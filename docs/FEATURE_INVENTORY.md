# Flow Detector — Feature Inventory

> Last updated: 2026-02-04

A comprehensive inventory of all designed and implemented features in the Flow Detector system.

---

## Overview

Flow Detector is a multi-sensor flow state detection system that combines:
- **Biometrics** (HR/HRV/EDA from Galaxy Watch)
- **Eye tracking** (MediaPipe via webcam)
- **Neural signals** (Mudra Link — planned)

The system detects and protects deep work states through sensor-triggered interventions.

---

## 1. Data Acquisition

### 1.1 Galaxy Watch 8 Integration
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete (end-to-end verified) |
| **Platform** | Wear OS 4+ with Samsung Health Sensor SDK |
| **Key Files** | `watch-app/app/src/main/kotlin/com/flowdetector/watch/` |

**Sensors Streamed:**
- Heart Rate (HR) + Inter-Beat Intervals (IBI) at 1 Hz
- Electrodermal Activity (EDA/SCL) at 1 Hz in microsiemens
- Photoplethysmography (PPG) raw channels at ~25 Hz
- Accelerometer (x/y/z) at ~50 Hz for stillness detection

**Features:**
- Exponential backoff reconnection (1s → 2s → 4s → 30s max)
- 30-second batch aggregation (RMSSD/SDNN calculated on-watch)
- IP address persistence (SharedPreferences)
- Foreground service for background streaming
- Compose UI with HR display, connection status, IP input

### 1.2 Watch Relay Server
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Port** | 8765 (binds 0.0.0.0 for LAN access) |
| **Key Files** | `server/watch-relay.ts`, `server/sensor-fusion/` |

**Paths:**
- `/watch` — accepts one Galaxy Watch connection
- `/browser` — fan-out to all connected browser clients

**Features:**
- Watch status messages (connected/disconnected with device name)
- Sensor fusion database (SQLite) for batch storage
- HTTP REST API endpoints for data retrieval
- Verbose logging mode (`--verbose`)

### 1.3 Eye Tracking (MediaPipe)
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `src/lib/mediapipe/`, `src/hooks/use-eye-tracking.ts` |

**Metrics Calculated:**
- Eye Aspect Ratio (EAR) for blink detection
- Blink rate and timing
- Gaze vector and stability scoring
- 478 3D face landmarks (processed locally, no cloud)

**Features:**
- 5-second aggregation windows
- Cold-start blink rate fix (blends with baseline first 30s)
- Gaze stability via variance calculation

### 1.4 BLE Heart Rate Monitor
| Aspect | Details |
|--------|---------|
| **Status** | ⏸️ Dormant (kept as fallback) |
| **Key Files** | `src/hooks/use-ble-hrm.ts` |

Web Bluetooth API integration for standard HRM devices. Not imported by dashboard — Galaxy Watch provides richer data.

### 1.5 Pulsoid Cloud Integration
| Aspect | Details |
|--------|---------|
| **Status** | ⏸️ Dormant (kept as fallback) |
| **Key Files** | `src/hooks/use-pulsoid.ts` |

Pulsoid WebSocket API for heart rate. Not imported — no IBI data available.

### 1.6 Mudra Link Neural Signals
| Aspect | Details |
|--------|---------|
| **Status** | 🔜 Planned (low priority) |

Surface Neural Conductance (SNC) for intent detection. Would require custom integration with Mudra Android app.

---

## 2. Calibration System

### 2.1 4-Step Personal Baseline Calibration
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `src/lib/calibration/`, `src/hooks/use-calibration.ts`, `src/components/calibration/` |

**Steps:**
1. **Baseline (3s)** — Look at camera → captures open-eye EAR
2. **Blink (5x)** — Blink naturally → captures closed-eye EAR and timing
3. **Gaze Center (3s)** — Look at dot → captures personal gaze center
4. **Working Baseline (30s)** — Read text naturally → captures:
   - Blink rate (mean/stdDev)
   - Gaze stability (mean/stdDev)
   - EAR distribution (mean/stdDev)
   - Optional: RMSSD baseline (if watch connected)
   - Optional: SCL baseline (if EDA streaming)

**Storage:** LocalStorage v3 schema with auto-migration from v1/v2. EDA/HRV baselines require minimum ~15 seconds of data.

---

## 3. Flow Detection Algorithm

### 3.1 Z-Score Flow Scoring
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete (25+ unit tests) |
| **Key Files** | `src/lib/biometrics/flow-calculator.ts`, `flow-calculator.test.ts` |

**Scoring Functions:**

| Signal | Curve | Center | Notes |
|--------|-------|--------|-------|
| Blink Rate | Gaussian | z=-1.5 | Optimal is ~1.5 std below baseline; strain penalty at very low rates |
| Gaze Stability | Sigmoid | — | Higher = better, no peak |
| EAR | Gaussian | z=0 | Comfortable at baseline |
| HRV (RMSSD) | Gaussian | z=-0.5 | Engaged but calm; width=1.2 (accounts for noise) |
| EDA (SCL) | Gaussian | z=0 | Moderate arousal; fallback to absolute thresholds if no baseline |
| Stillness | Linear | — | Higher stillness = better; multiplicative motion quality (0.5-0.95) |

