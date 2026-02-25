# Spec

## Goal
Preserve HRV sample-count fidelity across watch direct-send and local replay paths so agent HRV confidence gating behaves consistently when relay disconnects/reconnects.

## Scope
- Watch app local schema/entity/repository changes for HRV sample count.
- Replay JSON serialization updates to include `hrv.samples`.
- Agent-side verification through tests/log expectations.

## Out of Scope
- Changing confidence threshold (`samples >= 8`).
- Altering HRV algorithm (`rmssd`, `sdnn`) math.

## Files Expected
- `watch-app/app/src/main/kotlin/com/flowdetector/watch/data/SensorBatch.kt`
- `watch-app/app/src/main/kotlin/com/flowdetector/watch/data/SensorRepository.kt`
- `watch-app/app/src/main/kotlin/com/flowdetector/watch/data/*` migration/DAO files if needed
- `server/ambient-agent/test-e2e.ts`
- `server/ambient-agent/test-runner.ts`
- `server/ambient-agent/agent-gap-handling.test.ts` (or equivalent replay coverage)
