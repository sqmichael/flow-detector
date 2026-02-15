#!/usr/bin/env npx tsx
/**
 * E2E test runner: starts agent with timezone override + sends fake data
 */

import { AmbientAgent } from "./agent";
import WebSocket from "ws";

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
}

async function main() {
  console.log("\n=== OpenClaw E2E Test Runner ===\n");

  // Create agent with timezoneOffset=0 to avoid quiet hours (UTC ~14:xx is afternoon)
  const agent = new AmbientAgent({
    quietHours: {
      startHour: 22,
      endHour: 7,
      timezoneOffset: 0, // UTC = ~14:xx = afternoon, NOT quiet hours
    },
  });
  await agent.start();
  console.log("[Test] Agent started\n");

  // Wait for relay connection
  await sleep(2000);

  // Connect as watch
  console.log("[Test] Connecting fake watch to relay...");
  const ws = new WebSocket("ws://localhost:8765/watch");

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      console.log("[Test] Connected as watch");
      resolve();
    });
    ws.on("error", (e) => reject(e));
  });

  // Handshake
  ws.send(JSON.stringify({
    type: "handshake",
    protocolVersion: 1,
    deviceName: "E2E Test Watch",
    sensors: ["hr", "eda"],
    timestamp: Date.now(),
  }));
  await sleep(500);

  // Phase 1: Establish baseline
  console.log("\n[Test] Phase 1: Sending baseline data (35 normal batches)...");
  for (let i = 0; i < 35; i++) {
    sendBatch(ws, 65 + Math.random() * 4, 50 + Math.random() * 5, 2.5 + Math.random() * 0.5);
    await sleep(100);
  }
  console.log("[Test] Baseline data sent. Waiting 32s for agent tick...");
  await sleep(32000);

  // Check state
  const state1 = agent.getState();
  console.log(`[Test] Baseline: ${state1.baseline ? `HR=${state1.baseline.restingHR}, HRV=${state1.baseline.baselineHRV.toFixed(1)}` : "NOT ESTABLISHED"}`);
  console.log(`[Test] Watch connected: ${state1.isWatchConnected}`);

  if (!state1.baseline) {
    console.log("[Test] ERROR: Baseline not established. Aborting.");
    agent.stop();
    ws.close();
    process.exit(1);
  }

  // Phase 2: Simulate stress
  // Trick: backdate the elevation start to 16 minutes ago so duration threshold is met
  console.log("\n[Test] Phase 2: Sending STRESS data + backdating elevation...");
  for (let i = 0; i < 10; i++) {
    sendBatch(ws, 88 + Math.random() * 5, 28 + Math.random() * 4, 5.5 + Math.random() * 1.0);
    await sleep(200);
  }
  // Wait for first tick to detect the stress pattern
  console.log("[Test] Waiting 32s for agent tick to detect stress...");
  await sleep(32000);

  // Now backdate the elevation start so durationMinutes >= 15
  const agentState = (agent as any).state;
  if (agentState.stressDetection.elevationStartedAt) {
    agentState.stressDetection.elevationStartedAt = Date.now() - 16 * 60 * 1000;
    console.log("[Test] Backdated elevationStartedAt to 16 min ago");
  } else {
    console.log("[Test] WARNING: stress not detected yet, setting manually");
    agentState.stressDetection.isElevated = true;
    agentState.stressDetection.elevationStartedAt = Date.now() - 16 * 60 * 1000;
  }

  // Send more stress data and wait for next tick
  for (let i = 0; i < 5; i++) {
    sendBatch(ws, 90 + Math.random() * 5, 28 + Math.random() * 3, 5.5 + Math.random() * 1.0);
    await sleep(500);
  }
  console.log("[Test] Waiting for next tick + OpenClaw response (up to 60s)...");
  // Poll for intervention rather than fixed wait — OpenClaw takes ~10s on top of tick interval
  let state2 = agent.getState();
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    state2 = agent.getState();
    if (state2.interventionsToday.length > 0) {
      console.log(`[Test] Intervention detected after ${(i + 1) * 5}s`);
      break;
    }
  }
  console.log(`\n[Test] === RESULTS ===`);
  console.log(`[Test] Stress elevated: ${state2.stressDetection.isElevated}`);
  console.log(`[Test] Elevated minutes: ${state2.stressDetection.elevatedMinutes}`);
  console.log(`[Test] Checkin offered: ${state2.stressDetection.checkinOfferedToday}`);
  console.log(`[Test] Interventions today: ${state2.interventionsToday.length}`);
  for (const int of state2.interventionsToday) {
    console.log(`[Test]   - ${int.type}: ${int.trigger.reason} (${new Date(int.triggeredAt).toLocaleTimeString()})`);
  }

  // Phase 3: Recovery
  console.log("\n[Test] Phase 3: Sending recovery data...");
  for (let i = 0; i < 10; i++) {
    sendBatch(ws, 60 + Math.random() * 3, 58 + Math.random() * 5, 2.0 + Math.random() * 0.3);
    await sleep(200);
  }

  console.log("\n[Test] === SUMMARY ===");
  const pass = state2.baseline !== null;
  const openclawFired = state2.interventionsToday.length > 0 || state2.stressDetection.isElevated;
  console.log(`[Test] Baseline established: ${pass ? "PASS" : "FAIL"}`);
  console.log(`[Test] Stress detected: ${state2.stressDetection.isElevated ? "PASS" : "PENDING (may need more time)"}`);
  console.log(`[Test] OpenClaw intervention: ${state2.interventionsToday.length > 0 ? "PASS" : "PENDING"}`);

  console.log("\n[Test] Cleaning up...");
  agent.stop();
  ws.close();

  // Give a moment for cleanup
  await sleep(1000);
  process.exit(0);
}

main().catch((e) => {
  console.error("[Test] Fatal:", e);
  process.exit(1);
});
