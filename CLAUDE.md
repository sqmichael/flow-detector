# Flow Detector

Multi-sensor flow state detection: HR/HRV (Galaxy Watch) + Neural (Mudra) + Eye Tracking (MediaPipe).

## Current Focus
<!-- UPDATE THIS EACH SESSION -->
Phase: Plumbing
Task: Set up Claude Code hooks and implementation plan for Watch Bridge

## Roadmap

| Phase | Goal |
|-------|------|
| **Plumbing** (1-3) | SensorServer on Flip → Watch HR on localhost:3000 |
| **Neural/Vision** (4-7) | Mudra relay + MediaPipe in React frontend |
| **Logic** (8-11) | Flow Formula: `Flow = (HRV × Rhythm) - Blinks` |
| **Shield** (12-14) | node-applescript triggers Mac Focus Mode |

## Coding Rules

1. TypeScript only
2. Small functions, single responsibility
3. Socket.io for all real-time streams
4. Build only what's needed for the current phase
5. Test each sensor independently before integration

## File Structure

```
src/
├── hooks/          # React hooks per sensor
├── lib/            # Core logic (mediapipe, biometrics, flow)
└── components/     # UI components
```

## References

- Architecture + data sources: `docs/architecture.md`
- Watch Bridge plan: `WATCH-BRIDGE-PLAN.md`

## Remember

- The user is non-technical - keep explanations simple
- Stay focused on the current phase
