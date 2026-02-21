# Assumptions: Watch Disconnect Resilience

## User Context

| Field | Value |
|-------|-------|
| Who | Developer (Michael) running field tests with ambient agent |
| Environment | Galaxy Watch 8 on wrist, MacBook running relay + agent at desk |
| Today's solution | Watch reconnects via START_STICKY + backoff, but agent has no gap awareness |
| Frequency | Watch disconnects multiple times per day (Android Doze, Freecessor, low RAM) |
| Constraints | Can't prevent Android from killing processes; must handle it gracefully |

## Solution Assumptions

1. The watch app's START_STICKY + Room persistence already handles the watch side adequately
2. Most disconnects are 30s-5min (Android restarts foreground service relatively quickly)
3. Data older than 1 hour is not useful for real-time detection
4. 2 batches (~60s) is sufficient warm-up before resuming detection
5. Gap duration is the critical metric for field test analysis

## Riskiest Assumption

Assumption #1: The watch side is adequate. If Room loses data or START_STICKY fails on Samsung Wear OS, server-side fixes won't help.

## Validation Test

| Field | Value |
|-------|-------|
| Test | Kill watch app process manually, wait 2 min, verify pending batches survive and sync on reconnect |
| Pass | Batches saved pre-kill appear in relay log post-reconnect |
| Fail | Batches lost, or service doesn't restart within 60s |

## Result

UNTESTABLE in planning session — requires physical watch. Architecture is sound per code review.

## Unknowns Remaining

- Exact frequency/duration distribution of disconnects during field test
- Whether Samsung Freecessor respects Ongoing Activity API consistently
- Whether 100-batch sync cap causes data loss after long gaps (>50 min offline)
