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
import { mkdirSync } from "fs";
import { dirname } from "path";
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
import { InterventionLogger, EnergyLogger, logGapEvent } from "./logger";
import { decideIntervention, buildReasoningInput } from "./reasoning";
import { queryOpenClaw, isInFallbackMode, getOpenClawStatus } from "./openclaw-bridge";
import { buildOpenClawContext, fetchCalendarContext, isCurrentlyInEvent, type OpenClawContext } from "./openclaw-context";
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

  constructor(config: Partial<AmbientAgentConfig> = {}, options?: { useOpenClaw?: boolean }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.useOpenClaw = options?.useOpenClaw ?? this.config.openclaw.enabled;
    this.hrvCalculator = new HRVCalculator();
    this.logger = new InterventionLogger(this.config.logPath);
    this.energyLogger = new EnergyLogger(
      this.config.logPath.replace(".jsonl", "-energy.jsonl"),
      5 // Log at most every 5 minutes
    );

    this.state = this.createInitialState();

    this.log("Ambient Agent initialized");
    this.log(`OpenClaw: ${this.useOpenClaw ? "ENABLED" : "DISABLED (using reasoning.ts)"}`);
    this.log("Config:", JSON.stringify(this.config, null, 2));
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
      currentLocation: null,
      lastSensorUpdate: null,

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
      const result = spawnSync(
        "python3",
        ["/home/michael/.openclaw/workspace/scripts/update-biometric-context.py"],
        {
          input: contextJson,
          encoding: "utf-8",
          timeout: 5000,
        }
      );
      if (result.status !== 0 && result.stderr) {
        this.log(`[MainContext] Update failed: ${result.stderr}`);
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

    // Load today's interventions from log
    const todayInterventions = await this.logger.getTodayInterventions();
    this.state.interventionsToday = todayInterventions;

    // Check if we've already done interventions today
    this.state.stressDetection.checkinOfferedToday = todayInterventions.some(
      (i) => i.type === "proactive_checkin"
    );
    this.state.eveningReflection.reflectionOfferedToday = todayInterventions.some(
      (i) => i.type === "evening_reflection"
    );

    this.log(`Loaded ${todayInterventions.length} interventions from today`);

    this.connect();
    this.startProcessingLoop();
    this.startHeartbeat();
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

      // Long gap: clear stale history and baseline
      if (gapMs >= GAP_CLEAR_THRESHOLD_MS) {
        this.hrHistory.length = 0;
        this.hrvHistory.length = 0;
        this.state.baseline = null;
        this.log(`Clearing stale history after ${Math.round(gapMs / 1000)}s gap`);
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

    // Always update timestamp — watch is alive even if HR is between bursts
    this.state.lastSensorUpdate = msg.timestamp;

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
      this.state.currentHRV = msg.hrv.rmssd;
      this.hrvHistory.push({ rmssd: msg.hrv.rmssd, timestamp: msg.timestamp });
      if (this.hrvHistory.length > HRV_HISTORY_SIZE) {
        this.hrvHistory.shift();
      }
    }
    if (hasEDA) {
      this.state.currentSCL = msg.eda!.meanScl;
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
    // Send startup notification after 10 seconds
    setTimeout(() => this.sendStartupPush(), 10000);

    // Schedule daily summary at 9pm local time, then every 24h
    this.scheduleDailySummary();
  }

  private async sendStartupPush(): Promise<void> {
    const watchStatus = this.state.isWatchConnected ? "connected" : "waiting";
    const message = `Agent started. Watch: ${watchStatus}. Ready.`;
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
    // Update baseline if we have enough data
    if (!this.state.baseline && this.hrHistory.length >= 30) {
      const baseline = estimateBaseline(this.hrHistory, this.hrvHistory);
      if (baseline) {
        this.state.baseline = baseline;
        this.log(
          `Baseline established: HR=${baseline.restingHR}bpm, HRV=${baseline.baselineHRV.toFixed(1)}ms`
        );
      }
    }

    // Run all detectors to update state (always needed for status display)
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
      this.config.stressDetection
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

    // Calendar-based code-side disqualifiers
    if (calendar?.inMeeting) {
      this.log(`[DQ] In meeting: "${calendar.currentMeeting}" — suppressing`);
      return;
    }
    if (calendar && calendar.minutesToNext !== null && calendar.minutesToNext < 5) {
      this.log(`[DQ] Meeting in ${calendar.minutesToNext} min — suppressing`);
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
      this.log(`[DQ] Calendar Focus Time: "${focusEvent.summary}" — protecting`);
      return;
    }

    // Out of Office: suppress all interventions
    const oooEvent = calendar?.upcoming.find(
      e => e.eventType === "outOfOffice" && isCurrentlyInEvent(e, undefined, this.config.quietHours.timezoneOffset)
    );
    if (oooEvent) {
      this.log(`[DQ] Out of Office: "${oooEvent.summary}" — suppressing`);
      return;
    }

    if (calendar === null) {
      this.log("[DQ] Calendar unavailable — being conservative");
      return;
    }

    const context = buildOpenClawContext(
      this.state,
      this.state.baseline,
      this.state.interventionsToday,
      this.config.maxInterventionsPerDay,
      this.config.quietHours.timezoneOffset,
      calendar
    );

    const message = JSON.stringify(context);

    // Also update the main agent's biometric context file
    this.updateMainAgentContext(context);

    const response = await queryOpenClaw(message, this.config.openclaw);

    this.log(`[OpenClaw] Response: ${response.reasoning}`);

    if (!response.shouldIntervene || response.actions.length === 0) {
      return;
    }

    // Idempotency check
    if (response.decisionId && this.executedDecisions.has(response.decisionId)) {
      this.log(`[OpenClaw] Skipping duplicate decision: ${response.decisionId}`);
      return;
    }

    await this.executeOpenClawActions(response);

    if (response.decisionId) {
      this.executedDecisions.add(response.decisionId);
    }
  }

  /**
   * Execute OpenClaw action plan by mapping action types to existing intervention functions
   */
  private async executeOpenClawActions(response: OpenClawResponse): Promise<void> {
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
          }
          break;
        }

        case "disable_focus_mode": {
          if (this.state.flowProtection.inFlowMode) {
            this.state.flowProtection.inFlowMode = false;
            this.state.flowProtection.flowModeStartedAt = null;
            await disableFocusMode();
          }
          break;
        }

        case "send_haptic": {
          const { sendWatchHaptic } = await import("./interventions");
          await sendWatchHaptic(this.ws, action.pattern || "gentle");
          break;
        }

        case "send_push": {
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
          break;
        }

        case "no_action":
          break;
      }
    }
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
      });

      this.state.interventionsToday.push(intervention);
      await this.logger.logIntervention(intervention);
      await executeIntervention(intervention, { relayWs: this.ws ?? undefined });
    }
  }

  // ── Behavior B: Proactive Check-in (fallback path) ─────────────

  private async processStressDetection(dynamicCtx?: DynamicContext): Promise<void> {
    if (this.state.stressDetection.checkinOfferedToday) return;

    const detection = detectStressPattern(
      this.state.currentHR,
      this.state.currentHRV,
      this.state.baseline,
      this.state.stressDetection.elevationStartedAt,
      this.config.stressDetection
    );

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
      });
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
      });

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
    const hr = this.state.currentHR?.toFixed(0) ?? "---";
    const hrv = this.state.currentHRV?.toFixed(0) ?? "---";
    const scl = this.state.currentSCL?.toFixed(1) ?? "---";
    lines.push(`║ HR: ${hr} bpm  HRV: ${hrv} ms  SCL: ${scl}`.padEnd(37) + "║");

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
  options?: { useOpenClaw?: boolean }
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
