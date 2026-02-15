# Biometric Agent Skill

Receives sensor context and decides whether to intervene.

## Input Format

```json
{
  "type": "intervention_decision",
  "sensors": {
    "hr": 72,
    "hrv": 45.2,
    "scl": 3.5,
    "watchConnected": true
  },
  "baseline": {
    "restingHR": 65,
    "baselineHRV": 52.0,
    "hrDeviation": "+11%",
    "hrvDeviation": "-13%"
  },
  "detections": {
    "flow": { "inFlowMode": false, "stableMinutes": 35 },
    "stress": { "isElevated": true, "elevatedMinutes": 18, "checkinOfferedToday": false },
    "recovery": { "recoveryDetected": false, "reflectionOfferedToday": false },
    "energy": "normal"
  },
  "agentState": {
    "time": "14:30 Tue",
    "dayPart": "afternoon_work",
    "interventionsToday": 0,
    "maxInterventions": 2,
    "lastInterventionHoursAgo": null,
    "warmthLevel": "warm"
  }
}
```

## Output Format

```json
{
  "shouldIntervene": true,
  "actions": [
    { "type": "send_haptic", "pattern": "gentle" },
    { "type": "send_push", "message": "Noticing some tension. Walk and talk?", "priority": "default" }
  ],
  "reasoning": "Sustained stress pattern (18min elevated HR, suppressed HRV) during afternoon work"
}
```

## Action Types

| Type | Weight | Description |
|------|--------|-------------|
| `no_action` | None | Explicitly do nothing |
| `enable_focus_mode` | Light | Enable macOS Focus Mode silently |
| `disable_focus_mode` | Light | Disable Focus Mode |
| `send_haptic` | Light | Gentle watch vibration |
| `send_push` | Medium | Push notification to phone |
| `trigger_call` | Heavy | Phone call check-in (use sparingly) |
| `send_reflection` | Medium | Evening reflection prompts |

## Decision Rules

1. **Flow detected** (stableMinutes >= 30, low HR variance):
   - `enable_focus_mode` — always appropriate
   - Optionally `send_push` with silent priority confirming flow protection
   - NEVER interrupt flow with heavier actions

2. **Stress detected** (elevated HR + suppressed HRV, sustained 15+ min):
   - `send_haptic` (gentle) + `send_push` with check-in message
   - `trigger_call` ONLY if elevated 30+ minutes AND no recent intervention
   - Never diagnose — "Noticing some tension" not "You're stressed"

3. **Recovery detected** (evening, HR below baseline, HRV above baseline):
   - `send_reflection` with gentle prompt
   - Only once per day

4. **Low energy** (HR low, HRV high, afternoon):
   - Usually `no_action` — rest is healthy
   - Mild push at most if very prolonged

## Skip Conditions (output `shouldIntervene: false`)

- Watch not connected
- interventionsToday >= maxInterventions
- lastInterventionHoursAgo < 2
- dayPart is "night" or "lunch"
- No baseline established (baseline is null)
- Low confidence in pattern (stableMinutes < 25 for flow, elevatedMinutes < 12 for stress)
- Checkin already offered today (for stress)
- Reflection already offered today (for recovery)
