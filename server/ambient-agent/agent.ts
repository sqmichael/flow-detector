/**
 * Ambient Agent - Main Orchestrator
 *
 * Connects to watch relay, monitors biometric signals, and triggers
 * contextual interventions based on detected patterns.
 *
 * Three behaviors:
 * A. Flow Protection - Silence during stable/focused periods
 * B. Proactive Check-in - When stress pattern detected
 * C. Evening Reflection - Recovery window prompts
 */

import WebSocket from "ws";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { HRVCalculator } from "./hrv-calculator";
import {
  detectFlowState,
  detectStressPattern,
  shouldTriggerEveningReflection,
  estimateBaseline,
  detectLowEnergy,
  type SensorSample,
  type HRVSample,
} from "./detectors";
import {
  executeIntervention,
  createIntervention,
  disableFocusMode,
  enableFocusMode,
  sendPushNotification,
} from "./interventions";
import {
  decideTimingPolicy,
  type TimingPolicyContext,
  type TimingMode,
  type TimingLocation,
  type CalendarPressure,
} from "./timing-policy";
import { InterventionLogger, EnergyLogger, logGapEvent } from "./logger";
import { decideIntervention, buildReasoningInput } from "./reasoning";
import { queryOpenClaw, isInFallbackMode, getOpenClawStatus } from "./openclaw-bridge";
import {
  buildOpenClawContext,
  buildOpenClawDecisionPrompt,
  deriveWatchQualityStatus,
  fetchCalendarContext,
  isCurrentlyInEvent,
  type OpenClawContext,
} from "./openclaw-context";
import type { CalendarContext } from "./openclaw-context";
import { buildDynamicContext } from "./dynamic-context";
import type { DynamicContext } from "./dynamic-context";
import { upsertCalendarEvents } from "../sensor-fusion/database";
import {
  DEFAULT_CONFIG,
  type AmbientAgentConfig,
  type AmbientAgentState,
  type PersonalBaseline,
  type Intervention,
  type BatchMessage,
  type OpenClawResponse,
  type OpenClawAction,
} from "./types";

// Memory layer for warmth tracking
import { getUserState, getWarmthDescription } from "../calling/memory";

// Re-export WatchMessage types for the agent
interface WatchHeartRate {
  type: "hr";
  bpm: number;
  ibi: number | null;
  quality: number;
  timestamp: number;
}

interface WatchEDA {
  type: "eda";
  scl: number;
  timestamp: number;
}

interface WatchStatus {
  type: "watch_status";
  connected: boolean;
  deviceName: string | null;
  timestamp: number;
}

interface WatchHandshake {
  type: "handshake";
  protocolVersion: number;
  deviceName: string;
  sensors: string[];
  timestamp: number;
}

// Batch messages use the BatchMessage type from ./types

type IncomingMessage = WatchHeartRate | WatchEDA | WatchStatus | WatchHandshake | BatchMessage;

// ── Constants ───────────────────────────────────────────────────────

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const HR_HISTORY_SIZE = 60 * 60; // 1 hour of samples at 1 Hz
const HRV_HISTORY_SIZE = 60 * 10; // 10 minutes of HRV samples

// ── Gap Handling Constants ─────────────────────────────────────────
const GAP_CLEAR_THRESHOLD_MS = 5 * 60 * 1000; // 5 min — clear stale history
const GAP_DEBOUNCE_MS = 5000; // 5s — ignore rapid flaps
const WARMUP_BATCHES = 2; // 2 batches (~60s) before resuming detection
const BACKFILL_MAX_AGE_MS = 60 * 60 * 1000; // 1 hr — discard old backfill
const MESSAGE_DEDUPE_MIN_COOLDOWN_MS = 60 * 1000; // 60s
const PROVISIONAL_BASELINE_MIN_HR_SAMPLES = 10;
const STABLE_BASELINE_MIN_HR_SAMPLES = 30;

type BaselineStage = "none" | "provisional" | "stable";
type PushTimingGateDecision = {
  messageNow: boolean;
  reason: string;
  delayMinutes: number | null;
};

const TIMING_MODES: ReadonlySet<TimingMode> = new Set(["focus", "meeting", "transit", "free"]);
const TIMING_LOCATIONS: ReadonlySet<TimingLocation> = new Set(["home", "office", "transit", "other", "unknown"]);
const CALENDAR_PRESSURES: ReadonlySet<CalendarPressure> = new Set(["low", "medium", "high"]);

export function hasMissingCalendarTimingContext(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;

  return !Object.hasOwn(obj, "calendar_pressure") || !Object.hasOwn(obj, "next_free_window_minutes");
}

function normalizeTimingContext(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  let normalized = raw;

  if (!Object.hasOwn(obj, "next_free_window_minutes")) {
    normalized = {
      ...obj,
      next_free_window_minutes: null,
    };
  }

  if (!Object.hasOwn(obj, "calendar_pressure")) {
    normalized = {
      ...(normalized as Record<string, unknown>),
      calendar_pressure: "high",
    };
  }

  return normalized;
}

function deriveCalendarPressure(calendar: CalendarContext): CalendarPressure {
  if (calendar.inMeeting) return "high";
  if (calendar.minutesToNext !== null) {
    if (calendar.minutesToNext <= 15) return "high";
    if (calendar.minutesToNext <= 60) return "medium";
  }
  if (calendar.upcoming.length > 0) return "medium";
  return "low";
}

function enrichTimingContextWithCalendar(raw: unknown, calendar: CalendarContext | null): unknown {
  if (!raw || typeof raw !== "object") return raw;
  if (!calendar) return raw;

  const obj = raw as Record<string, unknown>;
  const hasCalendarPressure = Object.hasOwn(obj, "calendar_pressure");
  const hasNextFreeWindowMinutes = Object.hasOwn(obj, "next_free_window_minutes");
  if (hasCalendarPressure && hasNextFreeWindowMinutes) return raw;

  return {
    ...obj,
    ...(hasCalendarPressure ? {} : { calendar_pressure: deriveCalendarPressure(calendar) }),
    ...(hasNextFreeWindowMinutes ? {} : { next_free_window_minutes: calendar.minutesToNext }),
  };
}

function parseTimingContext(raw: unknown): TimingPolicyContext | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.can_message_now !== "boolean") return null;
  if (typeof obj.current_mode !== "string" || !TIMING_MODES.has(obj.current_mode as TimingMode)) return null;
  if (
    obj.next_free_window_minutes !== null &&
    (typeof obj.next_free_window_minutes !== "number" || Number.isNaN(obj.next_free_window_minutes))
  ) {
    return null;
  }
  if (typeof obj.location_type !== "string" || !TIMING_LOCATIONS.has(obj.location_type as TimingLocation)) return null;
  if (
    typeof obj.calendar_pressure !== "string" ||
    !CALENDAR_PRESSURES.has(obj.calendar_pressure as CalendarPressure)
  ) {
    return null;
  }

  return {
    canMessageNow: obj.can_message_now,
    currentMode: obj.current_mode as TimingMode,
    nextFreeWindowMinutes: obj.next_free_window_minutes as number | null,
    locationType: obj.location_type as TimingLocation,
    calendarPressure: obj.calendar_pressure as CalendarPressure,
  };
}

export function evaluatePushTimingGate(raw: unknown, calendar: CalendarContext | null = null): PushTimingGateDecision {
  const withCalendar = enrichTimingContextWithCalendar(raw, calendar);
  const normalized = normalizeTimingContext(withCalendar);

  if (hasMissingCalendarTimingContext(normalized)) {
    return { messageNow: false, reason: "missing_calendar_context", delayMinutes: null };
  }

  const context = parseTimingContext(normalized);
  if (!context) {
    return { messageNow: false, reason: "bad_or_unknown_context", delayMinutes: null };
  }

  const decision = decideTimingPolicy(context);
  return {
    messageNow: decision.messageNow,
    reason: decision.reason,
    delayMinutes: decision.delayMinutes,
  };
}

