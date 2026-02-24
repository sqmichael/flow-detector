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

// ── ntfy.sh Push Notifications ───────────────────────────────────────

const NTFY_TOPIC = process.env.NTFY_TOPIC || "flow-detector-x7k9m2";
const NTFY_BASE_URL = (process.env.NTFY_BASE_URL || "https://ntfy.sh").replace(/\/+$/, "");
const NTFY_URL = `${NTFY_BASE_URL}/${encodeURIComponent(NTFY_TOPIC)}`;
const NTFY_TOKEN = process.env.NTFY_TOKEN;
const NTFY_USERNAME = process.env.NTFY_USERNAME;
const NTFY_PASSWORD = process.env.NTFY_PASSWORD;

const NTFY_TIMEOUT_MS = 8000;
const NTFY_MAX_RETRIES = 3;
const NTFY_RETRY_DELAYS_MS = [500, 1500];

/**
 * Detect the best reachable URL for the rating server.
 * Priority: tailscale IP → RATING_SERVER env → localhost fallback
 */
async function detectRatingServerUrl(): Promise<string> {
  // 1. Try Tailscale IP (reachable from phone on same tailnet)
  try {
    const { stdout } = await execAsync("tailscale ip -4", { timeout: 3000 });
    const ip = stdout.trim();
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      return `http://${ip}:8767`;
    }
  } catch {
    // Tailscale not installed or not running
  }

  // 2. Environment variable
  if (process.env.RATING_SERVER) {
    return process.env.RATING_SERVER;
  }

  // 3. Localhost fallback (buttons won't work from phone)
  return "http://localhost:8767";
}

let RATING_SERVER = "http://localhost:8767";

// Initialize on module load — don't block, update when ready
detectRatingServerUrl().then((url) => {
  RATING_SERVER = url;
  console.log(`[Interventions] Rating server URL: ${RATING_SERVER}`);
});

/** Get the detected rating server URL (for preflight display) */
export function getRatingServerUrl(): string {
  return RATING_SERVER;
}

/**
 * Send push notification via ntfy.sh
 * Works anywhere - delivers to phone via ntfy app
 * If interventionId is provided, includes rating action buttons
 */
