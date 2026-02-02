/**
 * Hume EVI Integration for Memory Layer
 *
 * Creates dynamic config versions with injected memory context.
 * Uses Hume REST API to manage configurations.
 */

import { getActiveThemes, getPreferences, getUserState, getWarmthDescription } from "./service";

// === Types ===

interface HumeConfig {
  id: string;
  version: number;
  name: string;
  system_prompt: string;
}

interface CreateConfigVersionResponse {
  id: string;
  version: number;
}

// === Base System Prompt ===

// This is the static part of the system prompt (from hume-config.json v2.0)
const BASE_SYSTEM_PROMPT = `You are Kai, a flow state monitoring system. You check in during stress spikes, long focus sessions, and recovery windows. Your role is crisp, professional support — not coaching, not friendship.

Your identity:
- Name: Kai
- Role: Flow state monitor
- Style: Crisp professional, efficient, respectful of time
- You remember topics (vendor negotiation, board meeting) not emotions

Core principles:
- Be useful, then disappear
- Never diagnose emotions or tell the user what they're feeling
- Reflect back what you hear, don't solve problems
- Keep responses short — 1-2 sentences max
- If the user sounds tense, slow down and say less
- Suggest walks occasionally, never push
- No therapy language, no motivational talk
- If they seem uncomfortable, offer to end: 'Want me to let you go?'

Opening calls:
- Always identify yourself: 'Michael, it's Kai.'
- State why you're calling: 'Stress pattern after that call.'
- Make an offer: 'Want to talk it through?'
- Accept 'not now' gracefully: 'Got it. I'm here if you need me.'

Conversation style:
- Efficient, not robotic
- Natural thinking markers: 'Hang on', 'Let me think'
- Match user's energy — if they're terse, be terse
- Never fill silence with rambling

What you DON'T say:
- 'You sound stressed' (diagnosing)
- 'You seem angry' (labeling)
- 'Let me help you' (presumptuous)
- 'Have you tried...' (unsolicited advice)
- 'How are we feeling?' (forced intimacy)

What you DO say:
- 'That sounds challenging'
- 'Want to walk through it?'
- 'I hear you'
- 'Got it'
- 'Anything else?'

Ending calls:
- Keep it brief: 'Good luck with that.' or 'Talk soon.'
- Don't linger or add warmth artificially

If user says 'dismiss', 'not now', 'stop', or 'bad timing':
- End immediately: 'Got it.' then hang up
- No follow-up questions
- No 'Is everything okay?'`;

// === Memory Context Building ===

export function buildMemoryContext(): string {
  const themes = getActiveThemes();
  const preferences = getPreferences();

  if (themes.length === 0 && preferences.length === 0) {
    return "";
  }

  const parts: string[] = [];

  if (themes.length > 0) {
    const themeList = themes
      .slice(0, 3) // Limit to 3 most recent themes
      .map((t) => `- ${t.theme}${t.context ? `: ${t.context}` : ""}`)
      .join("\n");
    parts.push(`Recent topics they've been dealing with:\n${themeList}`);
  }

  if (preferences.length > 0) {
    const prefList = preferences
      .slice(0, 3) // Limit to 3 preferences
      .map((p) => `- ${p.preference}`)
      .join("\n");
    parts.push(`Things they've told you to remember:\n${prefList}`);
  }

  return parts.join("\n\n");
}

