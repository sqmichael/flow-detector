/**
 * Dynamic Context Tests
 *
 * Run: npx tsx server/ambient-agent/dynamic-context.test.ts
 */

import {
  deriveSensorMood,
  deriveTimeOfDay,
  buildDynamicContext,
  type DynamicContext,
} from "./dynamic-context";
import type { AmbientAgentState, PersonalBaseline } from "./types";

// ── Test utilities ───────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${(e as Error).message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message?: string) {
  const msg = message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  assert(actual === expected, msg);
}

// ── Test Fixtures ────────────────────────────────────────────────────

const NOW = Date.now();

function makeBaseline(restingHR = 65, baselineHRV = 40): PersonalBaseline {
  return { restingHR, baselineHRV, updatedAt: NOW };
}

function makeState(overrides: Partial<AmbientAgentState> = {}): AmbientAgentState {
  return {
    isConnected: true,
    isWatchConnected: true,
    watchDeviceName: "Galaxy Watch 8",
    connectionState: "connected",
    disconnectedAt: null,
    reconnectedAt: null,
    batchesSinceReconnect: 0,
    currentHR: 65,
    currentHRV: 40,
    currentSCL: null,
    currentStillness: null,
    currentLocation: null,
    lastSensorUpdate: NOW,
    watchQuality: null,
    baseline: makeBaseline(),
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
    startedAt: NOW - 60_000,
    ...overrides,
  };
}

// ── deriveSensorMood tests ───────────────────────────────────────────

console.log("\n=== deriveSensorMood ===\n");

test("deriveSensorMood_noBaseline_returnsUnknown", () => {
  const state = makeState({ currentHR: 70, currentHRV: 35 });
  assertEqual(deriveSensorMood(state, null), "unknown");
});

test("deriveSensorMood_nullHR_returnsUnknown", () => {
  const state = makeState({ currentHR: null });
  assertEqual(deriveSensorMood(state, makeBaseline()), "unknown");
});

test("deriveSensorMood_nullHRV_returnsUnknown", () => {
  const state = makeState({ currentHRV: null });
  assertEqual(deriveSensorMood(state, makeBaseline()), "unknown");
});

test("deriveSensorMood_staleSensorData_returnsUnknown", () => {
  const state = makeState({
    currentHR: 65,
    currentHRV: 40,
    lastSensorUpdate: NOW - 6 * 60_000, // 6 min ago — stale
  });
  assertEqual(deriveSensorMood(state, makeBaseline()), "unknown");
});

test("deriveSensorMood_nullLastSensorUpdate_returnsUnknown", () => {
  const state = makeState({ lastSensorUpdate: null });
  assertEqual(deriveSensorMood(state, makeBaseline()), "unknown");
});

test("deriveSensorMood_restlessPattern_returnsRestless", () => {
  // HR > baseline + 10% (+7+ bpm on 65 base), HRV < 70% of baseline, not still
  const baseline = makeBaseline(65, 40);
  const state = makeState({
    currentHR: 80,       // +23% above 65
    currentHRV: 27,      // 67.5% of 40 — below 70% threshold
    lastSensorUpdate: NOW,
    flowProtection: {
      inFlowMode: false,
      flowModeStartedAt: null,
      stableMinutes: 2,  // < 5 — not still
      lastHapticAt: null,
      hapticsThisHour: 0,
    },
  });
  assertEqual(deriveSensorMood(state, baseline), "restless");
});

test("deriveSensorMood_calmPattern_returnsCalm", () => {
  // HR below baseline, HRV above baseline, still
  const baseline = makeBaseline(65, 40);
  const state = makeState({
    currentHR: 58,       // below baseline
    currentHRV: 48,      // > baseline
    lastSensorUpdate: NOW,
    flowProtection: {
      inFlowMode: false,
      flowModeStartedAt: null,
      stableMinutes: 10, // >= 5 — still
      lastHapticAt: null,
      hapticsThisHour: 0,
    },
  });
  assertEqual(deriveSensorMood(state, baseline), "calm");
});

test("deriveSensorMood_focusedPattern_returnsFocused", () => {
  // HR ≈ baseline (±5%), HRV slightly below (70-100%), still
  const baseline = makeBaseline(65, 40);
  const state = makeState({
    currentHR: 66,       // +1.5% — within ±5%
    currentHRV: 34,      // 85% of 40 — in [70%, 100%) range
    lastSensorUpdate: NOW,
    flowProtection: {
      inFlowMode: true,
      flowModeStartedAt: NOW - 10 * 60_000,
      stableMinutes: 12, // >= 5 — still
      lastHapticAt: null,
      hapticsThisHour: 0,
    },
  });
  assertEqual(deriveSensorMood(state, baseline), "focused");
});

