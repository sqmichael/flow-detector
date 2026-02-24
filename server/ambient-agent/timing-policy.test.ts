import { decideTimingPolicy, type TimingPolicyContext } from "./timing-policy";

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

function makeContext(overrides: Partial<TimingPolicyContext> = {}): TimingPolicyContext {
  return {
    canMessageNow: true,
    currentMode: "free",
    nextFreeWindowMinutes: 20,
    locationType: "office",
    calendarPressure: "low",
    ...overrides,
  };
}

console.log("\ntiming-policy edge cases");

test("meeting mode delays message", () => {
  const decision = decideTimingPolicy(makeContext({ currentMode: "meeting" }));
  assert(decision.messageNow === false, "meeting should not message now");
  assert(decision.messageType === "none", "meeting should return none message type");
  assert(decision.reason === "meeting", "meeting reason mismatch");
});

test("transit mode delays message", () => {
  const decision = decideTimingPolicy(makeContext({ currentMode: "transit" }));
  assert(decision.messageNow === false, "transit should not message now");
  assert(decision.reason === "transit", "transit reason mismatch");
});

test("no free window delays with explicit reason", () => {
  const decision = decideTimingPolicy(makeContext({ nextFreeWindowMinutes: null }));
  assert(decision.messageNow === false, "no free window should delay");
  assert(decision.reason === "no_free_window", "no-free-window reason mismatch");
  assert(decision.delayMinutes !== null, "delay should be populated when no free window");
});

test("unknown location fails safe to delay", () => {
  const decision = decideTimingPolicy(makeContext({ locationType: "unknown" }));
  assert(decision.messageNow === false, "unknown location should fail safe");
  assert(decision.reason === "unknown_location", "unknown-location reason mismatch");
});

test("high calendar pressure delays message", () => {
  const decision = decideTimingPolicy(makeContext({ calendarPressure: "high" }));
  assert(decision.messageNow === false, "high calendar pressure should delay");
  assert(decision.reason === "high_calendar_pressure", "calendar-pressure reason mismatch");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