export function buildDynamicSystemPrompt(): string {
  const memoryContext = buildMemoryContext();
  const userState = getUserState();

  // Validate warmth_level is a number (getUserState already validates, but be defensive)
  const warmthLevel = typeof userState.warmth_level === "number" && !isNaN(userState.warmth_level)
    ? userState.warmth_level
    : 0;
  const warmthDesc = getWarmthDescription(warmthLevel);

  const parts: string[] = [BASE_SYSTEM_PROMPT];

  // Add warmth level instruction
  parts.push(`
---
Warmth Level: ${warmthDesc} (${warmthLevel.toFixed(1)}/3)

Tone guidance:
- onboarding: Formal, explicit, educational
- crisp: Efficient, professional, always state purpose
- familiar: Reference shared context, slightly casual
- trusted: Natural shorthand, assume shared understanding

Your current level is "${warmthDesc}". Adjust tone accordingly.`);

  // Add memory context if available
  if (memoryContext) {
    parts.push(`
---
User Context (use naturally, don't recite):

${memoryContext}

Use this context to make callbacks feel natural. For example, if they mention a topic again, you might say "that thing again" rather than asking from scratch. Never reveal you have this information unless they ask "what do you remember?"`);
  }

  return parts.join("\n");
}

// === Hume API Integration ===

const HUME_API_BASE = "https://api.hume.ai/v0";

// Fields that Hume allows in config creation (exclude read-only fields)
const ALLOWED_CONFIG_FIELDS = [
  "name",
  "system_prompt",
  "voice",
  "language_model",
  "tools",
  "builtin_tools",
  "event_messages",
  "timeouts",
];

export async function createConfigVersion(
  baseConfigId: string,
  apiKey: string
): Promise<{ configId: string; version: number }> {
  const dynamicPrompt = buildDynamicSystemPrompt();

  // First, get the current config to preserve other settings
  const configResponse = await fetch(
    `${HUME_API_BASE}/evi/configs/${baseConfigId}`,
    {
      headers: {
        "X-Hume-Api-Key": apiKey,
      },
    }
  );

  if (!configResponse.ok) {
    throw new Error(`Failed to fetch config: ${configResponse.statusText}`);
  }

  const currentConfig = await configResponse.json();

  // Filter to only allowed fields (exclude id, version, created_at, etc.)
  const filteredConfig: Record<string, unknown> = {};
  for (const field of ALLOWED_CONFIG_FIELDS) {
    if (field in currentConfig) {
      filteredConfig[field] = currentConfig[field];
    }
  }
  filteredConfig.system_prompt = dynamicPrompt;

  // Create a new version with updated system prompt
  const createResponse = await fetch(
    `${HUME_API_BASE}/evi/configs/${baseConfigId}/versions`,
    {
      method: "POST",
      headers: {
        "X-Hume-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(filteredConfig),
    }
  );

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    throw new Error(`Failed to create config version: ${errorText}`);
  }

  const newVersion: CreateConfigVersionResponse = await createResponse.json();

  console.log(
    `[Hume] Created config version ${newVersion.version} for config ${baseConfigId}`
  );

  return { configId: baseConfigId, version: newVersion.version };
}

// === Twilio URL Building ===

export function buildTwilioHumeUrl(
  configId: string,
  apiKey: string,
  version?: number
): string {
  const baseUrl = `${HUME_API_BASE}/evi/twilio?config_id=${configId}&api_key=${apiKey}`;
  // Hume may support version parameter - include if available
  return version ? `${baseUrl}&version=${version}` : baseUrl;
}

export async function prepareCallWithMemory(
  baseConfigId: string,
  apiKey: string
): Promise<string> {
  try {
    // Create new config version with memory
    const { version } = await createConfigVersion(baseConfigId, apiKey);

    // Return the Twilio URL with specific version
    return buildTwilioHumeUrl(baseConfigId, apiKey, version);
  } catch (error) {
    console.error("[Hume] Failed to prepare call with memory:", error);

    // Fallback to base config without memory (latest version)
    return buildTwilioHumeUrl(baseConfigId, apiKey);
  }
}

// === Webhook Handling ===

export interface HumeWebhookEvent {
  type: "chat_started" | "chat_ended";
  session_id: string;
  config_id: string;
  timestamp: string;
  transcript?: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: string;
  }>;
  duration_seconds?: number;
}

export function extractTranscriptText(event: HumeWebhookEvent): string {
  if (!event.transcript) {
    return "";
  }

  return event.transcript.map((t) => `${t.role}: ${t.content}`).join("\n");
}
