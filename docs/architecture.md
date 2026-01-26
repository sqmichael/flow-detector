# Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Galaxy Watch 7 │     │   Mudra Link    │     │ MacBook Webcam  │
│   (HR / HRV)    │     │ (Neural/SNC)    │     │  (Eye Tracking) │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │ WebSocket             │ WebSocket             │ Local
         │ (SensorServer)        │ (Custom Relay)        │ (MediaPipe)
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌────────────────────────┐
                    │     Fusion Hub         │
                    │  (React + Socket.io)   │
                    │                        │
                    │  Flow = (HRV × Rhythm) │
                    │         - Blinks       │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │   Mac Focus Mode       │
                    │  (node-applescript)    │
                    └────────────────────────┘
```

## Data Sources

### 1. Galaxy Watch 7 (via SensorServer)
- **Tool**: SensorServer app on Z Flip
- **Protocol**: WebSocket server on phone
- **Data**: Heart Rate, IBI (Inter-Beat Interval) for HRV
- **Access**: Samsung Health Data SDK (Privileged Access on Z Flip)

### 2. Mudra Link (Neural)
- **Repo**: Mudra Android App Example
- **Interface**: MudraDelegate
- **Data**: Surface Neural Conductance (SNC) for intent detection
- **Method**: Add WebSocket.send() to forward data to MacBook

### 3. MacBook Webcam (Eye Tracking)
- **Tool**: MediaPipe Face Landmarker (WASM)
- **Data**: 478 3D face landmarks
- **Key Landmarks**: 159 (Upper Eyelid), 145 (Lower Eyelid)
- **Metric**: Eye Aspect Ratio → Blink Rate

### 4. Fusion Hub
- **Stack**: React + Socket.io (Node.js)
- **Role**: Traffic controller for all sensor streams
- **Output**: Flow Score + Focus Mode trigger

## Flow Formula

```
Flow = (HRV × Rhythm) - Blinks
```
- **HRV**: Heart Rate Variability from watch IBI data
- **Rhythm**: Derived from neural SNC patterns (Mudra)
- **Blinks**: Blink rate from eye tracking (MediaPipe)
