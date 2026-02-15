/**
 * OpenClaw Context Builder
 *
 * Constructs a compact (~300 token) JSON context from agent state
 * for each OpenClaw decision request. Stateless — full context
 * passed each call to avoid session context blowout.
 */

import type {
  AmbientAgentState,
  PersonalBaseline,
  Intervention,
} from "./types";
import { getUserState, getWarmthDescription } from "../calling/memory";

export interface OpenClawContext {
  type: "intervention_decision";
  sensors: {
    hr: number | null;
    hrv: number | null;
    scl: number | null;
    watchConnected: boolean;
    location?: { latitude: number; longitude: number; accuracy: number };
  };
  baseline: {
    restingHR: number;
    baselineHRV: number;
    hrDeviation: string | null;
    hrvDeviation: string | null;
  } | null;
  detections: {
    flow: {
      inFlowMode: boolean;
      stableMinutes: number;
    };
    stress: {
      isElevated: boolean;
      elevatedMinutes: number;
      checkinOfferedToday: boolean;
    };
    recovery: {
      recoveryDetected: boolean;
      reflectionOfferedToday: boolean;
    };
    energy: string; // "normal" | "low" | "high"
  };
  agentState: {
    time: string;
    dayPart: string;
    interventionsToday: number;
    maxInterventions: number;
    lastInterventionHoursAgo: number | null;
    warmthLevel: string;
  };
}

/**
 * Build compact context for OpenClaw decision-making
 */
export function buildOpenClawContext(
  state: AmbientAgentState,
  baseline: PersonalBaseline | null,
  interventionsToday: Intervention[],
  maxInterventionsPerDay: number,
  timezoneOffset: number
): OpenClawContext {
  // Calculate baseline deviations
  let hrDeviation: string | null = null;
  let hrvDeviation: string | null = null;
  if (baseline && state.currentHR !== null) {
    const pct = Math.round(
      ((state.currentHR - baseline.restingHR) / baseline.restingHR) * 100
    );
    hrDeviation = `${pct >= 0 ? "+" : ""}${pct}%`;
  }
  if (baseline && state.currentHRV !== null) {
    const pct = Math.round(
      ((state.currentHRV - baseline.baselineHRV) / baseline.baselineHRV) * 100
    );
    hrvDeviation = `${pct >= 0 ? "+" : ""}${pct}%`;
  }

  // Local time (using timezone offset)
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const localHour = ((utcHour + timezoneOffset) % 24 + 24) % 24;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const time = `${localHour.toString().padStart(2, "0")}:${utcMin.toString().padStart(2, "0")} ${dayNames[now.getUTCDay()]}`;

  let dayPart = "night";
  if (localHour >= 6 && localHour < 12) dayPart = "morning";
  else if (localHour >= 12 && localHour < 14) dayPart = "lunch";
  else if (localHour >= 14 && localHour < 18) dayPart = "afternoon_work";
  else if (localHour >= 18 && localHour < 22) dayPart = "evening";

  // Last intervention timing
  let lastInterventionHoursAgo: number | null = null;
  if (interventionsToday.length > 0) {
    const last = interventionsToday[interventionsToday.length - 1];
    lastInterventionHoursAgo =
      Math.round(((Date.now() - last.triggeredAt) / (1000 * 60 * 60)) * 10) /
      10;
  }

  // Warmth from memory layer
  const userState = getUserState();
  const warmthDesc = getWarmthDescription(userState.warmth_level);

  // Infer energy from HR/HRV vs baseline
  let energy = "normal";
  if (baseline && state.currentHR !== null && state.currentHRV !== null) {
    if (
      state.currentHR < baseline.restingHR - 5 &&
      state.currentHRV > baseline.baselineHRV * 1.2
    ) {
      energy = "low";
    } else if (
      state.currentHR > baseline.restingHR + 15 &&
      state.currentHRV < baseline.baselineHRV * 0.6
    ) {
      energy = "high";
    }
  }

  return {
    type: "intervention_decision",
    sensors: {
      hr: state.currentHR,
      hrv: state.currentHRV !== null ? Math.round(state.currentHRV * 10) / 10 : null,
      scl: state.currentSCL !== null ? Math.round(state.currentSCL * 100) / 100 : null,
      watchConnected: state.isWatchConnected,
      ...(state.currentLocation ? { location: state.currentLocation } : {}),
    },
    baseline: baseline
      ? {
          restingHR: baseline.restingHR,
          baselineHRV: Math.round(baseline.baselineHRV * 10) / 10,
          hrDeviation,
          hrvDeviation,
        }
      : null,
    detections: {
      flow: {
        inFlowMode: state.flowProtection.inFlowMode,
        stableMinutes: state.flowProtection.stableMinutes,
      },
      stress: {
        isElevated: state.stressDetection.isElevated,
        elevatedMinutes: state.stressDetection.elevatedMinutes,
        checkinOfferedToday: state.stressDetection.checkinOfferedToday,
      },
      recovery: {
        recoveryDetected: state.eveningReflection.recoveryDetected,
        reflectionOfferedToday:
          state.eveningReflection.reflectionOfferedToday,
      },
      energy,
    },
    agentState: {
      time,
      dayPart,
      interventionsToday: interventionsToday.length,
      maxInterventions: maxInterventionsPerDay,
      lastInterventionHoursAgo,
      warmthLevel: warmthDesc,
    },
  };
}
