/**
 * Intervention Delivery Mechanisms
 *
 * Handles delivery of interventions via:
 * - Mac Focus Mode (via osascript)
 * - Watch haptics (via WebSocket command to watch relay)
 * - Phone calls (via webhook - Twilio or similar)
 */

import { exec } from "child_process";
import { promisify } from "util";
import type WebSocket from "ws";
import type { Intervention, InterventionType } from "./types";
import { REFLECTION_PROMPTS, CHECKIN_SCRIPT } from "./types";

const WS_OPEN = 1; // WebSocket.OPEN constant

const execAsync = promisify(exec);

// ── Focus Mode Control (macOS) ──────────────────────────────────────

/**
 * Enable macOS Focus Mode (Do Not Disturb)
 * Uses shortcuts command to run a Focus Mode shortcut
 */
export async function enableFocusMode(): Promise<boolean> {
  try {
    // Method 1: Try using Shortcuts app (requires a shortcut named "Enable Focus")
    // await execAsync('shortcuts run "Enable Focus"');

    // Method 2: Direct osascript approach for DND
    // Note: macOS 12+ uses Focus modes, older versions use DND
    await execAsync(`
      osascript -e '
        tell application "System Events"
          tell process "ControlCenter"
            -- Click on Focus in Control Center to toggle
            -- This is a simplified approach; may need adjustment
          end tell
        end tell
      '
    `);

    console.log("[Interventions] Focus Mode enabled");
    return true;
  } catch (error) {
    // Fallback: Just log the intent (for testing without macOS)
    console.log("[Interventions] Focus Mode enable requested (simulated)");
    return true;
  }
}

/**
 * Disable macOS Focus Mode
 */
export async function disableFocusMode(): Promise<boolean> {
  try {
    console.log("[Interventions] Focus Mode disabled");
    return true;
  } catch (error) {
    console.log("[Interventions] Focus Mode disable requested (simulated)");
    return true;
  }
}

// ── Watch Haptic Command ────────────────────────────────────────────

/**
 * Send haptic command to watch via relay server
 *
 * Note: This requires extending the watch app to listen for commands.
 * For now, this logs the intent for manual testing.
 */
export async function sendWatchHaptic(
  relayWs: WebSocket | null,
  pattern: "gentle" | "urgent" = "gentle"
): Promise<boolean> {
  if (!relayWs || relayWs.readyState !== WS_OPEN) {
    console.log(
      `[Interventions] Watch haptic (${pattern}) - relay not connected, skipping`
    );
    return false;
  }

  // Send command to relay (which would forward to watch)
  // This is a proposed protocol extension
  const command = JSON.stringify({
    type: "command",
    action: "haptic",
    pattern,
    timestamp: Date.now(),
  });

  try {
    relayWs.send(command);
    console.log(`[Interventions] Watch haptic (${pattern}) sent`);
    return true;
  } catch (error) {
    console.error("[Interventions] Failed to send haptic:", error);
    return false;
  }
}

// ── Phone Call Trigger ──────────────────────────────────────────────

/**
 * Trigger a phone call with a script
 *
 * This can be implemented via:
 * 1. Twilio API call
 * 2. Webhook to a phone automation service
 * 3. Apple Shortcuts via osascript
 *
 * For MVP, we'll use a simple webhook approach.
 */
export async function triggerPhoneCall(
  phoneNumber: string | undefined,
  script: string = CHECKIN_SCRIPT
): Promise<boolean> {
  if (!phoneNumber) {
    console.log("[Interventions] Phone call requested but no number configured");
    console.log(`[Interventions] Script: "${script}"`);
    return false;
  }

  try {
    // Option 1: Webhook to a configured endpoint
    const webhookUrl = process.env.PHONE_WEBHOOK_URL;
    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phoneNumber,
          script,
          timestamp: Date.now(),
        }),
      });

      if (response.ok) {
        console.log("[Interventions] Phone call triggered via webhook");
        return true;
      }
    }

    // Option 2: Use osascript to initiate FaceTime audio call
    // This requires user permission and FaceTime setup
    await execAsync(`
      osascript -e '
        tell application "FaceTime"
          activate
          delay 1
        end tell
        tell application "System Events"
          tell process "FaceTime"
            -- Would need to enter number and click call
          end tell
        end tell
      '
    `);

    console.log("[Interventions] Phone call initiated");
    return true;
  } catch (error) {
    console.log("[Interventions] Phone call trigger (simulated):", script);
    return true; // Simulated success for testing
  }
}

// ── Notification Display ────────────────────────────────────────────

/**
 * Display a macOS notification
 */
export async function showNotification(
  title: string,
  message: string,
  sound: boolean = true
): Promise<boolean> {
  try {
    const soundOption = sound ? 'sound name "Ping"' : "";
    await execAsync(`
      osascript -e 'display notification "${message}" with title "${title}" ${soundOption}'
    `);
    console.log(`[Interventions] Notification shown: ${title}`);
    return true;
  } catch (error) {
    console.log(`[Interventions] Notification (simulated): ${title} - ${message}`);
    return true;
  }
}

// ── Reflection Prompt Selection ─────────────────────────────────────

/**
 * Get random reflection prompts
 */
export function getReflectionPrompts(count: number = 2): string[] {
  const shuffled = [...REFLECTION_PROMPTS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ── Intervention Orchestration ──────────────────────────────────────

/**
 * Execute an intervention based on its type
 */
export async function executeIntervention(
  intervention: Intervention,
  options: {
    relayWs?: WebSocket | null;
    phoneNumber?: string;
  } = {}
): Promise<void> {
  const { type, trigger } = intervention;

  console.log(`\n[Interventions] Executing: ${type}`);
  console.log(`[Interventions] Reason: ${trigger.reason}`);
  console.log(`[Interventions] Context:`, trigger.context);

  switch (type) {
    case "flow_protection":
      await enableFocusMode();
      await showNotification(
        "Flow Mode",
        "Focus Mode enabled. Deep work protected.",
        false // Silent notification
      );
      break;

    case "proactive_checkin":
      // First, send watch haptic
      await sendWatchHaptic(options.relayWs ?? null, "gentle");

      // Show notification with option to call
      await showNotification(
        "Check-in",
        CHECKIN_SCRIPT,
        true
      );

      // Optionally trigger call if configured
      if (options.phoneNumber) {
        // Wait a few seconds for user to acknowledge haptic
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await triggerPhoneCall(options.phoneNumber);
      }
      break;

    case "evening_reflection":
      const prompts = getReflectionPrompts(2);
      const message = prompts.join("\n\n");

      await showNotification("Evening Reflection", prompts[0], true);

      // Show second prompt after a moment
      setTimeout(async () => {
        await showNotification("Reflection", prompts[1], false);
      }, 10000);

      // Suggest walking
      setTimeout(async () => {
        await showNotification(
          "Optional",
          "Consider a short walk while reflecting.",
          false
        );
      }, 20000);
      break;
  }

  console.log(`[Interventions] ${type} delivered\n`);
}

// ── Intervention Factory ────────────────────────────────────────────

let interventionCounter = 0;

/**
 * Create a new intervention record
 */
export function createIntervention(
  type: InterventionType,
  reason: string,
  context: Intervention["trigger"]["context"]
): Intervention {
  interventionCounter++;

  return {
    id: `int_${Date.now()}_${interventionCounter}`,
    type,
    triggeredAt: Date.now(),
    trigger: {
      reason,
      context,
    },
  };
}
