# Flow Detector

## Vision
A multi-sensor flow state detection system that combines biometrics (HR/HRV/EDA from Galaxy Watch), eye-tracking (MediaPipe), and neural signals (Mudra Link) to detect and protect deep work states.

## Architecture

```
┌─────────────────┐                       ┌─────────────────┐
│ Galaxy Watch 8  │                       │ MacBook Webcam  │
│ (HR+IBI+EDA)    │                       │  (Eye Tracking) │
└────────┬────────┘                       └────────┬────────┘
         │ WebSocket                               │ Local
         │ via relay                               │ (MediaPipe)
         ▼                                         │
┌─────────────────┐                                │
│ watch-relay.ts  │                                │
│ (Node, :8765)   │                                │
│ /watch → /browser│                               │
└────────┬────────┘                                │
         │ ws://localhost:8765                      │
         └─────────────────────────────────────────┘
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

### Data Source

The Galaxy Watch is the sole cardiac/EDA data source, connected via the relay server (`use-watch-stream.ts`). BLE HRM (`use-ble-hrm.ts`) and Pulsoid (`use-pulsoid.ts`) hooks are kept as dormant fallbacks but are not imported by the dashboard.

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
Phase: Ambient Agent Felt-Experience Prototype - **IN PROGRESS**

### What's Working
- ✅ Eye tracking via MediaPipe (blink rate, gaze stability, EAR)
- ⏸️ Heart rate streaming via Pulsoid WebSocket (dormant — hook kept, not imported)
- ⏸️ BLE HRM integration via Web Bluetooth (dormant — hook kept, not imported)
- ✅ HRV calculation (RMSSD/SDNN) from RR-interval data
- ✅ Galaxy Watch relay server (standalone Node, port 8765, binds 0.0.0.0 for LAN)
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
- ✅ Galaxy Watch Kotlin app (watch-app/) — Compose UI, Samsung Health SDK, WebSocket with backoff
- ✅ End-to-end verified: Watch → Relay → Browser dashboard (HR + IBI/RMSSD + EDA/SCL all flowing)
- ✅ UX Principles document (UX_PRINCIPLES.md) — codified philosophy into checkable rules
- ✅ UX Agent instructions (UX_AGENT.md) — verification process for cross-checking
- ✅ PostToolUse hook for UX reminders on Write/Edit
- ✅ AGENTS.md updated with dual-agent review process
- ✅ **Ambient Agent** — Server-side intervention system (sensor-triggered vs fixed-time comparison)

### What's Next
- **Field Testing** — Run the ambient agent prototype for 5-8 days to collect felt-experience ratings

### Watch App Setup Notes
- Samsung Health Sensor SDK AAR must be downloaded from https://developer.samsung.com/health/sensor and placed in `watch-app/app/libs/`
- **Health Platform Developer Mode** must be enabled on the watch: Settings → Apps → Health Platform → tap title 10x rapidly until "[Dev mode]" appears. Without this, the SDK silently queues the app and no sensor data is delivered.
- Watch IP must be set to the MacBook's LAN IP (e.g. 192.168.1.45), relay server must be running (`npm run watch-server`)

## Calibration System

4-step guided calibration captures personal baselines:

1. **Baseline (3s)** — Look at camera → captures open-eye EAR
2. **Blink (5x)** — Blink naturally → captures closed-eye EAR and blink timing
3. **Gaze Center (3s)** — Look at dot → captures personal gaze center
4. **Working Baseline (30s)** — Read text naturally → captures personal blink rate, gaze stability, EAR distributions (mean + stdDev), optionally RMSSD baseline and EDA baseline (SCL mean + stdDev) if Galaxy Watch is connected

Calibration data persists in localStorage (version 3, with optional HRV and EDA fields). Old v1/v2 data is auto-cleared on version mismatch. EDA baseline requires minimum 3 aggregation windows (~15 seconds) to be considered valid, matching the HRV baseline threshold.

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

### 1. Galaxy Watch 8 (Custom App - COMPLETE)
- **Platform**: Wear OS 4+ with Samsung Health Sensor SDK
- **Protocol**: WebSocket client → relay server (port 8765) → browser
- **Data**: Heart Rate + IBI + EDA (skin conductance)
- **Status**: End-to-end verified on Galaxy Watch 8 (sole data source for dashboard)

### 1b. Decathlon HRM Armband (BLE - DORMANT)
- **Platform**: Any BLE Heart Rate Service device (tested with Decathlon optical armband)
- **Protocol**: Web Bluetooth API (Chrome), standard Heart Rate Service (0x180D)
- **Data**: Heart Rate + RR-intervals (IBI) for HRV calculation
- **Status**: Hook kept (`use-ble-hrm.ts`) but not imported by dashboard. Galaxy Watch provides same data.

### 1c. Pulsoid (Cloud - DORMANT)
- **Protocol**: Pulsoid WebSocket API
- **Data**: Heart Rate only (no IBI/HRV)
- **Status**: Hook kept (`use-pulsoid.ts`) but not imported by dashboard. Galaxy Watch provides richer data.

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
watch-app/                             ✅ Galaxy Watch Kotlin app (Wear OS)
├── app/src/main/kotlin/com/flowdetector/watch/
│   ├── MessageSerializer.kt          ✅ Protocol data classes → JSON
│   ├── WebSocketManager.kt           ✅ OkHttp WebSocket + exponential backoff
│   ├── SensorService.kt              ✅ Samsung Health SDK bridge (HR + IBI + EDA)
│   └── MainActivity.kt               ✅ Compose UI (HR display, IP input, connect button)
├── app/src/main/AndroidManifest.xml   ✅ Permissions + foreground service
└── app/build.gradle.kts               ✅ Dependencies (Samsung AAR, OkHttp, Wear Compose)
server/
├── watch-relay.ts              ✅ Standalone WebSocket relay (port 8765)
├── calling/                    ✅ Hume EVI + Twilio phone call service
│   ├── call-service.ts         ✅ Express server (port 8766) for outbound calls
│   ├── hume-config.json        ✅ EVI persona configuration
│   ├── SETUP.md                ✅ Setup guide for Twilio + Hume credentials
│   └── .env.example            ✅ Environment variables template
└── ambient-agent/              ✅ Sensor-triggered intervention prototype
    ├── types.ts                ✅ Intervention types, thresholds, state
    ├── agent.ts                ✅ Main orchestrator (connects to relay, runs detection)
    ├── detectors.ts            ✅ Flow, stress, recovery pattern detection
    ├── interventions.ts        ✅ Delivery (Focus Mode, haptic, call-service)
    ├── logger.ts               ✅ JSONL logging + condition comparison
    ├── hrv-calculator.ts       ✅ Server-side HRV calculation
    └── cli.ts                  ✅ CLI entry point (start, rate, compare, fixed)
src/
├── app/
│   ├── layout.tsx              ✅ Root layout
│   └── page.tsx                ✅ Main dashboard with flow metrics UI
├── hooks/
│   ├── use-camera-stream.ts    ✅ Camera permission & MediaStream
│   ├── use-eye-tracking.ts     ✅ MediaPipe face landmarks → blink/gaze (accepts calibration)
│   ├── use-calibration.ts      ✅ 4-step calibration state machine
│   ├── use-watch-stream.ts     ✅ Galaxy Watch relay hook (HR + IBI + EDA, backoff reconnect)
│   ├── use-ble-hrm.ts          ⏸️ BLE Heart Rate Monitor (dormant — not imported)
│   ├── use-pulsoid.ts          ⏸️ Pulsoid WebSocket (dormant — not imported)
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

## UX Verification Agent

A two-layer review system ensures both code quality and UX alignment:

| Layer | Agent | Focus | Documents |
|-------|-------|-------|-----------|
| 1 | Building Agent | Types, tests, architecture | AGENTS.md |
| 2 | UX Agent | Noise, privacy, simplicity | UX_AGENT.md, UX_PRINCIPLES.md |

### Core UX Principle

> "If it becomes noisy, smart, talkative, or opinionated, it has failed."

The system should be **invisible when working**. Users should notice fewer interruptions, not a new tool.

### UX Blocking Violations

- **B1 Noise**: Notifications/dashboards during flow
- **B2 Authority**: Telling user what they're feeling
- **B3 Dependency**: Streaks, gamification, daily prompts
- **B4 Privacy**: Silent emotional data persistence
- **B5 Latency**: Dead air without social cues
- **B6 Over-Engineering**: Building for hypotheticals

### Integration

- PostToolUse hook reminds building agent to check UX on Write/Edit
- UX verification script: `.claude/ux-verify.sh`
- Full checklist: `UX_PRINCIPLES.md`

## Code Orchestration Framework

A structured approach to Claude Code sessions based on task type.

### Task Classification (Step Zero)

| Task Type | Phases Needed |
|-----------|---------------|
| Question | None — just answer |
| Bug fix | Plan → Test → Ship |
| Small change | Plan → Build → Test → Ship |
| Refactor | Plan → Test → Refactor → Verify |
| New feature | Story → Plan → Build → Test → Ship |
| Major feature | Full 7-phase loop |

### The 7 Phases (Major Features Only)

1. **Assumptions + TED** — Kill uncertainty first
2. **User Story + Gherkin** — Behavior contract
3. **C4 Mini Map** — Just enough architecture
4. **Implementation Plan** — Files, functions, failure modes
5. **Tests Plan** — Pyramid: unit > integration > E2E
6. **PR Review Checklist** — Clean Code + UX checks
7. **CI/CD Steps** — Build, test, deploy, rollback

### Key Principle

> "You can fit them into one Claude Code loop. You must pick. If you try to 'do everything,' you will ship nothing."

See `.claude/orchestrator/ORCHESTRATOR.md` for full details.

## References

- Architecture + data sources: `docs/architecture.md`
- Watch Bridge plan: `WATCH-BRIDGE-PLAN.md`
- UX Philosophy: `UX_PRINCIPLES.md`
- UX Verification Process: `UX_AGENT.md`
- **Code Orchestration**: `.claude/orchestrator/ORCHESTRATOR.md`
- Iteration Template: `iterations/TEMPLATE.md`

## Remember

- The user is non-technical - keep explanations simple
- Stay focused on the current phase