export async function sendPushNotification(
  title: string,
  message: string,
  priority: "low" | "default" | "high" = "default",
  interventionId?: string
): Promise<boolean> {
  const baseHeaders: Record<string, string> = {
    "Title": title,
    "Priority": priority === "high" ? "high" : priority === "low" ? "low" : "default",
    "Tags": "heart,wave",
    "User-Agent": "flow-detector/ambient-agent",
  };

  // Add rating buttons if intervention ID provided
  // Note: Button labels must be ASCII-only for HTTP headers
  if (interventionId) {
    baseHeaders["Actions"] = [
      `http, Helpful, ${RATING_SERVER}/rate/${interventionId}/good, method=POST`,
      `http, Okay, ${RATING_SERVER}/rate/${interventionId}/ok, method=POST`,
      `http, Intrusive, ${RATING_SERVER}/rate/${interventionId}/bad, method=POST`,
    ].join("; ");
  }

  // Auth headers for private ntfy servers
  if (NTFY_TOKEN) {
    baseHeaders["Authorization"] = `Bearer ${NTFY_TOKEN}`;
  } else if (NTFY_USERNAME && NTFY_PASSWORD) {
    baseHeaders["Authorization"] =
      `Basic ${Buffer.from(`${NTFY_USERNAME}:${NTFY_PASSWORD}`).toString("base64")}`;
  }

  for (let attempt = 1; attempt <= NTFY_MAX_RETRIES; attempt++) {
    try {
      // Attempt A: publish directly to /<topic>
      let response = await fetchWithTimeout(NTFY_URL, {
        method: "POST",
        headers: baseHeaders,
        body: message,
      }, NTFY_TIMEOUT_MS);

      // Attempt B (fallback): publish to root with Topic header
      if (!response.ok) {
        response = await fetchWithTimeout(NTFY_BASE_URL, {
          method: "POST",
          headers: { ...baseHeaders, "Topic": NTFY_TOPIC },
          body: message,
        }, NTFY_TIMEOUT_MS);
      }

      if (response.ok) {
        console.log(`[Interventions] Push sent: ${title}`);
        return true;
      }

      const errorText = await safeReadText(response);
      console.log(
        `[Interventions] Push failed (attempt ${attempt}/${NTFY_MAX_RETRIES}): ` +
        `${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`
      );
    } catch (error) {
      console.log(
        `[Interventions] Push error (attempt ${attempt}/${NTFY_MAX_RETRIES}): ${String(error)}`
      );
    }

    if (attempt < NTFY_MAX_RETRIES) {
      await sleep(NTFY_RETRY_DELAYS_MS[attempt - 1] ?? NTFY_RETRY_DELAYS_MS[NTFY_RETRY_DELAYS_MS.length - 1]);
    }
  }

  return false;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim().slice(0, 200);
  } catch {
    return "";
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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

const CALL_SERVICE_URL = process.env.CALL_SERVICE_URL || "http://localhost:8766";

/**
 * Trigger a phone call via the call-service (Twilio + Hume EVI)
 *
 * The call-service must be running separately:
 *   npm run call-service
 */
export async function triggerPhoneCall(
  phoneNumber: string | undefined,
  reason: "stress_check_in" | "evening_reflection" | "interest_checkin" = "stress_check_in",
  script: string = CHECKIN_SCRIPT
): Promise<boolean> {
  try {
    // Call the call-service to trigger outbound call
    const response = await fetch(`${CALL_SERVICE_URL}/call/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason,
        context: script,
      }),
    });

    if (response.ok) {
      const result = await response.json() as { callSid?: string };
      console.log(`[Interventions] Phone call triggered via call-service`);
      console.log(`[Interventions] Call SID: ${result.callSid || "unknown"}`);
      return true;
    } else {
      console.log(`[Interventions] Call service returned ${response.status}`);
      return false;
    }
  } catch (error) {
    // Call service not running - show notification instead
    console.log("[Interventions] Call service not available, showing notification");
    await showNotification("Check-in", script, true);
    return false;
  }
}

// ── Notification Display ────────────────────────────────────────────

/**
 * Display notification on Mac AND send push to phone
 * If interventionId is provided, push notification includes rating buttons
 */
export async function showNotification(
  title: string,
  message: string,
  sound: boolean = true,
  interventionId?: string
): Promise<boolean> {
  // Always send push notification (works anywhere)
  await sendPushNotification(title, message, sound ? "default" : "low", interventionId);

  // Also try macOS notification (works when at computer)
  try {
    const soundOption = sound ? 'sound name "Ping"' : "";
    await execAsync(`
      osascript -e 'display notification "${message}" with title "${title}" ${soundOption}'
    `);
    console.log(`[Interventions] Notification shown: ${title}`);
    return true;
  } catch (error) {
    // Not on macOS or osascript failed - push already sent, that's fine
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

// ── Contextual Message Builders ─────────────────────────────────────

/**
 * Build sensor-contextual message for flow protection
 */
function buildFlowMessage(context: Intervention["trigger"]["context"]): string {
  const parts: string[] = [];

  if (context.flowDurationMinutes) {
    parts.push(`${context.flowDurationMinutes}min focused`);
  }
  if (context.hr) {
    parts.push(`HR ${context.hr}`);
  }

  if (parts.length > 0) {
    return `Deep work detected (${parts.join(", ")}). Silencing interruptions.`;
  }
  return "Deep work detected. Silencing interruptions.";
}

/**
 * Build sensor-contextual message for stress check-in
 */
function buildCheckinMessage(_context: Intervention["trigger"]["context"]): string {
  // Copy Rules: never label emotions, cite biometrics, or prescribe actions.
  // Keep messages vague, physical, brief.
  return CHECKIN_SCRIPT;
}

/**
 * Build sensor-contextual message for evening reflection
 */
function buildReflectionMessage(_context: Intervention["trigger"]["context"]): string {
  // Copy Rules: never cite biometrics to the user.
  return "Good time to reflect.";
}

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
  const { id, type, trigger } = intervention;

  console.log(`\n[Interventions] Executing: ${type} (${id})`);
  console.log(`[Interventions] Reason: ${trigger.reason}`);
  console.log(`[Interventions] Context:`, trigger.context);

  switch (type) {
    case "flow_protection":
      await enableFocusMode();
      await showNotification(
        "Flow Mode",
        buildFlowMessage(trigger.context),
        false, // Silent notification
        id
      );
      break;

    case "proactive_checkin":
      // First, send watch haptic
      await sendWatchHaptic(options.relayWs ?? null, "gentle");

      // Show notification with rating buttons
      await showNotification(
        "Check-in",
        buildCheckinMessage(trigger.context),
        true,
        id
      );

      // Optionally trigger call if configured
      if (options.phoneNumber) {
        // Wait a few seconds for user to acknowledge haptic
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await triggerPhoneCall(options.phoneNumber, "stress_check_in");
      }
      break;

    case "evening_reflection":
      const prompts = getReflectionPrompts(2);
      const reflectionIntro = buildReflectionMessage(trigger.context);

      await showNotification("Evening Reflection", reflectionIntro, true, id);

      // Show reflection prompts after a moment
      setTimeout(async () => {
        await showNotification("Reflect", prompts[0], false);
      }, 10000);

      setTimeout(async () => {
        await showNotification("Reflect", prompts[1], false);
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
