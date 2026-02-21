/**
 * Gap handling tests for AmbientAgent
 *
 * Verifies the connection state machine:
 * - First connect: no warm-up
 * - Short gap (<5s): debounced, no warm-up
 * - Medium gap (5s–5min): warm-up, history preserved
 * - Long gap (>5min): warm-up, history cleared, baseline preserved
 * - Warm-up completes after WARMUP_BATCHES (2) batches
 * - Detection blocked during warm-up
 * - Stale backfill batches (>1hr old) discarded
 * - Baseline persistence (provisional/stable) works
 */

import { AmbientAgent } from "./agent";
import type { BatchMessage, AmbientAgentState } from "./types";
import { readFileSync, unlinkSync, existsSync, writeFileSync } from "fs";

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_LOG_PATH = "/tmp/test-gap-handling.jsonl";
const TEST_BASELINE_PATH = "/tmp/baseline-state.json";

function makeBatch(overrides: Partial<BatchMessage> = {}): BatchMessage {
  return {
    type: "batch",
    windowMs: 30000,
    hr: { mean: 72, min: 65, max: 80, samples: 30 },
    hrv: { rmssd: 45, sdnn: 50 },
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeAgent(): AmbientAgent {
  // Clean up any previous test log
  if (existsSync(TEST_LOG_PATH)) unlinkSync(TEST_LOG_PATH);

  return new AmbientAgent({
    relayUrl: "ws://localhost:9999/browser",
    logPath: TEST_LOG_PATH,
  });
}

function state(agent: AmbientAgent): AmbientAgentState {
  return (agent as any).state;
}

function hrHistory(agent: AmbientAgent): unknown[] {
  return (agent as any).hrHistory;
}

function hrvHistory(agent: AmbientAgent): unknown[] {
  return (agent as any).hrvHistory;
}

function callHandleWatchStatus(
  agent: AmbientAgent,
  connected: boolean,
  deviceName: string | null = "Galaxy Watch 8"
): void {
  (agent as any).handleWatchStatus({
    type: "watch_status",
    connected,
    deviceName,
    timestamp: Date.now(),
  });
}

function callHandleBatch(agent: AmbientAgent, msg: BatchMessage): void {
  (agent as any).handleBatch(msg);
}

function checkDisqualifiers(agent: AmbientAgent): string | null {
  return (agent as any).checkDisqualifiers();
}

function readLogLines(): string[] {
  if (!existsSync(TEST_LOG_PATH)) return [];
  const content = readFileSync(TEST_LOG_PATH, "utf-8").trim();
  return content ? content.split("\n") : [];
}

function cleanup(): void {
  if (existsSync(TEST_LOG_PATH)) unlinkSync(TEST_LOG_PATH);
  if (existsSync(TEST_BASELINE_PATH)) unlinkSync(TEST_BASELINE_PATH);
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

console.log("\nGap handling tests\n");

// 1. First connect — no warm-up
test("test_firstConnect_noWarmup", () => {
  const agent = makeAgent();
  assertEqual(state(agent).disconnectedAt, null, "disconnectedAt before connect");

  callHandleWatchStatus(agent, true);

  assertEqual(state(agent).connectionState, "connected", "connectionState");
  // No gap event should be logged
  assertEqual(readLogLines().length, 0, "gap events logged");
  cleanup();
});

// 2. Short gap (<5s) — debounced
test("test_shortGap_debounced", () => {
  const agent = makeAgent();

  // First connect
  callHandleWatchStatus(agent, true);
  assertEqual(state(agent).connectionState, "connected", "initial state");

  // Disconnect
  callHandleWatchStatus(agent, false);
  assertEqual(state(agent).connectionState, "disconnected", "after disconnect");

  // Quick reconnect within 3s
  const disconnectedAt = state(agent).disconnectedAt!;
  // Simulate fast reconnect by reconnecting immediately (gap < 5s)
  callHandleWatchStatus(agent, true);

  assertEqual(state(agent).connectionState, "connected", "after quick reconnect");
  // No gap event for debounced reconnect
  assertEqual(readLogLines().length, 0, "gap events logged");
  cleanup();
});

// 3. Medium gap (60s) — warm-up but history preserved
test("test_mediumGap_warmupNoHistoryClear", () => {
  const agent = makeAgent();

  // First connect + add some history
  callHandleWatchStatus(agent, true);
  callHandleBatch(agent, makeBatch());
  callHandleBatch(agent, makeBatch());
  const historyBefore = hrHistory(agent).length;
  assert(historyBefore > 0, "should have HR history");

  // Set a baseline manually
  (agent as any).state.baseline = { restingHR: 72, baselineHRV: 45, updatedAt: Date.now() };

  // Disconnect
  callHandleWatchStatus(agent, false);
  const disconnectedAt = state(agent).disconnectedAt!;

  // Simulate 60s gap
  (agent as any).state.disconnectedAt = Date.now() - 60000;
  callHandleWatchStatus(agent, true);

  assertEqual(state(agent).connectionState, "warming_up", "connectionState");
  assert(hrHistory(agent).length === historyBefore, "HR history should be preserved");
  assert(state(agent).baseline !== null, "baseline should be preserved");

  // Gap event logged
  const lines = readLogLines();
  assertEqual(lines.length, 1, "one gap event logged");
  const event = JSON.parse(lines[0]);
  assertEqual(event.type, "gap", "event type");
  cleanup();
});

// 4. Long gap (>5min) — clears history but keeps baseline
test("test_longGap_clearsHistory_keepsBaseline", () => {
  const agent = makeAgent();

  // First connect + add history
  callHandleWatchStatus(agent, true);
  callHandleBatch(agent, makeBatch());
  callHandleBatch(agent, makeBatch());
  assert(hrHistory(agent).length > 0, "should have HR history");

  // Set a baseline
  (agent as any).state.baseline = { restingHR: 72, baselineHRV: 45, updatedAt: Date.now() };

  // Disconnect
  callHandleWatchStatus(agent, false);

  // Simulate 10min gap
  (agent as any).state.disconnectedAt = Date.now() - 10 * 60 * 1000;
  callHandleWatchStatus(agent, true);

  assertEqual(state(agent).connectionState, "warming_up", "connectionState");
  assertEqual(hrHistory(agent).length, 0, "HR history cleared");
  assertEqual(hrvHistory(agent).length, 0, "HRV history cleared");
  assert(state(agent).baseline !== null, "baseline preserved");

  // Gap event logged
  const lines = readLogLines();
  assertEqual(lines.length, 1, "one gap event logged");
  cleanup();
});

// 4b. Provisional baseline can be established with 10 HR samples
test("test_provisionalBaseline_establishesAt10Samples", () => {
  const agent = makeAgent();
  callHandleWatchStatus(agent, true);

  const now = Date.now();
  for (let index = 0; index < 10; index++) {
    callHandleBatch(agent, makeBatch({
      timestamp: now - (9 - index) * 30000,
      hr: { mean: 70 + (index % 2), min: 66, max: 76, samples: 100 },
      hrv: { rmssd: 40 + (index % 3), sdnn: 45 },
    }));
  }

  (agent as any).processDetection();

  assert(state(agent).baseline !== null, "baseline should be established after 10 samples");
  assert(existsSync(TEST_BASELINE_PATH), "baseline file persisted");

  const raw = readFileSync(TEST_BASELINE_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  assertEqual(parsed.stage, "provisional", "persisted stage");
  cleanup();
});

// 4c. Persisted baseline is loaded on startup path
test("test_loadPersistedBaseline", () => {
  writeFileSync(
    TEST_BASELINE_PATH,
    JSON.stringify({
      baseline: {
        restingHR: 69,
        baselineHRV: 41.5,
        updatedAt: Date.now() - 10000,
      },
      stage: "stable",
      savedAt: Date.now(),
    })
  );

  const agent = makeAgent();
  (agent as any).loadPersistedBaseline();

  assert(state(agent).baseline !== null, "baseline loaded");
  assertEqual((agent as any).baselineStage, "stable", "baseline stage loaded");
  cleanup();
});

// 5. Warm-up completes after 2 batches
test("test_warmup_completesAfterBatches", () => {
  const agent = makeAgent();

  // Connect, disconnect, reconnect with medium gap
  callHandleWatchStatus(agent, true);
  callHandleWatchStatus(agent, false);
  (agent as any).state.disconnectedAt = Date.now() - 60000;
  callHandleWatchStatus(agent, true);
  assertEqual(state(agent).connectionState, "warming_up", "should be warming up");

  // First batch — still warming up
  callHandleBatch(agent, makeBatch());
  assertEqual(state(agent).connectionState, "warming_up", "still warming after 1 batch");
  assertEqual(state(agent).batchesSinceReconnect, 1, "batch count");

  // Second batch — warm-up complete
  callHandleBatch(agent, makeBatch());
  assertEqual(state(agent).connectionState, "connected", "connected after 2 batches");
  assertEqual(state(agent).batchesSinceReconnect, 2, "batch count");
  cleanup();
});

// 6. Detection blocked during warm-up
test("test_warmup_blocksDetection", () => {
  const agent = makeAgent();

  // Connect, disconnect, reconnect with medium gap
  callHandleWatchStatus(agent, true);
  callHandleWatchStatus(agent, false);
  (agent as any).state.disconnectedAt = Date.now() - 60000;
  callHandleWatchStatus(agent, true);

  // Force watch connected + warming_up state
  (agent as any).state.isWatchConnected = true;

  const dq = checkDisqualifiers(agent);
  assert(dq !== null, "should have a disqualifier");
  assert(dq!.includes("Warming up"), `disqualifier should mention warming up, got: ${dq}`);
  cleanup();
});

// 7. Stale backfill batch discarded
test("test_staleBackfill_discarded", () => {
  const agent = makeAgent();
  callHandleWatchStatus(agent, true);

  const initialCount = hrHistory(agent).length;

  // Send a batch with timestamp >1hr old
  const staleBatch = makeBatch({ timestamp: Date.now() - 2 * 60 * 60 * 1000 });
  callHandleBatch(agent, staleBatch);

  // HR history should not grow
  assertEqual(hrHistory(agent).length, initialCount, "HR history unchanged after stale batch");
  cleanup();
});

// 8. Duplicate connected messages ignored
test("test_duplicateConnected_ignored", () => {
  const agent = makeAgent();

  // First connect + add history + set baseline
  callHandleWatchStatus(agent, true);
  callHandleBatch(agent, makeBatch());
  callHandleBatch(agent, makeBatch());
  const historyBefore = hrHistory(agent).length;
  (agent as any).state.baseline = { restingHR: 72, baselineHRV: 45, updatedAt: Date.now() };

  assertEqual(state(agent).connectionState, "connected", "should be connected");

  // Send duplicate connected — should be a no-op
  callHandleWatchStatus(agent, true);

  assertEqual(state(agent).connectionState, "connected", "still connected (not warming_up)");
  assertEqual(hrHistory(agent).length, historyBefore, "HR history unchanged");
  assert(state(agent).baseline !== null, "baseline unchanged");
  assertEqual(readLogLines().length, 0, "no gap events logged");
  cleanup();
});

// 9. Duplicate connected during warm-up ignored
test("test_duplicateConnected_duringWarmup_ignored", () => {
  const agent = makeAgent();

  // Connect, disconnect, reconnect with medium gap → warming_up
  callHandleWatchStatus(agent, true);
  callHandleWatchStatus(agent, false);
  (agent as any).state.disconnectedAt = Date.now() - 60000;
  callHandleWatchStatus(agent, true);
  assertEqual(state(agent).connectionState, "warming_up", "should be warming up");

  const logsBefore = readLogLines().length;

  // Send duplicate connected during warm-up — should be a no-op
  callHandleWatchStatus(agent, true);

  assertEqual(state(agent).connectionState, "warming_up", "still warming up");
  assertEqual(readLogLines().length, logsBefore, "no additional gap events");
  cleanup();
});

// ── Summary ──────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
