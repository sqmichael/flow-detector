/**
 * Tests for isCurrentlyInEvent helper and buildOpenClawContext
 */

import {
  isCurrentlyInEvent,
  buildOpenClawContext,
  buildOpenClawDecisionPrompt,
  deriveWatchQualityStatus,
  type CalendarEvent,
  type CalendarContext,
} from "./openclaw-context";
import type { AmbientAgentState, PersonalBaseline } from "./types";

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

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

function makeEvent(
  startIso: string,
  endIso: string,
  eventType = "default"
): CalendarEvent {
  return {
    summary: "Test Event",
    start: startIso,
    end: endIso,
    status: "confirmed",
    eventType,
  };
}

const now = new Date("2026-02-20T14:00:00.000Z");
const oneHourAgo = new Date("2026-02-20T13:00:00.000Z").toISOString();
const oneHourLater = new Date("2026-02-20T15:00:00.000Z").toISOString();
const twoHoursAgo = new Date("2026-02-20T12:00:00.000Z").toISOString();
const thirtyMinAgo = new Date("2026-02-20T13:30:00.000Z").toISOString();
const thirtyMinLater = new Date("2026-02-20T14:30:00.000Z").toISOString();

console.log("isCurrentlyInEvent");

test("returns true when now is within start–end window", () => {
  const event = makeEvent(oneHourAgo, oneHourLater);
  assert(isCurrentlyInEvent(event, now), "should be in event");
});

test("returns false when event has not started yet", () => {
  const event = makeEvent(thirtyMinLater, oneHourLater);
  assert(!isCurrentlyInEvent(event, now), "should not be in event");
});

test("returns false when event has already ended", () => {
  const event = makeEvent(twoHoursAgo, oneHourAgo);
  assert(!isCurrentlyInEvent(event, now), "should not be in event");
});

test("returns false when now equals end time (exclusive end)", () => {
  // now === end → not in event (end is exclusive)
  const event = makeEvent(oneHourAgo, now.toISOString());
  assert(!isCurrentlyInEvent(event, now), "end is exclusive");
});

test("returns true when now equals start time (inclusive start)", () => {
  const event = makeEvent(now.toISOString(), oneHourLater);
  assert(isCurrentlyInEvent(event, now), "start is inclusive");
});

test("works with all-day date strings (YYYY-MM-DD)", () => {
  // All-day event on 2026-02-20 — now (14:00 UTC) is within it
  const event = makeEvent("2026-02-20", "2026-02-21");
  assert(isCurrentlyInEvent(event, now), "all-day event should include this time");
});

test("returns false for all-day event that is yesterday", () => {
  const event = makeEvent("2026-02-19", "2026-02-20");
  assert(!isCurrentlyInEvent(event, now), "yesterday's all-day event should not match");
});

test("uses current time by default (no now parameter)", () => {
  // Event far in the past — should return false regardless of when we call it
  const event = makeEvent("2020-01-01T00:00:00Z", "2020-01-02T00:00:00Z");
  assert(!isCurrentlyInEvent(event), "past event should not match current time");
});

test("works with focusTime eventType", () => {
  const event = makeEvent(oneHourAgo, oneHourLater, "focusTime");
  assert(isCurrentlyInEvent(event, now), "focusTime event within window");
});

test("works with outOfOffice eventType", () => {
  const event = makeEvent(thirtyMinAgo, thirtyMinLater, "outOfOffice");
  assert(isCurrentlyInEvent(event, now), "outOfOffice event within window");
});

// ── buildOpenClawContext: dynamicContext integration ──────────────────

const NOW_MS = Date.now();

function makeBaseline(restingHR = 65, baselineHRV = 40): PersonalBaseline {
  return { restingHR, baselineHRV, updatedAt: NOW_MS };
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
    currentLocation: null,
    lastSensorUpdate: NOW_MS,
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
    startedAt: NOW_MS - 10 * 60 * 1000,
    ...overrides,
  };
}

console.log("\nbuildOpenClawContext dynamicContext");

test("sets watchQuality.status=good when quality is >= 50", () => {
  const ctx = buildOpenClawContext(makeState({ watchQuality: 87 }), makeBaseline(), [], 2, 0, null);
  assert(ctx.sensors.watchQuality.status === "good", "watch quality should be good");
  assert(ctx.sensors.watchQuality.value === 87, "watch quality value should be retained");
});

