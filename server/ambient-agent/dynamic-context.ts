/**
 * Dynamic Context Assembly
 *
 * Builds a structured context object from current agent state, personal
 * baseline, and calendar data. Used to enrich intervention prompts with
 * situational awareness without adding new LLM calls.
 *
 * Token budget: +50-80 tokens per call (negligible cost increase).
 * Assembly time: < 50ms (local SQLite + in-memory state).
 */

import type { AmbientAgentState, PersonalBaseline, Intervention } from "./types";
import type { CalendarContext } from "./openclaw-context";
import { getUserState, getRecentThemes } from "../calling/memory";

// ── Types ────────────────────────────────────────────────────────────

export type SensorMood =
  | "calm"
  | "focused"
  | "restless"
  | "winding_down"
  | "unknown";

export type TimeOfDay =
  | "morning"
  | "midday"
  | "afternoon"
  | "evening"
  | "night";

export interface DynamicContext {
  /** Inferred physiological mood from HR/HRV vs baseline */
  sensorMood: SensorMood;
  /** Time of day bucket */
  timeOfDay: TimeOfDay;
  /** Full day name, e.g. "Thursday" */
  dayOfWeek: string;
  /** Warmth level 0-3 from memory layer */
  warmthLevel: number;
  /** Up to 3 most recent active themes from memory */
  recentThemes: string[];
  /** Type of last intervention fired today (null if none) */
  lastInterventionType: string | null;
  /** Hours since last intervention (null if none today) */
  lastInterventionHoursAgo: number | null;
  /** wellTimed rating (1-5) from last intervention (null if unrated or none) */
  lastInterventionRating: number | null;
  /** Minutes until next calendar event (null if no calendar or no upcoming events) */
  nextEventMinutes: number | null;
  /** Name of the next calendar event (null if none) */
  nextEventName: string | null;
  /**
   * Whether location data is currently available.
   * Coordinates are never exposed in prompts — only availability.
   */
  location: "available" | "unavailable";
}

// ── Staleness Constants ──────────────────────────────────────────────

/** Sensor data older than this is treated as stale (unknown mood) */
const SENSOR_STALE_MS = 5 * 60 * 1000; // 5 minutes

/** HR must be stable for this many minutes to be considered "still" */
const STILLNESS_MINUTES_THRESHOLD = 5;

/** HR stable for this long signals possible winding-down period */
const WINDING_DOWN_MINUTES_THRESHOLD = 15;

// ── Pure Helpers ─────────────────────────────────────────────────────

/**
 * Derive a 5-state physiological mood from current HR/HRV vs personal baseline.
 *
 * Uses `flowProtection.stableMinutes` as a stillness proxy — HR variance
 * below the flow threshold implies physical stillness.
 *
 * Exported for unit testing.
 */
export function deriveSensorMood(
  state: AmbientAgentState,
  baseline: PersonalBaseline | null
): SensorMood {
  const { currentHR, currentHRV, lastSensorUpdate } = state;

  // Not enough data to classify
  if (!baseline || currentHR === null || currentHRV === null) {
    return "unknown";
  }

  // Stale data (no update in > 5 minutes)
  if (!lastSensorUpdate || Date.now() - lastSensorUpdate > SENSOR_STALE_MS) {
    return "unknown";
  }

  const hrDelta = currentHR - baseline.restingHR;
  const hrPct = hrDelta / baseline.restingHR; // signed fraction
  const hrvRatio = currentHRV / baseline.baselineHRV;
  const stableMinutes = state.flowProtection.stableMinutes;

  // Stillness proxy: HR has been variance-stable for several minutes
  const isStill = stableMinutes >= STILLNESS_MINUTES_THRESHOLD;

  // ── restless ──
  // Elevated HR (>+10% above baseline), suppressed HRV (<70% of baseline),
  // HR not stable (movement disrupting readings)
  if (hrPct > 0.10 && hrvRatio < 0.7 && !isStill) {
    return "restless";
  }

  // ── winding_down ──
  // HR clearly below baseline, HRV recovering above baseline,
  // sustained stable period (proxy for 15+ min declining trend)
  if (
    hrDelta < -5 &&
    hrvRatio > 1.05 &&
    stableMinutes >= WINDING_DOWN_MINUTES_THRESHOLD
  ) {
    return "winding_down";
  }

  // ── calm ──
  // HR below baseline, HRV above baseline, physically still
  if (hrDelta < 0 && hrvRatio > 1.0 && isStill) {
    return "calm";
  }

  // ── focused ──
  // HR near baseline (±5%), HRV slightly below (70-100% of baseline),
  // physically still — engaged but not stressed
  if (Math.abs(hrPct) <= 0.05 && hrvRatio >= 0.7 && hrvRatio < 1.0 && isStill) {
    return "focused";
  }

  return "unknown";
}

