# BLE HRM Integration — Requirements Document

## Summary

Integrate the Decathlon HRM armband (optical PPG, upper-arm) into the flow detector via the browser Web Bluetooth API. The armband broadcasts standard BLE Heart Rate Service (UUID 0x180D) with RR-interval data included in the Heart Rate Measurement characteristic (UUID 0x2A37). This gives us real IBI data for HRV calculation — the missing piece for the flow formula.

## Hardware

- **Device**: Decathlon HRM Band (optical armband, BLE + ANT+)
- **Verified**: RR-interval flag is set in BLE packets (confirmed via nRF Connect)
- **Placement**: Upper arm (bicep) — better PPG signal than wrist due to richer vasculature
- **Protocol**: Standard Bluetooth Heart Rate Service, no proprietary SDK needed

## Architecture

```
Decathlon HRM Band (BLE)
        │
        │  Web Bluetooth API (Chrome)
        ▼
┌──────────────────────┐
│  use-ble-hrm.ts      │  ← NEW HOOK
│  (connect, parse RR) │
└──────────┬───────────┘
           │  { heartRate, ibi, timestamp }
           ▼
┌──────────────────────┐
│  HRVCalculator       │  ← EXISTING (src/lib/biometrics/hrv-calculator.ts)
│  addIBI(ibi, ts)     │
│  → RMSSD, SDNN       │
└──────────┬───────────┘
           │  HRVMetrics
           ▼
┌──────────────────────┐
│  FlowCalculator      │  ← EXISTING (src/lib/biometrics/flow-calculator.ts)
│  Enable HRV scoring  │
│  (currently disabled) │
└──────────────────────┘
```

No external bridge process. No WebSocket server. The browser connects directly to the armband via Web Bluetooth, keeping everything client-side like the existing eye tracking and Pulsoid hooks.

## Deliverables

### 1. New Hook: `src/hooks/use-ble-hrm.ts`

**Responsibilities:**
- Request BLE device filtered by Heart Rate Service (0x180D)
- Connect to GATT server, get Heart Rate Measurement characteristic (0x2A37)
- Subscribe to notifications
- Parse each packet per Bluetooth SIG spec:
  - Byte 0: Flags (HR format, contact status, RR-interval presence)
  - Bytes 1-2: Heart rate (uint8 or uint16 depending on flag)
  - Remaining bytes: RR-interval values as uint16 in 1/1024s units (convert to ms)
  - A single packet may contain multiple RR intervals
- Feed each RR interval into HRVCalculator via `addIBI()`
- Expose connection state, heart rate, latest IBI, and HRV metrics to consuming components

**Interface:**
```typescript
interface BleHrmState {
  isConnected: boolean;
  isConnecting: boolean;
  deviceName: string | null;
  heartRate: number | null;
  latestIBI: number | null;       // ms
  hrvMetrics: HRVMetrics | null;  // { rmssd, sdnn, sampleCount, timestamp }
  error: string | null;
}

interface UseBleHrmReturn extends BleHrmState {
  connect: () => Promise<void>;   // triggers Web Bluetooth device picker
  disconnect: () => void;
}
```

**BLE Packet Parsing (Heart Rate Measurement 0x2A37):**
```
Flags byte (bit field):
  Bit 0: HR format (0 = uint8, 1 = uint16)
  Bit 1-2: Sensor contact status
  Bit 3: Energy expended present
  Bit 4: RR-interval present  ← THIS IS THE KEY BIT

Data layout:
  [flags][hr_value][energy_expended?][rr_interval_1][rr_interval_2]...

RR intervals:
  - uint16, units of 1/1024 seconds
  - Convert to ms: (value / 1024) * 1000
  - Multiple RR intervals per packet possible (parse until end of buffer)
```

### 2. Wire Into page.tsx

- Add `useBleHrm()` hook call alongside existing `usePulsoid()`
- Add a "Connect HRM" button to the UI (triggers Web Bluetooth picker)
- Show connection status, current HR, and HRV metrics
- Pass HRV metrics into `calculateCombinedFlow()`