test("sets watchQuality.status=bad when quality is < 50 and redacts biometrics", () => {
  const ctx = buildOpenClawContext(
    makeState({ watchQuality: 20, currentHR: 82, currentHRV: 25, currentSCL: 8.4 }),
    makeBaseline(),
    [],
    2,
    0,
    null
  );
  assert(ctx.sensors.watchQuality.status === "bad", "watch quality should be bad");
  assert(ctx.sensors.hr === null, "HR should be redacted");
  assert(ctx.sensors.hrv === null, "HRV should be redacted");
  assert(ctx.sensors.scl === null, "SCL should be redacted");
});

test("sets watchQuality.status=unknown when quality is null", () => {
  const ctx = buildOpenClawContext(makeState({ watchQuality: null }), makeBaseline(), [], 2, 0, null);
  assert(ctx.sensors.watchQuality.status === "unknown", "watch quality should be unknown");
});

test("deriveWatchQualityStatus returns expected status values", () => {
  assert(deriveWatchQualityStatus(80) === "good", "80 should be good");
  assert(deriveWatchQualityStatus(49) === "bad", "49 should be bad");
  assert(deriveWatchQualityStatus(null) === "unknown", "null should be unknown");
});

test("buildOpenClawDecisionPrompt includes required hard-gate language", () => {
  const ctx = buildOpenClawContext(makeState({ watchQuality: 20 }), makeBaseline(), [], 2, 0, null);
  const prompt = buildOpenClawDecisionPrompt(ctx);
  assert(prompt.includes('watchQuality.status == "bad"'), "prompt should mention bad-quality hard gate");
  assert(prompt.includes("Return JSON only"), "prompt should require JSON-only output");
});

test("includes dynamicContext field in returned object", () => {
  const ctx = buildOpenClawContext(makeState(), makeBaseline(), [], 2, 0, null);
  assert("dynamicContext" in ctx, "dynamicContext field must be present");
});

test("dynamicContext has required shape fields", () => {
  const ctx = buildOpenClawContext(makeState(), makeBaseline(), [], 2, 0, null);
  const dc = ctx.dynamicContext;
  assert("sensorMood" in dc, "sensorMood missing");
  assert("timeOfDay" in dc, "timeOfDay missing");
  assert("dayOfWeek" in dc, "dayOfWeek missing");
  assert("warmthLevel" in dc, "warmthLevel missing");
  assert("recentThemes" in dc, "recentThemes missing");
  assert("location" in dc, "location missing");
  assert(Array.isArray(dc.recentThemes), "recentThemes must be array");
});

test("dynamicContext.location is unavailable when state has no location", () => {
  const ctx = buildOpenClawContext(makeState({ currentLocation: null }), makeBaseline(), [], 2, 0, null);
  assert(ctx.dynamicContext.location === "unavailable", "should be unavailable with no location");
});

test("dynamicContext.location is available when state has location data", () => {
  const state = makeState({
    currentLocation: { latitude: 37.7749, longitude: -122.4194, accuracy: 10 },
  });
  const ctx = buildOpenClawContext(state, makeBaseline(), [], 2, 0, null);
  assert(ctx.dynamicContext.location === "available", "should be available with location data");
});

test("dynamicContext.sensorMood is unknown when no baseline", () => {
  const ctx = buildOpenClawContext(makeState(), null, [], 2, 0, null);
  assert(ctx.dynamicContext.sensorMood === "unknown", "unknown without baseline");
});

test("dynamicContext calendar fields are null when no calendar passed", () => {
  const ctx = buildOpenClawContext(makeState(), makeBaseline(), [], 2, 0, null);
  assert(ctx.dynamicContext.nextEventMinutes === null, "nextEventMinutes should be null");
  assert(ctx.dynamicContext.nextEventName === null, "nextEventName should be null");
});

test("dynamicContext.nextEventMinutes populated from calendar", () => {
  const futureStart = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const calendar: CalendarContext = {
    upcoming: [{ summary: "Standup", start: futureStart, end: futureEnd, status: "confirmed" }],
    inMeeting: false,
    currentMeeting: null,
    minutesToNext: 30,
  };
  const ctx = buildOpenClawContext(makeState(), makeBaseline(), [], 2, 0, calendar);
  assert(ctx.dynamicContext.nextEventMinutes === 30, "nextEventMinutes should be 30");
  assert(ctx.dynamicContext.nextEventName === "Standup", "nextEventName should be Standup");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