/**
 * Map local hour (0-23) to a time-of-day bucket.
 * Exported for unit testing.
 */
export function deriveTimeOfDay(localHour: number): TimeOfDay {
  if (localHour >= 5 && localHour < 12) return "morning";
  if (localHour >= 12 && localHour < 14) return "midday";
  if (localHour >= 14 && localHour < 18) return "afternoon";
  if (localHour >= 18 && localHour < 22) return "evening";
  return "night";
}

/**
 * Extract last intervention stats from today's intervention list.
 */
function extractLastIntervention(interventions: Intervention[]): {
  lastInterventionType: string | null;
  lastInterventionHoursAgo: number | null;
  lastInterventionRating: number | null;
} {
  if (interventions.length === 0) {
    return {
      lastInterventionType: null,
      lastInterventionHoursAgo: null,
      lastInterventionRating: null,
    };
  }

  const last = interventions[interventions.length - 1];
  const hoursAgo =
    Math.round(((Date.now() - last.triggeredAt) / (1000 * 60 * 60)) * 10) / 10;

  return {
    lastInterventionType: last.type,
    lastInterventionHoursAgo: hoursAgo,
    lastInterventionRating: last.rating?.wellTimed ?? null,
  };
}

/**
 * Resolve the next upcoming calendar event name and time.
 */
function extractNextEvent(calendar: CalendarContext | null): {
  nextEventMinutes: number | null;
  nextEventName: string | null;
} {
  if (!calendar || calendar.minutesToNext === null) {
    return { nextEventMinutes: null, nextEventName: null };
  }

  const now = Date.now();
  const nextEvent = calendar.upcoming.find((e) => {
    const startMs = new Date(e.start).getTime();
    return startMs > now;
  });

  return {
    nextEventMinutes: calendar.minutesToNext,
    nextEventName: nextEvent?.summary ?? null,
  };
}

// ── Main Builder ──────────────────────────────────────────────────────

/**
 * Assemble a DynamicContext from agent state, personal baseline, and
 * calendar data. All external reads (SQLite) are wrapped in try/catch
 * with safe defaults so this never throws.
 *
 * @param state      Current ambient agent state
 * @param baseline   Personal HR/HRV baseline (null if not yet established)
 * @param calendar   Calendar context (null if unavailable)
 * @param now        Override current time (for testing)
 */
export function buildDynamicContext(
  state: AmbientAgentState,
  baseline: PersonalBaseline | null,
  calendar: CalendarContext | null,
  now: Date = new Date()
): DynamicContext {
  // ── Time ──
  const localHour = now.getHours();
  const timeOfDay = deriveTimeOfDay(localHour);
  const DAY_NAMES = [
    "Sunday", "Monday", "Tuesday", "Wednesday",
    "Thursday", "Friday", "Saturday",
  ];
  const dayOfWeek = DAY_NAMES[now.getDay()];

  // ── Sensor mood ──
  const sensorMood = deriveSensorMood(state, baseline);

  // ── Last intervention ──
  const { lastInterventionType, lastInterventionHoursAgo, lastInterventionRating } =
    extractLastIntervention(state.interventionsToday);

  // ── Calendar ──
  const { nextEventMinutes, nextEventName } = extractNextEvent(calendar);

  // ── Location availability ──
  const location: "available" | "unavailable" =
    state.currentLocation !== null ? "available" : "unavailable";

  // ── Memory layer (DB reads, each wrapped in try/catch) ──
  let warmthLevel = 0;
  try {
    const userState = getUserState();
    warmthLevel = userState.warmth_level;
  } catch (err) {
    console.error("[DynamicContext] getUserState failed, defaulting warmth to 0:", err);
  }

  let recentThemes: string[] = [];
  try {
    recentThemes = getRecentThemes(3);
  } catch (err) {
    console.error("[DynamicContext] getRecentThemes failed, defaulting to []:", err);
  }

  return {
    sensorMood,
    timeOfDay,
    dayOfWeek,
    warmthLevel,
    recentThemes,
    lastInterventionType,
    lastInterventionHoursAgo,
    lastInterventionRating,
    nextEventMinutes,
    nextEventName,
    location,
  };
}
