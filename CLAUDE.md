# Flow Detector

## Vision
A multi-sensor flow state detection system that combines biometrics (HR/HRV/EDA from Galaxy Watch), eye-tracking (MediaPipe), and neural signals (Mudra Link) to detect and protect deep work states.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Galaxy Watch 8  │     │ Decathlon HRM   │     │ MacBook Webcam  │
│ (HR+IBI+EDA)    │     │ (HR + RR/IBI)   │     │  (Eye Tracking) │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │ WebSocket             │ Web Bluetooth         │ Local
         │ via relay             │ (Chrome)              │ (MediaPipe)
         ▼                       │                       │
┌─────────────────┐              │                       │
│ watch-relay.ts  │              │                       │
│ (Node, :8765)   │              │                       │
│ /watch → /browser│             │                       │
└────────┬────────┘              │                       │
         │ ws://localhost:8765   │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │     Fusion Hub         │
                    │  (Next.js Client-Side) │
                    │                        │
                    │  Z-score flow scoring  │
                    │  + EMA smoothing       │
                    │  + HRV (RMSSD/SDNN)    │
                    │  + EDA (SCL) scoring   │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │   Mac Focus Mode       │
                    │  (node-applescript)    │
                    └────────────────────────┘
```

### Data Source Priority

The browser app uses a priority cascade for cardiac data:

1. **Watch Stream** (HR + IBI + EDA) — richest data, via relay server (`use-watch-stream.ts`)
2. **BLE HRM** (HR + IBI) — direct browser connection via Web Bluetooth (`use-ble-hrm.ts`)
3. **Pulsoid** (HR only) — cloud WebSocket fallback (`use-pulsoid.ts`)

The highest-priority connected source wins. EDA is only available from the Watch Stream.

### Watch Relay Server

A standalone Node WebSocket server (`server/watch-relay.ts`) on port 8765 with path-based routing:

- `/watch` — accepts the Galaxy Watch connection (one at a time)
- `/browser` — accepts browser clients (fan-out to all)

All watch messages are relayed to all browser clients. The server sends `watch_status` messages when the watch connects/disconnects. Run with `npm run watch-server` (or `npm run watch-server -- --verbose` for message logging).

### Watch Message Protocol

Uses a discriminated union on the `type` field with `protocolVersion` in the handshake:

```typescript
{ type: "handshake", protocolVersion: 1, deviceName: string, sensors: string[], timestamp: number }
{ type: "hr", bpm: number, ibi: number | null, quality: number, timestamp: number }
{ type: "eda", scl: number, timestamp: number }  // scl in microsiemens
{ type: "watch_status", connected: boolean, deviceName: string | null, timestamp: number }  // relay→browser only
```

## Current Focus
<!-- UPDATE THIS EACH SESSION -->
Phase: Logic (Phase 3) - **EDA + WATCH RELAY INTEGRATION COMPLETE, FOCUS MODE NEXT**

### What's Working
- ✅ Eye tracking via MediaPipe (blink rate, gaze stability, EAR)
- ✅ Heart rate streaming via Pulsoid WebSocket (HR only, fallback)
- ✅ BLE HRM integration via Web Bluetooth (HR + RR-intervals for HRV)
- ✅ HRV calculation (RMSSD/SDNN) from RR-interval data
- ✅ Galaxy Watch relay server (standalone Node, port 8765)
- ✅ Watch stream browser hook with exponential backoff reconnection
- ✅ EDA (skin conductance) scoring with Gaussian z-score model
- ✅ Three-tier flow scoring: eye-only → eye+HRV → eye+HRV+EDA
- ✅ 4-step calibration with personal working baseline (HRV + EDA baselines)
- ✅ Z-score flow algorithm with Gaussian/sigmoid scoring curves
- ✅ EMA temporal smoothing (alpha=0.15) to prevent score flickering
- ✅ Flow confirmation requiring 2+ minutes sustained above threshold
- ✅ Blink rate cold-start fix (blends with baseline for first 30 seconds)
- ✅ Algorithm test suite (17 tests, all passing)
- ✅ Graceful degradation: immediate tier drop-back when sensors disconnect

### What's Next
- **Galaxy Watch Kotlin App** — Custom Wear OS app to stream HR, IBI, and EDA via WebSocket to the relay server (Phase 4, separate Android Studio project)
- **Focus Mode Shield** — Wire flow detection to trigger Mac Focus Mode via node-applescript

## Calibration System

4-step guided calibration captures personal baselines:

1. **Baseline (3s)** — Look at camera → captures open-eye EAR
2. **Blink (5x)** — Blink naturally → captures closed-eye EAR and blink timing
3. **Gaze Center (3s)** — Look at dot → captures personal gaze center
4. **Working Baseline (30s)** — Read text naturally → captures personal blink rate, gaze stability, EAR distributions (mean + stdDev), optionally RMSSD baseline if BLE HRM is connected, and optionally EDA baseline (SCL mean + stdDev) if Galaxy Watch is connected

Calibration data persists in localStorage (version 3, with optional HRV and EDA fields). Old v1/v2 data is auto-cleared on version mismatch. EDA baseline requires minimum 20 samples (~20 seconds at 1 Hz) to be considered valid.

## Flow Detection Algorithm

The algorithm uses **z-score normalization** against personal baselines captured during calibration.

**Scoring functions:**
- **Blink rate** — Gaussian curve centered at z=-1.5 (optimal is ~1.5 std deviations below your normal rate). Very low blink rates score slightly lower to account for strain.
- **Gaze stability** — Sigmoid curve where higher stability = higher score. "More is better" without a peak.
- **EAR** — Gaussian curve centered at z=0 (close to baseline = comfortable engagement).
- **HRV (RMSSD)** — Gaussian curve centered at z=-0.5 (slightly below baseline = engaged but calm). Width 1.2 (broad, since HRV is noisy). Falls back to absolute thresholds if no HRV baseline captured.
- **EDA (SCL)** — Gaussian curve centered at z=0 (moderate arousal near baseline = flow). Width 1.0 (`EDA_SCORE_GAUSSIAN_WIDTH` constant). Falls back to absolute thresholds (2-10 µS = 0.8, 1-15 µS = 0.6, else 0.4) if no EDA baseline captured.

**Three-tier weight system (automatic based on available sensors):**

| Signal | Eye-Only | Eye+HRV | Eye+HRV+EDA |
|--------|----------|---------|-------------|
| Gaze stability | 0.45 | 0.35 | 0.30 |
| Blink rate | 0.40 | 0.30 | 0.25 |
| EAR | 0.15 | 0.10 | 0.10 |
| HRV (RMSSD) | -- | 0.25 | 0.20 |
| EDA (SCL) | -- | -- | 0.15 |

EDA gets conservative weight (0.15) because wrist-based skin conductance is noisier than finger/palm electrodes. When a sensor disconnects mid-session, the system immediately drops back to the next available tier. EMA smoothing on the final score (alpha=0.15) prevents abrupt score jumps.

**Temporal smoothing:** EMA with alpha=0.15 prevents raw score volatility from causing UI flickering.

**Flow confirmation:** Score must stay above 0.65 for 2+ minutes before `inFlow` flag is set. Confidence builds over time. Dropping below threshold resets the onset timer.

## Custom Watch App Spec (Phase 4)
```
Platform: Wear OS 4+ (Galaxy Watch 8)
Language: Kotlin
SDK: Samsung Health Sensor SDK (samsung-health-sensor-api.aar)

