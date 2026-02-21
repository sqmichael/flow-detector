# Spec: Watch Disconnect Resilience

## Files to Change

| File | Changes |
|------|---------|
| `server/ambient-agent/types.ts` | Add `ConnectionState` type, `GapEvent` type, extend `AgentState` with connection state fields |
| `server/ambient-agent/agent.ts` | Add connection state machine, gap tracking, warm-up logic, history clearing, baseline invalidation, warm-up disqualifier, backfill age filter |
| `server/ambient-agent/logger.ts` | Add `logGapEvent()` for disconnect/reconnect JSONL logging |
| `server/ambient-agent/agent-gap-handling.test.ts` | New test file for gap handling scenarios |

## New Functions/Types

| Name | Signature | Purpose |
|------|-----------|---------|
| `ConnectionState` | `type ConnectionState = "connected" \| "disconnected" \| "warming_up"` | Explicit connection state (string union, not enum) |
| `GapEvent` | `{ type: "gap", disconnectedAt: number, reconnectedAt: number, gapDurationMs: number, batchesDuringWarmup: number }` | Gap event for JSONL logging. `batchesDuringWarmup` = batches received while in warming_up state (0 if gap was debounced) |
| `logGapEvent()` | `(event: GapEvent, logPath: string) => void` | Append gap event to intervention log. `logPath` = same path as `logIntervention()` (the agent's `this.logPath` field) |

## Clarifications (from codex review)

- **Warm-up counting**: Based on **batches** (not individual HR samples). Each batch = ~30s window. `WARMUP_BATCHES = 2` means ~60s of data before detection resumes. This is conservative enough without being too slow.
- **`batchesDuringWarmup`**: Count of batches received while `connectionState === "warming_up"`. Logged in the gap event when warm-up completes (or on next disconnect if warm-up didn't finish).
- **Initial connect (first time)**: When `disconnectedAt === null` and watch connects, set `connectionState = "connected"` immediately. No gap event logged, no warm-up. This is a fresh start, not a reconnect.
- **logPath source**: The agent already has `this.logPath` (set in constructor from CLI config). `logGapEvent()` uses this same path.
- **No changes to `detectors.ts`**: The warm-up check lives in `agent.ts`'s processing loop (alongside existing `isWatchConnected` check), not in the detector functions. Detectors already return safe defaults when data is null.

## Failure Modes

| What Could Go Wrong | How to Handle |
|---------------------|---------------|
| Rapid connect/disconnect flapping | Debounce: gaps < `GAP_DEBOUNCE_MS` (5s) → set connected immediately, no warm-up, no gap event |
| Batch flood on reconnect (100 batches at once) | Batches still increment warm-up counter but detection is blocked until warm-up completes |
| Backfill batches older than 1 hour | Discard: skip batches where `batch.timestamp < Date.now() - BACKFILL_MAX_AGE_MS` |
| Agent process restart (loses in-memory state) | Accept cold start — baseline rebuilds naturally from accumulated data |
| Gap event logging fails (disk full, permissions) | Log to stderr via existing error pattern, continue operating |
| Watch never reconnects | Agent stays in "disconnected" state indefinitely — correct ("go silent") |

## Change Sequence

| Step | Change | Depends On |
|------|--------|------------|
| 1 | Add types (`ConnectionState`, `GapEvent`, state fields) | Nothing |
| 2 | Add `logGapEvent()` to logger | Step 1 (GapEvent type) |
| 3 | Implement disconnect handling in agent | Steps 1, 2 |
| 4 | Implement reconnect handling + warm-up in agent | Steps 1, 2, 3 |
| 5 | Add warm-up disqualifier + backfill filter in agent processing loop | Steps 3, 4 |
| 6 | Write gap handling tests | Steps 1-5 |
| 7 | Update STANDARDS.md | Steps 1-6 |

## Constants

| Name | Value | Rationale |
|------|-------|-----------|
| `GAP_CLEAR_THRESHOLD_MS` | `5 * 60 * 1000` (5 min) | Gaps longer than 5 min mean pre-gap data is stale |
| `GAP_DEBOUNCE_MS` | `5000` (5s) | Ignore sub-5s reconnect flaps |
| `WARMUP_BATCHES` | `2` | 2 batches x 30s = ~60s of clean data before resuming detection |
| `BACKFILL_MAX_AGE_MS` | `60 * 60 * 1000` (1 hr) | Batches older than 1hr are discarded on backfill |
