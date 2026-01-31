#!/usr/bin/env npx tsx
/**
 * Ambient Agent CLI
 *
 * Run: npx tsx server/ambient-agent/cli.ts
 *
 * Commands:
 *   start          Start the agent
 *   status         Show current status
 *   rate           Rate the last intervention
 *   compare        Compare sensor-triggered vs fixed-time days
 *   fixed          Switch to fixed-time mode (control condition)
 */

import { createInterface } from "readline";
import { getAgent, stopAgent } from "./agent";
import { InterventionLogger, formatSummary } from "./logger";
import { DEFAULT_CONFIG, type Intervention } from "./types";

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

async function showStatus(continuous = false): Promise<void> {
  const agent = getAgent();

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
          process.exit(0);
        }
      });
    }
  } else {
    display();
  }
}

async function rateIntervention(): Promise<void> {
  const agent = getAgent();
  const state = agent.getState();
  const last = state.interventionsToday[state.interventionsToday.length - 1];

  if (!last) {
    console.log("\nNo interventions to rate yet.\n");
    return;
  }

  console.log("\n═══════════════════════════════════════");
  console.log("          RATE LAST INTERVENTION       ");
  console.log("═══════════════════════════════════════");
  console.log(`Type: ${last.type}`);
  console.log(`Triggered: ${new Date(last.triggeredAt).toLocaleTimeString()}`);
  console.log(`Reason: ${last.trigger.reason}`);
  console.log("───────────────────────────────────────\n");

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

async function showSummary(): Promise<void> {
  const logger = new InterventionLogger(DEFAULT_CONFIG.logPath);
  const comparison = await logger.compareConditions();

  console.log("\n═══════════════════════════════════════");
  console.log("         INTERVENTION COMPARISON       ");
  console.log("═══════════════════════════════════════\n");

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

  console.log("───────────────────────────────────────");
  console.log("ANALYSIS:");
  if (comparison.analysis.wellTimedDiff !== null) {
    const diff = comparison.analysis.wellTimedDiff;
    const sign = diff >= 0 ? "+" : "";
    console.log(`  Well-timed difference: ${sign}${diff.toFixed(1)} points`);
  }
  console.log(`  ${comparison.analysis.recommendation}`);
  console.log("═══════════════════════════════════════\n");
}

async function runFixedTimeMode(): Promise<void> {
  console.log("\n═══════════════════════════════════════");
  console.log("         FIXED-TIME MODE              ");
  console.log("═══════════════════════════════════════");
  console.log("\nIn this mode, interventions trigger at fixed times:");
  console.log("  - Check-in: 2:00 PM");
  console.log("  - Reflection: 8:00 PM");
  console.log("\nThis is the control condition for comparison.");
  console.log("No sensor data is used for timing.\n");

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
      console.log("\n🔔 FIXED CHECK-IN: Hey. Just checking in. Want to walk and talk?\n");

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
      console.log("\n🌙 EVENING REFLECTION:");
      console.log("  - What drained energy today?");
      console.log("  - What helped you reset?\n");

      scheduleFixedReflection(); // Reschedule for tomorrow
    }, delay);
  };

  scheduleFixedCheckin();
  scheduleFixedReflection();

  console.log("\nPress Ctrl+C to stop.\n");

  await new Promise(() => {}); // Keep running
}

async function main(): Promise<void> {
  const command = process.argv[2] || "start";

  console.log("\n╔════════════════════════════════════╗");
  console.log("║      AMBIENT AGENT PROTOTYPE       ║");
  console.log("║   Felt-Experience Intervention Test ║");
  console.log("╚════════════════════════════════════╝\n");

  switch (command) {
    case "start":
      console.log("Starting sensor-triggered mode...\n");
      const agent = getAgent();
      await agent.start();
      await showStatus(true);
      break;

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

    case "fixed":
      await runFixedTimeMode();
      break;

    default:
      console.log("Usage: npx tsx server/ambient-agent/cli.ts [command]");
      console.log("");
      console.log("Commands:");
      console.log("  start     Start the agent in sensor-triggered mode");
      console.log("  status    Show current status");
      console.log("  rate      Rate the last intervention");
      console.log("  compare   Compare sensor-triggered vs fixed-time days");
      console.log("  fixed     Run in fixed-time mode (control condition)");
      console.log("");
      rl.close();
  }
}

main().catch(console.error);