test("deriveSensorMood_windingDownPattern_returnsWindingDown", () => {
  // HR clearly below baseline (-6+), HRV recovering (>1.05x), stable 15+ min
  const baseline = makeBaseline(65, 40);
  const state = makeState({
    currentHR: 58,       // -7 below 65
    currentHRV: 44,      // 110% of 40 — above 1.05 threshold
    lastSensorUpdate: NOW,
    flowProtection: {
      inFlowMode: false,
      flowModeStartedAt: null,
      stableMinutes: 18, // >= 15 — winding down threshold
      lastHapticAt: null,
      hapticsThisHour: 0,
    },
  });
  assertEqual(deriveSensorMood(state, baseline), "winding_down");
});

test("deriveSensorMood_ambiguousValues_returnsUnknown", () => {
  // HR exactly at baseline, HRV at 100% — doesn't match any specific mood
  const baseline = makeBaseline(65, 40);
  const state = makeState({
    currentHR: 65,
    currentHRV: 40,      // exactly 1.0 ratio — doesn't match focused (requires < 1.0) or calm
    lastSensorUpdate: NOW,
    flowProtection: {
      inFlowMode: false,
      flowModeStartedAt: null,
      stableMinutes: 8,
      lastHapticAt: null,
      hapticsThisHour: 0,
    },
  });
  assertEqual(deriveSensorMood(state, baseline), "unknown");
});

// ── deriveTimeOfDay tests ────────────────────────────────────────────

console.log("\n=== deriveTimeOfDay ===\n");

test("deriveTimeOfDay_5am_returnsMorning", () => {
  assertEqual(deriveTimeOfDay(5), "morning");
});

test("deriveTimeOfDay_11am_returnsMorning", () => {
  assertEqual(deriveTimeOfDay(11), "morning");
});

test("deriveTimeOfDay_12pm_returnsMidday", () => {
  assertEqual(deriveTimeOfDay(12), "midday");
});

test("deriveTimeOfDay_13_returnsMidday", () => {
  assertEqual(deriveTimeOfDay(13), "midday");
});

test("deriveTimeOfDay_15_returnsAfternoon", () => {
  assertEqual(deriveTimeOfDay(15), "afternoon");
});

test("deriveTimeOfDay_19_returnsEvening", () => {
  assertEqual(deriveTimeOfDay(19), "evening");
});

test("deriveTimeOfDay_23_returnsNight", () => {
  assertEqual(deriveTimeOfDay(23), "night");
});

test("deriveTimeOfDay_2am_returnsNight", () => {
  assertEqual(deriveTimeOfDay(2), "night");
});

// ── buildDynamicContext tests ────────────────────────────────────────

console.log("\n=== buildDynamicContext ===\n");

test("buildDynamicContext_noLocation_returnsUnavailable", () => {
  const state = makeState({ currentLocation: null });
  const ctx = buildDynamicContext(state, makeBaseline(), null);
  assertEqual(ctx.location, "unavailable");
});

test("buildDynamicContext_withLocation_returnsAvailable", () => {
  const state = makeState({
    currentLocation: { latitude: 1.3, longitude: 103.8, accuracy: 10 },
  });
  const ctx = buildDynamicContext(state, makeBaseline(), null);
  assertEqual(ctx.location, "available");
});

test("buildDynamicContext_noInterventions_returnsNullLastIntervention", () => {
  const state = makeState({ interventionsToday: [] });
  const ctx = buildDynamicContext(state, makeBaseline(), null);
  assertEqual(ctx.lastInterventionType, null);
  assertEqual(ctx.lastInterventionHoursAgo, null);
  assertEqual(ctx.lastInterventionRating, null);
});

test("buildDynamicContext_withIntervention_returnsLastInterventionData", () => {
  const triggeredAt = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
  const state = makeState({
    interventionsToday: [
      {
        id: "test-id",
        type: "proactive_checkin",
        triggeredAt,
        trigger: { reason: "stress", context: { hr: 80 } },
        rating: {
          wellTimed: 4,
          helpedRegulation: 3,
          feltIntrusive: 2,
          wantAgainTomorrow: true,
        },
      },
    ],
  });
  const ctx = buildDynamicContext(state, makeBaseline(), null);
  assertEqual(ctx.lastInterventionType, "proactive_checkin");
  assert(ctx.lastInterventionHoursAgo !== null && ctx.lastInterventionHoursAgo >= 1.9, "Should be ~2 hours ago");
  assertEqual(ctx.lastInterventionRating, 4);
});

