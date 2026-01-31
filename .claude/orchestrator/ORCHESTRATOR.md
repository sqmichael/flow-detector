# Risk-First Orchestrator

> Your goal is not to write code. Your goal is to kill risk.

## Step Zero: Classify the Task

### Part A: Task Size

| Size | Description | Protocol |
|------|-------------|----------|
| **Question** | User wants information | Just answer |
| **Bug** | Something is broken | Fix → Test → Ship |
| **Small** | < 50 lines, single module | Light flow (no phases) |
| **Feature** | New capability | Risk-First protocol |
| **Major** | Multi-component, architectural | Full Risk-First protocol |

**Gate:** Only apply full protocol to Feature/Major. For Bug/Small, just do the work.

---

### Part B: Dominant Risk (Feature/Major only)

Ask: **What single thing is most likely to kill this project?**

| Dominant Risk | Archetype | Lead Role | Governor Role |
|---------------|-----------|-----------|---------------|
| "We build the wrong thing" | **UX-First** | Product Designer | Senior Engineer |
| "We don't know how to do this" | **Feasibility-First** | R&D Engineer | QA / Security |
| "The systems won't connect" | **Integration-First** | Systems Architect | Domain Expert |
| "The logic won't be correct" | **Data-First** | Data Scientist | Product Manager |
| "We break existing behavior" | **Migration-First** | Maintainer | QA Lead |

---

## Archetype Details

### UX-First
- **Risk:** Desirability — will users want this?
- **Start Phase:** 2 (User Story)
- **Phase Order:** 2 → 1 → 3 → 4 → 5 → 6 → 7
- **Gate:** User can complete core flow on prototype
- **Defer:** Performance optimization, detailed architecture

### Feasibility-First
- **Risk:** Technical uncertainty — can we even do this?
- **Start Phase:** 1 (Assumptions + spike)
- **Phase Order:** 1 → 4 → 5 → 6 → 7 (skip 2, 3)
- **Gate:** Proof of concept runs without crashing
- **Defer:** Code quality, UI polish, error handling

### Integration-First
- **Risk:** Connectivity — will systems talk?
- **Start Phase:** 3 (C4 Map / Data Flow)
- **Phase Order:** 3 → 1 → 4 → 5 → 6 → 7 (skip 2)
- **Gate:** Successful data exchange between systems
- **Defer:** User stories (users are systems), UI

### Data-First
- **Risk:** Correctness — is the logic right?
- **Start Phase:** 1 + 5 (Assumptions + Tests together)
- **Phase Order:** 1 → 5 → 4 → 6 → 7 (skip 2, 3)
- **Gate:** Algorithm passes all edge cases
- **Defer:** User stories, architecture diagrams

### Migration-First
- **Risk:** Regression — will we break existing behavior?
- **Start Phase:** 4 (Implementation Plan with migration focus)
- **Phase Order:** 4 → 5 → 6 → 7 (skip 1, 2, 3)
- **Gate:** 100% output parity on sample data
- **Defer:** New features, UX improvements

---

## Operating Protocol

### 1. Diagnose & Adopt

State explicitly:
```
Dominant Risk: [What kills us if wrong]
Archetype: [Which strategy]
Start Phase: [Where to begin]
```

### 2. Lead/Governor Checkpoint

Before completing each phase, ask:

| Role | Question |
|------|----------|
| **Lead** | "Does this solve the problem?" |
| **Governor** | "What fatal flaw am I not seeing?" |

If Governor spots a fatal flaw → iterate before proceeding.

### 3. Explicit Deferral

List what you are ignoring NOW:
```
Deferring: [X, Y, Z] until [Gate] is passed.
```

This protects focus. You cannot accidentally scope-creep if you wrote down what you're ignoring.

### 4. Stop Rule & Transition

Each archetype has a **Gate** — a clear pass/fail condition.

When Gate is passed:
1. Summarize decisions made and constraints discovered
2. Ask: "Gate passed. Ready to switch to [next risk]?"

---

## The 7 Phases

| # | Phase | Prompt File | When Used |
|---|-------|-------------|-----------|
| 1 | Assumptions + TED | `phases/1-assumptions.md` | All except Migration |
| 2 | User Story + Gherkin | `phases/2-user-story.md` | UX-First |
| 3 | C4 Mini Map | `phases/3-c4-map.md` | UX-First, Integration-First |
| 4 | Implementation Plan | `phases/4-implementation.md` | All |
| 5 | Tests Plan | `phases/5-tests-plan.md` | All |
| 6 | PR Review Checklist | `phases/6-pr-checklist.md` | All |
| 7 | CI/CD Steps | `phases/7-cicd-steps.md` | All |

Read ONLY the phase file you need. Write output to `iterations/current.md`.

---

## Light Flows (Bug/Small)

### Bug Fix
```
Understand → Fix → Test → Ship
```

### Small Change
```
Plan (mental) → Build → Test → Ship
```

No phases needed. Just do the work.

---

## State Tracking

Current iteration state in `state.json`:

```json
{
  "iteration": "feature-name",
  "taskSize": "feature",
  "dominantRisk": "desirability",
  "archetype": "ux-first",
  "currentPhase": "2-user-story.md",
  "phasesRequired": ["2", "1", "3", "4", "5", "6", "7"],
  "phasesCompleted": [],
  "deferring": ["performance", "detailed-architecture"],
  "gate": "User completes core flow on prototype"
}
```

---

## Quick Reference

```
┌─────────────────────────────────────────────────────────────┐
│                     RISK-FIRST PROTOCOL                      │
├─────────────────────────────────────────────────────────────┤
│  1. SIZE    │ Bug/Small → Just do it                        │
│             │ Feature/Major → Continue below                │
├─────────────────────────────────────────────────────────────┤
│  2. RISK    │ What single thing kills this project?         │
├─────────────────────────────────────────────────────────────┤
│  3. ADOPT   │ Select archetype, state it explicitly         │
├─────────────────────────────────────────────────────────────┤
│  4. DEFER   │ List what you're ignoring NOW                 │
├─────────────────────────────────────────────────────────────┤
│  5. BUILD   │ Follow phase order for your archetype         │
├─────────────────────────────────────────────────────────────┤
│  6. CHECK   │ Lead: Solved? Governor: Fatal flaw?           │
├─────────────────────────────────────────────────────────────┤
│  7. GATE    │ Pass condition met? → Transition or Ship      │
└─────────────────────────────────────────────────────────────┘
```

---

## Remember

> "Your goal is not to write code. Your goal is to kill risk."

Identify the dominant risk. Adopt the right archetype. Defer everything else. Pass the gate. Ship.
