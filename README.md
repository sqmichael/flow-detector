# Flow Detector

Flow Detector is a multi-sensor system for protecting deep work in real time.
It combines browser eye-tracking, Galaxy Watch biometrics, sensor fusion, and an ambient intervention agent that decides when to stay silent, protect focus, or suggest a reset.

## Table of Contents

- [System Overview](#system-overview)
- [Repository Layout](#repository-layout)
- [Core Features](#core-features)
- [Architecture and Data Flow](#architecture-and-data-flow)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Local Development Setup](#local-development-setup)
- [Running the System](#running-the-system)
- [API Endpoints](#api-endpoints)
- [Testing and Verification](#testing-and-verification)
- [Data, Logs, and Artifacts](#data-logs-and-artifacts)
- [Troubleshooting](#troubleshooting)
- [Security and Privacy Notes](#security-and-privacy-notes)
- [Documentation Index](#documentation-index)

## System Overview

Flow Detector has five main runtime pieces:

1. Wear OS watch app streams biometric batches over LAN WebSocket.
2. Relay server accepts watch data, fans it out to browser/agent clients, and stores batches in SQLite.
3. Next.js dashboard performs webcam-based eye tracking and publishes eye metrics.
4. Sensor fusion aligns watch and eye windows into time-aligned data.
5. Ambient agent evaluates flow/stress/recovery context and decides whether to intervene.

## Repository Layout

```text
.
├── src/                      # Next.js app (dashboard + browser-side processing)
│   ├── components/
│   ├── hooks/
│   └── lib/
├── server/
│   ├── watch-relay.ts        # WebSocket relay + HTTP API host
│   ├── sensor-fusion/        # SQLite schema, ingestion, fusion, routes
│   ├── ambient-agent/        # Detection engine + interventions + CLI
│   ├── calling/              # Twilio/Hume call service + memory layer
│   └── data/                 # Runtime DB/log artifacts
├── watch-app/                # Wear OS app project
├── docs/                     # Architecture, inventory, process docs
└── README.md
```

## Core Features

- Browser eye tracking (MediaPipe) with blink/gaze/stability signals
- Watch biometrics streaming (HR, HRV/IBI, EDA, accelerometer, optional PPG stats)
- SQLite-backed sensor-fusion pipeline with export/query routes
- Ambient agent modes:
  - Sensor-triggered mode (`start`)
  - Fixed-time mode (`fixed`) for comparison
  - Comparison/report workflows (`compare`, `report`)
- Context-aware disqualifiers:
  - Meetings (including pre-meeting suppression)
  - `focusTime` calendar blocks (protect focus mode)
  - `outOfOffice` blocks (suppress interventions)
  - Watch-quality hard gate:
    - `watchQuality.status == "bad"` suppresses interventions and treats biometrics as unreliable
    - HR/HRV/SCL are redacted from OpenClaw context while quality is bad
    - status surfaces show `Watch quality bad` instead of numeric readings
- Dynamic context injection for intervention reasoning:
  - sensor mood
  - time/day context
  - memory warmth + recent themes
  - previous intervention recency/rating
  - strict JSON action schema in OpenClaw decisions (`shouldIntervene`, `actions[]`, `reasoning`)
- Location persistence in watch batches:
  - `location_lat`
  - `location_lon`
  - `location_accuracy`
  - stale location invalidation in agent state
- Optional voice check-in path via Twilio + Hume EVI

## Architecture and Data Flow

```text
Galaxy Watch App
  -> ws://<host>:8765/watch
     watch-relay.ts
       -> SQLite (server/data/sensor-fusion.db)
       -> ws://<host>:8765/browser (fan-out to dashboard + agent)

Dashboard (Next.js, localhost:3000)
  -> POST /api/sensors/eye (via relay HTTP API)

Ambient Agent
  -> consumes fused + contextual signals
  -> suppresses or triggers intervention channels
     - Focus Mode
     - ntfy push + rating links
     - optional outbound voice call
```

## Tech Stack

- TypeScript across frontend and backend
- Next.js + React (dashboard)
- WebSocket (`ws`) for watch/browser relay
- Express for API surfaces
- SQLite (`better-sqlite3`) for sensor fusion and memory persistence
- MediaPipe for eye-tracking landmarks
- Optional: Twilio + Hume for call interventions

## Prerequisites

- Node.js 20+
- npm
- A webcam-enabled machine for dashboard eye tracking
- Galaxy Watch with the app from `watch-app/` installed (for live watch signals)
- Optional:
  - OpenRouter key for LLM fallback reasoning and memory theme extraction
  - Twilio + Hume credentials for call service

## Environment Variables

### Root / Agent Runtime

Set these in your shell or process manager:

```bash
# Important for local agent runs (default in code points to a production hostname)
RELAY_URL=ws://localhost:8765/browser

# Optional LLM fallback in reasoning.ts
OPENROUTER_API_KEY=...
LLM_MODEL=deepseek/deepseek-chat

# Optional intervention integrations
CALL_SERVICE_URL=http://localhost:8766
NTFY_TOPIC=flow-detector-x7k9m2
RATING_SERVER=http://localhost:8767
OPENCLAW_CONTEXT_WRITER=...
```

### Frontend (`.env.local`, optional)

```bash
NEXT_PUBLIC_CALL_SERVICE_PORT=8766
# or
NEXT_PUBLIC_CALL_SERVICE_URL=http://localhost:8766
```

### Call Service (`server/calling/.env`)

Required:

```bash
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+15551234567
HUME_API_KEY=...
HUME_CONFIG_ID=conf_...
USER_PHONE_NUMBER=+15557654321
```

Optional:

```bash
OPENROUTER_API_KEY=...   # memory theme extraction
CALL_SERVICE_PORT=8766
```

## Local Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start dashboard:
   ```bash
   npm run dev
   ```
3. Start watch relay (new terminal):
   ```bash
   npm run watch-server
   ```
4. Start ambient agent (new terminal, with local relay URL):
   ```bash
   RELAY_URL=ws://localhost:8765/browser npm run agent:start
   ```
5. Optional: start call service:
   ```bash
   npm run call-service
   ```

## Running the System

### Main Commands

- `npm run dev` - Next.js dashboard
- `npm run watch-server` - relay + sensor-fusion API on `:8765`
- `npm run agent:start` - sensor-triggered ambient agent mode
- `npm run agent:fixed` - fixed-time intervention mode
- `npm run agent:compare` - compare behavior modes
- `npm run agent -- --no-openclaw` - fallback reasoning path without OpenClaw
- `npm run call-service` - Twilio/Hume call backend
- `npm run relay:public` - relay plus `ngrok` tunnel

### Agent CLI Commands

`server/ambient-agent/cli.ts` supports:

- `start`
- `fixed`
- `status`
- `rate`
- `compare`
- `report`
- `--no-openclaw`
- `--daemon`

## API Endpoints

Served by `server/watch-relay.ts` under `/api`:

- `POST /api/sessions` - create session
- `GET /api/sessions` - list sessions
- `GET /api/sessions/:id` - session detail + stats
- `POST /api/sensors/eye` - ingest eye metrics
- `POST /api/sensors/watch` - ingest watch batch
- `POST /api/events` - ingest event marker
- `GET /api/fusion/time-aligned/:id` - query fused windows
- `POST /api/fusion/process/:id` - trigger fusion processing
- `GET /api/export/:id` - export session NDJSON
- `GET /api/health` - health check
- `POST /api/session/activate` - set active fusion session for watch storage

## Testing and Verification

### Fast Checks

- Lint:
  ```bash
  npm run lint
  ```
- Type-check:
  ```bash
  npx tsc --noEmit
  ```

### Targeted Tests

- Biometrics flow calculator:
  ```bash
  npx tsx src/lib/biometrics/flow-calculator.test.ts
  ```
- Ambient agent E2E harness:
  ```bash
  npx tsx server/ambient-agent/test-e2e.ts
  ```

### Operational Verification Checklist

- Watch relay accepts watch connection and shows browser clients connected
- Eye metrics and watch batches are stored for the active session
- Location columns are populated when watch location is available
- Agent suppresses during `focusTime` and `outOfOffice`
- Agent suppresses when watch quality is bad and does not use HR/HRV/SCL for inference
- Dynamic context appears in reasoning/intervention logs
- Fallback path works with `--no-openclaw`

## Data, Logs, and Artifacts

- Sensor-fusion DB: `server/data/sensor-fusion.db`
- Intervention logs: `server/data/intervention-log*.jsonl`
- Root-local temporary DB may appear during development: `sensor-fusion.db` (workspace artifact)

## Troubleshooting

- Agent cannot connect to relay:
  - Ensure relay is running: `npm run watch-server`
  - For local runs set `RELAY_URL=ws://localhost:8765/browser`
- Watch connected but no stored batches:
  - Confirm active session was set via `POST /api/session/activate`
- Call service exits at startup:
  - Missing required vars in `server/calling/.env`
- Push rating links do not work on phone:
  - Set `RATING_SERVER` to a reachable host (not localhost), or use Tailscale URL

## Security and Privacy Notes

- Do not commit any `.env` files or secrets
- Treat biometric and conversational data as sensitive
- Restrict external exposure of relay and call-service endpoints
- For outbound calls beyond personal testing, evaluate consent/compliance requirements

## Documentation Index

- `docs/README.md` - docs map
- `docs/architecture.md` - architecture diagram and path summary
- `docs/FEATURE_INVENTORY.md` - detailed implementation inventory
- `server/calling/SETUP.md` - call service setup walkthrough
- `STANDARDS.md` - coding and verification standards
- `docs/AGENTS.md` - build/review process rules
