# Watch Bridge Implementation Plan

Use this plan with Claude Code on your local Mac to implement the Samsung Galaxy Watch integration.

---

## Prerequisites

Before starting, ensure you have:

- [ ] Samsung Galaxy Watch 7 paired with Samsung Fold
- [ ] SensorServer app installed on Fold ([GitHub](https://github.com/umer0586/SensorServer))
- [ ] Both devices on same Wi-Fi as your Mac
- [ ] SensorServer running and showing its IP address (e.g., `192.168.1.x:8080`)
- [ ] flow-detector repo pulled locally with hooks

---

## Setup Commands

```bash
# 1. Pull the latest code with hooks
cd /Users/user/Documents/Code\ Repo/flow-detector
git fetch origin claude/setup-project-hooks-LTvBw
git checkout claude/setup-project-hooks-LTvBw

# 2. Verify hooks are present
ls -la .claude/
cat CLAUDE.md

# 3. Start Claude Code
claude
```

---

## Prompt to Give Claude

Copy and paste this entire prompt into your local Claude Code session:

```
Update CLAUDE.md - we're in Phase 1 (Plumbing), implementing the Watch Bridge.

Implement the Watch Bridge to receive HR/HRV data from Samsung Galaxy Watch via SensorServer.

## Architecture
- Galaxy Watch → Samsung Fold (SensorServer app) → WebSocket → MacBook (this app)
- SensorServer URL: ws://<fold-ip>:8080
- Combined flow formula: Flow = (HRV × GazeStability) - BlinkPenalty

## Tasks

### 1. Create biometrics types
Create `src/lib/biometrics/types.ts`:
- HeartRateData: { bpm: number, timestamp: number }
- IBIData: { ibi: number, timestamp: number }
- HRVMetrics: { rmssd: number, sdnn: number, timestamp: number }
- SensorServerMessage: { type: string, sensor: string, values: number[], timestamp: number }
- CombinedFlowMetrics: eye metrics + HRV metrics combined

### 2. Create HRV calculator
Create `src/lib/biometrics/hrv-calculator.ts`:
- calculateRMSSD(ibiHistory: number[]): number
- calculateSDNN(ibiHistory: number[]): number
- Use 60-second sliding window
- Add debug logging

### 3. Create SensorServer WebSocket hook
Create `src/hooks/use-sensor-server.ts`:
- useSensorServer(serverUrl: string | null) hook
- WebSocket connect/disconnect
- Parse HR and IBI data from SensorServer JSON format
- Maintain IBI history buffer (60 seconds)
- Calculate HRV on each new IBI
- Return: { isConnected, heartRate, hrv, error, connect, disconnect }

### 4. Create combined flow calculator
Create `src/lib/biometrics/flow-calculator.ts`:
- calculateCombinedFlow(eyeMetrics, hrvMetrics): number
- Normalize HRV (higher RMSSD = calmer = better for flow)
- Multiply by gaze stability (0-1)
- Subtract blink penalty
- Return 0-1 scale

### 5. Update UI
Modify `src/app/page.tsx`:
- Add IP address input field
- Add connect/disconnect button
- Show connection status indicator
- Display HR (BPM) and HRV (RMSSD)
- Show combined flow score when watch connected
- Fallback to eye-only flow when disconnected

## SensorServer JSON Format
{
  "type": "sensor_data",
  "sensor": "heart_rate",  // or "accelerometer", etc.
  "values": [72],
  "timestamp": 1234567890
}

## Testing
After implementation:
1. Run npm run dev
2. Open http://localhost:3000
3. Enter Fold's IP address shown in SensorServer
4. Click connect
5. Verify HR appears and updates
6. Verify HRV calculates after ~10 seconds of data
7. Verify combined flow score reflects both eye + heart data

Commit all changes when done.
```

---

## Expected Session Flow

```
You: [paste the prompt above]

Claude: [sees UserPromptSubmit hook reminder]
Claude: [updates CLAUDE.md Current Focus]
Claude: [creates todo list with 5 tasks]
Claude: [implements each task]
Claude: [tries to stop]

Stop Hook: [validates - blocks if issues]

Claude: [fixes any issues, commits]
Claude: [stops successfully]

You: [have working Watch Bridge code]
```

---

## Verification Checklist

After Claude finishes, verify:

- [ ] `src/lib/biometrics/types.ts` exists
- [ ] `src/lib/biometrics/hrv-calculator.ts` exists
- [ ] `src/lib/biometrics/flow-calculator.ts` exists
- [ ] `src/hooks/use-sensor-server.ts` exists
- [ ] `src/app/page.tsx` has IP input and connect button
- [ ] `npm run dev` works
- [ ] UI shows HR when connected to SensorServer
- [ ] All changes are committed

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Can't connect to SensorServer | Check Fold IP, ensure same Wi-Fi, check SensorServer is running |
| No HR data | Enable HR sensor in SensorServer app settings |
| HRV shows 0 | Wait 10+ seconds for enough IBI samples |
| Claude stops too early | Stop hook should block - check `.claude/settings.json` exists |

---

## Files Created by This Plan

```
src/
├── hooks/
│   ├── use-camera-stream.ts     (existing)
│   ├── use-eye-tracking.ts      (existing)
│   └── use-sensor-server.ts     (NEW)
├── lib/
│   ├── mediapipe/               (existing)
│   └── biometrics/
│       ├── types.ts             (NEW)
│       ├── hrv-calculator.ts    (NEW)
│       └── flow-calculator.ts   (NEW)
└── app/
    └── page.tsx                 (MODIFIED)
```