// ── Quiet Hours Check ───────────────────────────────────────────────

/**
 * Check if current time is within quiet hours (no interventions allowed)
 * Uses configured timezone offset to calculate local time
 */
function isInQuietHours(config: AmbientAgentConfig): boolean {
  const now = new Date();
  // Get UTC hours and apply timezone offset (handles negative offsets)
  const utcHour = now.getUTCHours();
  const localHour = ((utcHour + config.quietHours.timezoneOffset) % 24 + 24) % 24;

  const { startHour, endHour } = config.quietHours;

  // Handle overnight quiet hours (e.g., 22:00 to 07:00)
  if (startHour > endHour) {
    // Quiet if after start OR before end
    return localHour >= startHour || localHour < endHour;
  } else {
    // Quiet if between start and end
    return localHour >= startHour && localHour < endHour;
  }
}

// ── Ambient Agent Class ─────────────────────────────────────────────

export class AmbientAgent {
  private config: AmbientAgentConfig;
  private state: AmbientAgentState;
  private ws: WebSocket | null = null;
  private hrvCalculator: HRVCalculator;
  private logger: InterventionLogger;
  private energyLogger: EnergyLogger;

  // Sensor history for detection
  private hrHistory: SensorSample[] = [];
  private hrvHistory: HRVSample[] = [];

  // Reconnection state
  private reconnectAttempt = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  // Processing interval
  private processingInterval: NodeJS.Timeout | null = null;

  // Heartbeat interval (debug notifications)
  private heartbeatInterval: NodeJS.Timeout | null = null;

  // OpenClaw control
  private useOpenClaw: boolean;

  // Track executed decision IDs for idempotency
  private executedDecisions: Set<string> = new Set();

  // Timestamp of the last batch that included a location field (ms)
  private lastLocationReceivedAt: number | null = null;
  private lastDecisionWindowStart: number | null = null;
  private lastDecisionWindowEnd: number | null = null;
  private lastDecisionWindowMs: number = 30_000;
  private baselineStage: BaselineStage = "none";
  private baselineFilePath: string;
  private ignorePersistedInterventions: boolean;

  constructor(
    config: Partial<AmbientAgentConfig> = {},
    options?: { useOpenClaw?: boolean; ignorePersistedInterventions?: boolean }
  ) {
    // Deep merge config with DEFAULT_CONFIG
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      flowDetection: { ...DEFAULT_CONFIG.flowDetection, ...config.flowDetection },
      stressDetection: { ...DEFAULT_CONFIG.stressDetection, ...config.stressDetection },
      eveningReflection: {
        ...DEFAULT_CONFIG.eveningReflection,
        ...config.eveningReflection,
        recoveryIndicators: {
          ...DEFAULT_CONFIG.eveningReflection.recoveryIndicators,
          ...config.eveningReflection?.recoveryIndicators,
        },
      },
      quietHours: { ...DEFAULT_CONFIG.quietHours, ...config.quietHours },
      openclaw: { ...DEFAULT_CONFIG.openclaw, ...config.openclaw },
    };
    this.useOpenClaw = options?.useOpenClaw ?? this.config.openclaw.enabled;
    this.ignorePersistedInterventions = options?.ignorePersistedInterventions ?? false;
    this.hrvCalculator = new HRVCalculator();
    this.logger = new InterventionLogger(this.config.logPath);
    this.energyLogger = new EnergyLogger(
      this.config.logPath.replace(".jsonl", "-energy.jsonl"),
      5 // Log at most every 5 minutes
    );
    this.baselineFilePath = join(dirname(this.config.logPath), "baseline-state.json");

    this.state = this.createInitialState();

