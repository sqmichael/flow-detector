# Code Orchestration Framework

> One iteration. One question. One proof. Ship it.

## Philosophy

Not every task needs the full framework. The orchestrator's **first job** is to classify the task and pick the relevant subset.

---

## Step Zero: Classify the Task

Before doing anything, ask: **What type of task is this?**

| Task Type | Description | Phases Needed |
|-----------|-------------|---------------|
| **Question** | User wants information, not code | None — just answer |
| **Bug fix** | Something is broken | 4 → 5 → 6 → 7 (light) |
| **Small change** | < 50 lines, single file/module | 4 → 5 → 6 → 7 |
| **Refactor** | Restructure without behavior change | 4 → 5 → 6 → 7 |
| **New feature** | New capability, clear scope | 2 → 4 → 5 → 6 → 7 |
| **Major feature** | Multi-component, architectural | 1 → 2 → 3 → 4 → 5 → 6 → 7 |
| **Risky change** | Uncertain assumptions | 1 → then reassess |

### Decision Shortcuts

- **"Fix the bug in X"** → Skip to Phase 4 (Implementation Plan)
- **"Add a button that does Y"** → Start at Phase 2 (User Story, light)
- **"Refactor X to use Y pattern"** → Skip to Phase 4
- **"Build a new system for Z"** → Full loop, start at Phase 1
- **"I'm not sure if X will work"** → Phase 1 only (Assumptions + TED)

---

## The Full Loop (When Needed)

For major features, the full loop produces **7 artifacts** in sequence:

| Phase | Artifact | Purpose | Reviewer |
|-------|----------|---------|----------|
| 1 | Assumptions + TED | Kill uncertainty first | Self |
| 2 | User Story + Gherkin | Contract for behavior | UX Agent |
| 3 | C4 Mini Map | Just enough architecture | Self |
| 4 | Implementation Plan | Files, functions, failure modes | Building Agent |
| 5 | Tests Plan | Pyramid: unit > integration > E2E | Building Agent |
| 6 | PR Review Checklist | Clean Code + SOLID checks | Both Agents |
| 7 | CI/CD Steps | Build, test, deploy, rollback | Self |

---

## Light Versions (For Smaller Tasks)

Not every phase needs to be a formal document. Here's what "light" looks like:

### Bug Fix Flow (15 min)
```
1. Understand: What's broken? Reproduce it.
2. Plan: Which file, which function, what's the fix?
3. Fix: Make the change
4. Test: Verify fix, check for regressions
5. Ship: Commit, push, PR
```

### Small Feature Flow (30 min - 1 hr)
```
1. Story (one sentence): "User can X so that Y"
2. Plan: Files to touch, new functions needed
3. Build: Write code, TDD if core logic
4. Test: Unit tests for new behavior
5. Check: Quick PR checklist scan
6. Ship: Commit, push, PR
```

### Refactor Flow (30 min)
```
1. Plan: What changes, what stays the same
2. Test: Ensure existing tests pass (or add them first)
3. Refactor: Make the structural change
4. Verify: All tests still pass
5. Ship: Commit, push, PR
```

The formal 7-phase template is for **major features** where you need the rigor.

---

## Phase Details (Full Loop)

### Phase 1: Assumptions + TED Test Plan

**Goal:** Identify what must be true for this change to matter.

**Output:**
```markdown
## Assumptions (Top 5)
1. [Assumption]
2. [Assumption]
3. [Assumption]
4. [Assumption]
5. [Assumption]

## Riskiest Assumption
[Which one could kill this entire effort if wrong?]

## TED Test
- **Test:** [One small test you can run fast]
- **Pass criteria:** [What result means "go"]
- **Fail criteria:** [What result means "stop"]
```

**Why this matters:** Most work fails because you build on a wrong assumption. You then fix the wrong thing. You then add more code. You get slower.

---

### Phase 2: User Story + Gherkin

**Goal:** Define the behavior contract.

**Output:**
```markdown
## User Story
As a [role],
I want [capability],
So that [benefit].

## Acceptance Criteria (Gherkin)

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
```

**Rules:**
- One story per iteration
- 2-5 scenarios maximum
- Gherkin is the source of truth
- UX Agent reviews for noise/authority/dependency violations

---

### Phase 3: C4 Mini Map

**Goal:** Just enough architecture to build.

**Output:**
```markdown
## Context Diagram
[Who uses the system? What external systems does it touch?]

## Container Diagram
[What are the main technical building blocks?]

## Key Decisions
- [Decision 1]: [Rationale]
- [Decision 2]: [Rationale]
```

**Rules:**
- Two levels only: Context and Container
- No detailed component diagrams (over-engineering)
- Text-based diagrams are fine (no art needed)
- Use DDD only if domain complexity dominates

---

### Phase 4: Implementation Plan

**Goal:** Map the code changes before writing them.

**Output:**
```markdown
## Files to Change
- `path/to/file.ts` — [What changes]
- `path/to/file.ts` — [What changes]

## New Functions/Types
- `functionName(params): ReturnType` — [Purpose]
- `TypeName` — [Purpose]

## Failure Modes
- [What could go wrong] → [How to handle]
- [What could go wrong] → [How to handle]

## Dependencies
- [External dependency] — [Why needed]
```

**Rules:**
- Building Agent reviews for type safety, cleanup, error handling
- No speculative features
- No over-abstraction

---

### Phase 5: Tests Plan (Pyramid)

**Goal:** Decide what to test at each level.

