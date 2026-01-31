# Phase 3: C4 Mini Map

> Just enough architecture to build. No more.

## Your Task

Create a minimal architecture diagram at two levels: Context and Container. Text-based is fine.

## Output Format

Write to `iterations/current.md` under Phase 3:

```markdown
## Context Diagram
[Who/what interacts with the system?]

```
[User] → [System] → [External Service]
```

**Actors:** [List with brief descriptions]
**External Systems:** [List with what they provide]

## Container Diagram
[What are the main technical building blocks?]

```
┌─────────────────────────────────┐
│           [System]              │
├─────────────────────────────────┤
│  [Container 1] → [Container 2]  │
│        ↓                        │
│  [Container 3]                  │
└─────────────────────────────────┘
```

**Containers:**
- [Container 1]: [Technology, responsibility]
- [Container 2]: [Technology, responsibility]

## Key Decisions
| Decision | Rationale |
|----------|-----------|
| [What] | [Why] |
```

## Rules

- Two levels only: Context and Container
- No detailed component diagrams (that's over-engineering)
- Text diagrams are fine — no art needed
- Skip DDD unless domain complexity is the main problem

## When to Skip This Phase

Skip if:
- Single file/module change
- Clear scope from user story
- No new architectural boundaries

## Done When

- [ ] Context diagram shows actors and external systems
- [ ] Container diagram shows main building blocks
- [ ] Key architectural decisions documented with rationale

## Next Phase

→ Phase 4 (Implementation Plan)
