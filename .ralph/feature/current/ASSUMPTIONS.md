# Assumptions

## Problem Assumptions
1. Missing `hrv.samples` causes valid HRV values to be rejected as low-confidence in agent runtime.
2. Watch buffered/replay path is dropping HRV sample-count fields while direct websocket path keeps them.
3. Requiring `samples >= 8` remains correct for noise rejection; fix should preserve guardrail, not relax it.
4. Schema/migration changes on watch local storage are acceptable and low risk if backward-compatible defaults are used.

## Risks
- Migration mismatch could break replay of older batches.
- Partial fix (tests only) could mask production disconnect/reconnect failure mode.

## Validation
- Simulated/replayed batches with HRV sample counts should update `currentHRV` and avoid low-confidence rejection logs.
- Replayed batches without sample counts should still be safely rejected.
