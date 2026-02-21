# Assumptions

## User Context
| Question | Answer |
|----------|--------|
| Who is the user? | Core maintainer/contributor working quickly across watch, server, and dashboard code. |
| What's their environment? | Local dev workflow in a mixed TypeScript + Kotlin repo with many historical docs. |
| How do they solve this today? | Open multiple markdown files and infer current state manually. |
| How often do they need this? | Every coding session and handoff. |
| What constraints exist? | Must preserve historical context while making current docs discoverable and accurate. |

## Solution Assumptions
1. A root `README.md` plus a docs index materially reduces onboarding and navigation friction.
2. Marking superseded docs explicitly prevents wrong implementation choices.
3. The highest value is aligning architecture/setup docs to the code that actually runs today.
4. Existing docs should be reorganized by status (current/active/historical), not deleted.
5. A lightweight consistency pass (paths/commands) is enough for this iteration.

## Riskiest Assumption
Assumption 1 is riskiest: if contributors still cannot quickly find the right doc, cleanup effort has low impact.

## Validation Test
- **Test:** Verify new docs provide direct entry points and that referenced key files/commands exist.
- **Pass:** New contributor can start from `README.md` and reach current architecture + setup docs without ambiguity.
- **Fail:** Entry docs still point to stale paths/flows or require deep manual discovery.

## Result
- [x] PASS — proceed
- [ ] FAIL — stop and reassess
- [ ] UNTESTABLE — document why, proceed with caution

## Unknowns Remaining
- Whether additional archived docs should be collapsed further after real contributor feedback.
- Whether call-service setup should be split into quickstart vs production guides.
