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
- [ ] Building agent review passed

## Next Phase

→ Phase 5 (Tests Plan)