### 3.2 Four-Tier Adaptive Weighting
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |

Automatic weight adjustment based on available sensors:

| Signal | Eye-Only | Eye+HRV | Eye+HRV+EDA | Eye+HRV+EDA+Stillness |
|--------|----------|---------|-------------|----------------------|
| Gaze stability | 0.45 | 0.35 | 0.30 | 0.25 |
| Blink rate | 0.40 | 0.30 | 0.25 | 0.20 |
| EAR | 0.15 | 0.10 | 0.10 | 0.08 |
| HRV (RMSSD) | — | 0.25 | 0.20 | 0.17 |
| EDA (SCL) | — | — | 0.15 | 0.12 |
| Stillness | — | — | — | 0.18 |
| Motion Quality | — | — | — | ×(0.5-0.95) |

### 3.3 Temporal Smoothing
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |

EMA with alpha=0.15 prevents score flickering (~100s stabilization time).

### 3.4 Flow Confirmation Logic
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |

Score must stay above 0.65 threshold for 2+ minutes before `inFlow` flag is set. Dropping below threshold resets the onset timer.

### 3.5 HRV Calculation
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `src/lib/biometrics/hrv-calculator.ts` |

- **RMSSD**: Root Mean Square of Successive Differences (parasympathetic)
- **SDNN**: Standard Deviation of NN intervals (overall variability)
- 60-second sliding window client-side; 30-second on watch

### 3.6 Graceful Degradation
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |

Immediate tier drop-back when sensors disconnect mid-session.

---

## 4. Ambient Agent (Intervention Engine)

### 4.1 Core Agent
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `server/ambient-agent/agent.ts`, `types.ts`, `cli.ts` |

Server-side sensor-triggered intervention system with three core behaviors.

### 4.2 Behavior A: Flow Protection
| Aspect | Details |
|--------|---------|
| **Trigger** | 30 min stable HR + stillness |
| **Action** | Enable Mac Focus Mode, silence interruptions |
| **Rate Limit** | Max 1 haptic/hour while in flow |

### 4.3 Behavior B: Proactive Check-in
| Aspect | Details |
|--------|---------|
| **Trigger** | Elevated HR (>10 bpm above baseline) + suppressed HRV (<70% baseline) for 15+ min |
| **Action** | Offer brief check-in call |

### 4.4 Behavior C: Evening Reflection
| Aspect | Details |
|--------|---------|
| **Trigger** | Recovery state (HRV >120% baseline, HR <5 bpm below baseline) during 6-10 PM window |
| **Action** | Offer reflection prompt |

### 4.5 Low Energy Detection
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete (silent logging only) |
| **Key Files** | `server/ambient-agent/detectors.ts` |

**Pattern:**
- HR < 60 bpm during active hours (8am-6pm)
- HRV < 50ms (low, not crashed)
- EDA < 0.5 µS (flat, no arousal)

Returns confidence level (low/medium/high). For long-term analysis, not intervention.

### 4.6 LLM Reasoning Layer
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `server/ambient-agent/reasoning.ts` |

DeepSeek judges intervention timing before delivery. Considers sensor context + memory layer data.

### 4.7 Intervention Delivery
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `server/ambient-agent/interventions.ts` |

**Channels:**
- Mac Focus Mode (osascript)
- Watch Haptics (WebSocket command)
- Push Notifications (ntfy.sh with rating buttons)
- Phone Calls (webhook to call-service)

### 4.8 Rating System
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `server/ambient-agent/rating-server.ts` |

**Metrics:**
- Well-timed (1-5)
- Helped regulation (1-5)
- Felt intrusive (1-5)
- Want again tomorrow (boolean)

### 4.9 CLI Interface
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `server/ambient-agent/cli.ts` |

**Commands:**
- `start` — Begin ambient agent
- `rate` — Submit intervention ratings
- `compare` — Compare felt-experience between conditions
- `fixed` — Run control condition (no interventions)

---

## 5. Memory Layer

### 5.1 SQLite Database
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `server/calling/memory/db.ts`, `service.ts`, `types.ts` |

**Schema:**
- **Themes**: Topic extraction (theme, context, last_mentioned, expires)
- **Preferences**: User preferences ("walks help after calls")
- **User State**: Warmth, interest level, onboarding status, ripcord count

### 5.2 Theme Extraction
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `server/calling/memory/theme-extractor.ts` |

DeepSeek extracts topics from call transcripts (not emotions/metrics). 4-week activity-based decay.

### 5.3 Warmth Evolution
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |

**Levels (0-3):**
- 0: Onboarding — First-time introduction
- 1: Crisp — After first successful call
- 2: Familiar — Building history
- 3: Trusted — Deep relationship

**Triggers:** Successful call (+0.1), explicit thanks (+0.2), first interaction (+0.1)

### 5.4 Voice Commands
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `server/calling/memory/commands.ts` |

- `remember` — Save statement to memory
- `forget` — Remove theme
- `query` — Recall relevant themes
- `ripcord` — "gotta go", "not now"

### 5.5 Interest Level Tracking
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |

