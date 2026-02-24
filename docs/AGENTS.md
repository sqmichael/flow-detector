# AGENTS.md

## Project

Flow Detector: multi-sensor flow state detection using TypeScript, React, Socket.io, and MediaPipe.

**Philosophy**: The system should be invisible when working. If the user notices it, something is wrong.

## Agents

This project uses two verification layers:

| Agent | Focus | Document |
|-------|-------|----------|
| **Building Agent** | Code quality, types, tests, architecture | This file (AGENTS.md) |
| **UX Agent** | User experience, noise, privacy, simplicity | UX_AGENT.md + UX_PRINCIPLES.md |

Both must pass before merge.

## Architecture

```
src/
├── hooks/       # React hooks only (one per file, use-*.ts)
├── lib/         # Pure logic, no React imports
└── components/  # UI components
```

- `types.ts` holds all types for its module
- `lib/` must not import from `hooks/`
- Socket.io for all real-time streams
- Each sensor works independently (eye, watch, neural)

## Review Guidelines

### Block

Block the PR if any of the following are present:

- Missing types or use of `any`
- React hooks that do not clean up resources such as subscriptions, timers, observers, or event listeners
- Errors are thrown instead of being handled gracefully with user-safe recovery or fallback behavior
- Hardcoded secrets, tokens, credentials, or private keys
- Cross-component or cross-sensor interference where one sensor breaks another
- Unsafe side effects during render or uncontrolled async behavior

Block means request changes. Do not approve.

### Suggest

Suggest a fix if any of the following are present:

- Logs do not include a `[ModuleName]` prefix
- Magic numbers are used instead of named constants
- Repeated logic that should be extracted into a shared helper
- Weak error messages that do not provide actionable context
- Missing cleanup guards in effects even if currently safe

Suggest means leave comments but do not block unless it violates the rules above.

### Ignore

Ignore the following completely:

- Style preferences or formatting opinions
- Missing tests
- Performance micro-optimizations and speculative tuning

Do not comment on these.

## Review Mindset

Prioritize correctness, safety, and system stability.
Avoid bikeshedding.
Prefer clear fixes over long explanations.
When in doubt, block only if there is real risk.

## Response Format Requirement

For every code implementation response, use this order:

1. **Execution Decision (required)**
   - `Mode:` solo | parallel-tools | collaboration
   - `Model/Reasoning Decision:` concise statement of why this path was chosen
   - `Rationale:` concrete tradeoff (speed, safety, confidence, scope, risk)
2. **PM Brief (plain English, 2-4 lines max)**  
   Explain what changed, why it matters for the real user/workflow, and any product tradeoff.
3. **Technical Detail**  
   Then provide files changed, implementation notes, risks, and test/verification status.

Rules:
- Do not omit the `Execution Decision` section on substantive responses (implementation, debugging, review, planning, or status updates).
- Keep decision lines short and concrete; no vague statements.
- The PM Brief must avoid jargon and be understandable by a non-engineer.
- Do not skip the PM Brief, even for small implementation updates.
- If blocked, state product impact first, then technical blocker.

---

## UX Review (Cross-Check Layer)

After technical review passes, the UX agent verifies against `UX_PRINCIPLES.md`.

### UX Block

Block if any of these are present:

- **B1 Noise**: Feature adds notifications, alerts, or dashboards during flow
- **B2 Authority**: System tells user what they're feeling
- **B3 Dependency**: Feature encourages frequent engagement (streaks, gamification)
- **B4 Privacy**: Emotional data persisted without explicit user action
- **B5 Latency**: Dead air > 2s without social cue, or verbose "I'm processing" responses
- **B6 Over-Engineering**: Builds for hypothetical requirements or adds unnecessary configurability

### UX Verification Questions

Before approving, answer:

1. Would the user notice this if it's working? *(Ideal: no)*
2. Does this add noise during flow? *(Must be: no)*
3. Does this tell the user what they're feeling? *(Must be: no)*
4. Could this create dependency? *(Should be: unlikely)*
5. Is this the simplest version? *(Should be: yes)*

### UX Mindset

> "If it becomes noisy, smart, talkative, or opinionated, it has failed."

The user wants to stay in flow. Everything else is secondary.

See `UX_PRINCIPLES.md` for detailed checklist and `UX_AGENT.md` for verification process.

## Website Reconstruction Reference
If reconstructing websites, reference: `Done. Here's what's saved at /home/michael/tools/kimi-vision-builder/:`

Primary path: `/home/michael/tools/kimi-vision-builder/`
