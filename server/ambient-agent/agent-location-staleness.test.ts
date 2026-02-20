/**
 * Location staleness tests for AmbientAgent.handleBatch()
 *
 * Verifies that state.currentLocation is:
 * - Set when a batch includes a location field
 * - Preserved when a batch has no location but last location is <5min old
 * - Cleared when a batch has no location and last location is >5min old
 * - Cleared immediately on watch disconnect
 */

import { AmbientAgent } from "./agent";
import type { BatchMessage } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────

const FIVE_MIN_MS = 5 * 60 * 1000;

const TEST_LOCATION = { latitude: 1.23, longitude: 4.56, accuracy: 10 };

function makeBatch(overrides: Partial<BatchMessage> = {}): BatchMessage {
  return {
    type: "batch",
    windowMs: 30000,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeAgent(): AmbientAgent {
  return new AmbientAgent({
    relayUrl: "ws://localhost:9999/browser", // won't connect in tests
    logPath: "/tmp/test-ambient-agent.jsonl",
  });
}

// Access private internals
function agentState(agent: AmbientAgent) {
  return (agent as any).state as { currentLocation: unknown };
}

function callHandleBatch(agent: AmbientAgent, msg: BatchMessage): void {
  (agent as any).handleBatch(msg);
}

function callHandleWatchStatus(
  agent: AmbientAgent,
  msg: { type: "watch_status"; connected: boolean; deviceName: string | null; timestamp: number }
): void {
  (agent as any).handleWatchStatus(msg);
}

// ── Tests ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log("\nLocation staleness tests\n");

// 1. Batch with location → state.currentLocation is set
test("batch_with_location_sets_currentLocation", () => {
  const agent = makeAgent();
  callHandleBatch(agent, makeBatch({ location: TEST_LOCATION }));
  assertEqual(agentState(agent).currentLocation, TEST_LOCATION, "currentLocation");
});

// 2. Batch without location, no prior location → stays null
test("batch_without_location_no_prior_stays_null", () => {
  const agent = makeAgent();
  callHandleBatch(agent, makeBatch()); // no location field
  assertEqual(agentState(agent).currentLocation, null, "currentLocation");
});

// 3. Batch without location, but prior location is fresh (<5min) → preserved
test("batch_without_location_fresh_prior_preserves_location", () => {
  const agent = makeAgent();
  const now = Date.now();

  // First batch: sets location at `now`
  callHandleBatch(agent, makeBatch({ location: TEST_LOCATION, timestamp: now }));

  // Second batch: no location, arrives 4 min later (still fresh)
  callHandleBatch(agent, makeBatch({ timestamp: now + 4 * 60 * 1000 }));

  assertEqual(agentState(agent).currentLocation, TEST_LOCATION, "currentLocation");
});

// 4. Batch without location, prior location is stale (>5min) → cleared
test("batch_without_location_stale_prior_clears_location", () => {
  const agent = makeAgent();
  const now = Date.now();

  // First batch: sets location at `now`
  callHandleBatch(agent, makeBatch({ location: TEST_LOCATION, timestamp: now }));

  // Second batch: no location, arrives 6 min later (stale)
  callHandleBatch(agent, makeBatch({ timestamp: now + 6 * 60 * 1000 }));

  assertEqual(agentState(agent).currentLocation, null, "currentLocation");
});

// 5. Exact 5-minute boundary: still stale (>5min, not >=)
test("batch_without_location_exactly_5min_old_clears_location", () => {
  const agent = makeAgent();
  const now = Date.now();

  callHandleBatch(agent, makeBatch({ location: TEST_LOCATION, timestamp: now }));
  // Exactly 5min + 1ms → stale
  callHandleBatch(agent, makeBatch({ timestamp: now + FIVE_MIN_MS + 1 }));

  assertEqual(agentState(agent).currentLocation, null, "currentLocation");
});

// 6. Location refreshed just before stale window → stays valid
test("batch_with_location_resets_staleness_timer", () => {
  const agent = makeAgent();
  const now = Date.now();

  // Set initial location
  callHandleBatch(agent, makeBatch({ location: TEST_LOCATION, timestamp: now }));

  // Refresh location at 4min (within window)
  const updatedLocation = { latitude: 9.9, longitude: 8.8, accuracy: 5 };
  callHandleBatch(agent, makeBatch({ location: updatedLocation, timestamp: now + 4 * 60 * 1000 }));

  // No location at 4min + 4min 59s — should still be within 5min of last receipt
  callHandleBatch(agent, makeBatch({ timestamp: now + 4 * 60 * 1000 + 4 * 60 * 1000 + 59000 }));

  assertEqual(agentState(agent).currentLocation, updatedLocation, "currentLocation");
});

// 7. Watch disconnect clears location immediately
test("watch_disconnect_clears_location_immediately", () => {
  const agent = makeAgent();
  const now = Date.now();

  callHandleBatch(agent, makeBatch({ location: TEST_LOCATION, timestamp: now }));
  assert(agentState(agent).currentLocation !== null, "location should be set before disconnect");

  callHandleWatchStatus(agent, {
    type: "watch_status",
    connected: false,
    deviceName: null,
    timestamp: now + 1000,
  });

  assertEqual(agentState(agent).currentLocation, null, "currentLocation after disconnect");
});

// 8. After disconnect + reconnect, fresh location is accepted
test("after_disconnect_reconnect_fresh_location_is_accepted", () => {
  const agent = makeAgent();
  const now = Date.now();

  callHandleBatch(agent, makeBatch({ location: TEST_LOCATION, timestamp: now }));
  callHandleWatchStatus(agent, {
    type: "watch_status",
    connected: false,
    deviceName: null,
    timestamp: now + 1000,
  });

  // Reconnect and receive a new batch with location
  callHandleWatchStatus(agent, {
    type: "watch_status",
    connected: true,
    deviceName: "Galaxy Watch 8",
    timestamp: now + 2000,
  });

  const newLocation = { latitude: 5.5, longitude: 6.6, accuracy: 20 };
  callHandleBatch(agent, makeBatch({ location: newLocation, timestamp: now + 3000 }));

  assertEqual(agentState(agent).currentLocation, newLocation, "currentLocation after reconnect");
});

// ── Summary ──────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
