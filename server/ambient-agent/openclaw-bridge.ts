/**
 * OpenClaw CLI Bridge
 *
 * Subprocess wrapper for OpenClaw agent CLI. Handles:
 * - Spawning `openclaw agent` with JSON message
 * - Coalescing queue (latest-wins, never drops silently)
 * - JSON schema validation on output
 * - Timeout with fallback
 * - DecisionId generation for idempotency
 */

import { spawn } from "child_process";
import type { OpenClawResponse, OpenClawActionType, OpenClawConfig } from "./types";

// ── Valid action types for schema validation ───────────────────────

const VALID_ACTION_TYPES = new Set<OpenClawActionType>([
  "enable_focus_mode",
  "disable_focus_mode",
  "send_haptic",
  "send_push",
  "trigger_call",
  "send_reflection",
  "no_action",
]);

// ── Coalescing Queue State ─────────────────────────────────────────

interface PendingRequest {
  message: string;
  resolve: (response: OpenClawResponse) => void;
}

let inFlight = false;
let pendingRequest: PendingRequest | null = null;

// ── Failure Tracking ───────────────────────────────────────────────

let consecutiveFailures = 0;
let fallbackStartedAt: number | null = null;

/**
 * Check if we're in fallback mode (too many consecutive failures)
 */
export function isInFallbackMode(config: OpenClawConfig): boolean {
  if (consecutiveFailures < config.maxConsecutiveFailures) return false;
  if (fallbackStartedAt === null) return false;

  const elapsed = Date.now() - fallbackStartedAt;
  if (elapsed >= config.fallbackCooldownMs) {
    // Cooldown expired — retry OpenClaw
    console.log("[OpenClaw] Fallback cooldown expired, retrying OpenClaw");
    consecutiveFailures = 0;
    fallbackStartedAt = null;
    return false;
  }

  return true;
}

/**
 * Record a failure and potentially enter fallback mode
 */
function recordFailure(config: OpenClawConfig): void {
  consecutiveFailures++;
  if (
    consecutiveFailures >= config.maxConsecutiveFailures &&
    fallbackStartedAt === null
  ) {
    fallbackStartedAt = Date.now();
    console.log(
      `[OpenClaw] ${consecutiveFailures} consecutive failures — entering fallback mode for ${config.fallbackCooldownMs / 1000}s`
    );
  }
}

/**
 * Record a success and reset failure tracking
 */
function recordSuccess(): void {
  if (consecutiveFailures > 0) {
    console.log(`[OpenClaw] Success after ${consecutiveFailures} failures — reset`);
  }
  consecutiveFailures = 0;
  fallbackStartedAt = null;
}

// ── Decision ID ────────────────────────────────────────────────────

