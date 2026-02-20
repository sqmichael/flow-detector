/**
 * Ambient Agent Type Definitions
 *
 * Types for the sensor-triggered intervention system that tests
 * whether biometric context improves intervention timing.
 */

// ── Detection Thresholds ────────────────────────────────────────────

/**
 * Thresholds for flow protection (Behavior A)
 * Triggers: stillness + stable HR for duration
 */
export interface FlowDetectionConfig {
  /** Minutes of stable state before triggering flow mode */
  stillnessMinutes: number;
  /** Maximum HR variance (bpm) to consider "stable" */
  hrStabilityThreshold: number;
  /** Maximum haptics per hour while in flow mode */
  maxHapticsPerHour: number;
}

/**
 * Thresholds for stress/arousal detection (Behavior B)
 * Triggers: elevated HR + suppressed HRV for duration
 */
export interface StressDetectionConfig {
  /** HR must be this many bpm above personal baseline */
  hrElevatedAboveBaseline: number;
  /** HRV must be this ratio below baseline (e.g., 0.7 = 70% of baseline) */
  hrvSuppressedBelowBaseline: number;
  /** Minutes of sustained stress before triggering check-in */
  durationMinutes: number;
}

/**
 * Evening reflection window (Behavior C)
 */
export interface EveningReflectionConfig {
  /** Hour to start looking for reflection opportunity (0-23) */
  windowStartHour: number;
  /** Hour to stop looking for reflection opportunity (0-23) */
  windowEndHour: number;
  /** Recovery indicators that can trigger earlier reflection */
  recoveryIndicators: {
    /** HRV must be this ratio above baseline to indicate recovery */
    hrvAboveBaseline: number;
    /** HR must be this many bpm below baseline to indicate recovery */
    hrBelowBaseline: number;
  };
}

// ── Intervention Types ──────────────────────────────────────────────

export type InterventionType =
  | "flow_protection"
  | "proactive_checkin"
  | "evening_reflection";

/**
 * An intervention that was triggered
 */
export interface Intervention {
  id: string;
  type: InterventionType;
  triggeredAt: number;
  /** What triggered this intervention */
  trigger: {
    reason: string;
    /** Sensor values at time of trigger */
    context: {
      hr?: number;
      hrv?: number;
      scl?: number;
      flowDurationMinutes?: number;
    };
  };
  /** User response if any */
  response?: {
    acknowledged: boolean;
    acknowledgedAt?: number;
    action?: string; // e.g., "tapped", "dismissed", "walked"
  };
  /** For post-intervention rating (1-5 scale) */
  rating?: {
    wellTimed: number;
    helpedRegulation: number;
    feltIntrusive: number;
    wantAgainTomorrow: boolean;
  };
}

// ── Agent State ─────────────────────────────────────────────────────

/**
 * Current flow protection state
 */
export interface FlowProtectionState {
  /** Whether flow mode is currently active */
  inFlowMode: boolean;
  /** When flow mode was entered */
  flowModeStartedAt: number | null;
  /** Minutes of stable state accumulated */
  stableMinutes: number;
  /** Last haptic sent (for rate limiting) */
  lastHapticAt: number | null;
  /** Haptics sent this hour */
  hapticsThisHour: number;
}

/**
 * Current stress detection state
 */
export interface StressDetectionState {
  /** Whether stress pattern is currently detected */
  isElevated: boolean;
  /** When elevation started */
  elevationStartedAt: number | null;
  /** Minutes of sustained elevation */
  elevatedMinutes: number;
  /** Whether check-in has been offered today */
  checkinOfferedToday: boolean;
}

/**
 * Current evening reflection state
 */
export interface EveningReflectionState {
  /** Whether reflection has been offered today */
  reflectionOfferedToday: boolean;
  /** When reflection was offered */
  reflectionOfferedAt: number | null;
  /** Recovery detected (HRV up, HR down) */
  recoveryDetected: boolean;
}

/**
 * Personal baseline from calibration or running average
 */
export interface PersonalBaseline {
  /** Average resting HR (bpm) */
  restingHR: number;
  /** Average RMSSD (ms) */
  baselineHRV: number;
  /** Average SCL (µS) - optional */
  baselineSCL?: number;
  /** When baseline was last updated */
  updatedAt: number;
}

/**
 * Full agent state
 */
export interface AmbientAgentState {
  /** Connection status */
  isConnected: boolean;
  isWatchConnected: boolean;
  watchDeviceName: string | null;

  /** Current sensor values */
  currentHR: number | null;
  currentHRV: number | null;
  currentSCL: number | null;
  currentLocation: { latitude: number; longitude: number; accuracy: number } | null;
  lastSensorUpdate: number | null;

  /** Personal baselines */
  baseline: PersonalBaseline | null;

  /** Behavior states */
  flowProtection: FlowProtectionState;
  stressDetection: StressDetectionState;
  eveningReflection: EveningReflectionState;

  /** Today's interventions */
  interventionsToday: Intervention[];

  /** When the agent started */
  startedAt: number;
}

// ── Configuration ───────────────────────────────────────────────────

/**
 * Quiet hours config - no interventions during these hours
 */
