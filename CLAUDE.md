# Flow Detector

## Vision
A multi-sensor flow state detection system that combines biometrics (HR/HRV from Galaxy Watch), neural signals (Mudra Link), and eye-tracking (MediaPipe) to detect and protect deep work states.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Decathlon HRM   │     │   Mudra Link    │     │ MacBook Webcam  │
│ (HR + RR/IBI)   │     │ (Neural/SNC)    │     │  (Eye Tracking) │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │ Web Bluetooth         │ WebSocket             │ Local
         │ (Chrome)              │ (Custom Relay)        │ (MediaPipe)
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │     Fusion Hub         │
                    │  (Next.js Client-Side) │
                    │                        │
                    │  Z-score flow scoring  │
                    │  + EMA smoothing       │
                    │  + HRV (RMSSD/SDNN)    │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │   Mac Focus Mode       │
                    │  (node-applescript)    │
                    └────────────────────────┘
```

## Current Focus
<!-- UPDATE THIS EACH SESSION -->
Phase: Logic (Phase 3) - **CARDIAC INTEGRATION COMPLETE, FOCUS MODE NEXT**

### What's Working
- ✅ Eye tracking via MediaPipe (blink rate, gaze stability, EAR)
- ✅ Heart rate streaming via Pulsoid WebSocket (HR only, fallback)
- ✅ BLE HRM integration via Web Bluetooth (HR + RR-intervals for HRV)
- ✅ HRV calculation (RMSSD/SDNN) from RR-interval data
- ✅ Combined flow scoring with HRV component (eye 75% + HRV 25%)
- ✅ 4-step calibration with personal working baseline (+ optional HRV baseline)
- ✅ Z-score flow algorithm with Gaussian/sigmoid scoring curves
- ✅ EMA temporal smoothing (alpha=0.15) to prevent score flickering
- ✅ Flow confirmation requiring 2+ minutes sustained above threshold
- ✅ Blink rate cold-start fix (blends with baseline for first 30 seconds)
- ✅ Algorithm test suite (13 tests, all passing)
- ✅ Graceful degradation: eye-only mode when HRM not connected

### What's Next: Focus Mode Shield
Wire up flow detection to trigger Mac Focus Mode via node-applescript when sustained flow is detected.

## Calibration System

4-step guided calibration captures personal baselines:

1. **Baseline (3s)** — Look at camera → captures open-eye EAR
2. **Blink (5x)** — Blink naturally → captures closed-eye EAR and blink timing
3. **Gaze Center (3s)** — Look at dot → captures personal gaze center
4. **Working Baseline (30s)** — Read text naturally → captures personal blink rate, gaze stability, EAR distributions (mean + stdDev), and optionally RMSSD baseline if BLE HRM is connected

Calibration data persists in localStorage (version 2, with optional HRV fields). Old v1 data is auto-cleared. Calibration works with or without HRM connected.

## Flow Detection Algorithm

The algorithm uses **z-score normalization** against personal baselines captured during calibration.

**Scoring functions:**
- **Blink rate** — Gaussian curve centered at z=-1.5 (optimal is ~1.5 std deviations below your normal rate). Very low blink rates score slightly lower to account for strain.
- **Gaze stability** — Sigmoid curve where higher stability = higher score. "More is better" without a peak.
- **EAR** — Gaussian curve centered at z=0 (close to baseline = comfortable engagement).
- **HRV (RMSSD)** — Gaussian curve centered at z=-0.5 (slightly below baseline = engaged but calm). Width 1.2 (broad, since HRV is noisy). Falls back to absolute thresholds if no HRV baseline captured.

**Weights (eye-only):** Gaze stability 0.45, Blink rate 0.40, EAR 0.15
**Weights (with HRV):** Gaze stability 0.35, Blink rate 0.30, EAR 0.10, HRV 0.25

**Temporal smoothing:** EMA with alpha=0.15 prevents raw score volatility from causing UI flickering.

**Flow confirmation:** Score must stay above 0.65 for 2+ minutes before `inFlow` flag is set. Confidence builds over time. Dropping below threshold resets the onset timer.

## Custom Watch App Spec (for Gemini/Codex)
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

The watch app is a WebSocket CLIENT that connects to a server on the MacBook. We'll need to add a simple WebSocket server to this Next.js app, or run a standalone Node server.

## Key Data Sources

### 1. Decathlon HRM Armband (BLE - COMPLETE)
- **Platform**: Any BLE Heart Rate Service device (tested with Decathlon optical armband)
- **Protocol**: Web Bluetooth API (Chrome), standard Heart Rate Service (0x180D)
- **Data**: Heart Rate + RR-intervals (IBI) for HRV calculation
- **Why BLE**: Direct browser connection, no bridge app needed, standard protocol

### 1b. Galaxy Watch 8 (Custom App - DEPRIORITIZED)
- **Platform**: Wear OS 4+ with Health Services API
- **Protocol**: WebSocket client connecting to MacBook
- **Data**: Heart Rate + IBI (via use-sensor-server.ts, ready if needed)
- **Status**: BLE HRM provides the same IBI data with simpler setup

### 2. Mudra Link (Neural - LOW PRIORITY)
- **Repo**: Mudra Android App Example
- **Interface**: MudraDelegate
- **Data**: Surface Neural Conductance (SNC) for intent detection
- **Method**: Add WebSocket.send() to forward data to MacBook

### 3. MacBook Webcam (Eye Tracking - COMPLETE)
- **Tool**: MediaPipe Face Landmarker (WASM)
- **Data**: 478 3D face landmarks
- **Metrics**: Blink rate, gaze stability, EAR
- **Calibration**: Personal baselines via 4-step guided flow

## Coding Rules

1. **TypeScript only** - All code must be typed
2. **Keep functions small** - Single responsibility
3. **No over-engineering** - Build only what's needed for the current phase
4. **Test data flows** - Verify each sensor connection before moving on
5. **Run tests** - `npx tsx src/lib/biometrics/flow-calculator.test.ts`

## File Structure

```
src/
├── app/
│   ├── layout.tsx              ✅ Root layout
│   └── page.tsx                ✅ Main dashboard with flow metrics UI
├── hooks/
│   ├── use-camera-stream.ts    ✅ Camera permission & MediaStream
│   ├── use-eye-tracking.ts     ✅ MediaPipe face landmarks → blink/gaze (accepts calibration)
│   ├── use-calibration.ts      ✅ 4-step calibration state machine
│   ├── use-ble-hrm.ts          ✅ BLE Heart Rate Monitor (HR + RR/IBI + HRV)
│   ├── use-pulsoid.ts          ✅ Pulsoid WebSocket (HR only, fallback)
│   ├── use-sensor-server.ts    ✅ Ready for custom watch app (HR + IBI)
│   └── use-mudra-stream.ts     TODO (low priority)
├── lib/
│   ├── mediapipe/
│   │   ├── types.ts            ✅ Eye tracking type definitions
│   │   ├── face-landmarker.ts  ✅ MediaPipe WASM wrapper
│   │   └── eye-metrics.ts      ✅ EAR, blink detection, gaze stability (cold-start fix)
│   ├── calibration/
│   │   ├── types.ts            ✅ CalibrationData v2, WorkingBaselineCalibration
│   │   ├── storage.ts          ✅ localStorage save/load/clear with version check
│   │   └── processor.ts        ✅ Threshold calculations, working baseline stats
│   └── biometrics/
│       ├── types.ts            ✅ HR/HRV/Combined types
│       ├── hrv-calculator.ts   ✅ RMSSD/SDNN from IBI data (waiting for watch app)
│       ├── flow-calculator.ts  ✅ Z-score flow scoring with EMA smoothing + HRV scoring
│       └── flow-calculator.test.ts ✅ 13 tests covering algorithm behavior
└── components/
    └── calibration/
        └── CalibrationOverlay.tsx ✅ 4-step calibration UI with reading text
```

## References

- Architecture + data sources: `docs/architecture.md`
- Watch Bridge plan: `WATCH-BRIDGE-PLAN.md`

## Remember

- The user is non-technical - keep explanations simple
- Stay focused on the current phase
