# AGENTS.md

## Project

Flow Detector: multi-sensor flow state detection using TypeScript, React, Socket.io, and MediaPipe.

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