### 3. Enable HRV Scoring in Flow Calculator

Currently at `flow-calculator.ts` ~line 294, there's a placeholder:
```typescript
if (hasWatchData && hrvMetrics) {
  const hrvComponent = 0; // Placeholder
}
```

Enable this path:
- Define HRV scoring function (similar to existing Gaussian/sigmoid curves for eye metrics)
- HRV "Goldilocks zone": moderate RMSSD relative to personal baseline (not too low = stress, not too high = relaxation)
- Add HRV to calibration working baseline capture (collect RMSSD samples during the 30s reading period)
- Adjust component weights when HRV is available (e.g., gaze 0.35, blink 0.30, EAR 0.10, HRV 0.25)

### 4. HRV Calibration Extension

Extend the working baseline calibration (step 4) to also capture HRV baseline:
- During the 30s reading period, if BLE HRM is connected, collect RMSSD values
- Store `hrvBaselineMean` and `hrvBaselineStdDev` in CalibrationData
- These become the reference for z-score normalization of HRV during flow detection
- Calibration should still work without HRM connected (eye-only mode remains valid)

## BLE Packet Parsing Reference

The Heart Rate Measurement characteristic (0x2A37) format per Bluetooth SIG:

```
Byte 0 — Flags:
  Bit 0:   Heart Rate Value Format (0=UINT8, 1=UINT16)
  Bit 1-2: Sensor Contact Status
  Bit 3:   Energy Expended Status (0=not present, 1=present)
  Bit 4:   RR-Interval (0=not present, 1=one or more present)
  Bit 5-7: Reserved

Remaining bytes (sequential):
  Heart Rate Value:  1 byte (UINT8) or 2 bytes (UINT16) per flags bit 0
  Energy Expended:   2 bytes (UINT16) if flags bit 3 is set
  RR-Intervals:      2 bytes each (UINT16), repeat until end of packet
                     Units: 1/1024 seconds
                     Convert: rr_ms = (raw_value / 1024) * 1000
```

## Constraints

- **Web Bluetooth requires HTTPS or localhost** — already satisfied in dev (Next.js runs on localhost)
- **Web Bluetooth requires user gesture** — the connect() function must be called from a button click handler, not on page load
- **Chrome only** — Web Bluetooth is not supported in Firefox or Safari. Chrome on macOS works.
- **One connection at a time** — Web Bluetooth connects to one device per service request
- **HRVCalculator needs ~10 IBI samples** before producing metrics (built-in minimum in existing code)

## Testing Plan

1. **Unit**: Parse a sample BLE Heart Rate Measurement buffer with known RR intervals, verify correct extraction and ms conversion
2. **Integration**: Connect to Decathlon armband, verify HR and RR data flows into HRVCalculator, verify RMSSD/SDNN output
3. **End-to-end**: Run full flow detection with eye tracking + HRM, verify combined score incorporates HRV component
4. **Graceful degradation**: Verify flow detection still works in eye-only mode when HRM is not connected
5. **Reconnection**: Verify the hook handles disconnection cleanly and allows reconnection

## Files to Create

- `src/hooks/use-ble-hrm.ts` — New BLE heart rate monitor hook

## Files to Modify

- `src/app/page.tsx` — Add BLE HRM hook, connect button, display HRV metrics
- `src/lib/biometrics/flow-calculator.ts` — Enable HRV scoring path, add HRV weight
- `src/lib/calibration/types.ts` — Add optional HRV baseline fields to CalibrationData
- `src/lib/calibration/processor.ts` — Compute HRV baseline stats during working baseline
- `src/hooks/use-calibration.ts` — Accept and accumulate HRV samples during step 4
- `CLAUDE.md` — Update current focus, architecture diagram, file structure

## Out of Scope

- Pulsoid removal (keep as fallback HR source)
- use-sensor-server.ts changes (keep for future Galaxy Watch app if Samsung opens up)
- Mac Focus Mode integration (Phase 4)
- Mudra Link integration (low priority)
