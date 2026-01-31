# Phase 6: PR Review Checklist

> Pre-flight check before creating the PR.

## Your Task

Verify the implementation against Clean Code, SOLID (where relevant), Security, and UX principles.

## Output Format

Write to `iterations/current.md` under Phase 6:

```markdown
## Clean Code
- [ ] Functions are small and single-responsibility
- [ ] Names are clear and intention-revealing
- [ ] No hidden side effects
- [ ] No magic numbers (constants used)
- [ ] Error messages are actionable
- [ ] Logs have `[ModuleName]` prefix

## SOLID (where relevant)
- [ ] Single Responsibility: Each module does one thing
- [ ] No premature abstractions

## Security
- [ ] No hardcoded secrets/tokens/keys
- [ ] Input validated at system boundaries
- [ ] No injection risks (command/SQL/XSS)

## UX (from UX_PRINCIPLES.md)
- [ ] B1: No noise during flow (notifications, dashboards)
- [ ] B2: No authority ("you seem stressed")
- [ ] B3: No dependency creation (streaks, gamification)
- [ ] B4: No silent emotional data persistence
- [ ] B5: No dead air > 2s without social cue
- [ ] B6: No over-engineering
```

## Blocking Issues (must fix)

From AGENTS.md — block the PR if any of these:
- Missing types or use of `any`
- React hooks that don't clean up resources
- Errors thrown instead of handled gracefully
- Hardcoded secrets, tokens, credentials
- Cross-component or cross-sensor interference
- Unsafe side effects during render

## Suggestions (fix if easy)

- Logs without `[ModuleName]` prefix
- Magic numbers instead of named constants
- Repeated logic that should be a helper
- Weak error messages

## Done When

- [ ] All Clean Code checks pass
- [ ] SOLID checks pass (where applied)
- [ ] Security checks pass
- [ ] UX checks pass
- [ ] No blocking issues remain

## Next Phase

→ Phase 7 (CI/CD Steps)
