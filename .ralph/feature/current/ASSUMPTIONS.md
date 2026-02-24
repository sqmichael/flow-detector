# Assumptions

## User Context
| Question | Answer |
|----------|--------|
| Who is the user? | Solo operator exploring what assistant behavior is genuinely useful. |
| What's their environment? | Production relay + local/dev agent workflow with ntfy as primary interaction surface. |
| How do they solve this today? | Receive mixed notifications with uncertain timing quality. |
| How often do they need this? | Continuously during workdays. |
| What constraints exist? | Avoid broad assistant scope; prove one useful decision loop first. |

## Solution Assumptions
1. A minimal context contract can improve notification timing without adding broad AI behavior.
2. Useful first loop is binary: `send_now` vs `delay`.
3. Decision quality improves when context includes only timing-critical fields.
4. Every decision needs a persisted snapshot for later usefulness scoring.
5. If timing quality does not improve, the loop should be rolled back quickly.

## Riskiest Assumption
Assumption 1 is riskiest: context injection may add complexity without improving timing.

## Validation Test
- **Test:** Compare mistimed notification rate before/after loop.
- **Pass:** Mistimed rate decreases and user acknowledges better timing.
- **Fail:** No measurable improvement or increased noise.

## Result
- [ ] PASS — proceed
- [ ] FAIL — stop and reassess
- [ ] UNTESTABLE — document why, proceed with caution

## Unknowns Remaining
- Which context fields materially improve timing for this user.
- Whether `protect/reflect/reset` message set is sufficient for v1.

## Targeted Assumptions By Item

### Item 1-2: No-Calendar Safety + Policy Tightening
- Calendar data may be unavailable for long periods; timing behavior must remain safe without it.
- Missing calendar context should bias toward delay, not send.
- Unknown location should remain a delay signal until proven otherwise.

### Item 3: Feedback Capture
- User is willing to provide lightweight binary feedback (`good` / `bad`) occasionally.
- ntfy is the primary feedback surface; no dashboard dependency is required.
- Feedback can be optional (`null`) without breaking decision logging.

### Item 4: Scoring With Feedback
- User-rated timing quality is a better primary metric than policy-only proxy scoring.
- Rule-based mistimed scoring remains useful as a fallback/secondary metric.
- Small sample sizes will occur; summaries must tolerate sparse feedback.

### Item 5: Calendar Enrichment
- Calendar integration should improve timing confidence but never be required for runtime correctness.
- Stale/unavailable calendar data must be treated as unknown and handled safely.
