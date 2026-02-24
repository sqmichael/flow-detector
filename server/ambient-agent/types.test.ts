/**
 * Contract tests for TimingContextV1 and TimingDecisionV1 defaults/enums.
 *
 * Run: npx tsx server/ambient-agent/types.test.ts
 */

import {
  TIMING_CONTEXT_V1_VERSION,
  TIMING_DECISION_V1_VERSION,
  TIMING_CONTEXT_V1_TRIGGER_TYPES,
  TIMING_CONTEXT_V1_CONFIDENCE_LEVELS,
  TIMING_CONTEXT_V1_DAY_PARTS,
  TIMING_CONTEXT_V1_WATCH_QUALITY,
  TIMING_CONTEXT_V1_ENERGY_STATES,
  TIMING_CONTEXT_V1_LOCATION_STATES,
  TIMING_DECISION_V1_OUTCOMES,
  TIMING_DECISION_V1_REASON_CODES,
  DEFAULT_TIMING_CONTEXT_V1,
  DEFAULT_TIMING_DECISION_V1,
} from "./types";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${name}: ${msg}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function hasUndefinedDeep(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(hasUndefinedDeep);
  if (value && typeof value === "object") {
    return Object.values(value).some(hasUndefinedDeep);
  }
  return false;
}

console.log("\nTiming v1 contract");

test("context enums are strict and stable", () => {
  assert(
    JSON.stringify(TIMING_CONTEXT_V1_TRIGGER_TYPES) ===
      JSON.stringify(["flow", "stress", "recovery"]),
    "trigger enum mismatch"
  );
  assert(
    JSON.stringify(TIMING_CONTEXT_V1_CONFIDENCE_LEVELS) ===
      JSON.stringify(["low", "medium", "high"]),
    "confidence enum mismatch"
  );
  assert(
    JSON.stringify(TIMING_CONTEXT_V1_DAY_PARTS) ===
      JSON.stringify(["morning", "lunch", "afternoon_work", "evening", "night"]),
    "dayPart enum mismatch"
  );
  assert(
    JSON.stringify(TIMING_CONTEXT_V1_WATCH_QUALITY) ===
      JSON.stringify(["good", "bad", "unknown"]),
    "watch quality enum mismatch"
  );
  assert(
    JSON.stringify(TIMING_CONTEXT_V1_ENERGY_STATES) ===
      JSON.stringify(["normal", "low", "high"]),
    "energy enum mismatch"
  );
  assert(
    JSON.stringify(TIMING_CONTEXT_V1_LOCATION_STATES) ===
      JSON.stringify(["available", "unavailable"]),
    "location enum mismatch"
  );
});

test("decision enums are strict and stable", () => {
  assert(
    JSON.stringify(TIMING_DECISION_V1_OUTCOMES) ===
      JSON.stringify(["skip", "intervene"]),
    "outcome enum mismatch"
  );
  assert(
    JSON.stringify(TIMING_DECISION_V1_REASON_CODES) ===
      JSON.stringify([
        "unknown",
        "watch_quality_bad",
        "insufficient_signal",
        "recent_intervention",
        "quota_reached",
        "quiet_hours",
        "flow_protection",
        "stress_sustained",
        "recovery_window",
      ]),
    "reason code enum mismatch"
  );
});

test("default timing context is v1 and null-safe", () => {
  assert(DEFAULT_TIMING_CONTEXT_V1.version === TIMING_CONTEXT_V1_VERSION, "context version must be v1");
  assert(DEFAULT_TIMING_CONTEXT_V1.trigger.confidence === "low", "default confidence should be low");
  assert(DEFAULT_TIMING_CONTEXT_V1.sensors.hr === null, "default hr should be null");
  assert(DEFAULT_TIMING_CONTEXT_V1.sensors.hrv === null, "default hrv should be null");
  assert(DEFAULT_TIMING_CONTEXT_V1.sensors.scl === null, "default scl should be null");
  assert(DEFAULT_TIMING_CONTEXT_V1.sensors.dataAgeSec === null, "default dataAgeSec should be null");
  assert(DEFAULT_TIMING_CONTEXT_V1.timing.lastInterventionHoursAgo === null, "default lastInterventionHoursAgo should be null");
  assert(DEFAULT_TIMING_CONTEXT_V1.timing.inMeeting === null, "default inMeeting should be null");
  assert(DEFAULT_TIMING_CONTEXT_V1.timing.minutesToNextEvent === null, "default minutesToNextEvent should be null");
  assert(!hasUndefinedDeep(DEFAULT_TIMING_CONTEXT_V1), "context default should not include undefined");
});

test("default timing decision is v1 and null-safe", () => {
  assert(DEFAULT_TIMING_DECISION_V1.version === TIMING_DECISION_V1_VERSION, "decision version must be v1");
  assert(DEFAULT_TIMING_DECISION_V1.outcome === "skip", "default outcome should be skip");
  assert(DEFAULT_TIMING_DECISION_V1.shouldIntervene === false, "default shouldIntervene should be false");
  assert(DEFAULT_TIMING_DECISION_V1.interventionType === null, "default interventionType should be null");
  assert(DEFAULT_TIMING_DECISION_V1.reasonCode === "unknown", "default reasonCode should be unknown");
  assert(DEFAULT_TIMING_DECISION_V1.cooldownMinutes === null, "default cooldownMinutes should be null");
  assert(!hasUndefinedDeep(DEFAULT_TIMING_DECISION_V1), "decision default should not include undefined");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
