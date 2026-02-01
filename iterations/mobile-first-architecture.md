# Mobile-First Architecture Iteration

**Status:** Ready for testing
**Created:** 2026-02-01
**Plan Agent ID:** ae7cf06 (can resume for follow-up questions)

## Decision

**Option B: 30-second batching** — best balance of data savings vs. complexity for felt-experience demo.

## Architecture

```
Watch (30s batches) → Tailscale VPN → Server → Ambient Agent → Push/Call to phone
```

## Data Comparison

| Approach | Data/Day |
|----------|----------|
| Current 1Hz | ~3-5 MB |
| 30s batches | ~200 KB |

## Implementation Tasks

### 1. Watch App (Kotlin) — ~4 hours
- [x] Add 30-second circular buffer in `SensorService.kt`
- [x] Port RMSSD calculation to Kotlin (from `hrv-calculator.ts`)
- [x] Add `BatchMessage` data class in `MessageSerializer.kt`
- [x] Timer-based flush every 30 seconds
- [ ] Reconnect replay (buffer batches if disconnected)

**Files:**
- `watch-app/app/src/main/kotlin/com/flowdetector/watch/SensorService.kt`
- `watch-app/app/src/main/kotlin/com/flowdetector/watch/MessageSerializer.kt`

### 2. Server Setup — ~30 min
- [ ] Install Tailscale on server
- [ ] Configure stable address (e.g., `server.tailnet.ts.net:8765`)
- [ ] Update watch app to use Tailscale address

### 3. Relay Server Update — ~1 hour
- [x] Handle new `batch` message type in `watch-relay.ts`
- [x] Forward batches to browsers/agent

**Files:**
- `server/watch-relay.ts`

### 4. Ambient Agent Update — ~2 hours
- [x] Process batch messages instead of individual samples
- [x] Update `hrHistory` and `hrvHistory` from batch aggregates
- [x] Detectors already work with windowed data (minimal changes)

**Files:**
- `server/ambient-agent/agent.ts`
- `server/ambient-agent/types.ts`

### 5. Push Notifications — ~2 hours
- [x] Add ntfy.sh or Firebase integration
- [x] Replace osascript notifications with push
- [ ] Test delivery to phone

**Files:**
- `server/ambient-agent/interventions.ts`

## Batch Message Protocol

```typescript
interface BatchMessage {
  type: "batch";
  windowMs: 30000;
  hr: { mean: number; min: number; max: number; samples: number };
  hrv: { rmssd: number; sdnn: number };
  eda: { meanScl: number; peakScl: number };
  timestamp: number;
}
```

## What's Skipped (Future)

- Phone companion app (BLE relay)
- On-watch detection
- Complex offline buffering
- Binary protocol compression

## Resume Command

```
Resume mobile-first architecture build — see iterations/mobile-first-architecture.md
```
