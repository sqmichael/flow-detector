# Code Orchestration Framework

> One iteration. One question. One proof. Ship it.

## Step Zero: Classify the Task

Before doing anything, ask: **What type of task is this?**

| Task Type | Description | Phases |
|-----------|-------------|--------|
| **Question** | User wants information | None — just answer |
| **Bug fix** | Something is broken | 4 → 5 → 6 → 7 (light) |
| **Small change** | < 50 lines, single module | 4 → 5 → 6 → 7 |
| **Refactor** | Restructure, same behavior | 4 → 5 → 6 → 7 |
| **New feature** | New capability, clear scope | 2 → 4 → 5 → 6 → 7 |
| **Major feature** | Multi-component, architectural | 1 → 2 → 3 → 4 → 5 → 6 → 7 |
| **Risky change** | Uncertain assumptions | 1 → then reassess |

### Decision Shortcuts

- **"Fix the bug in X"** → Phase 4
- **"Add a button that does Y"** → Phase 2
- **"Refactor X to use Y pattern"** → Phase 4
- **"Build a new system for Z"** → Phase 1
- **"I'm not sure if X will work"** → Phase 1 only

---

## The 7 Phases

| # | Phase | Prompt File | Reviewer |
|---|-------|-------------|----------|
| 1 | Assumptions + TED | `phases/1-assumptions.md` | Self |
| 2 | User Story + Gherkin | `phases/2-user-story.md` | UX Agent |
| 3 | C4 Mini Map | `phases/3-c4-map.md` | Self |
| 4 | Implementation Plan | `phases/4-implementation.md` | Building Agent |
| 5 | Tests Plan | `phases/5-tests-plan.md` | Building Agent |
| 6 | PR Review Checklist | `phases/6-pr-checklist.md` | Both |
| 7 | CI/CD Steps | `phases/7-cicd-steps.md` | Self |

Read the phase file. Write output to `iterations/current.md`.

---

## Light Flows (No formal phases)

### Bug Fix
```
1. Understand → 2. Plan → 3. Fix → 4. Test → 5. Ship
```

### Small Feature
```
1. Story (one sentence) → 2. Plan → 3. Build → 4. Test → 5. Ship
```

### Refactor
```
1. Plan → 2. Test first → 3. Refactor → 4. Verify → 5. Ship
```

---

## State Tracking

Current iteration state: `state.json`

```json
{
  "iteration": "feature-name",
  "taskType": "feature",
  "currentPhase": "2-user-story.md",
  "phasesRequired": ["2", "4", "5", "6", "7"],
  "phasesCompleted": ["2"],
  "startedAt": "2025-01-31T10:00:00Z",
  "updatedAt": "2025-01-31T10:30:00Z"
}
```

Update `currentPhase` as you progress. Mark phases in `phasesCompleted`.

---

## Key Principle

> "If you try to 'do everything,' you will ship nothing."

Pick the right level of rigor for the task. Most tasks don't need all 7 phases.
