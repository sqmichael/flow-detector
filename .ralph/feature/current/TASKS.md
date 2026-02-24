# Tasks
- [x] Add v1 context/decision contract types in `server/ambient-agent/types.ts` (`TimingContextV1`, `TimingDecisionV1`) with strict enums and null-safe defaults.
- [x] Implement deterministic timing policy in `server/ambient-agent/timing-policy.ts` with binary output (`message_now` vs `delay`) and bounded message taxonomy (`protect|reflect|reset|none`).
- [x] Add unit tests for timing policy edge cases (meeting, transit, no-free-window, unknown location, high calendar pressure).
- [x] Integrate timing policy into `server/ambient-agent/agent.ts` before `sendPushNotification`, with fail-safe default `message_now=false` on bad/unknown context.
- [x] Add decision snapshot logging in `server/ambient-agent/logger.ts` for every decision cycle (`context`, `decision`, `sent`, `deferred_until`).
- [x] Add dedupe/cooldown guard in agent messaging path to prevent restart-induced duplicate sends for same decision window.
- [x] Add a replay/scoring script `server/ambient-agent/eval/timing-score.ts` to compute mistimed rate from logged decisions.
- [x] Document runbook in `.ralph/feature/current/SHIP.md`: env vars, how to run policy in shadow mode, and go/no-go metrics after 3-5 days.
