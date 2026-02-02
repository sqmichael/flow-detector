/**
 * LLM Reasoning Layer
 *
 * Adds judgment to intervention decisions using a cheap LLM.
 * Called ONLY when detectors flag a pattern - not on every data point.
 *
 * Input: ~100 tokens (normalized, derived features)
 * Cost: ~3-5 calls/day × $0.0001 = ~$0.02/month
 */

import type { PersonalBaseline, Intervention, InterventionType } from "./types";

// ── Config ───────────────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.LLM_MODEL || "deepseek/deepseek-chat";

// ── Types ────────────────────────────────────────────────────────────

export interface ReasoningInput {
  trigger: {
    type: "flow" | "stress" | "recovery";
    confidence: "low" | "medium" | "high";
    reason: string;
  };
  state: {
    hrVsBaseline: string | null;  // e.g., "+25%"
    hrvVsBaseline: string | null; // e.g., "-35%"
    sclTrend: "rising" | "falling" | "stable" | null;
  };
  context: {
    time: string;           // e.g., "14:30 Tue"
    dayPart: string;        // e.g., "afternoon_work"
    interventionsToday: number;
    lastInterventionHoursAgo: number | null;
    recentAvgRating: number | null; // 1-5 scale
  };
  trend?: string; // e.g., "hr_rising_10min" (conditional)
}

export interface ReasoningOutput {
  shouldIntervene: boolean;
  interventionType: InterventionType | null;
  message: string | null;
  reasoning: string;
}

// ── System Prompt (~200 tokens, set once) ────────────────────────────

const SYSTEM_PROMPT = `You judge whether to send a wellness notification based on biometric signals.

Rules:
1. FLOW: Protect deep work. Enable Focus Mode silently. High bar to interrupt.
2. STRESS: Only if sustained + confident. Check in gently. Don't diagnose.
3. RECOVERY: Evening wind-down prompt. Only if clearly relaxing.

Skip if:
- Low confidence
- Intervened <2 hours ago
- Low avg rating (user finds these intrusive)
- Time suggests exercise/commute/meal

Output JSON only:
{"shouldIntervene":bool,"interventionType":"flow_protection"|"proactive_checkin"|"evening_reflection"|null,"message":"text or null","reasoning":"one sentence"}`;

// ── Main ─────────────────────────────────────────────────────────────

export async function decideIntervention(
  input: ReasoningInput
): Promise<ReasoningOutput> {
  if (!OPENROUTER_API_KEY) {
    console.log("[Reasoning] No API key - fallback mode");
    return fallbackDecision(input);
  }

  const userPrompt = JSON.stringify(input);
  console.log(`[Reasoning] Input: ${userPrompt}`);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://flow-detector.local",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      console.log(`[Reasoning] API error ${response.status}`);
      return fallbackDecision(input);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    if (data.usage) {
      console.log(`[Reasoning] Tokens: ${data.usage.prompt_tokens} in, ${data.usage.completion_tokens} out`);
    }

    const content = data.choices[0]?.message?.content;
    if (!content) return fallbackDecision(input);

    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const result = JSON.parse(jsonStr) as ReasoningOutput;

    console.log(`[Reasoning] Decision: ${result.shouldIntervene ? "INTERVENE" : "SKIP"} - ${result.reasoning}`);
    return result;
  } catch (error) {
    console.log(`[Reasoning] Error: ${error}`);
    return fallbackDecision(input);
  }
}

// ── Fallback ─────────────────────────────────────────────────────────

