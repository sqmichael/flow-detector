/**
 * Tests for serializeDynamicContext() in reasoning.ts
 */

import { serializeDynamicContext } from "./reasoning";
import type { DynamicContext } from "./dynamic-context";

// ── Helpers ───────────────────────────────────────────────────────────

function makeContext(overrides: Partial<DynamicContext> = {}): DynamicContext {
  return {
    sensorMood: "focused",
    timeOfDay: "afternoon",
    dayOfWeek: "Thursday",
    warmthLevel: 2,
    recentThemes: ["deadlines", "sleep quality"],
    lastInterventionType: "proactive_checkin",
    lastInterventionHoursAgo: 4,
    lastInterventionRating: 4,
    nextEventMinutes: 25,
    nextEventName: "Standup",
    location: "available",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err}`);
    process.exitCode = 1;
  }
}

function assertEqual<T>(actual: T, expected: T, msg?: string) {
  if (actual !== expected) {
    throw new Error(`${msg ?? "Assertion failed"}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(str: string, substring: string, msg?: string) {
  if (!str.includes(substring)) {
    throw new Error(`${msg ?? "Substring not found"}\n  expected to find: ${JSON.stringify(substring)}\n  in: ${JSON.stringify(str)}`);
  }
}

function assertNotIncludes(str: string, substring: string, msg?: string) {
  if (str.includes(substring)) {
    throw new Error(`${msg ?? "Unexpected substring found"}\n  did not expect: ${JSON.stringify(substring)}\n  in: ${JSON.stringify(str)}`);
  }
}

// ── Full context ──────────────────────────────────────────────────────

console.log("\nserializeDynamicContext()");

test("test_serializeDynamicContext_fullContext_includesAllLines", () => {
  const result = serializeDynamicContext(makeContext());
  assertIncludes(result, "Context:", "should include Context: header");
  assertIncludes(result, "- Mood: focused");
  assertIncludes(result, "- Time: Thursday afternoon");
  assertIncludes(result, "- Warmth: level 2");
  assertIncludes(result, "- Themes: deadlines, sleep quality");
  assertIncludes(result, "- Last check-in: 4h ago (proactive_checkin, rated 4/5)");
  assertIncludes(result, '- Next event: "Standup" in 25min');
});

// ── Skipped lines ─────────────────────────────────────────────────────

test("test_serializeDynamicContext_unknownMood_skipsMoodLine", () => {
  const result = serializeDynamicContext(makeContext({ sensorMood: "unknown" }));
  assertNotIncludes(result, "- Mood:", "unknown mood should be skipped");
  assertIncludes(result, "- Time:", "time should still be present");
});

test("test_serializeDynamicContext_zeroWarmth_skipsWarmthLine", () => {
  const result = serializeDynamicContext(makeContext({ warmthLevel: 0 }));
  assertNotIncludes(result, "- Warmth:", "warmth level 0 should be skipped");
});

test("test_serializeDynamicContext_emptyThemes_skipsThemesLine", () => {
  const result = serializeDynamicContext(makeContext({ recentThemes: [] }));
  assertNotIncludes(result, "- Themes:", "empty themes should be skipped");
});

test("test_serializeDynamicContext_noLastIntervention_skipsCheckInLine", () => {
  const result = serializeDynamicContext(makeContext({
    lastInterventionType: null,
    lastInterventionHoursAgo: null,
    lastInterventionRating: null,
  }));
  assertNotIncludes(result, "- Last check-in:", "no last intervention should be skipped");
});

test("test_serializeDynamicContext_noNextEvent_skipsEventLine", () => {
  const result = serializeDynamicContext(makeContext({
    nextEventMinutes: null,
    nextEventName: null,
  }));
  assertNotIncludes(result, "- Next event:", "no next event should be skipped");
});

// ── Rating optional ───────────────────────────────────────────────────

test("test_serializeDynamicContext_nullRating_omitsRatingFromCheckIn", () => {
  const result = serializeDynamicContext(makeContext({ lastInterventionRating: null }));
  assertIncludes(result, "- Last check-in: 4h ago (proactive_checkin)");
  assertNotIncludes(result, "rated", "null rating should not include 'rated' text");
});

// ── All-null context ──────────────────────────────────────────────────

test("test_serializeDynamicContext_allNullOrUnknown_returnsEmpty", () => {
  const result = serializeDynamicContext(makeContext({
    sensorMood: "unknown",
    warmthLevel: 0,
    recentThemes: [],
    lastInterventionType: null,
    lastInterventionHoursAgo: null,
    lastInterventionRating: null,
    nextEventMinutes: null,
    nextEventName: null,
  }));
  // Only Time line should remain
  assertIncludes(result, "- Time:", "time is always included");
  assertNotIncludes(result, "- Mood:", "unknown mood skipped");
  assertNotIncludes(result, "- Warmth:", "0 warmth skipped");
  assertNotIncludes(result, "- Themes:", "empty themes skipped");
  assertNotIncludes(result, "- Last check-in:", "no intervention skipped");
  assertNotIncludes(result, "- Next event:", "no event skipped");
});

// ── Starts with newlines for correct prompt appending ─────────────────

test("test_serializeDynamicContext_startsWithNewlineNewline", () => {
  const result = serializeDynamicContext(makeContext());
  assertEqual(result.startsWith("\n\nContext:"), true, "should start with \\n\\nContext:");
});

// ── Location field (never in prompt) ─────────────────────────────────

test("test_serializeDynamicContext_neverExposesLocationCoords", () => {
  const result = serializeDynamicContext(makeContext({ location: "available" }));
  assertNotIncludes(result, "latitude", "coordinates must not appear in prompt");
  assertNotIncludes(result, "longitude", "coordinates must not appear in prompt");
  assertNotIncludes(result, "available", "location availability not in prompt");
});
