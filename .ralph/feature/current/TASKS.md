# Tasks
- [ ] [engine=codex model=gpt-5.3-codex effort=medium] Add `hrvSamples` field to watch `SensorBatch` entity and write path in `SensorRepository.createBatch`.
- [ ] [engine=codex model=gpt-5.3-codex effort=high] Implement Room migration so existing watch local DBs gain `hrvSamples` with safe default `0`.
- [ ] [engine=codex model=gpt-5.3-codex effort=medium] Include `hrv.samples` in watch replay JSON serialization in `SensorRepository.batchToJson`.
- [ ] [engine=codex model=gpt-5.3-codex effort=low] Ensure direct websocket batch path still sends `hrv.samples` from `HrvAggregate`.
- [ ] [engine=codex model=gpt-5.3-codex effort=medium] Update `server/ambient-agent/test-runner.ts` to send `hrv.samples` in batch messages.
- [ ] [engine=codex model=gpt-5.3-codex effort=medium] Update `server/ambient-agent/agent-gap-handling.test.ts` fixtures to include `hrv.samples` where HRV is expected valid.
- [ ] [engine=codex model=gpt-5.3-codex effort=medium] Add replay-path test proving HRV is accepted when `hrv.samples >= 8` after disconnect/reconnect.
- [ ] [engine=codex model=gpt-5.3-codex effort=low] Add legacy-row fallback test proving replayed HRV without samples is rejected safely (`samples=0`).
- [ ] [engine=codex model=gpt-5.3-codex effort=low] Document verification steps and expected logs in `.ralph/plans/hrv-replay-samples-fix/SHIP.md`.
