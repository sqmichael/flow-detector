# Technical Specification

## Files to Change
| File | Changes |
|------|---------|
| `README.md` | Add canonical project overview, quickstart, commands, and doc links. |
| `docs/README.md` | Add documentation map with current/active/historical grouping. |
| `docs/architecture.md` | Replace stale SensorServer-era architecture with current watch-app + relay architecture. |
| `docs/WATCH-BRIDGE-PLAN.md` | Add historical/superseded warning banner. |
| `server/calling/SETUP.md` | Replace missing `.env.example` instructions with explicit `.env` creation; remove machine-specific paths. |

## New Functions/Types
| Name | Signature | Purpose |
|------|-----------|---------|
| N/A | N/A | Documentation-only iteration; no runtime code changes. |

## Failure Modes
| What Could Go Wrong | How to Handle |
|--------------------|---------------|
| New entry docs point to stale files | Run path/reference checks and update links before closing iteration |
| Setup instructions remain partially non-runnable | Validate against repo files and rewrite with explicit commands |
| Historical docs still interpreted as current | Add superseded labels and central docs index |

## Change Sequence
| Step | Change | Depends On |
|------|--------|------------|
| 1 | Add root `README.md` | — |
| 2 | Add `docs/README.md` taxonomy | Step 1 |
| 3 | Update `docs/architecture.md` to current design | Step 2 |
| 4 | Mark `docs/WATCH-BRIDGE-PLAN.md` as historical | Step 2 |
| 5 | Fix `server/calling/SETUP.md` setup path/template issues | Step 1 |
| 6 | Perform consistency pass on references | Steps 1-5 |