Trackers:
- HealthTrackerType.HEART_RATE_CONTINUOUS (HR + IBI, 1 Hz)
- HealthTrackerType.EDA_CONTINUOUS (SCL in microsiemens, 1 Hz)

Message Protocol (named fields, discriminated union on "type"):
Handshake: { type: "handshake", protocolVersion: 1, deviceName, sensors, timestamp }
HR:        { type: "hr", bpm, ibi, quality, timestamp }
EDA:       { type: "eda", scl, timestamp }

Reconnection: Exponential backoff 1s → 2s → 4s → ... → 30s max

Permissions:
- BODY_SENSORS (for heart rate + EDA)
- INTERNET (for WebSocket)
- FOREGROUND_SERVICE (for background streaming)

UI: Single screen showing:
- Current HR
- Connection status dot (green=connected, red=disconnected)
- IP address input field (persisted in SharedPreferences)
- Connect/Disconnect button
- Streaming indicator (green pulsing dot)

App structure:
  MainActivity.kt          — Compose UI
  SensorService.kt         — Foreground service hosting tracker subscriptions
  WebSocketManager.kt      — OkHttp WebSocket client with backoff
  MessageSerializer.kt     — Data classes → JSON per protocol
```

### Watch App Architecture
```
Galaxy Watch 8 (Custom App) → ws://macbook-ip:8765/watch → watch-relay.ts → /browser → Next.js app
```

The watch app is a WebSocket CLIENT that connects to the relay server on the MacBook. The relay server fans out messages to all connected browser clients.

## Key Data Sources

### 1. Galaxy Watch 8 (Custom App - IN PROGRESS)
- **Platform**: Wear OS 4+ with Samsung Health Sensor SDK
- **Protocol**: WebSocket client → relay server (port 8765) → browser
- **Data**: Heart Rate + IBI + EDA (skin conductance)
- **Status**: Relay server and browser hook complete; Kotlin watch app pending (Phase 4)

### 1b. Decathlon HRM Armband (BLE - COMPLETE)
- **Platform**: Any BLE Heart Rate Service device (tested with Decathlon optical armband)
- **Protocol**: Web Bluetooth API (Chrome), standard Heart Rate Service (0x180D)
- **Data**: Heart Rate + RR-intervals (IBI) for HRV calculation
- **Why BLE**: Direct browser connection, no bridge app needed, standard protocol

### 1c. Pulsoid (Cloud - COMPLETE, FALLBACK)
- **Protocol**: Pulsoid WebSocket API
- **Data**: Heart Rate only (no IBI/HRV)
- **Status**: Lowest priority fallback

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
server/
└── watch-relay.ts              ✅ Standalone WebSocket relay (port 8765)
src/
├── app/
│   ├── layout.tsx              ✅ Root layout
│   └── page.tsx                ✅ Main dashboard with flow metrics UI
├── hooks/
│   ├── use-camera-stream.ts    ✅ Camera permission & MediaStream
│   ├── use-eye-tracking.ts     ✅ MediaPipe face landmarks → blink/gaze (accepts calibration)
│   ├── use-calibration.ts      ✅ 4-step calibration state machine
│   ├── use-watch-stream.ts     ✅ Galaxy Watch relay hook (HR + IBI + EDA, backoff reconnect)
│   ├── use-ble-hrm.ts          ✅ BLE Heart Rate Monitor (HR + RR/IBI + HRV)
│   ├── use-pulsoid.ts          ✅ Pulsoid WebSocket (HR only, fallback)
│   ├── use-sensor-server.ts    ⏸️ Legacy hook (kept but not imported)
│   └── use-mudra-stream.ts     TODO (low priority)
├── lib/
│   ├── mediapipe/
│   │   ├── types.ts            ✅ Eye tracking type definitions
│   │   ├── face-landmarker.ts  ✅ MediaPipe WASM wrapper
│   │   └── eye-metrics.ts      ✅ EAR, blink detection, gaze stability (cold-start fix)
│   ├── calibration/
│   │   ├── types.ts            ✅ CalibrationData v3, WorkingBaselineCalibration (+ EDA fields)
│   │   ├── storage.ts          ✅ localStorage save/load/clear with version check (v3)
│   │   └── processor.ts        ✅ Threshold calculations, working baseline stats (+ EDA baseline)
│   └── biometrics/
│       ├── types.ts            ✅ HR/HRV/EDA/Combined types + WatchMessage protocol
│       ├── hrv-calculator.ts   ✅ RMSSD/SDNN from IBI data
│       ├── flow-calculator.ts  ✅ Z-score flow scoring + EMA + HRV + EDA (three-tier weights)
│       └── flow-calculator.test.ts ✅ 17 tests covering algorithm behavior
└── components/
    └── calibration/
        └── CalibrationOverlay.tsx ✅ 4-step calibration UI with reading text
```

## Remember

- **Stay focused on the current phase** - Don't jump ahead
- **Use TodoWrite** to track all tasks
- **Test each sensor independently** before integration
- **The user is non-technical** - Keep explanations simple
- **Commit working code** - Don't stop with broken builds
