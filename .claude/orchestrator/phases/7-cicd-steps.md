# Phase 7: CI/CD Steps

> Define how to ship safely.

## Your Task

Document the build, test, deploy, and rollback steps for this change.

## Output Format

Write to `iterations/current.md` under Phase 7:

```markdown
## Build & Test
| Step | Command | Purpose |
|------|---------|---------|
| Lint | `npm run lint` | Code style |
| Build | `npm run build` | TypeScript compilation |
| Test | `npm test` | Unit + integration tests |

## Deploy
| Step | Action |
|------|--------|
| Target | [Where: staging/production] |
| Method | [How: manual/CI/GitOps] |
| Trigger | [When: merge to main / manual] |

## Smoke Test
[Quick verification after deploy — what to check manually]

## Rollback Plan
[How to revert if something breaks]

## Blue-Green (if applicable)
- [ ] N/A — Not needed for this change
- [ ] Required — [Reason]
```

## When Blue-Green is Needed

Use Blue-Green deployment when:
- Downtime is costly (production revenue impact)
- Rollback must be instant (< 1 minute)
- Database migrations are involved

Skip Blue-Green when:
- Internal tools
- Staging environments
- Low-traffic features

## Done When

- [ ] Build & test commands documented
- [ ] Deploy target and method specified
- [ ] Smoke test defined
- [ ] Rollback plan documented
- [ ] Blue-Green decision made

## Iteration Complete

After Phase 7:
1. Commit all changes
2. Push to branch
3. Create PR
4. Request review (Building Agent + UX Agent)

Update `iterations/current.md` status to COMPLETE.
