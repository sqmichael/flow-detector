# Architecture: Watch Disconnect Resilience

## Context Diagram

```
Galaxy Watch 8 ──ws──▶ watch-relay.ts ──ws──▶ Browser / Agent consumers
                ◀─ping─
```

Android kills watch process → START_STICKY restarts → Room replays pending batches → OkHttp reconnects. Server side has no gap awareness — this feature adds it.

## Data Flow (Proposed)

```
Watch Disconnect
  ├─ Agent: log disconnect event, mark state = "disconnected"
  ... gap ...
Watch Reconnect
  ├─ Agent: log reconnect event with gap_duration_ms
  ├─ Agent: if gap > 5 min → clear history + invalidate baseline
  ├─ Agent: if gap > 5s → enter "warming_up" state
  ├─ Agent: discard backfill batches older than 1hr
  ├─ Agent: once 2 batches received → state = "connected", resume detection
```

## State Ownership

| State | Owner | Gap Behavior |
|-------|-------|-------------|
| Sensor data (HR/IBI/EDA) | Watch app (Room DB) | Survives process kill |
| HR/HRV history | Ambient agent (memory) | Clear after 5min gaps |
| Baseline | Ambient agent (memory) | Invalidate after 5min gaps |
| Gap events | Ambient agent (JSONL log) | Persisted for analysis |
| Connection state | Ambient agent (memory) | connected/disconnected/warming_up |

## Key Decisions

| Chose | Not | Why |
|-------|-----|-----|
| Clear history after 5min gap | Keep across all gaps | Stale pre-gap data misrepresents current state |
| 2-batch warm-up | Immediate resume | Brief burst shouldn't trigger against stale baselines |
| Gap events in same JSONL log | Separate file | Simpler; gap events are just another event type |
| Server-side only | Also fix browser | Agent is the field test bottleneck; browser has tier drop-back |
