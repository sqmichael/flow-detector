# Phase 2: User Story + Gherkin

> Define the behavior contract before writing code.

## Your Task

Write one user story with 2-5 acceptance criteria in Gherkin format. This becomes the source of truth for what "done" means.

## Output Format

Write to `iterations/current.md` under Phase 2:

```markdown
## User Story
As a [role],
I want [capability],
So that [benefit].

## Acceptance Criteria

### Scenario 1: [Happy path]
Given [context]
When [action]
Then [outcome]

### Scenario 2: [Edge case]
Given [context]
When [action]
Then [outcome]

### Scenario 3: [Error case]
Given [context]
When [action]
Then [outcome]

## Scope Boundary

**In scope:**
- [What we ARE building]

**Out of scope (explicit):**
- [What we are NOT building]
- [What we are deferring]

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Performance | [e.g., < 200ms response] |
| Accessibility | [e.g., WCAG 2.1 AA] |
| Browser/Device | [e.g., Chrome, Safari, mobile] |
| Offline | [e.g., must work offline] |

(Leave blank if not applicable)

## Dependencies

- [ ] [Dependency 1]: [Status — ready / blocked / unknown]
- [ ] [Dependency 2]: [Status]
```

## Rules

- One story per iteration (no scope creep)
- 2-5 scenarios maximum
- Gherkin is the contract — code must satisfy these scenarios
- Focus on behavior, not implementation
- **Explicitly state what's OUT of scope** — prevents creep

## UX Review Required

Before proceeding, verify against UX_PRINCIPLES.md:
- [ ] B1: No noise during flow
- [ ] B2: Doesn't tell user what they're feeling
- [ ] B3: No dependency creation (streaks, gamification)
- [ ] Simplest version of the feature

## Done When

- [ ] User story written (As a / I want / So that)
- [ ] 2-5 Gherkin scenarios defined
- [ ] Scope boundary defined (in/out)
- [ ] Non-functional requirements noted (if any)
- [ ] Dependencies identified
- [ ] UX review passed

## Next Phase

→ Phase 3 (C4 Mini Map) if architectural
→ Phase 4 (Implementation Plan) if scope is clear
