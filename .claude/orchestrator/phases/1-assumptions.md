# Phase 1: Assumptions + TED Test Plan

> Kill uncertainty before writing code.

## Your Task

1. Understand the user context first
2. Then list solution assumptions
3. Find the riskiest assumption (could be user OR solution)
4. Design a fast test for it

## Output Format

Write to `iterations/current.md` under Phase 1:

```markdown
## User Context (answer first)

| Question | Answer |
|----------|--------|
| Who is the user? | [Role, technical level, decision-making power] |
| What's their environment? | [Physical context, devices, social setting] |
| How do they solve this today? | [Current workflow, tools, workarounds] |
| When/how often do they need this? | [Frequency, urgency, interruptibility] |
| What constraints exist? | [Time, attention, budget, policies, accessibility] |

## Solution Assumptions (answer second)

1. [Assumption about your approach]
2. [Assumption about your approach]
3. [Assumption about your approach]
4. [Assumption about your approach]
5. [Assumption about your approach]

## Riskiest Assumption

[Which one — user context OR solution — could kill this if wrong?]

## TED Test

- **Test:** [One small test you can run fast]
- **Pass criteria:** [What result means "go"]
- **Fail criteria:** [What result means "stop"]

## TED Result

- [ ] PASS — Proceed to Phase 2
- [ ] FAIL — Stop and reconsider
```

## Why This Matters

Most work fails because you build on a wrong assumption. The most dangerous assumptions are often about the **user**, not the solution. You assume you know who they are, where they are, how they work. Then you build something that doesn't fit their reality.

This phase forces you to answer user context questions first, before you can even list solution assumptions.

## Done When

- [ ] User context questions answered
- [ ] 5 solution assumptions listed
- [ ] Riskiest assumption identified (user OR solution)
- [ ] TED test defined with clear pass/fail
- [ ] TED test executed
- [ ] Result recorded (PASS or FAIL)

## Next Phase

If PASS → Phase 2 (User Story + Gherkin)
If FAIL → Stop. Reassess the approach.
