# Project Standards

> These conventions are loaded into every Ralph iteration. Keep them verifiable —
> each standard should be something a reviewer (human or AI) can check YES/NO.

## Language & Types

- TypeScript only — no `.js` files in `src/` or `server/`
- Strict typing — no `any` unless explicitly justified with a comment
- Discriminated unions for message protocols (discriminant: `type` field)
- Export interfaces from dedicated `types.ts` files

## Naming

- Functions: `camelCase`
- Interfaces/Types: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Files: `kebab-case.ts`

## File Structure

- Frontend hooks: `src/hooks/use-*.ts`
- Frontend components: `src/components/`
- Biometric algorithms: `src/lib/biometrics/`
- Server code: `server/`
- Ambient agent: `server/ambient-agent/`
- Calling/memory: `server/calling/`
- Tests: colocated next to source (e.g., `flow-calculator.test.ts`)

## Error Handling

- No bare `catch {}` — always log with structured context
- WebSocket reconnection uses exponential backoff (1s → 2s → 4s → 30s max)
- Graceful degradation: sensor loss drops to next available tier, never crashes

## Testing

- Run tests: `npx tsx src/lib/biometrics/flow-calculator.test.ts`
- Every new function gets at least one test
- Tests must be deterministic — no flaky tests
- Test names describe behavior: `test_<function>_<scenario>_<expected>`

## Sensor Data Conventions

- HR in bpm, IBI in ms, HRV (RMSSD/SDNN) in ms
- EDA/SCL in microsiemens (µS)
- Timestamps: `Date.now()` (Unix ms)
- Batch messages: 30-second windows

## Dependencies

- New dependencies require justification in commit message
- Prefer existing deps (ws, better-sqlite3, express) over new ones
- No OpenRouter/API calls on hot paths — LLM only on detector triggers (~3-5/day)

## UX (Blocking Violations)

- B1: No notifications/dashboards during detected flow
- B2: Never tell user what they're feeling
- B3: No streaks, gamification, or daily prompts
- B4: No silent emotional data persistence without consent
- B5: No dead air without social cues
- B6: No over-engineering for hypotheticals

## DO NOT

- DO NOT import dormant hooks (`use-ble-hrm.ts`, `use-pulsoid.ts`) into the dashboard
- DO NOT use `process.env.ANTHROPIC_API_KEY` in child processes — always exclude it
- DO NOT add time-based fallback triggers — interventions are sensor-only
- DO NOT exceed 2 interventions per day (`maxInterventionsPerDay: 2`)
- DO NOT commit `.env` files or API keys
