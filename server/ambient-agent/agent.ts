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
  sendPushNotification,
} from "./interventions";
import { InterventionLogger, EnergyLogger } from "./logger";
import { decideIntervention, buildReasoningInput } from "./reasoning";
import { queryOpenClaw, isInFallbackMode, getOpenClawStatus } from "./openclaw-bridge";
import { buildOpenClawContext, fetchCalendarContext } from "./openclaw-context";
import type { CalendarContext } from "./openclaw-context";
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

  // ── Connection Management ───────────────────────────────────────

  async start(): Promise<void> {
    this.log("Starting agent...");

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
      this.log(`Watch connected: ${msg.deviceName}`);
    } else {
      this.log("Watch disconnected");
      this.state.currentLocation = null;
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
    // Validate batch
    if (msg.hr.samples === 0) return;

    const locInfo = msg.location ? ", Loc=present" : "";
    this.log(
      `Batch: HR=${msg.hr.mean.toFixed(0)} (${msg.hr.samples} samples), ` +
        `HRV=${msg.hrv.rmssd.toFixed(1)}ms, SCL=${msg.eda.meanScl.toFixed(2)}µS${locInfo}`
    );

    // Update current values from batch aggregates
    this.state.currentHR = Math.round(msg.hr.mean);
    this.state.currentHRV = msg.hrv.rmssd;
    this.state.currentSCL = msg.eda.meanScl;
    this.state.currentLocation = msg.location ?? null;
    this.state.lastSensorUpdate = msg.timestamp;

    // Add to HR history (single sample per batch representing the window)
    this.hrHistory.push({ hr: Math.round(msg.hr.mean), timestamp: msg.timestamp });
    if (this.hrHistory.length > HR_HISTORY_SIZE) {
      this.hrHistory.shift();
    }

    // Add to HRV history (pre-calculated on watch)
    if (msg.hrv.rmssd > 0) {
      this.hrvHistory.push({ rmssd: msg.hrv.rmssd, timestamp: msg.timestamp });
      if (this.hrvHistory.length > HRV_HISTORY_SIZE) {
        this.hrvHistory.shift();
      }
    }
  }

  // ── Processing Loop ─────────────────────────────────────────────

  private startProcessingLoop(): void {
    // Process every 30 seconds (accommodates OpenClaw CLI latency)
    this.processingInterval = setInterval(() => {
      this.processDetection();
    }, 30000);
  }

  // ── Heartbeat (Debug) ──────────────────────────────────────────────

  private startHeartbeat(): void {
    // Send initial heartbeat after 10 seconds
    setTimeout(() => this.sendHeartbeat(), 10000);

    // Then every 60 minutes
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 60 * 60 * 1000);
  }

  private async sendHeartbeat(): Promise<void> {
    const hr = this.state.currentHR?.toFixed(0) ?? "---";
    const hrv = this.state.currentHRV?.toFixed(0) ?? "---";
    const scl = this.state.currentSCL?.toFixed(1) ?? "---";

    const watchStatus = this.state.isWatchConnected ? "connected" : "disconnected";
    const flowStatus = this.state.flowProtection.inFlowMode ? "IN FLOW" : `stable ${this.state.flowProtection.stableMinutes}m`;
    const stressStatus = this.state.stressDetection.isElevated ? `ELEVATED ${this.state.stressDetection.elevatedMinutes}m` : "normal";

    // Get warmth level from memory
    const userState = getUserState();
    const warmthDesc = getWarmthDescription(userState.warmth_level);

    const message = `Watch: ${watchStatus} | HR: ${hr} | HRV: ${hrv}ms | Flow: ${flowStatus} | Stress: ${stressStatus} | Kai: ${warmthDesc}`;

    await sendPushNotification("Heartbeat", message, "low");
    this.log(`Heartbeat sent: ${message}`);
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

    await this.processFlowProtection();
    await this.processStressDetection();
    await this.processEveningReflection();
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

  private async processFlowProtection(): Promise<void> {
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

  private async processStressDetection(): Promise<void> {
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

  private async processEveningReflection(): Promise<void> {
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
