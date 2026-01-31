# Phase 4: Implementation Plan

> Map the code changes before writing them.

## Your Task

Identify exactly which files change, what new functions/types are needed, and what could go wrong.

## Output Format

Write to `iterations/current.md` under Phase 4:

```markdown
## Files to Change
| File | Changes |
|------|---------|
| `path/to/file.ts` | [What changes] |
| `path/to/file.ts` | [What changes] |

## New Functions/Types
| Name | Signature | Purpose |
|------|-----------|---------|
| `functionName` | `(params): ReturnType` | [What it does] |
| `TypeName` | `type/interface` | [What it represents] |

## Failure Modes
| What Could Go Wrong | How to Handle |
|--------------------|---------------|
| [Failure scenario] | [Recovery strategy] |
| [Failure scenario] | [Recovery strategy] |

## Dependencies
| Dependency | Why Needed |
|------------|------------|
| [Package/System] | [Rationale] |

## Change Sequence
[Order matters. What depends on what?]

| Step | Change | Depends On |
|------|--------|------------|
| 1 | [First change] | — |
| 2 | [Second change] | Step 1 |
| 3 | [Third change] | Step 1, 2 |

## Migration Path (if changing existing behavior)

| Current State | Target State | Migration Strategy |
|---------------|--------------|-------------------|
| [How it works now] | [How it will work] | [How users/data transition] |

**Breaking changes:** [Yes/No — if yes, explain impact]

## Rollback Plan

| Change | Rollback Method | Risk Level |
|--------|-----------------|------------|
| [Change 1] | [How to revert] | [Low/Med/High] |

**Can each change be independently reverted?** [Yes/No]
```

## Building Agent Review

Before proceeding, verify:
- [ ] Types are complete (no `any`)
- [ ] Resources will be cleaned up (subscriptions, timers, listeners)
- [ ] Errors handled gracefully with user-safe recovery
- [ ] No hardcoded secrets/tokens/keys
- [ ] No cross-component interference

## Rules

- No speculative features — only what the user story requires
- No premature abstractions — three similar lines > unnecessary helper
- No backwards-compatibility hacks for unused code

## Done When

- [ ] All files to change identified
- [ ] New functions/types specified
- [ ] Failure modes documented with handling strategy
- [ ] Change sequence defined (order of operations)
- [ ] Migration path documented (if changing behavior)
- [ ] Rollback plan exists for each change
- [ ] Building agent review passed

## Next Phase

→ Phase 5 (Tests Plan)