**Levels (0-3):**
- 0: Normal
- 1: Curious (active within 1 week)
- 2: Attentive (active within 2 weeks)
- 3: Gentle Concern (4+ weeks since engagement)

### 5.6 Ripcord Detection
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `server/calling/call-service.ts` |

**Logic:**
- <10s call → technical failure (ignore)
- 10-30s → implicit ripcord
- 30-60s → check transcript for phrases
- 60s+ → likely intentional conversation

**Phrases:** "dismiss", "not now", "stop", "bad timing", "gotta go", "let me go"

---

## 6. Phone Call Service

### 6.1 Twilio + Hume EVI Integration
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `server/calling/call-service.ts`, `hume-config.json` |

Express server (port 8766) with endpoints:
- `/call/trigger` — Intervention calls
- `/call/onboarding` — First-time introduction

### 6.2 Dynamic Prompt Injection
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `server/calling/memory/hume-integration.ts` |

Memory context fed to Hume system prompt:
- Active themes
- User preferences
- Warmth level with tone adjustment
- Interest level
- Last successful engagement

### 6.3 Onboarding Call Script
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |

Structured first-time introduction (<3 min):
1. Opening: "Hi Michael, this is Kai..."
2. Explain role and frequency
3. Set privacy expectations
4. Give user control
5. Closing

### 6.4 Call Outcome Detection
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |

**Outcomes:**
- Successful (60s+ with engagement)
- Ripcord (rejection)
- Technical Failure (<10s)
- Thankful (boosts warmth)

---

## 7. UI/Dashboard

### 7.1 Main Dashboard
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `src/app/page.tsx` |

**Features:**
- Camera stream with face detection status
- Eye tracking metrics (blink rate, gaze stability, EAR)
- Watch connection status (HR, HRV, EDA)
- Flow score visualization with confidence meter
- Real-time metrics history graph
- Calibration overlay integration
- Session download (JSONL)

### 7.2 Calibration Overlay
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `src/components/calibration/CalibrationOverlay.tsx` |

Interactive 4-step UI with progress indicators, real-time feedback, and instructions.

### 7.3 Flow End Prompt
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `src/components/FlowEndPrompt.tsx` |

Post-flow reflection capture when exiting flow state.

### 7.4 Biometric Logging
| Aspect | Details |
|--------|---------|
| **Status** | ✅ Complete |
| **Key Files** | `src/hooks/use-biometric-log.ts` |

IndexedDB storage with JSONL export, event counting, annotation system.

---

## 8. Testing

| Suite | Tests | Key Files |
|-------|-------|-----------|
| Flow Calculator | 25+ | `src/lib/biometrics/flow-calculator.test.ts` |
| Memory Service | 35+ | `server/calling/memory/service.test.ts` |
| Hume Integration | 15+ | `server/calling/memory/hume-integration.test.ts` |
| Watch App | Unit tests | `watch-app/.../MessageSerializerTest.kt` |

---

## 9. Documentation

| Document | Purpose | Location |
|----------|---------|----------|
| UX Principles | B1-B6 blocking violations | `docs/UX_PRINCIPLES.md` |
| Memory Layer Spec | Two-tier model, decay rules | `docs/MEMORY_LAYER_SPEC.md` |
| UX Agent Process | Dual-agent review | `docs/UX_AGENT.md` |
| Architecture | Data flow diagrams | `docs/architecture.md` |
| Code Orchestration | Task classification | `.claude/orchestrator/ORCHESTRATOR.md` |

---

## 10. Storage

| Store | Technology | Purpose |
|-------|------------|---------|
| Calibration | LocalStorage v3 | Personal baselines |
| Sensor Fusion | SQLite | Watch batch data, sessions |
| Memory Layer | SQLite | Themes, preferences, user state |
| Metrics | IndexedDB | High-volume real-time data |

---

## 11. Configuration

### Ambient Agent Config
```typescript
{
  flowDetection: {
    stillnessMinutes: 30,
    hrStabilityThreshold: 5,  // bpm variance
    maxHapticsPerHour: 1
  },
  stressDetection: {
    hrElevatedAboveBaseline: 10,  // bpm
    hrvSuppressedBelowBaseline: 0.7,  // ratio
    durationMinutes: 15
  },
  eveningReflection: {
    windowStartHour: 18,
    windowEndHour: 22,
    recoveryIndicators: {
      hrvAboveBaseline: 1.2,
      hrBelowBaseline: 5
    }
  },
  quietHours: {
    startHour: 22,
    endHour: 7,
    timezoneOffset: 8
  },
  maxInterventionsPerDay: 2
}
```

---

## Backlog

| Feature | Priority | Notes |
|---------|----------|-------|
| Mudra Link Neural Signals | Low | SNC for intent detection |
| Dynamic Sensor Context | Medium | Mood/time of day in prompts |

---

## Current Status

**Phase:** Ambient Agent Felt-Experience Prototype — Field Testing

**Next Steps:**
1. Run ambient agent for 5-8 days
2. Collect felt-experience ratings after each intervention
3. Compare sensor-triggered vs fixed (control) condition
4. Analyze which mode produces better timing