export interface QuietHoursConfig {
  /** Hour to start quiet period (0-23), e.g., 22 = 10 PM */
  startHour: number;
  /** Hour to end quiet period (0-23), e.g., 7 = 7 AM */
  endHour: number;
  /** Timezone offset in hours from UTC, e.g., 8 for UTC+8 */
  timezoneOffset: number;
}

/**
 * Full agent configuration
 */
export interface AmbientAgentConfig {
  /** Watch relay WebSocket URL */
  relayUrl: string;

  /** Detection thresholds */
  flowDetection: FlowDetectionConfig;
  stressDetection: StressDetectionConfig;
  eveningReflection: EveningReflectionConfig;

  /** Quiet hours - no interventions during sleep */
  quietHours: QuietHoursConfig;

  /** Maximum interventions per day (across all types) */
  maxInterventionsPerDay: number;

  /** Phone number for call-based check-ins (optional) */
  phoneNumber?: string;

  /** Path to intervention log file */
  logPath: string;

  /** OpenClaw orchestrator config */
  openclaw: OpenClawConfig;
}

// ── Default Configuration ───────────────────────────────────────────

export const DEFAULT_CONFIG: AmbientAgentConfig = {
  relayUrl: process.env.RELAY_URL || "ws://production-server:8765/browser",

  flowDetection: {
    stillnessMinutes: 30,
    hrStabilityThreshold: 5, // bpm variance
    maxHapticsPerHour: 1,
  },

  stressDetection: {
    hrElevatedAboveBaseline: 10, // bpm
    hrvSuppressedBelowBaseline: 0.7, // ratio
    durationMinutes: 15,
  },

  eveningReflection: {
    windowStartHour: 18, // 6 PM
    windowEndHour: 22, // 10 PM
    recoveryIndicators: {
      hrvAboveBaseline: 1.2, // 120% of baseline
      hrBelowBaseline: 5, // 5 bpm below baseline
    },
  },

  quietHours: {
    startHour: 22, // 10 PM
    endHour: 7, // 7 AM
    timezoneOffset: 8, // UTC+8 (adjust for your timezone)
  },

  maxInterventionsPerDay: 2,
  logPath: "./server/data/intervention-log.jsonl",

  openclaw: {
    enabled: true,
    agentId: "flow-detector",
    timeoutMs: 30000,
    maxConsecutiveFailures: 3,
    fallbackCooldownMs: 600000, // 10 minutes
  },
};

// ── Reflection Prompts ──────────────────────────────────────────────

export const REFLECTION_PROMPTS = [
  "What drained energy today?",
  "What helped you reset?",
  "What's one thing you'd do differently?",
  "What felt like real progress?",
  "What can wait until tomorrow?",
  "What would you tell a friend in your position?",
] as const;

export const CHECKIN_SCRIPT =
  "Hey — maybe step away for a few?";

// ── OpenClaw Types ──────────────────────────────────────────────────

/**
 * OpenClaw orchestrator configuration
 */
export interface OpenClawConfig {
  /** Whether OpenClaw is enabled */
  enabled: boolean;
  /** Agent ID registered in OpenClaw */
  agentId: string;
  /** CLI timeout in milliseconds */
  timeoutMs: number;
  /** Max consecutive failures before falling back to reasoning.ts */
  maxConsecutiveFailures: number;
  /** How long to stay on fallback before retrying OpenClaw (ms) */
  fallbackCooldownMs: number;
}

/**
 * Action types OpenClaw can request
 */
export type OpenClawActionType =
  | "enable_focus_mode"
  | "disable_focus_mode"
  | "send_haptic"
  | "send_push"
  | "trigger_call"
  | "send_reflection"
  | "no_action";

/**
 * A single action from OpenClaw
 */
export interface OpenClawAction {
  type: OpenClawActionType;
  message?: string;
  priority?: "low" | "default" | "high";
  /** Optional haptic pattern */
  pattern?: "gentle" | "urgent";
}

/**
 * Full response from OpenClaw agent
 */
export interface OpenClawResponse {
  shouldIntervene: boolean;
  actions: OpenClawAction[];
  reasoning: string;
  /** Dedup key generated by bridge */
  decisionId?: string;
}

// ── Batch Message Protocol ──────────────────────────────────────────

/**
 * 30-second aggregated sensor batch from watch.
 * Reduces data from ~3-5 MB/day (1Hz) to ~200 KB/day.
 */
export interface BatchMessage {
  type: "batch";
  /** Window duration in ms (always 30000) */
  windowMs: number;
  /** Heart rate aggregates (null when SDK doesn't deliver HR in this window) */
  hr?: {
    mean: number;
    min: number;
    max: number;
    samples: number;
  } | null;
  /** HRV metrics calculated on-watch from IBI data */
  hrv?: {
    rmssd: number;
    sdnn: number;
  } | null;
  /** EDA (skin conductance) aggregates */
  eda?: {
    meanScl: number;
    peakScl: number;
  } | null;
  /** Location snapshot (optional, coarse GPS) */
  location?: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  /** Batch timestamp (end of window) */
  timestamp: number;
}
