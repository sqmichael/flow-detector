/**
 * Memory Layer Types
 *
 * Two-tier memory model:
 * - Session: Dies when call ends (not persisted)
 * - Remembered: Themes + preferences with activity-based decay
 */

// === Storage Records ===

export interface ThemeRecord {
  id: string;
  theme: string; // "vendor negotiation"
  context: string; // "Dealing with pricing pushback from Acme Corp"
  last_mentioned: number; // Unix timestamp (ms)
  expires: number; // Unix timestamp (ms) - 4 weeks after last_mentioned
  source: "call" | "explicit";
}

export interface PreferenceRecord {
  id: string;
  preference: string; // "walks help after tense calls"
  created: number; // Unix timestamp (ms)
}

// === Voice Commands ===

export type VoiceCommand =
  | { type: "remember"; content: string }
  | { type: "forget"; target: string }
  | { type: "query" }
  | { type: "ripcord" };

export interface CommandResult {
  success: boolean;
  response: string; // What agent should say
  action?: "end_call" | "purge_session";
}

// === Theme Extraction ===

export interface ExtractedTheme {
  theme: string;
  context: string;
  confidence: number; // 0-1
}

// === Memory Summary ===

export interface MemorySummary {
  themes: Array<{ theme: string; lastMentioned: Date }>;
  preferences: string[];
  isEmpty: boolean;
}

// === Constants ===

export const DECAY_PERIOD_MS = 4 * 7 * 24 * 60 * 60 * 1000; // 4 weeks in ms
export const MIN_CALL_DURATION_FOR_THEME = 180; // 3 minutes in seconds
export const THEME_CONFIDENCE_THRESHOLD = 0.7;
