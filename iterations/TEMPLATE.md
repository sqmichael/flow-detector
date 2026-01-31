# Iteration: [Title]

> Started: [Date]
> Status: [IN_PROGRESS | PAUSED | COMPLETE]
> Branch: [branch-name]

---

## Phase 1: Assumptions + TED Test Plan

**Status:** [ ] Not Started / [x] Complete

### Assumptions (Top 5)

1. [ ] [Assumption 1]
2. [ ] [Assumption 2]
3. [ ] [Assumption 3]
4. [ ] [Assumption 4]
5. [ ] [Assumption 5]

### Riskiest Assumption

> [Which assumption could kill this entire effort if wrong?]

### TED Test

| Element | Description |
|---------|-------------|
| **Test** | [One small test you can run fast] |
| **Pass** | [What result means "go"] |
| **Fail** | [What result means "stop"] |

### TED Result

- [ ] PASS — Proceed to Phase 2
- [ ] FAIL — Stop and reconsider

---

## Phase 2: User Story + Gherkin

**Status:** [ ] Not Started / [x] Complete

### User Story

```
As a [role],
I want [capability],
So that [benefit].
```

### Acceptance Criteria

#### Scenario 1: [Happy path name]

```gherkin
Given [context]
When [action]
Then [outcome]
```

#### Scenario 2: [Edge case name]

```gherkin
Given [context]
When [action]
Then [outcome]
```

#### Scenario 3: [Error case name]

```gherkin
Given [context]
When [action]
Then [outcome]
```

### UX Agent Review

- [ ] B1 Noise: No notifications during flow
- [ ] B2 Authority: Doesn't tell user what they're feeling
- [ ] B3 Dependency: No streaks/gamification
- [ ] Simplest version of the feature

---

## Phase 3: C4 Mini Map

**Status:** [ ] Not Started / [x] Complete

### Context Diagram

```
[User] → [System Name] → [External System]
              ↓
        [Other External]
```

**Actors:**
- [Actor 1]: [Description]

**External Systems:**
- [System 1]: [What it provides]

### Container Diagram

```
┌─────────────────────────────────────────┐
│              [System Name]              │
├─────────────────────────────────────────┤
│  ┌──────────┐    ┌──────────┐          │
│  │Container1│ → │Container2│          │
│  └──────────┘    └──────────┘          │
│        ↓                                │
│  ┌──────────┐                          │
│  │Container3│                          │
│  └──────────┘                          │
└─────────────────────────────────────────┘
```

**Containers:**
- [Container 1]: [Technology, responsibility]
- [Container 2]: [Technology, responsibility]

### Key Decisions

| Decision | Rationale |
|----------|-----------|
| [Decision 1] | [Why] |
| [Decision 2] | [Why] |

---

## Phase 4: Implementation Plan

**Status:** [ ] Not Started / [x] Complete

### Files to Change

| File | Changes |
|------|---------|
| `path/to/file.ts` | [What changes] |
| `path/to/file.ts` | [What changes] |

### New Functions/Types

```typescript
// [filename.ts]
functionName(params): ReturnType  // [Purpose]
TypeName                          // [Purpose]
```

### Failure Modes

| What Could Go Wrong | How to Handle |
|--------------------|---------------|
| [Failure 1] | [Recovery strategy] |
| [Failure 2] | [Recovery strategy] |

### Dependencies

| Dependency | Why Needed |
|------------|------------|
| [Package/System] | [Rationale] |

### Building Agent Review

- [ ] Types are complete (no `any`)
- [ ] Resources cleaned up in hooks
- [ ] Errors handled gracefully
- [ ] No hardcoded secrets

---

## Phase 5: Tests Plan (Pyramid)

**Status:** [ ] Not Started / [x] Complete

### Unit Tests (Most)

- [ ] `test_[function]_[behavior]` — [What it verifies]
- [ ] `test_[function]_[edge_case]` — [What it verifies]
- [ ] `test_[function]_[error_case]` — [What it verifies]

### Integration Tests (Some)

- [ ] `test_[module]_integrates_with_[other]` — [What it verifies]

### E2E Tests (Few, critical paths only)

- [ ] `test_[critical_flow]` — [What it verifies] *(only if needed)*

### Test Strategy

> [Brief note: mocking approach, fixtures, test data strategy]

---

## Phase 6: PR Review Checklist

**Status:** [ ] Not Started / [x] Complete

### Clean Code

- [ ] Functions are small and single-responsibility
- [ ] Names are clear and intention-revealing
- [ ] No hidden side effects
- [ ] No magic numbers (constants used)
- [ ] Error messages are actionable
- [ ] Logs have `[ModuleName]` prefix

### SOLID (where relevant)

- [ ] Single Responsibility maintained
- [ ] No premature abstractions

### Security

- [ ] No hardcoded secrets/tokens/keys
- [ ] Input validated at boundaries
- [ ] No injection risks (command/SQL/XSS)

### UX Verification

- [ ] B1: No noise during flow
- [ ] B2: No authority ("you seem...")
- [ ] B3: No dependency creation
- [ ] B4: No silent data persistence
- [ ] B5: No dead air > 2s
- [ ] B6: No over-engineering

---

## Phase 7: CI/CD Steps

**Status:** [ ] Not Started / [x] Complete

### Build & Test Commands

```bash
npm run lint          # Linting
npm run build         # TypeScript compilation
npm test              # Unit + integration tests
```

### Deploy

| Step | Command/Action |
|------|---------------|
| Target | [Where] |
| Method | [How] |

### Smoke Test

> [Quick verification after deploy]

### Rollback Plan

> [How to revert if something breaks]

### Blue-Green (if applicable)

- [ ] N/A — Not needed for this change
- [ ] Required — [Reason: downtime costly / instant rollback needed]

---

## Iteration Complete

### Summary

> [One sentence: what was shipped]

### Artifacts

- [ ] Code committed
- [ ] Tests passing
- [ ] PR created
- [ ] UX Agent approved
- [ ] Building Agent approved

### Next Iteration

> [What's the next bet?]

---

## Notes / Blockers

> [Any issues encountered, decisions made, or context for future reference]
