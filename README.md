# Flow Detector

Flow Detector is a multi-sensor system for detecting and protecting deep work states.
It combines webcam eye-tracking with Galaxy Watch biometrics, then uses an ambient agent
to decide when to stay silent, protect focus, or nudge recovery.

## What It Includes

- `src/` — Next.js dashboard and browser-side sensor processing
- `server/watch-relay.ts` — Watch-to-browser WebSocket relay and sensor fusion storage
- `server/ambient-agent/` — Sensor-triggered intervention logic
- `server/calling/` — Voice call service and memory layer
- `watch-app/` — Wear OS app for Galaxy Watch streaming

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the web app:
   ```bash
   npm run dev
   ```
3. Start the watch relay:
   ```bash
   npm run watch-server
   ```
4. (Optional) Start the ambient agent:
   ```bash
   npm run agent:start
   ```

## Common Commands

- `npm run dev` — Run dashboard locally
- `npm run watch-server` — Run watch relay on port `8765`
- `npm run agent:start` — Start ambient agent loop
- `npm run call-service` — Start voice call backend
- `npx tsx src/lib/biometrics/flow-calculator.test.ts` — Run biometrics test suite

## Documentation

- `docs/README.md` — Documentation map and current-vs-archived status
- `docs/architecture.md` — Current system architecture
- `docs/FEATURE_INVENTORY.md` — Feature-by-feature implementation inventory
- `server/calling/SETUP.md` — Call service setup (Twilio + Hume)
- `STANDARDS.md` — Coding and verification standards
