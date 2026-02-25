#!/usr/bin/env npx tsx
/**
 * End-to-end smoke test for dynamic context + location persistence.
 *
 * Verifies:
 * 1. Location fields in batch messages are persisted to SQLite
 * 2. Dynamic context fields (sensorMood, warmthLevel, etc.) appear in
 *    intervention-log.jsonl trigger data when an intervention fires
 * 3. The agent suppresses interventions during focusTime calendar events
 *    (verified manually — look for [DQ] Calendar Focus Time in agent logs)
 *
 * Prerequisites:
 *   - watch-relay running:  npm run watch-server
 *   - ambient agent running: npx tsx server/ambient-agent/cli.ts start --no-openclaw
 *
 * Usage: npx tsx server/ambient-agent/test-e2e.ts
 */

import WebSocket from "ws";
import { readFileSync, existsSync } from "fs";
import path from "path";
import Database from "better-sqlite3";

const RELAY_URL = "ws://localhost:8765/watch";
const RELAY_HTTP = "http://localhost:8765";
const LOG_PATH = path.resolve("./server/data/intervention-log.jsonl");
const DB_PATH = path.resolve("./server/data/sensor-fusion.db");

// Fake GPS coordinates (San Francisco, rounded to 2 decimal places)
const FAKE_LOCATION = { latitude: 37.78, longitude: -122.42, accuracy: 15 };

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Activate a session on the relay HTTP API so batches are persisted to SQLite */
async function activateSession(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${RELAY_HTTP}/api/session/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    });
    const json = (await res.json()) as { activated: boolean };
    return json.activated;
  } catch (err) {
    console.error("[Test] Could not activate session:", err);
    return false;
  }
}

