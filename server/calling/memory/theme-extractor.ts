/**
 * Theme Extractor
 *
 * Uses LLM to identify themes from call transcripts.
 * Cheap model (DeepSeek) for cost efficiency.
 */

import { ExtractedTheme, THEME_CONFIDENCE_THRESHOLD } from "./types";

// === OpenRouter Integration ===

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-v3.2"; // Cheap and good at extraction

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// === Theme Extraction ===

const EXTRACTION_PROMPT = `You are analyzing a phone call transcript between a user and an AI companion. Your task is to identify the main topic or theme of the conversation.

Rules:
- Extract ONE main theme (not multiple)
- Use simple, human language (e.g., "vendor negotiation", "delegation challenges")
- Provide brief context (1 sentence max)
- Rate your confidence 0-1
- If the call was just small talk or checking in with no clear topic, return null

Examples of good themes:
- "vendor negotiation" (context: "Dealing with pricing pushback from Acme Corp")
- "delegation challenges" (context: "Struggling to hand off the reporting project")
- "board meeting prep" (context: "Anxious about Thursday's presentation")

Examples of what NOT to extract:
- "stress" (too vague, emotional label)
- "work problems" (too generic)
- "user was upset" (emotional observation, not topic)

Respond in JSON format:
{
  "theme": "short theme name" | null,
  "context": "brief context sentence" | null,
  "confidence": 0.0-1.0
}`;

export async function extractTheme(
  transcript: string
): Promise<ExtractedTheme | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error("[ThemeExtractor] OPENROUTER_API_KEY not set");
    return null;
  }

  if (!transcript || transcript.trim().length < 100) {
    // Too short to extract meaningful theme
    return null;
  }

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 256,
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: `Transcript:\n\n${transcript}` },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    const data: OpenRouterResponse = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      return null;
    }

    // Extract JSON from response (LLM may include extra text)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[ThemeExtractor] No JSON found in response:", content.slice(0, 100));
      return null;
    }

    let parsed: { theme?: unknown; context?: unknown; confidence?: unknown };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.warn("[ThemeExtractor] Failed to parse JSON:", jsonMatch[0].slice(0, 100));
      return null;
    }

    // Validate types
    if (typeof parsed.theme !== "string" || !parsed.theme) {
      return null;
    }

    const confidence = typeof parsed.confidence === "number"
      ? parsed.confidence
      : parseFloat(String(parsed.confidence));

    if (isNaN(confidence) || confidence < THEME_CONFIDENCE_THRESHOLD) {
      return null;
    }

    return {
      theme: parsed.theme,
      context: typeof parsed.context === "string" ? parsed.context : "",
      confidence,
    };
  } catch (error) {
    console.error("[ThemeExtractor] Failed to extract theme:", error);
    return null;
  }
}

// === In-Call Theme Confirmation ===

/**
 * Generate a natural confirmation question for the agent to ask.
 * Used at the end of substantive calls.
 */
export function generateConfirmationQuestion(
  suggestedTheme: string,
  existingThemes: string[]
): string {
  // Check if this matches an existing theme
  const normalizedSuggested = suggestedTheme.toLowerCase();
  const matchingExisting = existingThemes.find((t) =>
    normalizedSuggested.includes(t.toLowerCase()) ||
    t.toLowerCase().includes(normalizedSuggested)
  );

  if (matchingExisting) {
    // It's a recurring topic
    return `Was that about ${matchingExisting} again, or something else?`;
  }

  // New topic
  return `Was that about ${suggestedTheme}, or something else?`;
}