    this.log("Ambient Agent initialized");
    this.log(`OpenClaw: ${this.useOpenClaw ? "ENABLED" : "DISABLED (using reasoning.ts)"}`);
    this.log("Config:", JSON.stringify({
      relayUrl: this.config.relayUrl,
      quietHours: this.config.quietHours,
      maxInterventionsPerDay: this.config.maxInterventionsPerDay,
      openclawEnabled: this.config.openclaw.enabled,
    }));
  }

  private createInitialState(): AmbientAgentState {
    return {
      isConnected: false,
      isWatchConnected: false,
      watchDeviceName: null,

      connectionState: "disconnected",
      disconnectedAt: null,
      reconnectedAt: null,
      batchesSinceReconnect: 0,

      currentHR: null,
      currentHRV: null,
      currentSCL: null,
      currentStillness: null,
      currentLocation: null,
      lastSensorUpdate: null,
      watchQuality: null,

      baseline: null,

      flowProtection: {
        inFlowMode: false,
        flowModeStartedAt: null,
        stableMinutes: 0,
        lastHapticAt: null,
        hapticsThisHour: 0,
      },

      stressDetection: {
        isElevated: false,
        elevationStartedAt: null,
        elevatedMinutes: 0,
        checkinOfferedToday: false,
      },

      eveningReflection: {
        reflectionOfferedToday: false,
        reflectionOfferedAt: null,
        recoveryDetected: false,
      },

      interventionsToday: [],
      startedAt: Date.now(),
    };
  }

  private log(...args: unknown[]) {
    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] [Agent]`, ...args);
  }

  /**
   * Update the main agent's BIOMETRIC_CONTEXT.md file so it has access
   * to the latest sensor data in its workspace context.
   */
  private updateMainAgentContext(context: OpenClawContext): void {
    try {
      const { spawnSync } = require("child_process");
      const contextJson = JSON.stringify(context);
      const writerCandidates = [
        process.env.OPENCLAW_CONTEXT_WRITER,
        "/root/flow-detector/.openclaw-workspace/scripts/update-biometric-context.py",
        "/home/michael/.openclaw/workspace/scripts/update-biometric-context.py",
      ].filter((value): value is string => typeof value === "string" && value.length > 0);

      for (const writerPath of writerCandidates) {
        if (!existsSync(writerPath)) continue;
        const result = spawnSync("python3", [writerPath], {
          input: contextJson,
          encoding: "utf-8",
          timeout: 5000,
        });
        if (result.status === 0) {
          return;
        }
        if (result.stderr) {
          this.log(`[MainContext] Update failed via ${writerPath}: ${result.stderr}`);
        }
      }

      // Fallback: write context locally so OpenClaw workspace tools can still read it.
      try {
        const fallbackPath = ".openclaw-workspace/BIOMETRIC_CONTEXT.json";
        writeFileSync(fallbackPath, JSON.stringify(context, null, 2));
      } catch (fallbackErr) {
        this.log(`[MainContext] Fallback write failed: ${String(fallbackErr)}`);
      }
    } catch (err) {
      // Non-critical — don't break the ambient agent if this fails
      this.log(`[MainContext] Error: ${err}`);
    }
  }

  // ── Connection Management ───────────────────────────────────────

  async start(): Promise<void> {
    this.log("Starting agent...");

    // Ensure data directory exists
    mkdirSync(dirname(this.config.logPath), { recursive: true });
    this.loadPersistedBaseline();

    // Load today's interventions from log
    const todayInterventionsRaw = this.ignorePersistedInterventions
      ? []
      : await this.logger.getTodayInterventions();
    const todayInterventions = todayInterventionsRaw.filter(
      (i): i is Intervention =>
        Boolean(i) &&
        typeof i === "object" &&
        typeof i.type === "string" &&
        typeof i.triggeredAt === "number"
    );
    this.state.interventionsToday = todayInterventions;

    // Check if we've already done interventions today
    this.state.stressDetection.checkinOfferedToday = todayInterventions.some(
      (i) => i.type === "proactive_checkin"
    );
    this.state.eveningReflection.reflectionOfferedToday = todayInterventions.some(
      (i) => i.type === "evening_reflection"
    );

    this.log(
      this.ignorePersistedInterventions
        ? "Loaded 0 interventions from today (test-mode reset)"
        : `Loaded ${todayInterventions.length} interventions from today`
    );

    this.connect();
    this.startProcessingLoop();
    this.startHeartbeat();
  }

  private loadPersistedBaseline(): void {
    try {
      if (!existsSync(this.baselineFilePath)) return;
      const raw = readFileSync(this.baselineFilePath, "utf-8");
      const parsed = JSON.parse(raw) as {
        baseline?: PersonalBaseline;
        stage?: BaselineStage;
      };
      if (!parsed.baseline) return;

      const baseline = parsed.baseline;
      if (
        typeof baseline.restingHR !== "number" ||
        typeof baseline.baselineHRV !== "number" ||
        typeof baseline.updatedAt !== "number"
      ) {
        this.log("[Baseline] Persisted baseline invalid, ignoring");
        return;
      }

      this.state.baseline = baseline;
      this.baselineStage = parsed.stage === "stable" ? "stable" : "provisional";
      this.log(
        `[Baseline] Loaded persisted ${this.baselineStage} baseline: HR=${baseline.restingHR}bpm, HRV=${baseline.baselineHRV.toFixed(1)}ms`
      );
    } catch (err) {
      this.log(`[Baseline] Failed to load persisted baseline: ${String(err)}`);
    }
  }

  private persistBaseline(stage: Exclude<BaselineStage, "none">): void {
    if (!this.state.baseline) return;
    try {
      writeFileSync(
        this.baselineFilePath,
        JSON.stringify(
          {
            baseline: this.state.baseline,
            stage,
            savedAt: Date.now(),
          },
          null,
          2
        )
      );
    } catch (err) {
      this.log(`[Baseline] Persist failed (non-fatal): ${String(err)}`);
    }
  }

  stop(): void {
    this.log("Stopping agent...");

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Disable Focus Mode if active
    if (this.state.flowProtection.inFlowMode) {
      disableFocusMode();
    }
  }

  private connect(): void {
    this.log(`Connecting to relay: ${this.config.relayUrl}`);

    this.ws = new WebSocket(this.config.relayUrl);

    this.ws.on("open", () => {
      this.log("Connected to relay");
      this.state.isConnected = true;
      this.reconnectAttempt = 0;
    });

    this.ws.on("message", (data: Buffer) => {
      this.handleMessage(data.toString());
    });

    this.ws.on("close", (code, reason) => {
      this.log(`Disconnected: code=${code}, reason=${reason.toString()}`);
      this.state.isConnected = false;
      this.state.isWatchConnected = false;
      this.scheduleReconnect();
    });

    this.ws.on("error", (error) => {
      this.log(`Connection error: ${error.message}`);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;

    const delay =
      RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt++;

    this.log(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempt})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  // ── Message Handling ────────────────────────────────────────────

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as IncomingMessage;

      switch (msg.type) {
        case "handshake":
          this.handleHandshake(msg);
          break;

        case "watch_status":
          this.handleWatchStatus(msg);
          break;

        case "hr":
          this.handleHeartRate(msg);
          break;

        case "eda":
          this.handleEDA(msg);
          break;

        case "batch":
          this.handleBatch(msg);
          break;
      }
    } catch (error) {
      this.log("Failed to parse message:", error);
    }
  }

  private handleHandshake(msg: WatchHandshake): void {
    this.log(`Watch handshake: ${msg.deviceName}, sensors: ${msg.sensors.join(", ")}`);
    this.state.watchDeviceName = msg.deviceName;
  }

  private handleWatchStatus(msg: WatchStatus): void {
    this.state.isWatchConnected = msg.connected;
    this.state.watchDeviceName = msg.deviceName;

    if (msg.connected) {
      // Already connected or warming up — ignore duplicate connected messages
      if (this.state.connectionState !== "disconnected") {
        return;
      }

      // First connect (never disconnected before) — go straight to connected
      if (this.state.disconnectedAt === null) {
        this.state.connectionState = "connected";
        this.log(`Watch connected: ${msg.deviceName}`);
        return;
      }

      // Calculate gap duration
      const gapMs = Date.now() - this.state.disconnectedAt;

      // Debounce: sub-5s flaps → connected immediately, no warm-up, no gap event
      if (gapMs < GAP_DEBOUNCE_MS) {
        this.state.connectionState = "connected";
        this.log(`Watch reconnected: ${msg.deviceName} (gap ${Math.round(gapMs / 1000)}s — debounced)`);
        return;
      }

      // Long gap: clear stale history, retain baseline (marked stale-by-age via updatedAt)
      if (gapMs >= GAP_CLEAR_THRESHOLD_MS) {
        this.hrHistory.length = 0;
        this.hrvHistory.length = 0;
        this.log(`Clearing stale history after ${Math.round(gapMs / 1000)}s gap (baseline retained)`);
      }

      // All non-debounced gaps: enter warm-up, log gap event
      this.state.connectionState = "warming_up";
      this.state.batchesSinceReconnect = 0;
      this.state.reconnectedAt = Date.now();

      logGapEvent({
        type: "gap",
        disconnectedAt: this.state.disconnectedAt,
        reconnectedAt: this.state.reconnectedAt,
        gapDurationMs: gapMs,
        batchesDuringWarmup: 0, // Updated when warm-up completes
      }, this.config.logPath);

      this.log(`Watch reconnected: ${msg.deviceName} (gap ${Math.round(gapMs / 1000)}s — warming up)`);
    } else {
      // Disconnect
      this.state.connectionState = "disconnected";
      this.state.disconnectedAt = Date.now();
      this.state.currentLocation = null;
      this.lastLocationReceivedAt = null;
      this.log("Watch disconnected");
    }
  }

  private handleHeartRate(msg: WatchHeartRate): void {
    // Validate HR
    if (msg.bpm < 30 || msg.bpm > 220) return;

    this.state.currentHR = msg.bpm;
    this.state.lastSensorUpdate = msg.timestamp;
    this.state.watchQuality = msg.quality;

    // Add to history
    this.hrHistory.push({ hr: msg.bpm, timestamp: msg.timestamp });
    if (this.hrHistory.length > HR_HISTORY_SIZE) {
      this.hrHistory.shift();
    }

    // Process IBI for HRV
    if (msg.ibi !== null && msg.ibi >= 200 && msg.ibi <= 2000) {
      this.hrvCalculator.addIBI(msg.ibi, msg.timestamp);

      const hrv = this.hrvCalculator.calculate();
      if (hrv) {
        this.state.currentHRV = hrv.rmssd;

        this.hrvHistory.push({ rmssd: hrv.rmssd, timestamp: hrv.timestamp });
        if (this.hrvHistory.length > HRV_HISTORY_SIZE) {
          this.hrvHistory.shift();
        }
      }
    }
  }

  private handleEDA(msg: WatchEDA): void {
    this.state.currentSCL = msg.scl;
  }

  private handleBatch(msg: BatchMessage): void {
    // Discard stale backfill batches (>1hr old)
    const batchAge = Date.now() - msg.timestamp;
    if (batchAge > BACKFILL_MAX_AGE_MS) {
      this.log(`Discarding stale backfill batch (age: ${Math.round(batchAge / 1000)}s)`);
      return;
    }

    // Warm-up tracking: count batches since reconnect
    if (this.state.connectionState === "warming_up") {
      this.state.batchesSinceReconnect++;
      if (this.state.batchesSinceReconnect >= WARMUP_BATCHES) {
        this.state.connectionState = "connected";
        this.log(`Warm-up complete after ${this.state.batchesSinceReconnect} batches`);
      }
    }

    const hasHR = msg.hr && msg.hr.samples > 0;
    const hasEDA = msg.eda && msg.eda.meanScl > 0;
    const hasLocation = !!msg.location;
    const windowMs = Number.isFinite(msg.windowMs) && msg.windowMs > 0 ? msg.windowMs : 30_000;

    this.lastDecisionWindowMs = windowMs;
    this.lastDecisionWindowEnd = msg.timestamp;
    this.lastDecisionWindowStart = Math.max(0, msg.timestamp - windowMs);

    // Always update timestamp — watch is alive even if HR is between bursts
    this.state.lastSensorUpdate = msg.timestamp;

    // Mark watch as connected when receiving batches
    if (!this.state.isWatchConnected) {
      this.state.isWatchConnected = true;
      this.state.connectionState = "connected";
    }

    const hrInfo = hasHR ? `HR=${msg.hr!.mean.toFixed(0)} (${msg.hr!.samples} samples)` : "HR=none";
    const hrvInfo = msg.hrv ? `HRV=${msg.hrv.rmssd.toFixed(1)}ms` : "";
    const edaInfo = hasEDA ? `SCL=${msg.eda!.meanScl.toFixed(2)}µS` : "";
    const locInfo = hasLocation ? ", Loc=present" : "";
    this.log(`Batch: ${hrInfo}, ${hrvInfo}, ${edaInfo}${locInfo}`);

    // Update sensor values from batch aggregates
    if (hasHR) {
      this.state.currentHR = Math.round(msg.hr!.mean);
      this.hrHistory.push({ hr: Math.round(msg.hr!.mean), timestamp: msg.timestamp });
      if (this.hrHistory.length > HR_HISTORY_SIZE) {
        this.hrHistory.shift();
      }
    }
    if (msg.hrv && msg.hrv.rmssd > 0) {
      const hrvSamples = msg.hrv.samples ?? 0;
      const hasReliableSampleCount = hrvSamples >= 8;
      const rmssdPlausible = msg.hrv.rmssd >= 8 && msg.hrv.rmssd <= 220;
      if (hasReliableSampleCount && rmssdPlausible) {
        this.state.currentHRV = msg.hrv.rmssd;
        this.hrvHistory.push({ rmssd: msg.hrv.rmssd, timestamp: msg.timestamp });
        if (this.hrvHistory.length > HRV_HISTORY_SIZE) {
          this.hrvHistory.shift();
        }
      } else {
        this.log(
          `[HRV] Ignoring low-confidence RMSSD=${msg.hrv.rmssd.toFixed(1)}ms (samples=${hrvSamples})`
        );
      }
    }
    if (hasEDA) {
      this.state.currentSCL = msg.eda!.meanScl;
    }
    if (msg.accel && typeof msg.accel.stillness === "number") {
      this.state.currentStillness = msg.accel.stillness;
    }

    // Location staleness: only update if present; null out if absent and >5min stale
    if (msg.location) {
      this.state.currentLocation = msg.location;
      this.lastLocationReceivedAt = msg.timestamp;
    } else if (this.lastLocationReceivedAt !== null) {
      const LOCATION_STALE_MS = 5 * 60 * 1000; // 5 minutes
      const ageMs = msg.timestamp - this.lastLocationReceivedAt;
      if (ageMs > LOCATION_STALE_MS) {
        this.state.currentLocation = null;
        this.lastLocationReceivedAt = null;
        this.log("[Location] Stale location cleared (no update for >5min)");
      }
      // else: location is recent enough — keep it
    }
    // else: never had a location — currentLocation stays null
  }

  // ── Processing Loop ─────────────────────────────────────────────

  private startProcessingLoop(): void {
    // Process every 30 seconds (accommodates OpenClaw CLI latency)
    this.processingInterval = setInterval(() => {
      this.processDetection();
      // Also update main agent context file if watch is connected
      if (this.state.isWatchConnected) {
        this.updateMainAgentContextPeriodic();
      }
    }, 30000);
  }

  /**
   * Periodic context update for the main agent (includes calendar).
   */
  private async updateMainAgentContextPeriodic(): Promise<void> {
    const calendar = await fetchCalendarContext(this.config.quietHours.timezoneOffset);

    // Persist calendar events to SQLite (async, best-effort)
    if (calendar?.upcoming?.length) {
      try {
        const sessionId = this.state.sessionId || "ambient";
        const inserts = calendar.upcoming
          .filter(e => e.uid) // Only persist events with UIDs
          .map(e => ({
            session_id: sessionId,
            event_uid: e.uid!,
            summary: e.summary,
            start_ts: new Date(e.start).getTime(),
            end_ts: new Date(e.end).getTime(),
            status: e.status,
            event_type: e.eventType ?? null,
            is_all_day: e.isAllDay ? 1 : 0,
            raw_json: JSON.stringify(e),
          }));
        if (inserts.length > 0) {
          const count = upsertCalendarEvents(inserts);
          this.log(`[Calendar] Persisted ${count} events to SQLite`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log(`[Calendar] Persist failed (non-fatal): ${msg}`);
      }
    }

    const context = buildOpenClawContext(
      this.state,
      this.state.baseline,
      this.state.interventionsToday,
      this.config.maxInterventionsPerDay,
      this.config.quietHours.timezoneOffset,
      calendar
    );
    this.updateMainAgentContext(context);
  }

  // ── Heartbeat / Daily Summary ──────────────────────────────────────

  private startHeartbeat(): void {
    // Optional startup notification (disabled by default to reduce noise).
    if (process.env.AGENT_STARTUP_PUSH === "1") {
      setTimeout(() => this.sendStartupPush(), 10000);
    }

    // Schedule daily summary at 9pm local time, then every 24h
    this.scheduleDailySummary();
  }

  private async sendStartupPush(): Promise<void> {
    const message = "Agent started. Monitoring active.";
    await sendPushNotification("Agent Online", message, "low");
    this.log(`Startup push sent: ${message}`);
  }

  private scheduleDailySummary(): void {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const localHour = ((utcHour + this.config.quietHours.timezoneOffset) % 24 + 24) % 24;

    // Calculate ms until 9pm local time (21:00)
    let hoursUntil9pm = 21 - localHour;
    if (hoursUntil9pm <= 0) hoursUntil9pm += 24;
    const msUntil9pm = hoursUntil9pm * 60 * 60 * 1000
      - now.getUTCMinutes() * 60 * 1000
      - now.getUTCSeconds() * 1000;

    setTimeout(async () => {
      await this.sendDailySummaryPush();
      // Then every 24 hours
      this.heartbeatInterval = setInterval(() => {
        this.sendDailySummaryPush();
      }, 24 * 60 * 60 * 1000);
    }, msUntil9pm);

    const hours = Math.floor(msUntil9pm / (60 * 60 * 1000));
    const mins = Math.floor((msUntil9pm % (60 * 60 * 1000)) / (60 * 1000));
    this.log(`Daily summary scheduled in ${hours}h ${mins}m (9pm local)`);
  }

  private async sendDailySummaryPush(): Promise<void> {
    const interventionCount = this.state.interventionsToday.length;
    const rated = this.state.interventionsToday.filter(i => i.rating).length;
    const flowMinutes = this.state.flowProtection.stableMinutes;
    const stressMinutes = this.state.stressDetection.elevatedMinutes;

    const message = [
      `Interventions: ${interventionCount} (${rated} rated)`,
      `Flow: ${flowMinutes}m | Stress: ${stressMinutes}m`,
    ].join("\n");

    await sendPushNotification("Daily Summary", message, "low");
    this.log(`Daily summary sent: ${interventionCount} interventions, ${rated} rated`);
  }

  private async processDetection(): Promise<void> {
    // Establish provisional baseline quickly, then promote to stable baseline
    if (!this.state.baseline && this.hrHistory.length >= PROVISIONAL_BASELINE_MIN_HR_SAMPLES) {
      const baseline = estimateBaseline(this.hrHistory, this.hrvHistory);
      if (baseline) {
        this.state.baseline = baseline;
        this.baselineStage = "provisional";
        this.persistBaseline("provisional");
        this.log(
          `Baseline established (provisional): HR=${baseline.restingHR}bpm, HRV=${baseline.baselineHRV.toFixed(1)}ms`
        );
      }
    } else if (
      this.state.baseline &&
      this.baselineStage !== "stable" &&
      this.hrHistory.length >= STABLE_BASELINE_MIN_HR_SAMPLES
    ) {
      const baseline = estimateBaseline(this.hrHistory, this.hrvHistory);
      if (baseline) {
        this.state.baseline = baseline;
        this.baselineStage = "stable";
        this.persistBaseline("stable");
        this.log(
          `Baseline promoted to stable: HR=${baseline.restingHR}bpm, HRV=${baseline.baselineHRV.toFixed(1)}ms`
        );
      }
    }

    // Hard gate: with bad watch quality, skip biometric inference entirely.
    if (deriveWatchQualityStatus(this.state.watchQuality) === "bad") {
      this.resetBiometricDetectionsForBadQuality();
      const dq = this.checkDisqualifiers();
      if (dq) {
        this.log(`[DQ] ${dq}`);
      }
      return;
    }

    // Run all detectors to update state
    this.updateDetectorState();

    // Code-side disqualifiers — deterministic checks that don't need LLM
    const dq = this.checkDisqualifiers();
    if (dq) {
      this.log(`[DQ] ${dq}`);
      // Still check flow mode exit and log energy even when disqualified
      await this.checkFlowModeExit();
      await this.logEnergyState();
      return;
    }

    // Check if any detector flagged something worth deciding on
    const needsDecision = this.needsDecision();

    if (needsDecision) {
      if (this.useOpenClaw && !isInFallbackMode(this.config.openclaw)) {
        await this.processViaOpenClaw();
      } else {
        // Fallback: use reasoning.ts (original per-behavior path)
        await this.processViaReasoning();
      }
    }

    // Handle flow mode exit (always check, regardless of OpenClaw)
    await this.checkFlowModeExit();

    // Silent energy state logging (no intervention)
    await this.logEnergyState();
  }

  /**
   * When watch quality is bad, prevent stale detector state from driving any
   * stress/flow/recovery inference until quality recovers.
   */
  private resetBiometricDetectionsForBadQuality(): void {
    this.state.flowProtection.stableMinutes = 0;
    this.state.stressDetection.isElevated = false;
    this.state.stressDetection.elevationStartedAt = null;
    this.state.stressDetection.elevatedMinutes = 0;
    this.state.eveningReflection.recoveryDetected = false;
  }

  /**
   * Code-side disqualifiers — deterministic boolean checks enforced before
   * the model is called. These are the checks that models consistently fail
   * on (eval showed 4/10 DQ misses across all models without this).
   *
   * Returns a reason string if disqualified, null if clear to proceed.
   */
  private checkDisqualifiers(): string | null {
    // Watch disconnected
    if (!this.state.isWatchConnected) {
      return "Watch disconnected — go silent";
    }

    // Watch quality check — hard gate
    if (deriveWatchQualityStatus(this.state.watchQuality) === "bad") {
      return "Watch quality bad — biometric data unreliable";
    }

    // Warming up after reconnect
    if (this.state.connectionState === "warming_up") {
      return `Warming up after reconnect — need ${WARMUP_BATCHES - this.state.batchesSinceReconnect} more batches`;
    }

    // No baseline established
    if (!this.state.baseline) {
      return "No baseline — can't make informed decisions";
    }

    // Quiet hours (night)
    if (isInQuietHours(this.config)) {
      return "Quiet hours — silence";
    }

    // Lunch break
    const localHour = this.getLocalHour();
    if (localHour >= 12 && localHour < 14) {
      return "Lunch break — leave user alone";
    }

    // Daily intervention limit reached
    if (this.state.interventionsToday.length >= this.config.maxInterventionsPerDay) {
      return "Daily intervention limit reached";
    }

    // Recent intervention (<2 hours ago)
    if (this.state.interventionsToday.length > 0) {
      const last = this.state.interventionsToday[this.state.interventionsToday.length - 1];
      const hoursSinceLast = (Date.now() - last.triggeredAt) / (1000 * 60 * 60);
      if (hoursSinceLast < 2) {
        return `Last intervention ${hoursSinceLast.toFixed(1)}h ago — too recent`;
      }
    }

    // Stress checkin already offered today
    if (this.state.stressDetection.checkinOfferedToday && this.state.stressDetection.isElevated) {
      return "Stress checkin already offered today";
    }

    // Reflection already offered today
    if (this.state.eveningReflection.reflectionOfferedToday && this.state.eveningReflection.recoveryDetected) {
      return "Reflection already offered today";
    }

    return null;
  }

  private getLocalHour(): number {
    const now = new Date();
    const utcHour = now.getUTCHours();
    return ((utcHour + this.config.quietHours.timezoneOffset) % 24 + 24) % 24;
  }

  /**
   * Update detector state from sensor data (no decisions, just state tracking)
   */
  private updateDetectorState(): void {
    // Flow detection
    const flowDetection = detectFlowState(this.hrHistory, this.config.flowDetection);
    this.state.flowProtection.stableMinutes = flowDetection.stableMinutes;

    // Stress detection
    const stressDetection = detectStressPattern(
      this.state.currentHR,
      this.state.currentHRV,
      this.state.baseline,
      this.state.stressDetection.elevationStartedAt,
      this.config.stressDetection,
      {
        hrHistory: this.hrHistory,
        currentSCL: this.state.currentSCL,
        baselineSCL: this.state.baseline?.baselineSCL ?? null,
        currentStillness: this.state.currentStillness,
      }
    );

    if (stressDetection.isStressed && !this.state.stressDetection.isElevated) {
      this.state.stressDetection.isElevated = true;
      this.state.stressDetection.elevationStartedAt = Date.now();
    } else if (!stressDetection.isStressed) {
      this.state.stressDetection.isElevated = false;
      this.state.stressDetection.elevationStartedAt = null;
    }
    this.state.stressDetection.elevatedMinutes = stressDetection.elevatedMinutes;
  }

  /**
   * Check if any detection warrants an LLM decision
   */
  private needsDecision(): boolean {
    const flow = detectFlowState(this.hrHistory, this.config.flowDetection);
    if (flow.shouldEnterFlowMode && !this.state.flowProtection.inFlowMode) return true;

    if (
      this.state.stressDetection.isElevated &&
      this.state.stressDetection.elevatedMinutes >= this.config.stressDetection.durationMinutes &&
      !this.state.stressDetection.checkinOfferedToday
    ) return true;

    const recovery = shouldTriggerEveningReflection(
      this.state.currentHR,
      this.state.currentHRV,
      this.state.baseline,
      this.state.eveningReflection.reflectionOfferedToday,
      this.config.eveningReflection,
      this.config.quietHours.timezoneOffset
    );
    if (recovery.shouldTrigger) return true;

    return false;
  }

  // ── OpenClaw Decision Path ─────────────────────────────────────

  private async processViaOpenClaw(): Promise<void> {
    // Fetch calendar context (best-effort, cached 2min)
    const calendar = await fetchCalendarContext(this.config.quietHours.timezoneOffset);
    const context = buildOpenClawContext(
      this.state,
      this.state.baseline,
      this.state.interventionsToday,
      this.config.maxInterventionsPerDay,
      this.config.quietHours.timezoneOffset,
      calendar
    );
    const buildPushSnapshotFeedback = (
      outcome: "sent" | "skipped",
      reason: string | null,
      deferredUntil: string | null = null,
      messageId: string | null = null,
      sentAt: string | null = null
    ): Record<string, unknown> => ({
      action: "send_push",
      outcome,
      reason,
      deferred_until: deferredUntil,
      message_id: messageId,
      sent_at: sentAt,
    });
    const logSnapshot = async (
      decision: unknown,
      sent: boolean,
      deferredUntil: string | null = null,
      messageId: string | null = null,
      sentAt: string | null = null,
      decisionReason: string | null = null,
      feedback: unknown = null
    ): Promise<void> => {
      await this.logger.logDecisionSnapshot({
        message_id: messageId,
        decision_reason: decisionReason,
        feedback,
        context,
        decision,
        sent,
        sent_at: sentAt,
        deferred_until: deferredUntil,
      });
    };

    // Calendar-based code-side disqualifiers
    if (calendar?.inMeeting) {
      this.log("[DQ] In meeting — suppressing");
      await logSnapshot({ reason: "calendar_in_meeting" }, false);
      return;
    }
    if (calendar && calendar.minutesToNext !== null && calendar.minutesToNext < 5) {
      this.log(`[DQ] Meeting in ${calendar.minutesToNext} min — suppressing`);
      await logSnapshot({ reason: "calendar_meeting_soon", minutesToNext: calendar.minutesToNext }, false);
      return;
    }

    // Focus Time: treat as flow — enable Focus Mode, suppress interventions
    const focusEvent = calendar?.upcoming.find(
      e => e.eventType === "focusTime" && isCurrentlyInEvent(e, undefined, this.config.quietHours.timezoneOffset)
    );
    if (focusEvent) {
      if (!this.state.flowProtection.inFlowMode) {
        this.state.flowProtection.inFlowMode = true;
        this.state.flowProtection.flowModeStartedAt = Date.now();
        await enableFocusMode();
      }
      this.log("[DQ] Calendar Focus Time active — protecting");
      await logSnapshot({ reason: "calendar_focus_time", summary: focusEvent.summary }, false);
      return;
    }

    // Out of Office: suppress all interventions
    const oooEvent = calendar?.upcoming.find(
      e => e.eventType === "outOfOffice" && isCurrentlyInEvent(e, undefined, this.config.quietHours.timezoneOffset)
    );
    if (oooEvent) {
      this.log("[DQ] Out of Office active — suppressing");
      await logSnapshot({ reason: "calendar_out_of_office", summary: oooEvent.summary }, false);
      return;
    }

    if (calendar === null) {
      this.log("[DQ] Calendar unavailable — being conservative");
      await logSnapshot({ reason: "calendar_unavailable" }, false);
      return;
    }

    const message = buildOpenClawDecisionPrompt(context);
    this.log(
      `[OpenClaw] Request payload: watchConnected=${context.sensors.watchConnected}, dataAgeSec=${context.sensors.dataAgeSec ?? "null"}, hr=${context.sensors.hr ?? "null"}, hrv=${context.sensors.hrv ?? "null"}, scl=${context.sensors.scl ?? "null"}`
    );

    // Also update the main agent's biometric context file
    this.updateMainAgentContext(context);

    const response = await queryOpenClaw(message, this.config.openclaw);

    this.log(
      `[OpenClaw] Decision: shouldIntervene=${response.shouldIntervene}, actions=${response.actions.length}`
    );
    const hasPushAction = response.actions.some((action) => action.type === "send_push");

    if (!response.shouldIntervene || response.actions.length === 0) {
      await logSnapshot(
        response,
        false,
        null,
        response.decisionId ?? null,
        null,
        hasPushAction ? "push_not_sent" : null,
        hasPushAction ? buildPushSnapshotFeedback("skipped", "push_not_sent") : null
      );
      return;
    }

    // Idempotency check
    if (response.decisionId && this.executedDecisions.has(response.decisionId)) {
      this.log(`[OpenClaw] Skipping duplicate decision: ${response.decisionId}`);
      await logSnapshot(
        response,
        false,
        null,
        response.decisionId ?? null,
        null,
        hasPushAction ? "duplicate_decision_id" : null,
        hasPushAction ? buildPushSnapshotFeedback("skipped", "duplicate_decision_id") : null
      );
      return;
    }

    const execution = await this.executeOpenClawActions(response, calendar);
    const snapshotMessageId = execution.messageId ?? response.decisionId ?? null;

    if (response.decisionId) {
      this.executedDecisions.add(response.decisionId);
    }
    await logSnapshot(
      response,
      execution.sent,
      execution.deferredUntil,
      snapshotMessageId,
      execution.sentAt,
      execution.decisionReason,
      execution.feedback
    );
  }

  /**
   * Execute OpenClaw action plan by mapping action types to existing intervention functions
   */
  private async executeOpenClawActions(response: OpenClawResponse, calendar: CalendarContext | null = null): Promise<{
    sent: boolean;
    deferredUntil: string | null;
    messageId: string | null;
    sentAt: string | null;
    decisionReason: string | null;
    feedback: unknown;
  }> {
    let sent = false;
    let deferredUntil: string | null = null;
    let messageId: string | null = null;
    let sentAt: string | null = null;
    let decisionReason: string | null = null;
    let feedback: unknown = null;

    for (const action of response.actions) {
      this.log(`[OpenClaw] Executing action: ${action.type}`);

      switch (action.type) {
        case "enable_focus_mode": {
          if (!this.state.flowProtection.inFlowMode) {
            this.state.flowProtection.inFlowMode = true;
            this.state.flowProtection.flowModeStartedAt = Date.now();

            const intervention = createIntervention("flow_protection", response.reasoning, {
              hr: this.state.currentHR ?? undefined,
              hrv: this.state.currentHRV ?? undefined,
              flowDurationMinutes: this.state.flowProtection.stableMinutes,
            });

            this.state.interventionsToday.push(intervention);
            await this.logger.logIntervention(intervention);
            await executeIntervention(intervention, { relayWs: this.ws ?? undefined });
            if (messageId === null) messageId = intervention.id;
            sent = true;
          }
          break;
        }

        case "disable_focus_mode": {
          if (this.state.flowProtection.inFlowMode) {
            this.state.flowProtection.inFlowMode = false;
            this.state.flowProtection.flowModeStartedAt = null;
            await disableFocusMode();
            sent = true;
          }
          break;
        }

        case "send_haptic": {
          const { sendWatchHaptic } = await import("./interventions");
          await sendWatchHaptic(this.ws, action.pattern || "gentle");
          sent = true;
          break;
        }

        case "send_push": {
          const actionWithTiming = action as OpenClawAction & { timing_policy?: unknown };
          const responseWithTiming = response as OpenClawResponse & { timing_policy?: unknown };
          const timingGate = evaluatePushTimingGate(
            actionWithTiming.timing_policy ?? responseWithTiming.timing_policy ?? null,
            calendar
          );
          if (!timingGate.messageNow) {
            this.log(`[OpenClaw] Skipping send_push: message_now=false (${timingGate.reason})`);
            if (decisionReason === null) {
              decisionReason = timingGate.reason;
            }
            if (
              timingGate.delayMinutes !== null &&
              timingGate.delayMinutes > 0
            ) {
              deferredUntil = new Date(
                Date.now() + timingGate.delayMinutes * 60 * 1000
              ).toISOString();
            }
            feedback = {
              action: "send_push",
              outcome: "skipped",
              reason: timingGate.reason,
              deferred_until: deferredUntil,
            };
            break;
          }

          const messageGuard = this.getMessageGuardDecision("proactive_checkin");
          if (messageGuard.skip) {
            this.log(`[OpenClaw] Skipping send_push: ${messageGuard.reason}`);
            if (decisionReason === null) {
              decisionReason = messageGuard.reason;
            }
            feedback = {
              action: "send_push",
              outcome: "skipped",
              reason: messageGuard.reason,
              deferred_until: deferredUntil,
            };
            break;
          }

          const msg = action.message || "Checking in";
          const intervention = createIntervention("proactive_checkin", response.reasoning, {
            hr: this.state.currentHR ?? undefined,
            hrv: this.state.currentHRV ?? undefined,
          });
          intervention.trigger.reason = msg;

          this.state.stressDetection.checkinOfferedToday = true;
          this.state.interventionsToday.push(intervention);
          await this.logger.logIntervention(intervention);
          await executeIntervention(intervention, { relayWs: this.ws ?? undefined });
          if (messageId === null) {
            messageId = intervention.id;
          }
          sentAt = new Date().toISOString();
          sent = true;
          decisionReason = "push_sent";
          feedback = {
            action: "send_push",
            outcome: "sent",
            reason: decisionReason,
            message_id: messageId,
            sent_at: sentAt,
            deferred_until: null,
          };
          break;
        }

        case "trigger_call": {
          const { triggerPhoneCall } = await import("./interventions");
          const intervention = createIntervention("proactive_checkin", response.reasoning, {
            hr: this.state.currentHR ?? undefined,
            hrv: this.state.currentHRV ?? undefined,
          });

          this.state.stressDetection.checkinOfferedToday = true;
          this.state.interventionsToday.push(intervention);
          await this.logger.logIntervention(intervention);
          await triggerPhoneCall(this.config.phoneNumber, "stress_check_in", action.message);
          if (messageId === null) messageId = intervention.id;
          sent = true;
          break;
        }

        case "send_reflection": {
          const intervention = createIntervention("evening_reflection", response.reasoning, {
            hr: this.state.currentHR ?? undefined,
            hrv: this.state.currentHRV ?? undefined,
          });

          this.state.eveningReflection.reflectionOfferedToday = true;
          this.state.eveningReflection.reflectionOfferedAt = Date.now();
          this.state.interventionsToday.push(intervention);
          await this.logger.logIntervention(intervention);
          await executeIntervention(intervention, { relayWs: this.ws ?? undefined });
          if (messageId === null) messageId = intervention.id;
          sent = true;
          break;
        }

        case "no_action":
          break;
      }
    }

    return { sent, deferredUntil, messageId, sentAt, decisionReason, feedback };
  }

  private getMessageGuardDecision(type: Intervention["type"]): { skip: boolean; reason: string } {
    const lastOfType = [...this.state.interventionsToday]
      .reverse()
      .find((entry) => entry.type === type);

    if (!lastOfType) {
      return { skip: false, reason: "no_prior_message" };
    }

    const windowMs = this.lastDecisionWindowMs;
    const cooldownMs = Math.max(windowMs * 2, MESSAGE_DEDUPE_MIN_COOLDOWN_MS);
    const now = Date.now();
    const withinCooldown = now - lastOfType.triggeredAt < cooldownMs;

    const hasDecisionWindow =
      this.lastDecisionWindowStart !== null && this.lastDecisionWindowEnd !== null;
    if (hasDecisionWindow) {
      const sameWindow =
        lastOfType.triggeredAt >= this.lastDecisionWindowStart! &&
        lastOfType.triggeredAt <= this.lastDecisionWindowEnd! + windowMs;
      if (sameWindow) {
        return { skip: true, reason: "duplicate_decision_window" };
      }
    }

    if (withinCooldown) {
      return { skip: true, reason: "message_cooldown_active" };
    }

    return { skip: false, reason: "clear" };
  }

  // ── Fallback: reasoning.ts Path (original behavior) ────────────

  private async processViaReasoning(): Promise<void> {
    this.log("[Fallback] Using reasoning.ts for decision");

    // Fetch calendar and build dynamic context once per decision cycle
    const calendar = await fetchCalendarContext(this.config.quietHours.timezoneOffset);
    const dynamicCtx = buildDynamicContext(this.state, this.state.baseline, calendar, undefined, this.config.quietHours.timezoneOffset);

    await this.processFlowProtection(dynamicCtx);
    await this.processStressDetection(dynamicCtx);
    await this.processEveningReflection(dynamicCtx);
  }

  /**
   * Check if flow mode should be exited (HR became unstable)
   * Runs independently of OpenClaw/reasoning decision path
   */
  private async checkFlowModeExit(): Promise<void> {
    const detection = detectFlowState(this.hrHistory, this.config.flowDetection);

    if (!detection.shouldEnterFlowMode && this.state.flowProtection.inFlowMode) {
      const flowDuration = this.state.flowProtection.flowModeStartedAt
        ? Math.floor((Date.now() - this.state.flowProtection.flowModeStartedAt) / (60 * 1000))
        : 0;

      this.log(`Flow mode ended after ${flowDuration} minutes`);

      this.state.flowProtection.inFlowMode = false;
      this.state.flowProtection.flowModeStartedAt = null;
      await disableFocusMode();
    }
  }

  private async logEnergyState(): Promise<void> {
    const energyState = detectLowEnergy(
      this.state.currentHR,
      this.state.currentHRV,
      this.state.currentSCL,
      this.config.quietHours.timezoneOffset
    );

    await this.energyLogger.logState(energyState);
  }

  // ── Behavior A: Flow Protection (fallback path) ────────────────

  private async processFlowProtection(dynamicCtx?: DynamicContext): Promise<void> {
    const detection = detectFlowState(this.hrHistory, this.config.flowDetection);

    if (detection.shouldEnterFlowMode && !this.state.flowProtection.inFlowMode) {
      const reasoningInput = buildReasoningInput(
        "flow",
        `Stable HR (variance ${detection.hrVariance.toFixed(1)} bpm) for ${detection.stableMinutes} minutes`,
        { hr: this.state.currentHR, hrv: this.state.currentHRV, scl: this.state.currentSCL },
        this.state.baseline,
        this.state.interventionsToday,
        { stableMinutes: detection.stableMinutes }
      );
      reasoningInput.dynamicContext = dynamicCtx;

      const decision = await decideIntervention(reasoningInput);

      if (!decision.shouldIntervene) {
        this.log(`Flow: LLM skipped - ${decision.reasoning}`);
        return;
      }

      this.state.flowProtection.inFlowMode = true;
      this.state.flowProtection.flowModeStartedAt = Date.now();

      const intervention = createIntervention("flow_protection", decision.reasoning, {
        hr: this.state.currentHR ?? undefined,
        hrv: this.state.currentHRV ?? undefined,
        flowDurationMinutes: detection.stableMinutes,
      }, dynamicCtx);

      this.state.interventionsToday.push(intervention);
      await this.logger.logIntervention(intervention);
      await executeIntervention(intervention, { relayWs: this.ws ?? undefined });
    }
  }

  // ── Behavior B: Proactive Check-in (fallback path) ─────────────

  private async processStressDetection(dynamicCtx?: DynamicContext): Promise<void> {
    if (this.state.stressDetection.checkinOfferedToday) return;
    const detection = {
      shouldTriggerCheckin:
        this.state.stressDetection.isElevated &&
        this.state.stressDetection.elevatedMinutes >= this.config.stressDetection.durationMinutes,
      elevatedMinutes: this.state.stressDetection.elevatedMinutes,
    };

    if (detection.shouldTriggerCheckin) {
      const reasoningInput = buildReasoningInput(
        "stress",
        `Elevated HR + suppressed HRV for ${detection.elevatedMinutes} minutes`,
        { hr: this.state.currentHR, hrv: this.state.currentHRV, scl: this.state.currentSCL },
        this.state.baseline,
        this.state.interventionsToday,
        { elevatedMinutes: detection.elevatedMinutes }
      );
      reasoningInput.dynamicContext = dynamicCtx;

      const decision = await decideIntervention(reasoningInput);

      if (!decision.shouldIntervene) {
        this.log(`Stress: LLM skipped - ${decision.reasoning}`);
        return;
      }

      this.state.stressDetection.checkinOfferedToday = true;

      const intervention = createIntervention("proactive_checkin", decision.reasoning, {
        hr: this.state.currentHR ?? undefined,
        hrv: this.state.currentHRV ?? undefined,
      }, dynamicCtx);
      if (decision.message) {
        intervention.trigger.reason = decision.message;
      }

      this.state.interventionsToday.push(intervention);
      await this.logger.logIntervention(intervention);
      await executeIntervention(intervention, {
        relayWs: this.ws ?? undefined,
        phoneNumber: this.config.phoneNumber,
      });
    }
  }

  // ── Behavior C: Evening Reflection (fallback path) ─────────────

  private async processEveningReflection(dynamicCtx?: DynamicContext): Promise<void> {
    const trigger = shouldTriggerEveningReflection(
      this.state.currentHR,
      this.state.currentHRV,
      this.state.baseline,
      this.state.eveningReflection.reflectionOfferedToday,
      this.config.eveningReflection,
      this.config.quietHours.timezoneOffset
    );

    if (trigger.shouldTrigger) {
      const reasoningInput = buildReasoningInput(
        "recovery",
        trigger.reason,
        { hr: this.state.currentHR, hrv: this.state.currentHRV, scl: this.state.currentSCL },
        this.state.baseline,
        this.state.interventionsToday
      );
      reasoningInput.dynamicContext = dynamicCtx;

      const decision = await decideIntervention(reasoningInput);

      if (!decision.shouldIntervene) {
        this.log(`Recovery: LLM skipped - ${decision.reasoning}`);
        return;
      }

      this.state.eveningReflection.reflectionOfferedToday = true;
      this.state.eveningReflection.reflectionOfferedAt = Date.now();

      const intervention = createIntervention("evening_reflection", decision.reasoning, {
        hr: this.state.currentHR ?? undefined,
        hrv: this.state.currentHRV ?? undefined,
      }, dynamicCtx);

      this.state.interventionsToday.push(intervention);
      await this.logger.logIntervention(intervention);
      await executeIntervention(intervention, { relayWs: this.ws ?? undefined });
    }
  }

  // ── Status ──────────────────────────────────────────────────────

  getState(): AmbientAgentState {
    return { ...this.state };
  }

  getStatus(): string {
    const lines = [
      "╔════════════════════════════════════╗",
      "║       AMBIENT AGENT STATUS         ║",
      "╠════════════════════════════════════╣",
    ];

    // Connection
    const connIcon = this.state.isConnected ? "🟢" : "🔴";
    const watchIcon = this.state.isWatchConnected ? "⌚" : "⌚";
    lines.push(`║ Relay: ${connIcon}  Watch: ${this.state.isWatchConnected ? "🟢" : "🔴"} ${this.state.watchDeviceName || "---"}`.padEnd(37) + "║");

    // Current sensors
    const watchQualityStatus = deriveWatchQualityStatus(this.state.watchQuality);
    if (watchQualityStatus === "bad") {
      lines.push("║ Watch quality bad".padEnd(37) + "║");
    } else {
      const hr = this.state.currentHR?.toFixed(0) ?? "---";
      const hrv = this.state.currentHRV?.toFixed(0) ?? "---";
      const scl = this.state.currentSCL?.toFixed(1) ?? "---";
      lines.push(`║ HR: ${hr} bpm  HRV: ${hrv} ms  SCL: ${scl}`.padEnd(37) + "║");
    }

    // Baseline
    if (this.state.baseline) {
      lines.push(
        `║ Baseline: HR=${this.state.baseline.restingHR} HRV=${this.state.baseline.baselineHRV.toFixed(0)}`.padEnd(37) + "║"
      );
    } else {
      lines.push("║ Baseline: Collecting...".padEnd(37) + "║");
    }

    lines.push("╠────────────────────────────────────╣");

    // Behavior states
    const flowIcon = this.state.flowProtection.inFlowMode ? "🛡️ " : "  ";
    lines.push(
      `║ ${flowIcon}Flow: ${this.state.flowProtection.stableMinutes}min stable`.padEnd(37) + "║"
    );

    const stressIcon = this.state.stressDetection.isElevated ? "⚠️ " : "  ";
    lines.push(
      `║ ${stressIcon}Stress: ${this.state.stressDetection.elevatedMinutes}min elevated`.padEnd(37) + "║"
    );

    const reflectDone = this.state.eveningReflection.reflectionOfferedToday ? "✓" : "-";
    const checkinDone = this.state.stressDetection.checkinOfferedToday ? "✓" : "-";
    lines.push(`║ Today: checkin[${checkinDone}] reflect[${reflectDone}]`.padEnd(37) + "║");

    lines.push("╠────────────────────────────────────╣");

    // Interventions today
    lines.push(`║ Interventions: ${this.state.interventionsToday.length}/${this.config.maxInterventionsPerDay}`.padEnd(37) + "║");

    // Warmth level from memory
    const userState = getUserState();
    const warmthDesc = getWarmthDescription(userState.warmth_level);
    lines.push(`║ Kai warmth: ${warmthDesc} (${userState.warmth_level.toFixed(1)})`.padEnd(37) + "║");

    // OpenClaw status
    if (this.useOpenClaw) {
      const ocStatus = getOpenClawStatus();
      const ocMode = ocStatus.inFallback
        ? `FALLBACK (${Math.ceil((ocStatus.fallbackRemainingMs ?? 0) / 1000)}s)`
        : `ACTIVE (${ocStatus.consecutiveFailures} fails)`;
      lines.push(`║ OpenClaw: ${ocMode}`.padEnd(37) + "║");
    } else {
      lines.push("║ OpenClaw: DISABLED".padEnd(37) + "║");
    }

    // Local time and quiet hours status
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMin = now.getUTCMinutes();
    const offset = this.config.quietHours.timezoneOffset;
    const localHour = ((utcHour + offset) % 24 + 24) % 24;
    const localTime = `${localHour.toString().padStart(2, "0")}:${utcMin.toString().padStart(2, "0")}`;
    const offsetStr = offset >= 0 ? `+${offset}` : `${offset}`;
    const quietStatus = isInQuietHours(this.config) ? "🌙 Quiet" : "🔔 Active";
    lines.push(`║ Local: ${localTime} (UTC${offsetStr}) ${quietStatus}`.padEnd(37) + "║");

    lines.push("╚════════════════════════════════════╝");

    return lines.join("\n");
  }

  // ── Rating Interface ────────────────────────────────────────────

  async rateLastIntervention(rating: Intervention["rating"]): Promise<boolean> {
    const last = this.state.interventionsToday[this.state.interventionsToday.length - 1];
    if (!last) return false;

    last.rating = rating;
    return await this.logger.updateRating(last.id, rating);
  }
}

// ── Export singleton for CLI ────────────────────────────────────────

let agentInstance: AmbientAgent | null = null;

export function getAgent(
  config?: Partial<AmbientAgentConfig>,
  options?: { useOpenClaw?: boolean; ignorePersistedInterventions?: boolean }
): AmbientAgent {
  if (!agentInstance) {
    agentInstance = new AmbientAgent(config, options);
  }
  return agentInstance;
}

export function stopAgent(): void {
  if (agentInstance) {
    agentInstance.stop();
    agentInstance = null;
  }
}