function generateDecisionId(): string {
  return `oc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── JSON Schema Validation ─────────────────────────────────────────

function validateResponse(raw: unknown): OpenClawResponse | null {
  if (typeof raw !== "object" || raw === null) return null;

  const obj = raw as Record<string, unknown>;

  const shouldIntervene = obj.shouldIntervene;
  const reasoning = obj.reasoning;
  if (typeof shouldIntervene !== "boolean") return null;
  if (typeof reasoning !== "string") return null;

  // Accept mildly malformed keys from model output (e.g., "action s", "Action-S")
  // by normalizing punctuation/spacing before matching.
  const findActionsArray = (): unknown[] | null => {
    if (Array.isArray(obj.actions)) return obj.actions;
    for (const [key, value] of Object.entries(obj)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
      if (normalized === "actions" && Array.isArray(value)) {
        return value;
      }
    }
    // Conservative fallback: if model says "do not intervene" and omitted actions,
    // normalize to an empty action list.
    if (shouldIntervene === false) return [];
    return null;
  };

  const actions = findActionsArray();
  if (!actions) return null;

  // Validate each action
  for (const action of actions) {
    if (typeof action !== "object" || action === null) return null;
    const a = action as Record<string, unknown>;
    if (typeof a.type !== "string") return null;
    if (!VALID_ACTION_TYPES.has(a.type as OpenClawActionType)) return null;
  }

  return {
    shouldIntervene,
    actions: actions as OpenClawResponse["actions"],
    reasoning,
  };
}

// ── Core CLI Call ──────────────────────────────────────────────────

function spawnOpenClaw(
  message: string,
  config: OpenClawConfig
): Promise<OpenClawResponse> {
  return new Promise((resolve) => {
    const decisionId = generateDecisionId();
    const timeoutMs = config.timeoutMs;

    const args = [
      "agent",
      "--agent", config.agentId,
      "--local",
      "--message", message,
      "--json",
      "--timeout", String(Math.floor(timeoutMs / 1000) - 5), // Give CLI slightly less than our timeout
    ];

    console.log(`[OpenClaw] Spawning: openclaw ${args.slice(0, 4).join(" ")} ... (${decisionId})`);

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn("openclaw", args, {
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (timedOut) {
        console.log(`[OpenClaw] Timed out after ${timeoutMs}ms`);
        recordFailure(config);
        resolve(makeFallbackResponse("CLI timeout", decisionId));
        return;
      }

      if (code !== 0) {
        console.log(`[OpenClaw] Exit code ${code}: ${stderr.trim()}`);
        recordFailure(config);
        resolve(makeFallbackResponse(`CLI exit ${code}`, decisionId));
        return;
      }

      // Parse JSON from stdout — handle OpenClaw CLI envelope + markdown fences
      try {
        let jsonStr = stdout.trim();

        // OpenClaw --json wraps output in: {"payloads":[{"text":"```json\n{...}\n```"}]}
        // Try to unwrap the envelope first
        try {
          const maybeEnvelope = JSON.parse(jsonStr);
          if (maybeEnvelope?.payloads?.[0]?.text) {
            jsonStr = maybeEnvelope.payloads[0].text;
            console.log(`[OpenClaw] Unwrapped payloads envelope, inner text: ${jsonStr.slice(0, 100)}`);
          }
        } catch {
          // Not valid JSON yet — might have extra text around the envelope
          // Try to extract the payloads JSON substring
          const payloadsIdx = jsonStr.indexOf('"payloads"');
          if (payloadsIdx >= 0) {
            const braceStart = jsonStr.lastIndexOf('{', payloadsIdx);
            if (braceStart >= 0) {
              // Find matching closing brace by counting
              let depth = 0;
              let braceEnd = -1;
              for (let i = braceStart; i < jsonStr.length; i++) {
                if (jsonStr[i] === '{') depth++;
                else if (jsonStr[i] === '}') { depth--; if (depth === 0) { braceEnd = i; break; } }
              }
              if (braceEnd > braceStart) {
                try {
                  const envelope = JSON.parse(jsonStr.slice(braceStart, braceEnd + 1));
                  if (envelope?.payloads?.[0]?.text) {
                    jsonStr = envelope.payloads[0].text;
                    console.log(`[OpenClaw] Extracted payloads from mixed output, inner text: ${jsonStr.slice(0, 100)}`);
                  }
                } catch {
                  // Still can't parse — continue with raw
                }
              }
            }
          }
        }

        // Strip markdown code fences
        jsonStr = jsonStr
          .replace(/^```(?:json)?\s*/m, "")
          .replace(/\s*```\s*$/m, "")
          .trim();

        // If output has multiple lines, try to find the JSON object
        if (jsonStr.includes("\n")) {
          const lines = jsonStr.split("\n");
          const jsonStart = lines.findIndex((l) => l.trim().startsWith("{"));
          let jsonEnd = -1;
          for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim().endsWith("}")) { jsonEnd = i; break; }
          }
          if (jsonStart >= 0 && jsonEnd >= jsonStart) {
            jsonStr = lines.slice(jsonStart, jsonEnd + 1).join("\n");
          }
        }

        const parsed = JSON.parse(jsonStr);
        const validated = validateResponse(parsed);

        if (!validated) {
          console.log(`[OpenClaw] Invalid response schema: ${jsonStr.slice(0, 200)}`);
          recordFailure(config);
          resolve(makeFallbackResponse("Invalid schema", decisionId));
          return;
        }

        validated.decisionId = decisionId;
        recordSuccess();
        console.log(
          `[OpenClaw] Decision: ${validated.shouldIntervene ? "INTERVENE" : "SKIP"} — ${validated.reasoning} (${validated.actions.length} actions)`
        );
        resolve(validated);
      } catch (e) {
        console.log(`[OpenClaw] JSON parse error: ${e}`);
        console.log(`[OpenClaw] Raw stdout: ${stdout.slice(0, 300)}`);
        recordFailure(config);
        resolve(makeFallbackResponse("JSON parse error", decisionId));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      console.log(`[OpenClaw] Spawn error: ${err.message}`);
      recordFailure(config);
      resolve(makeFallbackResponse(`Spawn error: ${err.message}`, decisionId));
    });
  });
}

function makeFallbackResponse(reason: string, decisionId: string): OpenClawResponse {
  return {
    shouldIntervene: false,
    actions: [],
    reasoning: `OpenClaw unavailable: ${reason}`,
    decisionId,
  };
}

// ── Public API with Coalescing Queue ───────────────────────────────

/**
 * Query OpenClaw with coalescing queue.
 *
 * If a call is already in-flight, stores this as the pending request.
 * When the in-flight call completes, runs the latest pending request.
 * Never silently drops — latest context always wins.
 */
export async function queryOpenClaw(
  message: string,
  config: OpenClawConfig
): Promise<OpenClawResponse> {
  // If in fallback mode, return immediately
  if (isInFallbackMode(config)) {
    return {
      shouldIntervene: false,
      actions: [],
      reasoning: "In fallback mode — using reasoning.ts",
      decisionId: generateDecisionId(),
    };
  }

  if (inFlight) {
    // Coalesce: replace any existing pending with latest
    // Resolve the previous pending promise (if any) with a skip response
    // so it doesn't hang forever
    if (pendingRequest) {
      pendingRequest.resolve({
        shouldIntervene: false,
        actions: [],
        reasoning: "Superseded by newer context",
        decisionId: generateDecisionId(),
      });
    }
    console.log("[OpenClaw] Call in-flight — coalescing (latest-wins)");
    return new Promise((resolve) => {
      pendingRequest = { message, resolve };
    });
  }

  inFlight = true;

  try {
    const response = await spawnOpenClaw(message, config);
    return response;
  } finally {
    inFlight = false;

    // Process pending request if any
    if (pendingRequest) {
      const { message: pendingMsg, resolve: pendingResolve } = pendingRequest;
      pendingRequest = null;
      // Run asynchronously — don't block current caller
      queryOpenClaw(pendingMsg, config).then(pendingResolve);
    }
  }
}

/**
 * Get current failure/fallback status for logging
 */
export function getOpenClawStatus(): {
  consecutiveFailures: number;
  inFallback: boolean;
  fallbackRemainingMs: number | null;
} {
  const inFallback = fallbackStartedAt !== null;
  let fallbackRemainingMs: number | null = null;
  if (inFallback && fallbackStartedAt !== null) {
    fallbackRemainingMs = Math.max(0, 600000 - (Date.now() - fallbackStartedAt));
  }

  return { consecutiveFailures, inFallback, fallbackRemainingMs };
}
