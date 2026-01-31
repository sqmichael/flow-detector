# Phase 1: Assumptions + TED Test Plan

> Kill uncertainty before writing code.

## Your Task

Identify what must be true for this change to matter. Find the riskiest assumption and design a fast test for it.

## Output Format

Write to `iterations/current.md` under Phase 1:

```markdown
## Assumptions (Top 5)
1. [Assumption that must be true]
2. [Assumption that must be true]
3. [Assumption that must be true]
4. [Assumption that must be true]
5. [Assumption that must be true]

## Riskiest Assumption
[Which one could kill this entire effort if wrong?]

## TED Test
- **Test:** [One small test you can run fast]
- **Pass criteria:** [What result means "go"]
- **Fail criteria:** [What result means "stop"]

## TED Result
- [ ] PASS — Proceed to Phase 2
- [ ] FAIL — Stop and reconsider
```

## Why This Matters

Most work fails because you build on a wrong assumption. You then fix the wrong thing. You add more code. You get slower. This phase breaks that cycle.

## Done When

- [ ] 5 assumptions listed
- [ ] Riskiest assumption identified
- [ ] TED test defined with clear pass/fail
- [ ] TED test executed
- [ ] Result recorded (PASS or FAIL)

## Next Phase

If PASS → Phase 2 (User Story + Gherkin)
If FAIL → Stop. Reassess the approach.
