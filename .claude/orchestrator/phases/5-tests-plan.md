# Phase 5: Tests Plan (Pyramid)

> Decide what to test at each level before writing tests.

## Your Task

Plan tests following the Testing Pyramid: mostly unit, some integration, few E2E.

## Output Format

Write to `iterations/current.md` under Phase 5:

```markdown
## Unit Tests (Most)
- [ ] `test_[function]_[expected_behavior]` — [What it verifies]
- [ ] `test_[function]_[edge_case]` — [What it verifies]
- [ ] `test_[function]_[error_case]` — [What it verifies]

## Integration Tests (Some)
- [ ] `test_[module]_integrates_with_[other]` — [What it verifies]

## E2E Tests (Few — critical paths only)
- [ ] `test_[critical_user_flow]` — [What it verifies]

## Test Strategy
[Brief note: mocking approach, fixtures, test data]
```

## The Testing Pyramid

```
        /\
       /E2E\        ← Few (critical paths: login, checkout, billing)
      /------\
     /Integr- \     ← Some (module boundaries)
    /  ation   \
   /------------\
  /    Unit      \  ← Most (functions, logic, edge cases)
 /________________\
```

## Rules

- **Unit tests**: Fast, isolated, test one thing
- **Integration tests**: Module boundaries, real dependencies
- **E2E tests**: Only for critical user flows

If you add E2E for every feature, tests will rot. You'll stop trusting them. Then you'll stop shipping.

## When to Skip E2E

Skip E2E if:
- Not a critical user flow (login, checkout, billing, permissions)
- Unit + integration coverage is sufficient
- Feature is internal/admin-only

## Done When

- [ ] Unit tests planned for core logic
- [ ] Integration tests planned for module boundaries
- [ ] E2E tests planned only if critical path
- [ ] Test strategy documented

## Next Phase

→ Phase 6 (PR Review Checklist)
