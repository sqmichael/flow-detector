#!/usr/bin/env npx tsx
/**
 * End-to-end test for OpenClaw integration.
 * Sends fake sensor data through the relay to trigger interventions.
 *
 * Usage: npx tsx server/ambient-agent/test-e2e.ts
 * Requires: watch-relay running on port 8765
 */

import WebSocket from "ws";

const RELAY_URL = "ws://localhost:8765/watch";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sendBatch(ws: WebSocket, hr: number, hrv: number, scl: number) {
  const batch = {
    type: "batch",
    windowMs: 30000,
    hr: { mean: hr, min: hr - 3, max: hr + 3, samples: 30 },
    hrv: { rmssd: hrv, sdnn: hrv * 1.2 },
    eda: { meanScl: scl, peakScl: scl + 0.5 },
    timestamp: Date.now(),
  };
  ws.send(JSON.stringify(batch));
  console.log(`[Test] Sent batch: HR=${hr}, HRV=${hrv}, SCL=${scl}`);
}

async function main() {
  console.log("\n=== OpenClaw E2E Test ===\n");

  // Connect as watch to relay
  const ws = new WebSocket(RELAY_URL);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      console.log("[Test] Connected to relay as watch");
      resolve();
    });
    ws.on("error", (e) => reject(e));
  });

  // Send handshake
  ws.send(JSON.stringify({
    type: "handshake",
    protocolVersion: 1,
    deviceName: "Test Watch (E2E)",
    sensors: ["hr", "eda"],
    timestamp: Date.now(),
  }));

  console.log("[Test] Phase 1: Baseline establishment (sending 35 normal batches)...");
  // Send enough samples to establish baseline (~35 samples)
  for (let i = 0; i < 35; i++) {
    sendBatch(ws, 65 + Math.random() * 4, 50 + Math.random() * 5, 2.5 + Math.random() * 0.5);
    await sleep(200); // Fast — just filling history
  }
  console.log("[Test] Baseline data sent. Waiting 35s for agent to establish baseline + first tick...\n");
  await sleep(35000);

  console.log("[Test] Phase 2: Simulating stress pattern (elevated HR, suppressed HRV)...");
  // Send stress data — elevated HR, low HRV
  for (let i = 0; i < 20; i++) {
    sendBatch(ws, 90 + Math.random() * 5, 28 + Math.random() * 3, 5.0 + Math.random() * 1.0);
    await sleep(1500); // ~30s total, need sustained pattern
  }
  console.log("[Test] Stress data sent. Waiting 60s for agent detection tick + OpenClaw call...\n");
  await sleep(60000);

  console.log("[Test] Phase 3: Recovery (back to normal)...");
  for (let i = 0; i < 10; i++) {
    sendBatch(ws, 62 + Math.random() * 3, 55 + Math.random() * 5, 2.0 + Math.random() * 0.5);
    await sleep(500);
  }

  console.log("\n[Test] Done. Check agent logs for [OpenClaw] entries.");
  console.log("[Test] Expected: baseline established → stress detected → OpenClaw queried → actions executed\n");

  ws.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("[Test] Error:", e);
  process.exit(1);
});
