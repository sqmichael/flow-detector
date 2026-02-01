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
  type SensorSample,
  type HRVSample,
} from "./detectors";
import {
  executeIntervention,
  createIntervention,
  disableFocusMode,
} from "./interventions";
import { InterventionLogger } from "./logger";
import {
  DEFAULT_CONFIG,
  type AmbientAgentConfig,
  type AmbientAgentState,
  type PersonalBaseline,
  type Intervention,
  type BatchMessage,
} from "./types";

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

  // Sensor history for detection
  private hrHistory: SensorSample[] = [];
  private hrvHistory: HRVSample[] = [];

  // Reconnection state
  private reconnectAttempt = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  // Processing interval
  private processingInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<AmbientAgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.hrvCalculator = new HRVCalculator();
    this.logger = new InterventionLogger(this.config.logPath);

    this.state = this.createInitialState();

    this.log("Ambient Agent initialized");
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

    this.log(
      `Batch: HR=${msg.hr.mean.toFixed(0)} (${msg.hr.samples} samples), ` +
        `HRV=${msg.hrv.rmssd.toFixed(1)}ms, SCL=${msg.eda.meanScl.toFixed(2)}µS`
    );

    // Update current values from batch aggregates
    this.state.currentHR = Math.round(msg.hr.mean);
    this.state.currentHRV = msg.hrv.rmssd;
    this.state.currentSCL = msg.eda.meanScl;
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
    // Process every 10 seconds
    this.processingInterval = setInterval(() => {
      this.processDetection();
    }, 10000);
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

    // Check quiet hours - no interventions during sleep
    if (isInQuietHours(this.config)) {
      return; // Respect quiet hours
    }

    // Check intervention limits
    if (this.state.interventionsToday.length >= this.config.maxInterventionsPerDay) {
      return; // Max interventions reached for today
    }

    // Process each behavior
    await this.processFlowProtection();
    await this.processStressDetection();
    await this.processEveningReflection();
  }

  // ── Behavior A: Flow Protection ─────────────────────────────────

  private async processFlowProtection(): Promise<void> {
    const detection = detectFlowState(this.hrHistory, this.config.flowDetection);

    this.state.flowProtection.stableMinutes = detection.stableMinutes;

    // Enter flow mode
    if (detection.shouldEnterFlowMode && !this.state.flowProtection.inFlowMode) {
      this.state.flowProtection.inFlowMode = true;
      this.state.flowProtection.flowModeStartedAt = Date.now();

      const intervention = createIntervention("flow_protection", "Stable HR for 30+ minutes", {
        hr: this.state.currentHR ?? undefined,
        hrv: this.state.currentHRV ?? undefined,
        flowDurationMinutes: detection.stableMinutes,
      });

      this.state.interventionsToday.push(intervention);
      await this.logger.logIntervention(intervention);
      await executeIntervention(intervention, { relayWs: this.ws ?? undefined });
    }

    // Exit flow mode (HR became unstable)
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

  // ── Behavior B: Proactive Check-in ──────────────────────────────

  private async processStressDetection(): Promise<void> {
    // Skip if already offered today
    if (this.state.stressDetection.checkinOfferedToday) return;

    const detection = detectStressPattern(
      this.state.currentHR,
      this.state.currentHRV,
      this.state.baseline,
      this.state.stressDetection.elevationStartedAt,
      this.config.stressDetection
    );

    // Update state
    if (detection.isStressed && !this.state.stressDetection.isElevated) {
      this.state.stressDetection.isElevated = true;
      this.state.stressDetection.elevationStartedAt = Date.now();
    } else if (!detection.isStressed) {
      this.state.stressDetection.isElevated = false;
      this.state.stressDetection.elevationStartedAt = null;
    }

    this.state.stressDetection.elevatedMinutes = detection.elevatedMinutes;

    // Trigger check-in
    if (detection.shouldTriggerCheckin) {
      this.state.stressDetection.checkinOfferedToday = true;

      const intervention = createIntervention(
        "proactive_checkin",
        `Elevated HR + suppressed HRV for ${detection.elevatedMinutes} minutes`,
        {
          hr: this.state.currentHR ?? undefined,
          hrv: this.state.currentHRV ?? undefined,
        }
      );

      this.state.interventionsToday.push(intervention);
      await this.logger.logIntervention(intervention);
      await executeIntervention(intervention, {
        relayWs: this.ws ?? undefined,
        phoneNumber: this.config.phoneNumber,
      });
    }
  }

  // ── Behavior C: Evening Reflection ──────────────────────────────

  private async processEveningReflection(): Promise<void> {
    const trigger = shouldTriggerEveningReflection(
      this.state.currentHR,
      this.state.currentHRV,
      this.state.baseline,
      this.state.eveningReflection.reflectionOfferedToday,
      this.config.eveningReflection
    );

    if (trigger.shouldTrigger) {
      this.state.eveningReflection.reflectionOfferedToday = true;
      this.state.eveningReflection.reflectionOfferedAt = Date.now();

      const intervention = createIntervention("evening_reflection", trigger.reason, {
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

export function getAgent(config?: Partial<AmbientAgentConfig>): AmbientAgent {
  if (!agentInstance) {
    agentInstance = new AmbientAgent(config);
  }
  return agentInstance;
}

export function stopAgent(): void {
  if (agentInstance) {
    agentInstance.stop();
    agentInstance = null;
  }
}
