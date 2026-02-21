# Architecture

Current architecture uses a custom Galaxy Watch app and local relay server.
Older SensorServer-based docs are superseded.

```
┌─────────────────┐                       ┌─────────────────┐
│ Galaxy Watch 8  │                       │ MacBook Webcam  │
│(HR+IBI+EDA+PPG+ │                       │  (Eye Tracking) │
│ Accelerometer)  │                       └────────┬────────┘
└────────┬────────┘                                │ Local
         │ WebSocket (LAN)                         │ (MediaPipe)
         ▼                                         │
┌─────────────────┐                                │
│ watch-relay.ts  │                                │
│ Node + WS :8765 │                                │
│ /watch → /browser                               │
└────────┬────────┘                                │
         │ ws://localhost:8765                     │
         └─────────────────────────────────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │   Fusion + Scoring     │
                    │  (Next.js, client-side)│
                    │                        │
                    │  Tiered scoring from   │
                    │  gaze + HRV + EDA +    │
                    │  stillness             │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │ Ambient Agent + Calls  │
                    │ + Focus Mode Actions   │
                    └────────────────────────┘
```

## Components

### 1. Watch App (`watch-app/`)
- **Platform**: Wear OS (Galaxy Watch 8 target)
- **Protocol**: Watch is a WebSocket client to relay `/watch`
- **Data**: HR, IBI, EDA, PPG, accelerometer batches

### 2. Relay + Sensor Fusion (`server/watch-relay.ts`, `server/sensor-fusion/`)
- Receives watch data on `/watch`
- Fans out to browser/agent clients on `/browser`
- Persists batches to SQLite for downstream analysis

### 3. Dashboard + Flow Scoring (`src/`)
- MediaPipe eye tracking in-browser
- Personal-baseline scoring with EMA smoothing
- Automatic tier fallback when sensors disconnect

### 4. Ambient Agent (`server/ambient-agent/`)
- Detects flow, stress, and recovery patterns
- Uses context gating before interventions
- Can trigger Focus Mode, notifications, or voice-call pathways

### 5. Calling + Memory (`server/calling/`)
- Twilio + Hume voice call orchestration
- Lightweight memory layer with theme-based recall and decay

## Data Paths

- **Live path**: `Watch App -> Relay (/watch) -> Browser/Agent (/browser)`
- **Storage path**: `Relay -> SQLite (sensor-fusion DB)`
- **Intervention path**: `Ambient Agent -> Focus/Push/Call service`