/** Deactivate the session after test to avoid polluting future runs */
async function deactivateSession(): Promise<void> {
  try {
    await fetch(`${RELAY_HTTP}/api/session/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: null }),
    });
  } catch {
    // best-effort
  }
}

/** Send one 30-second batch with all sensor data + location */
function sendBatch(
  ws: WebSocket,
  hr: number,
  hrv: number,
  scl: number,
  withLocation = true
) {
  const batch = {
    type: "batch",
    windowMs: 30000,
    hr: { mean: hr, min: hr - 3, max: hr + 3, samples: 30 },
    hrv: { rmssd: hrv, sdnn: hrv * 1.2, samples: 30 },
    eda: { meanScl: scl, peakScl: scl + 0.5 },
    ...(withLocation ? { location: FAKE_LOCATION } : {}),
    timestamp: Date.now(),
  };
  ws.send(JSON.stringify(batch));
  const locStr = withLocation ? ` Loc=(${FAKE_LOCATION.latitude}, ${FAKE_LOCATION.longitude})` : "";
  console.log(`[Test] Sent batch: HR=${hr}, HRV=${hrv}, SCL=${scl}${locStr}`);
}

// ── Verification helpers ─────────────────────────────────────────────

/**
 * Verify location rows exist in SQLite for our test session.
 * Returns the count of rows with non-null location_lat.
 */
function verifyLocationInSQLite(sessionId: string): number {
  if (!existsSync(DB_PATH)) {
    console.log("[Verify] SQLite DB not found at", DB_PATH);
    return 0;
  }

  try {
    const db = new Database(DB_PATH, { readonly: true });
    const row = db
      .prepare(
        `SELECT COUNT(*) as count FROM watch_batches
         WHERE session_id = ? AND location_lat IS NOT NULL`
      )
      .get(sessionId) as { count: number };
    db.close();
    return row.count;
  } catch (err) {
    console.error("[Verify] SQLite query failed:", err);
    return 0;
  }
}

/**
 * Verify that the intervention log contains entries with dynamicContext fields.
 * Returns { found: bool, sampleEntry: object | null }
 */
function verifyDynamicContextInLog(): { found: boolean; sampleEntry: object | null } {
  if (!existsSync(LOG_PATH)) {
    console.log("[Verify] Intervention log not found at", LOG_PATH);
    return { found: false, sampleEntry: null };
  }

  try {
    const lines = readFileSync(LOG_PATH, "utf-8")
      .split("\n")
      .filter(Boolean);

    // Look for recent entries (within the last 2 hours)
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (typeof entry.triggeredAt === "number" && entry.triggeredAt > cutoff) {
          // Check for dynamicContext in trigger data or top-level
          const trigger = entry.trigger as Record<string, unknown> | undefined;
          const hasDynCtx =
            entry.dynamicContext !== undefined ||
            trigger?.dynamicContext !== undefined;
          if (hasDynCtx) {
            return { found: true, sampleEntry: entry };
          }
        }
      } catch {
        // skip malformed lines
      }
    }

    return { found: false, sampleEntry: null };
  } catch (err) {
    console.error("[Verify] Log read failed:", err);
    return { found: false, sampleEntry: null };
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== Dynamic Context + Location E2E Smoke Test ===\n");
  console.log("Prerequisites:");
  console.log("  - watch-relay running: npm run watch-server");
  console.log("  - ambient agent running: npx tsx server/ambient-agent/cli.ts start --no-openclaw");
  console.log("");

  // Generate a unique session ID for this test run
  const sessionId = `e2e-test-${Date.now()}`;
  console.log(`[Test] Session ID: ${sessionId}`);

  // 1. Activate session so batches are persisted to SQLite
  const activated = await activateSession(sessionId);
  console.log(`[Test] Session activation: ${activated ? "OK" : "FAILED (relay may not be running)"}`);

  // 2. Connect to relay as a fake watch
  const ws = new WebSocket(RELAY_URL);

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      console.log("[Test] Connected to relay as watch");
      resolve();
    });
    ws.on("error", (e) => {
      console.error("[Test] Connection failed:", e.message);
      console.error("[Test] Is the relay running? npm run watch-server");
      reject(e);
    });
  });

  // 3. Send handshake
  ws.send(JSON.stringify({
    type: "handshake",
    protocolVersion: 1,
    deviceName: "Test Watch (E2E)",
    sensors: ["hr", "eda", "location"],
    timestamp: Date.now(),
  }));

  // 4. Phase 1: Baseline establishment (normal sensors + location)
  console.log("\n[Test] Phase 1: Baseline establishment (35 normal batches with location)...");
  for (let i = 0; i < 35; i++) {
    sendBatch(ws, 65 + Math.random() * 4, 50 + Math.random() * 5, 2.5 + Math.random() * 0.5, true);
    await sleep(200);
  }
  console.log("[Test] Baseline data sent. Waiting 35s for agent to establish baseline + first tick...\n");
  await sleep(35000);

  // 5. Phase 2: Stress pattern (elevated HR, suppressed HRV, still with location)
  console.log("[Test] Phase 2: Simulating stress pattern (elevated HR, suppressed HRV + location)...");
  for (let i = 0; i < 20; i++) {
    sendBatch(ws, 90 + Math.random() * 5, 28 + Math.random() * 3, 5.0 + Math.random() * 1.0, true);
    await sleep(1500);
  }
  console.log("[Test] Stress data sent. Waiting 60s for agent detection tick...\n");
  await sleep(60000);

  // 6. Phase 3: Recovery (back to normal, no location — tests staleness logic)
  console.log("[Test] Phase 3: Recovery batches WITHOUT location (testing staleness clear)...");
  for (let i = 0; i < 10; i++) {
    sendBatch(ws, 62 + Math.random() * 3, 55 + Math.random() * 5, 2.0 + Math.random() * 0.5, false);
    await sleep(500);
  }

  // Wait 5+ minutes for location staleness to trigger
  console.log("[Test] Waiting 6 min for location staleness clear (>5min without location in batch)...");
  // Note: In practice, verify this by watching agent logs for:
  //   [Location] Stale location cleared (no update for >5min)

  console.log("\n=== Verification ===\n");

  // 7. Verify location in SQLite
  const locationCount = verifyLocationInSQLite(sessionId);
  const locationOk = locationCount > 0;
  console.log(`[Verify] Location rows in SQLite (session ${sessionId.slice(0, 20)}...): ${locationCount}`);
  console.log(`[Verify] Location persistence: ${locationOk ? "✓ PASS" : "✗ FAIL (check relay is running + session was activated)"}`);

  // 8. Verify dynamicContext in intervention log
  const { found: dynCtxFound, sampleEntry } = verifyDynamicContextInLog();
  console.log(`\n[Verify] DynamicContext in intervention log: ${dynCtxFound ? "✓ PASS" : "⚠ NOT FOUND (intervention may not have fired yet — check agent logs)"}`);
  if (sampleEntry) {
    console.log("[Verify] Sample entry with dynamicContext:", JSON.stringify(sampleEntry, null, 2).slice(0, 400) + "...");
  }

  // 9. Manual verification notes
  console.log("\n=== Manual Checks ===");
  console.log("After running this test, verify in agent logs:");
  console.log("  1. Baseline: '[Agent] Baseline established: HR=6X bpm, HRV=XXms'");
  console.log("  2. Location: '[Location] Stale location cleared (no update for >5min)'");
  console.log("  3. FocusTime: Add a 'focusTime' Google Calendar event, restart agent,");
  console.log("     look for: '[DQ] Calendar Focus Time: \"<event>\" — protecting'");
  console.log("  4. OOO: Add an 'outOfOffice' Google Calendar event, look for:");
  console.log("     '[DQ] Out of Office: \"<event>\" — suppressing'");
  console.log("\n[Test] Done.\n");

  // Cleanup
  ws.close();
  await deactivateSession();

  // Exit code: 0 if location persisted (primary verifiable assertion)
  process.exit(locationOk ? 0 : 1);
}

main().catch((e) => {
  console.error("[Test] Fatal error:", e);
  process.exit(1);
});
