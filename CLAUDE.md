# Flow Detector

## Vision
A multi-sensor flow state detection system that combines biometrics (HR/HRV from Galaxy Watch), neural signals (Mudra Link), and eye-tracking (MediaPipe) to detect and protect deep work states.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Galaxy Watch 7 │     │   Mudra Link    │     │ MacBook Webcam  │
│   (HR / HRV)    │     │ (Neural/SNC)    │     │  (Eye Tracking) │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │ WebSocket             │ WebSocket             │ Local
         │ (SensorServer)        │ (Custom Relay)        │ (MediaPipe)
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │     Fusion Hub         │
                    │  (React + Socket.io)   │
                    │                        │
                    │  Flow = (HRV × Rhythm) │
                    │         - Blinks       │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │   Mac Focus Mode       │
                    │  (node-applescript)    │
                    └────────────────────────┘
```

## 14-Day Roadmap

| Phase | Days | Goal | Status |
|-------|------|------|--------|
| **Plumbing** | 1-3 | SensorServer on Flip → Watch HR visible on localhost:3000 | |
| **Neural/Vision** | 4-7 | Mudra relay + MediaPipe in React frontend | |
| **Logic** | 8-11 | Flow Formula: `Flow = (HRV × Rhythm) - Blinks` | |
| **Shield** | 12-14 | node-applescript triggers Mac Focus Mode on Flow detection | |

## Current Focus
<!-- UPDATE THIS EACH SESSION -->
Phase: Plumbing
Task: Set up Claude Code hooks and implementation plan for Watch Bridge

## Key Data Sources

### 1. Galaxy Watch 7 (via SensorServer)
- **Tool**: SensorServer app on Z Flip
- **Protocol**: WebSocket server on phone
- **Data**: Heart Rate, IBI (Inter-Beat Interval) for HRV
- **Access**: Samsung Health Data SDK (Privileged Access on Z Flip)

### 2. Mudra Link (Neural)
- **Repo**: Mudra Android App Example
- **Interface**: MudraDelegate
- **Data**: Surface Neural Conductance (SNC) for intent detection
- **Method**: Add WebSocket.send() to forward data to MacBook

### 3. MacBook Webcam (Eye Tracking)
- **Tool**: MediaPipe Face Landmarker (WASM)
- **Data**: 478 3D face landmarks
- **Key Landmarks**: 159 (Upper Eyelid), 145 (Lower Eyelid)
- **Metric**: Eye Aspect Ratio → Blink Rate

### 4. Fusion Hub
- **Stack**: React + Socket.io (Node.js)
- **Role**: Traffic controller for all sensor streams
- **Output**: Flow Score + Focus Mode trigger

## Flow Formula
```
Flow = (HRV × Rhythm) - Blinks
```
- **HRV**: Heart Rate Variability from watch IBI data
- **Rhythm**: Derived from neural SNC patterns (Mudra)
- **Blinks**: Blink rate from eye tracking (MediaPipe)

## Coding Rules

1. **TypeScript only** - All code must be typed
2. **Keep functions small** - Single responsibility
3. **WebSocket consistency** - Use Socket.io for all real-time streams
4. **No over-engineering** - Build only what's needed for the current phase
5. **Test data flows** - Verify each sensor connection before moving on

## File Structure

```
src/
├── hooks/           # React hooks for each sensor
│   ├── use-camera-stream.ts    ✓ Done
│   ├── use-eye-tracking.ts     ✓ Done
│   ├── use-watch-stream.ts     TODO (Phase 1)
│   └── use-mudra-stream.ts     TODO (Phase 2)
├── lib/
│   ├── mediapipe/              ✓ Done
│   ├── sensor-server/          TODO (Phase 1)
│   └── flow-calculator/        TODO (Phase 3)
└── components/
    └── flow-dashboard/         TODO (Phase 3)
```

## Remember

- **Stay focused on the current phase** - Don't jump ahead
- **Use TodoWrite** to track all tasks
- **Test each sensor independently** before integration
- **The user is non-technical** - Keep explanations simple
- **Commit working code** - Don't stop with broken builds
