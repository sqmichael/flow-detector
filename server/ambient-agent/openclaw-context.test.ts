/**
 * Tests for isCurrentlyInEvent helper
 */

import { isCurrentlyInEvent, type CalendarEvent } from "./openclaw-context";

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
