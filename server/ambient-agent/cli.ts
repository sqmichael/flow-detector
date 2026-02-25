#!/usr/bin/env npx tsx
/**
 * Ambient Agent CLI
 *
 * Run: npx tsx server/ambient-agent/cli.ts
 *
 * Commands:
 *   start          Start the agent (sensor-triggered mode)
 *   fixed          Switch to fixed-time mode (control condition)
 *   status         Show current status
 *   rate           Rate the last intervention
 *   compare        Compare sensor-triggered vs fixed-time days
 *   report         Full field test report with rating coverage
 *
 * Options:
 *   --no-openclaw  Disable OpenClaw, use reasoning.ts fallback
 *   --daemon       Run without terminal UI (for tmux/nohup)
 */

import { createInterface } from "readline";
import { spawn, type ChildProcess } from "child_process";
import WebSocket from "ws";
import { getAgent, stopAgent } from "./agent";
import { InterventionLogger, formatSummary, type InterventionLogEntry } from "./logger";
import { startRatingServer } from "./rating-server";
import { getRatingServerUrl, showNotification, sendPushNotification } from "./interventions";
import { DEFAULT_CONFIG, CHECKIN_SCRIPT, REFLECTION_PROMPTS, type Intervention } from "./types";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { readFile } from "fs/promises";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function clear() {
  console.clear();
}

// ── Preflight Health Checks ─────────────────────────────────────────

interface PreflightResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

let relayChildProcess: ChildProcess | null = null;

async function preflight(): Promise<boolean> {
  console.log("Running preflight checks...\n");
  const results: PreflightResult[] = [];

  // Ensure data directory exists
  mkdirSync(dirname(DEFAULT_CONFIG.logPath), { recursive: true });

  // 1. Check watch-relay WebSocket
  const relayOk = await checkRelay();
  if (relayOk) {
    results.push({ name: "Watch Relay", status: "pass", message: "Connected (ws://localhost:8765)" });
  } else {
    // Try to auto-start relay
    console.log("  Relay not running, auto-starting...");
    try {
      relayChildProcess = spawn("npx", ["tsx", "server/watch-relay.ts"], {
        stdio: "ignore",
        detached: true,
      });
      relayChildProcess.unref();

      // Wait for relay to come up
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const retryOk = await checkRelay();

      if (retryOk) {
        results.push({ name: "Watch Relay", status: "pass", message: "Auto-started successfully" });
      } else {
        results.push({ name: "Watch Relay", status: "warn", message: "Auto-started but not responding yet (will retry on connect)" });
      }
    } catch {
      results.push({ name: "Watch Relay", status: "warn", message: "Could not auto-start (start manually: npm run watch-server)" });
    }
  }

  // 2. Check ollama model
  try {
    const resp = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const data = await resp.json() as { models?: Array<{ name: string }> };
      const models = data.models?.map((m) => m.name) || [];
      const hasModel = models.some((m) => m.includes("qwen3"));
      if (hasModel) {
        results.push({ name: "Ollama", status: "pass", message: "qwen3 model available" });
      } else {
        results.push({ name: "Ollama", status: "warn", message: `No qwen3 model found (available: ${models.slice(0, 3).join(", ")})` });
      }
    } else {
      results.push({ name: "Ollama", status: "warn", message: "Ollama responded but returned error" });
    }
  } catch {
    results.push({ name: "Ollama", status: "warn", message: "Ollama not reachable (OpenClaw may still work)" });
  }

  // 3. Rating server URL
  // Wait briefly for async detection to complete
  await new Promise((resolve) => setTimeout(resolve, 500));
  const ratingUrl = getRatingServerUrl();
  const isTailscale = ratingUrl.includes("100.") || ratingUrl.includes("fd7a:");
  if (isTailscale) {
    results.push({ name: "Rating URL", status: "pass", message: `${ratingUrl} (Tailscale - phone buttons will work)` });
  } else if (ratingUrl.includes("localhost")) {
    results.push({ name: "Rating URL", status: "warn", message: `${ratingUrl} (localhost - phone buttons won't work)` });
  } else {
    results.push({ name: "Rating URL", status: "pass", message: ratingUrl });
  }

  // 4. Log path
  results.push({ name: "Log Path", status: "pass", message: DEFAULT_CONFIG.logPath });

  // 5. ntfy endpoint health (without publishing a message)
  const ntfyHealth = await checkNtfyHealth();
  if (ntfyHealth.ok) {
    results.push({ name: "ntfy", status: "pass", message: ntfyHealth.message });
  } else {
    results.push({ name: "ntfy", status: "warn", message: ntfyHealth.message });
  }

  // Print results
  let hasFail = false;
  for (const r of results) {
    const icon = r.status === "pass" ? "[OK]" : r.status === "warn" ? "[!!]" : "[FAIL]";
    console.log(`  ${icon} ${r.name}: ${r.message}`);
    if (r.status === "fail") hasFail = true;
  }
  console.log();

  return !hasFail;
}

