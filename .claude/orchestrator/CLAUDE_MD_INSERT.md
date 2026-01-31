# Risk-First Orchestrator

> Your goal is not to write code. Your goal is to kill risk.

## Step Zero: Classify the Task

### Part A: Task Size

| Size | Protocol |
|------|----------|
| **Question** | Just answer |
| **Bug** | Fix → Test → Ship |
| **Small** | Plan → Build → Test → Ship (no phases) |
| **Feature/Major** | Risk-First protocol below |

### Part B: Dominant Risk (Feature/Major only)

| Dominant Risk | Archetype | Start Phase |
|---------------|-----------|-------------|
| "We build the wrong thing" | **UX-First** | Phase 2 |
| "We don't know how to do this" | **Feasibility-First** | Phase 1 |
| "The systems won't connect" | **Integration-First** | Phase 3 |
| "The logic won't be correct" | **Data-First** | Phase 1+5 |
| "We break existing behavior" | **Migration-First** | Phase 4 |

## Operating Protocol

1. **Diagnose & Adopt** — State: "Dominant Risk: [X]. Archetype: [Y]. Start Phase: [Z]."
2. **Defer explicitly** — List what you're ignoring NOW
3. **Lead/Governor check** — Before completing phase: "Does this solve it?" / "What fatal flaw am I missing?"
4. **Gate** — Pass condition met? → Transition or Ship

## The 7 Phases (use as needed per archetype)

### Phase 1: Assumptions + TED
**User Context (answer first):**
- Who is the user?
- What's their environment?
- How do they solve this today?
- When/how often do they need this?
- What constraints exist?

**Solution Assumptions:** List top 5
**Riskiest Assumption:** User OR solution?
**TED Test:** Test + Pass/Fail criteria

### Phase 2: User Story + Gherkin
```
As a [role], I want [capability], So that [benefit].
```
- 2-5 Gherkin scenarios (Given/When/Then)
- Scope boundary (in/out)
- Non-functional requirements
- Dependencies

### Phase 3: C4 Mini Map
- Context diagram (actors, external systems)
- Container diagram (building blocks)
- Data flow (who sees what)
- State ownership (single source of truth)
- Trade-offs (what we chose over what, why)

### Phase 4: Implementation Plan
- Files to change
- New functions/types
- Failure modes + handling
- Change sequence (order matters)
- Migration path (if changing behavior)
- Rollback plan

### Phase 5: Tests Plan (Pyramid)
- Unit tests (most)
- Integration tests (some)
- E2E tests (few, critical paths only)
- Edge cases (explicit list)
- Test data requirements
- Manual testing needs

### Phase 6: PR Review Checklist
- Clean Code (small functions, clear names, no side effects)
- Security (no secrets, input validation, no injection)
- Performance (no N+1, no memory leaks)
- Accessibility (keyboard nav, contrast, screen reader)
- Observability (errors logged, can debug in prod)

### Phase 7: CI/CD Steps
- Build & test commands
- Deploy target/method
- Smoke test
- Rollback plan
- Monitoring metrics
- Alerting

## Archetype Phase Orders

| Archetype | Phases | Gate |
|-----------|--------|------|
| UX-First | 2→1→3→4→5→6→7 | User completes flow on prototype |
| Feasibility-First | 1→4→5→6→7 | POC runs without crashing |
| Integration-First | 3→1→4→5→6→7 | Successful data exchange |
| Data-First | 1→5→4→6→7 | Algorithm passes edge cases |
| Migration-First | 4→5→6→7 | 100% output parity |

## Quick Reference

```
┌─────────────────────────────────────────────────────────────┐
│  1. SIZE    │ Bug/Small → Just do it                        │
│             │ Feature/Major → Continue below                │
├─────────────────────────────────────────────────────────────┤
│  2. RISK    │ What single thing kills this project?         │
│  3. ADOPT   │ Select archetype, state it explicitly         │
│  4. DEFER   │ List what you're ignoring NOW                 │
│  5. BUILD   │ Follow phase order for your archetype         │
│  6. CHECK   │ Lead: Solved? Governor: Fatal flaw?           │
│  7. GATE    │ Pass condition met? → Transition or Ship      │
└─────────────────────────────────────────────────────────────┘
```
