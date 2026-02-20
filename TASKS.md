# Tasks

> Each task is one verifiable unit of work for a single Ralph iteration.
> Format: `- [ ] Task description` (completed: `- [x]`)

## Part 1: Location Persistence

- [x] Add `location_lat`, `location_lon`, `location_accuracy` columns to `watch_batches` table in `server/sensor-fusion/database.ts` (ALTER TABLE migration + CREATE TABLE update). Add matching fields to `WatchBatchRow` and `WatchBatchInsert` in `server/sensor-fusion/types.ts`. Verify with `npx tsc --noEmit`.
- [ ] Update `insertWatchBatch()` in `server/sensor-fusion/database.ts` to persist location fields. Update `watch-relay.ts` batch handler (~line 300) to pass `msg.location` through to `insertWatchBatch()`. Include location in `exportSessionAsJSONL()`.
- [ ] In `agent.ts`, clear `state.currentLocation = null` when location data is stale (no batch with location for >5 minutes). Add staleness check in `handleBatch()` — if batch has no location field AND last location is >5min old, null it out.

## Part 2: Calendar Event Types

- [ ] Add `isCurrentlyInEvent(event, now?)` helper to `server/ambient-agent/openclaw-context.ts` that returns true if `now` is between event start and end. Add `focusTime` and `outOfOffice` disqualifiers in `agent.ts` `processViaOpenClaw()` after the existing meeting check. `focusTime` should also call `enableFocusMode()`. Write inline tests or verify manually.

## Part 3: Dynamic Context

- [ ] Add `getRecentThemes(limit: number): string[]` to `server/calling/memory/service.ts` — query themes table ordered by `created_at DESC`, respecting decay (skip themes with weight < 0.1). Write a test for it in `service.test.ts`.
- [ ] Create `server/ambient-agent/dynamic-context.ts` with `DynamicContext` interface and `buildDynamicContext(state, baseline, calendar)` function. Implement `sensorMood` derivation (5 states based on HR/HRV/stillness vs baseline). Read warmth from `getUserState()`, themes from `getRecentThemes(3)`. All reads wrapped in try/catch with safe defaults.
- [ ] Write tests for `buildDynamicContext()` in `server/ambient-agent/dynamic-context.test.ts`: all 5 mood states, missing sensor data → "unknown", missing memory layer → defaults, calendar context present/absent, location available/unavailable.

## Part 4: Prompt Injection

- [ ] Integrate `DynamicContext` into `reasoning.ts` — add `dynamicContext?: DynamicContext` to `ReasoningInput`. In `decideIntervention()`, serialize context into a "Context:" block appended to the user prompt. Skip null/unknown lines. Keep under +80 tokens.
- [ ] Integrate `DynamicContext` into `openclaw-context.ts` — add dynamic context fields to `buildOpenClawContext()` return value so OpenClaw sees mood/time/memory/calendar signals.
- [ ] Update `agent.ts` to call `buildDynamicContext()` before each intervention decision in both `processViaOpenClaw()` and the reasoning.ts fallback path. Pass context through to both.

## Part 5: Verification

- [ ] End-to-end smoke test: run agent with `--no-openclaw`, send fake batch data via `test-e2e.ts`, verify dynamic context fields appear in intervention-log.jsonl trigger data. Verify location is persisted in SQLite. Verify `focusTime` calendar events suppress interventions.