async function checkNtfyHealth(): Promise<{ ok: boolean; message: string }> {
  const baseUrl = (process.env.NTFY_BASE_URL || "https://ntfy.sh").replace(/\/+$/, "");
  const topic = process.env.NTFY_TOPIC || "flow-detector-x7k9m2";
  const token = process.env.NTFY_TOKEN;
  const username = process.env.NTFY_USERNAME;
  const password = process.env.NTFY_PASSWORD;

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else if (username && password) {
    headers["Authorization"] =
      `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  try {
    // Avoid long-poll checks here; they can legitimately wait > timeout when no messages exist.
    // First, verify server health endpoint, then do a fast topic endpoint probe.
    const health = await fetch(`${baseUrl}/v1/health`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(4000),
    });

    if (!health.ok) {
      return { ok: false, message: `${baseUrl}/v1/health returned ${health.status}` };
    }

    const res = await fetch(`${baseUrl}/${encodeURIComponent(topic)}/json?poll=0`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      return { ok: true, message: `${baseUrl}/${topic} reachable` };
    }
    return { ok: false, message: `${baseUrl}/${topic} returned ${res.status}` };
  } catch (err) {
    return { ok: false, message: `${baseUrl}/${topic} unreachable (${String(err)})` };
  }
}

function checkRelay(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket("ws://localhost:8765/browser", { handshakeTimeout: 3000 });
      const timer = setTimeout(() => {
        ws.terminate();
        resolve(false);
      }, 3000);

      ws.on("open", () => {
        clearTimeout(timer);
        ws.close();
        resolve(true);
      });

      ws.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

// ── Status Display ──────────────────────────────────────────────────

async function showStatus(continuous = false, daemon = false): Promise<void> {
  const agent = getAgent();

  if (daemon) {
    // Daemon mode: just log to stdout, no terminal UI
    console.log("Agent running in daemon mode. Press Ctrl+C to stop.");
    process.on("SIGINT", () => {
      stopAgent();
      cleanupRelay();
      console.log("\nAgent stopped.");
      process.exit(0);
    });
    // Keep process alive
    await new Promise(() => {});
    return;
  }

  const display = () => {
    clear();
    console.log(agent.getStatus());
    console.log("\nPress Ctrl+C to stop, 'r' to rate, 's' for summary");
  };

  if (continuous) {
    display();
    const interval = setInterval(display, 2000);

    process.on("SIGINT", () => {
      clearInterval(interval);
      stopAgent();
      cleanupRelay();
      console.log("\nAgent stopped.");
      process.exit(0);
    });

    // Listen for key presses
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", async (key) => {
        if (key.toString() === "r") {
          clearInterval(interval);
          await rateIntervention();
          display();
          setInterval(display, 2000);
        } else if (key.toString() === "s") {
          clearInterval(interval);
          await showSummary();
          display();
          setInterval(display, 2000);
        } else if (key.toString() === "\u0003") {
          // Ctrl+C
          clearInterval(interval);
          stopAgent();
          cleanupRelay();
          process.exit(0);
        }
      });
    }
  } else {
    display();
  }
}

function cleanupRelay(): void {
  if (relayChildProcess) {
    try {
      relayChildProcess.kill();
    } catch {
      // Already dead
    }
    relayChildProcess = null;
  }
}

// ── Rate Intervention ───────────────────────────────────────────────

async function rateIntervention(): Promise<void> {
  const agent = getAgent();
  const state = agent.getState();
  const last = state.interventionsToday[state.interventionsToday.length - 1];

  if (!last) {
    console.log("\nNo interventions to rate yet.\n");
    return;
  }

  console.log("\n===================================");
  console.log("          RATE LAST INTERVENTION       ");
  console.log("===================================");
  console.log(`Type: ${last.type}`);
  console.log(`Triggered: ${new Date(last.triggeredAt).toLocaleTimeString()}`);
  console.log(`Reason: ${last.trigger.reason}`);
  console.log("-----------------------------------\n");

  const wellTimed = parseInt(await prompt("Well-timed? (1-5): ")) || 3;
  const helpedRegulation = parseInt(await prompt("Helped regulation? (1-5): ")) || 3;
  const feltIntrusive = parseInt(await prompt("Felt intrusive? (1-5): ")) || 3;
  const wantAgain = (await prompt("Want again tomorrow? (y/n): ")).toLowerCase() === "y";

  const rating: Intervention["rating"] = {
    wellTimed: Math.min(5, Math.max(1, wellTimed)),
    helpedRegulation: Math.min(5, Math.max(1, helpedRegulation)),
    feltIntrusive: Math.min(5, Math.max(1, feltIntrusive)),
    wantAgainTomorrow: wantAgain,
  };

  await agent.rateLastIntervention(rating);
  console.log("\nRating saved!\n");
}

// ── Summary / Compare ───────────────────────────────────────────────

async function showSummary(): Promise<void> {
  const logger = new InterventionLogger(DEFAULT_CONFIG.logPath);
  const comparison = await logger.compareConditions();

  console.log("\n===================================");
  console.log("         INTERVENTION COMPARISON       ");
  console.log("===================================\n");

  console.log("SENSOR-TRIGGERED DAYS:");
  if (comparison.sensorTriggered.length === 0) {
    console.log("  No data yet\n");
  } else {
    for (const summary of comparison.sensorTriggered) {
      console.log("  " + formatSummary(summary).split("\n").join("\n  "));
      console.log();
    }
  }

  console.log("FIXED-TIME DAYS:");
  if (comparison.fixedTime.length === 0) {
    console.log("  No data yet\n");
  } else {
    for (const summary of comparison.fixedTime) {
      console.log("  " + formatSummary(summary).split("\n").join("\n  "));
      console.log();
    }
  }

  console.log("-----------------------------------");
  console.log("ANALYSIS:");
  if (comparison.analysis.wellTimedDiff !== null) {
    const diff = comparison.analysis.wellTimedDiff;
    const sign = diff >= 0 ? "+" : "";
    console.log(`  Well-timed difference: ${sign}${diff.toFixed(1)} points`);
  }
  console.log(`  ${comparison.analysis.recommendation}`);
  console.log("===================================\n");
}

// ── Report Command ──────────────────────────────────────────────────

async function showReport(): Promise<void> {
  const logPath = DEFAULT_CONFIG.logPath;
  let entries: InterventionLogEntry[] = [];

  try {
    const content = await readFile(logPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    entries = lines.map((line) => JSON.parse(line) as InterventionLogEntry);
  } catch {
    console.log("No intervention log found. Run the agent first.");
    return;
  }

  if (entries.length === 0) {
    console.log("No interventions logged yet.");
    return;
  }

  // Date range
  const dates = [...new Set(entries.map((e) => e.date))].sort();
  const totalDays = dates.length;
  const sensorDays = [...new Set(entries.filter((e) => e.condition === "sensor_triggered").map((e) => e.date))].length;
  const fixedDays = [...new Set(entries.filter((e) => e.condition === "fixed_time").map((e) => e.date))].length;

  console.log("\n===================================");
  console.log("       FIELD TEST REPORT           ");
  console.log("===================================\n");

  console.log(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
  console.log(`Total days: ${totalDays} (sensor: ${sensorDays}, fixed: ${fixedDays})\n`);

  // Interventions by type
  const byType = new Map<string, number>();
  for (const e of entries) {
    const t = e.intervention.type;
    byType.set(t, (byType.get(t) || 0) + 1);
  }
  console.log("INTERVENTIONS BY TYPE:");
  for (const [type, count] of byType) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(`  Total: ${entries.length}\n`);

  // Rating coverage
  const rated = entries.filter((e) => e.intervention.rating);
  const unrated = entries.filter((e) => !e.intervention.rating);
  const pctUnrated = entries.length > 0 ? ((unrated.length / entries.length) * 100).toFixed(0) : "0";

  console.log("RATING COVERAGE:");
  console.log(`  ${rated.length}/${entries.length} rated (${pctUnrated}% unrated)\n`);

  // List unrated
  if (unrated.length > 0) {
    console.log("UNRATED INTERVENTIONS:");
    for (const e of unrated) {
      const time = new Date(e.intervention.triggeredAt).toLocaleString();
      console.log(`  ${e.intervention.id}  ${time}  ${e.intervention.type}`);
    }
    console.log();
  }

  // Average scores by condition
  if (rated.length > 0) {
    console.log("AVERAGE SCORES:");

    for (const condition of ["sensor_triggered", "fixed_time"] as const) {
      const condRated = rated.filter((e) => e.condition === condition);
      if (condRated.length === 0) continue;

      const avg = (field: "wellTimed" | "helpedRegulation" | "feltIntrusive") => {
        const vals = condRated
          .map((e) => e.intervention.rating?.[field])
          .filter((v): v is number => v !== undefined);
        return vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "n/a";
      };

      const wantAgain = condRated.filter((e) => e.intervention.rating?.wantAgainTomorrow).length;
      const label = condition === "sensor_triggered" ? "Sensor-Triggered" : "Fixed-Time";

      console.log(`\n  ${label} (${condRated.length} rated):`);
      console.log(`    Well-timed:        ${avg("wellTimed")}/5`);
      console.log(`    Helped regulation: ${avg("helpedRegulation")}/5`);
      console.log(`    Felt intrusive:    ${avg("feltIntrusive")}/5`);
      console.log(`    Want again:        ${wantAgain}/${condRated.length}`);
    }
    console.log();
  }

  // Recommendation (reuse compare logic)
  const logger = new InterventionLogger(logPath);
  const comparison = await logger.compareConditions();
  console.log("-----------------------------------");
  console.log(`RECOMMENDATION: ${comparison.analysis.recommendation}`);
  console.log("===================================\n");
}

// ── Fixed-Time Mode ─────────────────────────────────────────────────

async function runFixedTimeMode(): Promise<void> {
  console.log("\n===================================");
  console.log("         FIXED-TIME MODE              ");
  console.log("===================================");
  console.log("\nIn this mode, interventions trigger at fixed times:");
  console.log("  - Check-in: 2:00 PM");
  console.log("  - Reflection: 8:00 PM");
  console.log("\nThis is the control condition for comparison.");
  console.log("No sensor data is used for timing.\n");

  // Start rating server for ntfy button callbacks
  startRatingServer(DEFAULT_CONFIG.logPath);

  const logger = new InterventionLogger(DEFAULT_CONFIG.logPath);

  // Schedule fixed-time interventions
  const scheduleFixedCheckin = () => {
    const now = new Date();
    const checkinTime = new Date(now);
    checkinTime.setHours(14, 0, 0, 0); // 2 PM

    if (now > checkinTime) {
      checkinTime.setDate(checkinTime.getDate() + 1);
    }

    const delay = checkinTime.getTime() - now.getTime();
    console.log(`Check-in scheduled for ${checkinTime.toLocaleTimeString()}`);

    setTimeout(async () => {
      const intervention: Intervention = {
        id: `fixed_${Date.now()}_checkin`,
        type: "proactive_checkin",
        triggeredAt: Date.now(),
        trigger: {
          reason: "Fixed time: 2:00 PM",
          context: {},
        },
      };

      await logger.logIntervention(intervention, "fixed_time");

      // Send real push notification with rating buttons
      await showNotification(
        "Check-in",
        CHECKIN_SCRIPT,
        true,
        intervention.id
      );

      console.log(`[Fixed] Check-in delivered: ${intervention.id}`);
      scheduleFixedCheckin(); // Reschedule for tomorrow
    }, delay);
  };

  const scheduleFixedReflection = () => {
    const now = new Date();
    const reflectionTime = new Date(now);
    reflectionTime.setHours(20, 0, 0, 0); // 8 PM

    if (now > reflectionTime) {
      reflectionTime.setDate(reflectionTime.getDate() + 1);
    }

    const delay = reflectionTime.getTime() - now.getTime();
    console.log(`Reflection scheduled for ${reflectionTime.toLocaleTimeString()}`);

    setTimeout(async () => {
      const intervention: Intervention = {
        id: `fixed_${Date.now()}_reflection`,
        type: "evening_reflection",
        triggeredAt: Date.now(),
        trigger: {
          reason: "Fixed time: 8:00 PM",
          context: {},
        },
      };

      await logger.logIntervention(intervention, "fixed_time");

      // Send real push notification with rating buttons
      await showNotification(
        "Evening Reflection",
        "Good time to reflect.",
        true,
        intervention.id
      );

      // Follow-up reflection prompts
      const prompts = [...REFLECTION_PROMPTS].sort(() => Math.random() - 0.5).slice(0, 2);
      setTimeout(() => sendPushNotification("Reflect", prompts[0], "low"), 10000);
      setTimeout(() => sendPushNotification("Reflect", prompts[1], "low"), 20000);

      console.log(`[Fixed] Reflection delivered: ${intervention.id}`);
      scheduleFixedReflection(); // Reschedule for tomorrow
    }, delay);
  };

  scheduleFixedCheckin();
  scheduleFixedReflection();

  console.log("\nPress Ctrl+C to stop.\n");

  await new Promise(() => {}); // Keep running
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Find the first non-flag argument as the command
  const command = process.argv.slice(2).find((arg) => !arg.startsWith("--")) || "start";

  console.log("\n+====================================+");
  console.log("|      AMBIENT AGENT PROTOTYPE       |");
  console.log("|   Felt-Experience Intervention Test |");
  console.log("+====================================+\n");

  const noOpenClaw = process.argv.includes("--no-openclaw");
  const daemon = process.argv.includes("--daemon");
  const testMode = process.argv.includes("--test-mode");

  switch (command) {
    case "start": {
      // Run preflight checks
      const ok = await preflight();
      if (!ok) {
        console.log("Preflight failed. Fix errors above and retry.");
        process.exit(1);
      }

      console.log("Starting sensor-triggered mode...\n");
      if (noOpenClaw) {
        console.log("OpenClaw DISABLED (--no-openclaw flag). Using reasoning.ts fallback.\n");
      }
      if (daemon) {
        console.log("Running in daemon mode (no terminal UI).\n");
      }
      if (testMode) {
        console.log("TEST MODE enabled: Lowering stress detection threshold to 2 minutes.\n");
      }
      startRatingServer(DEFAULT_CONFIG.logPath);
      const agentConfig: Partial<AmbientAgentConfig> | undefined = testMode
        ? {
            stressDetection: {
              hrElevatedAboveBaseline: 10,
              hrvSuppressedBelowBaseline: 0.7,
              durationMinutes: 2, // Lowered for testing
            },
          }
        : undefined;
      const agent = getAgent(agentConfig, { useOpenClaw: !noOpenClaw });
      await agent.start();
      await showStatus(true, daemon);
      break;
    }

    case "status":
      await showStatus(false);
      rl.close();
      break;

    case "rate":
      await rateIntervention();
      rl.close();
      break;

    case "compare":
    case "summary":
      await showSummary();
      rl.close();
      break;

    case "report":
      await showReport();
      rl.close();
      break;

    case "fixed":
      await runFixedTimeMode();
      break;

    default:
      console.log("Usage: npx tsx server/ambient-agent/cli.ts [command] [options]");
      console.log("");
      console.log("Commands:");
      console.log("  start     Start the agent in sensor-triggered mode");
      console.log("  fixed     Run in fixed-time mode (control condition)");
      console.log("  status    Show current status");
      console.log("  rate      Rate the last intervention");
      console.log("  compare   Compare sensor-triggered vs fixed-time days");
      console.log("  report    Full field test report with rating coverage");
      console.log("");
      console.log("Options:");
      console.log("  --no-openclaw  Disable OpenClaw, use reasoning.ts fallback");
      console.log("  --daemon       Run without terminal UI (for tmux/nohup)");
      console.log("  --test-mode    Lower thresholds for faster testing (stress: 2min)");
      console.log("");
      rl.close();
  }
}

main().catch(console.error);
