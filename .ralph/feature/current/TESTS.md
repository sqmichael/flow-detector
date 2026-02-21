# Test Plan

## Coverage Map
| Behavior | Test Type | Where |
|----------|----------|-------|
| Repo entrypoint clarity and command discoverability | Manual doc validation | `README.md` |
| Documentation status discoverability | Manual doc validation | `docs/README.md` |
| Architecture accuracy vs current runtime paths | Manual cross-check | `docs/architecture.md` |
| Superseded plan clearly labeled | Manual doc validation | `docs/WATCH-BRIDGE-PLAN.md` |
| Setup command portability | Manual doc validation | `server/calling/SETUP.md` |

## Edge Cases
- Existing contributors using old SensorServer docs should immediately see superseded warning.
- Setup steps should remain valid even without root `.env.example`.
- Doc links should be readable from both repo root and `docs/` context.

## Notes
- This iteration is documentation-only; no automated test suite changes required.
- Validation performed via file/path checks and direct content review.