function fallbackDecision(input: ReasoningInput): ReasoningOutput {
  const { trigger, context } = input;

  // Skip if too many today or recent
  if (context.interventionsToday >= 2) {
    return { shouldIntervene: false, interventionType: null, message: null, reasoning: "Max interventions today (fallback)" };
  }
  if (context.lastInterventionHoursAgo !== null && context.lastInterventionHoursAgo < 2) {
    return { shouldIntervene: false, interventionType: null, message: null, reasoning: "Too recent (fallback)" };
  }
  if (trigger.confidence === "low") {
    return { shouldIntervene: false, interventionType: null, message: null, reasoning: "Low confidence (fallback)" };
  }

  const typeMap: Record<string, InterventionType> = {
    flow: "flow_protection",
    stress: "proactive_checkin",
    recovery: "evening_reflection",
  };
  const msgMap: Record<string, string> = {
    flow: "Focus Mode enabled. Deep work protected.",
    stress: "Hey. Just checking in.",
    recovery: "Nice wind-down. What drained energy today?",
  };

  return {
    shouldIntervene: true,
    interventionType: typeMap[trigger.type],
    message: msgMap[trigger.type],
    reasoning: `${trigger.type} detected (fallback)`,
  };
}

// ── Helper: Build input from agent state ─────────────────────────────

export function buildReasoningInput(
  triggerType: "flow" | "stress" | "recovery",
  triggerReason: string,
  sensors: { hr: number | null; hrv: number | null; scl: number | null },
  baseline: PersonalBaseline | null,
  interventionsToday: Intervention[],
  metrics?: { stableMinutes?: number; elevatedMinutes?: number }
): ReasoningInput {
  // Calculate confidence
  let confidence: "low" | "medium" | "high" = "medium";
  if (triggerType === "flow" && metrics?.stableMinutes !== undefined) {
    confidence = metrics.stableMinutes >= 45 ? "high" : metrics.stableMinutes >= 30 ? "medium" : "low";
  }
  if (triggerType === "stress" && metrics?.elevatedMinutes !== undefined) {
    confidence = metrics.elevatedMinutes >= 20 ? "high" : metrics.elevatedMinutes >= 15 ? "medium" : "low";
  }

  // Normalize state vs baseline
  let hrVsBaseline: string | null = null;
  let hrvVsBaseline: string | null = null;
  if (baseline && sensors.hr !== null) {
    const pct = Math.round(((sensors.hr - baseline.restingHR) / baseline.restingHR) * 100);
    hrVsBaseline = `${pct >= 0 ? "+" : ""}${pct}%`;
  }
  if (baseline && sensors.hrv !== null) {
    const pct = Math.round(((sensors.hrv - baseline.baselineHRV) / baseline.baselineHRV) * 100);
    hrvVsBaseline = `${pct >= 0 ? "+" : ""}${pct}%`;
  }

  // Time context
  const now = new Date();
  const hour = now.getHours();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const time = `${hour.toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")} ${dayNames[now.getDay()]}`;

  let dayPart = "night";
  if (hour >= 6 && hour < 12) dayPart = "morning";
  else if (hour >= 12 && hour < 14) dayPart = "lunch";
  else if (hour >= 14 && hour < 18) dayPart = "afternoon_work";
  else if (hour >= 18 && hour < 22) dayPart = "evening";

  // Last intervention timing
  let lastInterventionHoursAgo: number | null = null;
  if (interventionsToday.length > 0) {
    const last = interventionsToday[interventionsToday.length - 1];
    lastInterventionHoursAgo = Math.round((Date.now() - last.triggeredAt) / (1000 * 60 * 60) * 10) / 10;
  }

  // Recent avg rating (simplified - would need to load from logger in real impl)
  const recentAvgRating: number | null = null; // TODO: load from intervention log

  // Build trend string (conditional)
  let trend: string | undefined;
  if (triggerType === "stress" && metrics?.elevatedMinutes !== undefined) {
    trend = `hr_elevated_${metrics.elevatedMinutes}min`;
  }
  if (triggerType === "flow" && metrics?.stableMinutes !== undefined) {
    trend = `stable_${metrics.stableMinutes}min`;
  }

  return {
    trigger: { type: triggerType, confidence, reason: triggerReason },
    state: { hrVsBaseline, hrvVsBaseline, sclTrend: null },
    context: { time, dayPart, interventionsToday: interventionsToday.length, lastInterventionHoursAgo, recentAvgRating },
    trend,
  };
}
