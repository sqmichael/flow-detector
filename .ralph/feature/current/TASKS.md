# Tasks: Watch Disconnect Resilience

## Implementation Tasks

- [ ] **Task 1: Add connection state types** — In `server/ambient-agent/types.ts`, add `ConnectionState` type (`"connected" | "disconnected" | "warming_up"` — string union, not enum), `GapEvent` type (`{ type: "gap", disconnectedAt: number, reconnectedAt: number, gapDurationMs: number, batchesDuringWarmup: number }`), and extend `AgentState` interface with: `connectionState: ConnectionState`, `disconnectedAt: number | null`, `reconnectedAt: number | null`, `batchesSinceReconnect: number`. Keep all existing fields unchanged.
  - AC: Types compile (`npx tsc --noEmit server/ambient-agent/types.ts`). No runtime changes.

- [ ] **Task 2: Add gap event logging** — In `server/ambient-agent/logger.ts`, add `logGapEvent(event: GapEvent, logPath: string)` that appends a JSONL line with `{ timestamp: Date.now(), date: new Date().toISOString(), type: "gap", disconnectedAt, reconnectedAt, gapDurationMs, batchesDuringWarmup }`. Follow the existing `logIntervention()` pattern exactly (same `fs.appendFileSync`, same `try/catch` with `console.error`). Import `GapEvent` from `./types`.
  - AC: Function exported. Calling it with a temp file path produces valid JSONL.

- [ ] **Task 3: Implement disconnect handling in agent** — In `server/ambient-agent/agent.ts`:
  1. Add constants at top: `GAP_CLEAR_THRESHOLD_MS = 5 * 60 * 1000`, `GAP_DEBOUNCE_MS = 5000`, `WARMUP_BATCHES = 2`, `BACKFILL_MAX_AGE_MS = 60 * 60 * 1000`
  2. Initialize new state fields where `this.state` is constructed: `connectionState: "disconnected"`, `disconnectedAt: null`, `reconnectedAt: null`, `batchesSinceReconnect: 0`
  3. In `handleWatchStatus()` when `connected === false`: set `this.state.connectionState = "disconnected"`, `this.state.disconnectedAt = Date.now()`, log `Watch disconnected` to console
  - AC: On `watch_status: false`, state fields update correctly. No other behavior changes.

- [ ] **Task 4: Implement reconnect + warm-up in agent** — In `server/ambient-agent/agent.ts`, in `handleWatchStatus()` when `connected === true`:
  1. **First connect** (when `this.state.disconnectedAt === null`): set `connectionState = "connected"`, no gap event, no warm-up. Return early.
  2. **Calculate gap**: `gapMs = Date.now() - this.state.disconnectedAt`
  3. **Debounce** (gap < `GAP_DEBOUNCE_MS`): set `connectionState = "connected"`, no gap event, no warm-up. Return early.
  4. **Long gap** (gap >= `GAP_CLEAR_THRESHOLD_MS`): clear `this.hrHistory.length = 0`, `this.hrvHistory.length = 0`, set `this.state.baseline = null`. Log `Clearing stale history after ${Math.round(gapMs/1000)}s gap`.
  5. **All non-debounced gaps**: set `connectionState = "warming_up"`, `batchesSinceReconnect = 0`, `reconnectedAt = Date.now()`. Call `logGapEvent()` with `this.logPath`.
  - AC: Short gaps debounced. Long gaps clear history. Gap events in JSONL log.

- [ ] **Task 5: Add warm-up disqualifier + backfill filter** — In `server/ambient-agent/agent.ts`:
  1. In the processing/detection gate (where `checkDisqualifiers()` or equivalent runs): add check `if (this.state.connectionState === "warming_up") return "Warming up after reconnect — need ${WARMUP_BATCHES - this.state.batchesSinceReconnect} more batches"` alongside existing `isWatchConnected` check.
  2. In batch processing (where HR/HRV data is extracted from incoming batches): increment `this.state.batchesSinceReconnect++`. When `batchesSinceReconnect >= WARMUP_BATCHES`, transition `connectionState` to `"connected"` and log `Warm-up complete after ${this.state.batchesSinceReconnect} batches`.
  3. In batch processing: skip batches where `batch.timestamp < Date.now() - BACKFILL_MAX_AGE_MS` with a log message `Discarding stale backfill batch (age: ${age}s)`.
  - AC: Detection blocked during warm-up. Stale backfill batches discarded. Warm-up completes after 2 batches.

- [ ] **Task 6: Write gap handling tests** — Create `server/ambient-agent/agent-gap-handling.test.ts` following the pattern of `agent-location-staleness.test.ts` (use `(agent as any)` for internals, fake relay URL `ws://localhost:9999/browser`, no real WebSocket). Tests:
  1. `test_firstConnect_noWarmup` — First `watch_status: true` when `disconnectedAt === null` → `connectionState = "connected"`, no gap event
  2. `test_shortGap_debounced` — Disconnect then reconnect within 3s → `connectionState = "connected"`, no warm-up, no gap event logged
  3. `test_mediumGap_warmupNoHistoryClear` — 60s gap → `connectionState = "warming_up"`, `hrHistory` preserved, `baseline` preserved, gap event logged
  4. `test_longGap_clearsHistoryAndBaseline` — 10min gap → `hrHistory` empty, `hrvHistory` empty, `baseline = null`, gap event logged
  5. `test_warmup_completesAfterBatches` — Feed 2 batches during warm-up → `connectionState` transitions to `"connected"`
  6. `test_warmup_blocksDetection` — During warm-up, detection loop returns disqualifier string
  7. `test_staleBackfill_discarded` — Batch with timestamp >1hr old → not added to history
  - AC: Run `npx tsx server/ambient-agent/agent-gap-handling.test.ts` — all 7 tests pass.

- [ ] **Task 7: Update STANDARDS.md** — Append to existing `STANDARDS.md` (do NOT overwrite):
  - Under `## Error Handling`, add: `- After watch reconnect (gap >5s), agent enters warm-up state requiring 2 batches (~60s) before resuming detection`
  - Under `## DO NOT`, add: `- DO NOT trigger interventions during warm-up period after watch reconnect`
  - Under `## DO NOT`, add: `- DO NOT keep stale HR/HRV history across gaps longer than 5 minutes`
  - Under `## DO NOT`, add: `- DO NOT process backfill batches older than 1 hour`
  - AC: Standards updated. No existing rules removed. File still valid markdown.