**Output:**
```markdown
## Unit Tests (Most)
- [ ] `test_function_does_x` — [What it verifies]
- [ ] `test_function_handles_edge_case` — [What it verifies]

## Integration Tests (Some)
- [ ] `test_module_integrates_with_other` — [What it verifies]

## E2E Tests (Few, only critical paths)
- [ ] `test_critical_user_flow` — [What it verifies] (if needed)

## Test Strategy
[Brief note on approach: mocking strategy, fixtures, etc.]
```

**Rules:**
- Mostly unit tests
- Integration tests for module boundaries
- E2E only for: checkout, login, billing, permissions
- If you add E2E for every feature, tests will rot

---

### Phase 6: PR Review Checklist

**Goal:** Pre-flight check before creating PR.

**Output:**
```markdown
## Clean Code Checks
- [ ] Functions are small and single-responsibility
- [ ] Names are clear and intention-revealing
- [ ] No hidden side effects
- [ ] No magic numbers (use constants)
- [ ] Error messages are actionable

## SOLID Checks (apply where relevant)
- [ ] Single Responsibility: Each module does one thing
- [ ] Open/Closed: Can extend without modifying (if needed)
- [ ] Dependency Inversion: Depends on abstractions (if complex)

## Security Checks
- [ ] No hardcoded secrets
- [ ] Input validation at boundaries
- [ ] No command/SQL/XSS injection risks

## UX Checks (from UX_PRINCIPLES.md)
- [ ] B1: No noise during flow
- [ ] B2: No telling user what they're feeling
- [ ] B3: No dependency creation
- [ ] B4: No silent emotional data persistence
- [ ] B5: No dead air without social cues
- [ ] B6: No over-engineering
```

---

### Phase 7: CI/CD Steps

**Goal:** Define how to ship safely.

**Output:**
```markdown
## Build & Test
- `npm run lint` — Linting
- `npm run build` — TypeScript compilation
- `npm test` — Unit + integration tests

## Deploy
- [Deployment target]
- [Deployment method]

## Smoke Test
- [Quick verification after deploy]

## Rollback Plan
- [How to revert if something breaks]

## Blue-Green (if applicable)
- [Only if downtime is costly or rollback must be instant]
```

---

## Decision Tree: When to Use Each Method

### Always Relevant (every iteration)
- Assumption Mapping
- TED test
- User Story + Gherkin
- C4 (Context + Container)
- TDD (selective, for core logic)
- Clean Code
- Testing Pyramid
- CI/CD

### Sometimes Relevant (add when needed)
- BDD (as team ritual)
- SOLID (when code tangles)
- E2E tests (critical paths only)
- Blue-Green (high availability)

### Usually Not Relevant (skip unless explicitly needed)
- Lean Startup (product level, not PR level)
- Atomic Design (only for UI component libraries)
- Design Systems (only for multi-screen consistency)
- DDD (only if domain complexity dominates)
- GitOps (only if infra maturity demands it)

---

## Orchestrator Workflow

### At Session Start
1. Check if `iterations/current.md` exists
2. If yes, identify current phase (look for `[ ]` vs `[x]`)
3. Resume from current phase
4. If no, start new iteration with Phase 1

### During Session
1. Complete current phase fully
2. Mark phase complete with `[x]`
3. Move to next phase
4. Do not skip phases

### At Session End
1. All phases must be complete OR explicitly marked as "PAUSED"
2. If complete: commit, push, create PR
3. If paused: document what's blocking in current.md

### Validation (Stop Hook)
- Check all 7 phases have artifacts
- TypeScript compiles
- Tests pass
- No uncommitted changes
- PR exists (or explicit pause)

---

## Integration with Existing Agents

| Agent | Reviews Phases | Focus |
|-------|---------------|-------|
| Building Agent | 4, 5, 6 | Types, tests, architecture |
| UX Agent | 2, 3, 6 | Noise, authority, dependency, simplicity |
| Self (Orchestrator) | 1, 3, 7 | Assumptions, architecture, shipping |

---

## Anti-Patterns

### Do Not
- Skip Phase 1 because "the requirement is clear"
- Write code before Phase 4 is complete
- Add E2E tests for every feature
- Create abstractions "just in case"
- Build for hypothetical requirements
- Skip tests because "it's simple"

### Do
- Kill the riskiest assumption first
- Write Gherkin before code
- Keep architecture minimal
- Test at the right level
- Ship small, ship often

---

## Quick Reference Card

```
┌─────────────────────────────────────────────────────────────┐
│                    ONE ITERATION LOOP                        │
├─────────────────────────────────────────────────────────────┤
│  1. FRAME    │ Assumptions + TED test plan                  │
│  2. DEFINE   │ User Story + Gherkin (2-5 scenarios)         │
│  3. SKETCH   │ C4 Context + Container (text only)           │
│  4. PLAN     │ Files, functions, failure modes              │
│  5. TEST     │ Pyramid: unit > integration > E2E            │
│  6. CHECK    │ Clean Code + SOLID + Security + UX           │
│  7. SHIP     │ CI/CD steps + rollback plan                  │
├─────────────────────────────────────────────────────────────┤
│  START WITH WHY  →  END WITH PROOF  →  SHIP IT              │
└─────────────────────────────────────────────────────────────┘
```

---

## Remember

> "You can fit them into one Claude Code loop. You must pick. If you try to 'do everything,' you will ship nothing."

One iteration answers one question. Then changes code. Then proves it works. Then ships it.