test("buildDynamicContext_interventionWithoutRating_returnsNullRating", () => {
  const state = makeState({
    interventionsToday: [
      {
        id: "test-id-2",
        type: "evening_reflection",
        triggeredAt: Date.now() - 30 * 60 * 1000,
        trigger: { reason: "recovery", context: {} },
        // no rating field
      },
    ],
  });
  const ctx = buildDynamicContext(state, makeBaseline(), null);
  assertEqual(ctx.lastInterventionType, "evening_reflection");
  assertEqual(ctx.lastInterventionRating, null);
});

test("buildDynamicContext_noCalendar_returnsNullNextEvent", () => {
  const state = makeState();
  const ctx = buildDynamicContext(state, makeBaseline(), null);
  assertEqual(ctx.nextEventMinutes, null);
  assertEqual(ctx.nextEventName, null);
});

test("buildDynamicContext_withCalendar_returnsNextEvent", () => {
  const futureTime = new Date(Date.now() + 25 * 60 * 1000); // 25 min from now
  const calendar = {
    upcoming: [
      {
        summary: "Team Standup",
        start: futureTime.toISOString(),
        end: new Date(futureTime.getTime() + 30 * 60 * 1000).toISOString(),
        status: "confirmed" as const,
        eventType: "default",
      },
    ],
    inMeeting: false,
    currentMeeting: null,
    minutesToNext: 25,
  };
  const state = makeState();
  const ctx = buildDynamicContext(state, makeBaseline(), calendar);
  assertEqual(ctx.nextEventMinutes, 25);
  assertEqual(ctx.nextEventName, "Team Standup");
});

test("buildDynamicContext_correctDayOfWeek", () => {
  // Use a fixed UTC date: 2026-02-20T06:00Z = 14:00 UTC+8 (Friday afternoon)
  const friday = new Date(Date.UTC(2026, 1, 20, 6, 0, 0));
  const state = makeState();
  const ctx = buildDynamicContext(state, makeBaseline(), null, friday, 8);
  assertEqual(ctx.dayOfWeek, "Friday");
  assertEqual(ctx.timeOfDay, "afternoon");
});

test("buildDynamicContext_correctTimeOfDay_morning", () => {
  // 2026-02-20T01:30Z = 09:30 UTC+8 (morning)
  const morning = new Date(Date.UTC(2026, 1, 20, 1, 30, 0));
  const ctx = buildDynamicContext(makeState(), makeBaseline(), null, morning, 8);
  assertEqual(ctx.timeOfDay, "morning");
});

test("buildDynamicContext_warmthDefaultsToZeroOnDbFailure", () => {
  // This test verifies the function doesn't throw when DB is not initialized.
  // If DB is accessible, warmthLevel will be a valid number (0-3).
  // If DB fails, it defaults to 0. Either way it should not throw.
  let threw = false;
  let ctx: DynamicContext | null = null;
  try {
    ctx = buildDynamicContext(makeState(), makeBaseline(), null);
  } catch {
    threw = true;
  }
  assert(!threw, "buildDynamicContext should never throw");
  assert(ctx !== null, "Should return a context object");
  assert(
    typeof (ctx as DynamicContext).warmthLevel === "number",
    "warmthLevel should always be a number"
  );
});

test("buildDynamicContext_recentThemesDefaultsToArrayOnDbFailure", () => {
  let ctx: DynamicContext | null = null;
  try {
    ctx = buildDynamicContext(makeState(), makeBaseline(), null);
  } catch {
    // should not throw
  }
  assert(ctx !== null, "Should return context");
  assert(Array.isArray((ctx as DynamicContext).recentThemes), "recentThemes should always be an array");
});

test("buildDynamicContext_sensorMoodFromState", () => {
  // Focused state: HR ≈ baseline, HRV slightly below, stable
  const baseline = makeBaseline(65, 40);
  const state = makeState({
    currentHR: 66,
    currentHRV: 34,
    lastSensorUpdate: NOW,
    flowProtection: {
      inFlowMode: true,
      flowModeStartedAt: NOW - 10 * 60_000,
      stableMinutes: 12,
      lastHapticAt: null,
      hapticsThisHour: 0,
    },
  });
  const ctx = buildDynamicContext(state, baseline, null);
  assertEqual(ctx.sensorMood, "focused");
});

// ── Results ──────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
