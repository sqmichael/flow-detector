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

## Gradual Rollout (if applicable)
| Stage | Audience | Duration | Success Criteria |
|-------|----------|----------|------------------|
| Canary | 1% of users | 1 hour | No errors |
| Ramp | 10% → 50% | 1 day | Metrics stable |
| Full | 100% | — | — |

- [ ] N/A — Ship to everyone immediately
- [ ] Required — [Reason for gradual rollout]

## Monitoring
| Metric | Expected | Alert Threshold |
|--------|----------|-----------------|
| Error rate | < 0.1% | > 1% |
| Latency p95 | < 200ms | > 500ms |
| [Custom metric] | [Expected] | [Threshold] |

## Alerting
| Condition | Action | Who |
|-----------|--------|-----|
| Error spike | Page on-call | [Team/Person] |
| Latency spike | Slack alert | [Channel] |
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
- [ ] Gradual rollout decision made
- [ ] Monitoring metrics defined
- [ ] Alerting configured

## Iteration Complete

After Phase 7:
1. Commit all changes
2. Push to branch
3. Create PR
4. Request review (Building Agent + UX Agent)

Update `iterations/current.md` status to COMPLETE.
