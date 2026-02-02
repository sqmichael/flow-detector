# Flow Detector - Session Context

Last updated: 2026-02-02

## Just Completed
- **State Machine Wiring** - Connected warmth/interest functions to Hume webhook in call-service.ts
  - Ripcord detected via transcript phrases OR duration < 30s
  - Thanks bonus detected via "thank/thanks/appreciate" in transcript
  - Successful call = duration >= 60s without ripcord
  - `/memory` and `/health` endpoints now include user state

## Current Branch State
- `feature/cold-start` - Ready for commit with state machine wiring

## Key Architecture Decisions
- Agent name: "Kai" - crisp professional, not a friend
- Warmth never decays (earned trust persists)
- Interest check-ins at 1/2/4 weeks of silence (only after onboarding complete)
- Memory injected into Hume EVI via dynamic config versioning
- **Call outcome detection:**
  - Tech failure: `<10s` → no state change (assume network issue)
  - Implicit ripcord: `10-30s` → user hung up quickly
  - Explicit ripcord: `30-60s` + word-boundary match for ripcord phrases
  - Thanks bonus: word-boundary match for "thank/thanks/appreciate"
  - Successful: `>=60s` duration without ripcord

## Backlog (from CLAUDE.md)
1. **Field Testing** - Run ambient agent prototype 5-8 days to collect felt-experience ratings
2. ~~**State Machine Wiring** - Connect warmth/interest functions to actual call lifecycle~~ ✅ DONE
3. **Onboarding Flow** - First proactive intro call upon registration

## Files to Know
- `server/calling/memory/` - Memory layer (themes, preferences, user state)
- `server/calling/call-service.ts` - Twilio + Hume call orchestration (now with state machine)
- `server/ambient-agent/` - Sensor-triggered intervention system
- `docs/cold-start/v0.1-design.md` - Warmth/interest state machine design

## Open Questions (Resolved)
- ✅ Engagement updates only on successful calls (non-ripcord, >= 60s)
