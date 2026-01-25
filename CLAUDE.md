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
Phase: Plumbing (Phase 1) - **MOSTLY COMPLETE**

### What's Working
- ✅ Eye tracking via MediaPipe (blink rate, gaze stability, EAR)
- ✅ Heart rate streaming via Pulsoid WebSocket
- ✅ Flow calculator (eye-only mode, since Pulsoid doesn't provide IBI)
- ✅ Combined UI showing all metrics

### Priority 1: MediaPipe Calibration (DO THIS FIRST)
The eye tracking metrics are currently unreliable because they use hardcoded thresholds. Before adding more sensors, fix the foundation.

**Problems with current implementation:**
- EAR (Eye Aspect Ratio) baseline varies per person based on eye shape
- Gaze "center" is wherever you happened to look when tracking started
- Blink detection threshold (0.2) may be too sensitive or not sensitive enough
- Flow score from uncalibrated data is essentially noise

**Calibration flow to implement:**
1. "Look straight at camera" → capture gaze center baseline
2. "Blink 5 times" → capture personal EAR range (open vs closed)
3. "Look at corners" → capture gaze range for stability calculation
4. Store calibration data in localStorage
5. Use personal baselines instead of hardcoded values

**Files to modify:**
- `src/hooks/use-eye-tracking.ts` - add calibration state and logic
- `src/lib/mediapipe/metrics-calculator.ts` - use calibrated values
- `src/app/page.tsx` - add calibration UI/flow

### Priority 2: Custom Watch App for IBI/HRV
The webapp is functional but Pulsoid only provides HR, not IBI data needed for proper HRV calculation. Need a custom Galaxy Watch 8 app to stream both HR and IBI.

### Custom Watch App Spec (for Gemini/Codex)
```
Platform: Wear OS 4+ (Galaxy Watch 8)
Language: Kotlin
SDK: Health Services API (not deprecated WearableListenerService)

Features:
1. Read heart rate sensor events
2. Calculate IBI from timestamp differences between beats
3. Send JSON over WebSocket to configurable IP

Output format (matches use-sensor-server.ts):
{
  "values": [heartRate, ibi],  // HR in BPM, IBI in milliseconds
  "timestamp": 1706000000000,  // Unix timestamp ms
  "accuracy": 3                // Sensor accuracy
}

Permissions needed:
- BODY_SENSORS (for heart rate)
- INTERNET (for WebSocket)

UI: Simple screen showing:
- Current HR
- Connection status
- IP address input field
- Connect/Disconnect button
```

### Watch App Architecture
```
Galaxy Watch 8 (Custom App) → WebSocket Client → MacBook (this app)
MacBook WebSocket Server: ws://macbook-ip:8080
```

Note: The watch app is a WebSocket CLIENT that connects to a server on the MacBook. We'll need to add a simple WebSocket server to this Next.js app, or run a standalone Node server.

## Key Data Sources

### 1. Galaxy Watch 8 (Custom App - TODO)
- **Platform**: Wear OS 4+ with Health Services API
- **Protocol**: WebSocket client connecting to MacBook
- **Data**: Heart Rate + IBI (Inter-Beat Interval) for HRV
- **Why Custom**: Pulsoid/SensorServer don't expose IBI data

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
├── hooks/
│   ├── use-camera-stream.ts    ✅ Camera permission & MediaStream
│   ├── use-eye-tracking.ts     ✅ MediaPipe face landmarks → blink/gaze
│   ├── use-pulsoid.ts          ✅ Pulsoid WebSocket (HR only, no IBI)
│   ├── use-sensor-server.ts    ✅ Ready for custom watch app (HR + IBI)
│   └── use-mudra-stream.ts     TODO (Phase 2)
├── lib/
│   ├── mediapipe/              ✅ Face Landmarker wrapper
│   ├── biometrics/             ✅
│   │   ├── types.ts            # HR/HRV/Combined types
│   │   ├── hrv-calculator.ts   # RMSSD/SDNN from IBI data
│   │   └── flow-calculator.ts  # Combined flow scoring
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
