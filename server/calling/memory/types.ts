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

// === Warmth & Interest Tracking ===

export interface UserState {
  warmth_level: number; // 0-3 (onboarding, crisp, familiar, trusted)
  last_engagement: number; // Unix timestamp (ms)
  interest_level: number; // 0-3 (normal, curious, attentive, gentle concern)
  interest_checkin_sent: boolean[]; // [level1_sent, level2_sent, level3_sent]
  onboarding_complete: boolean;
  ripcord_count: number; // Recent ripcords (resets after successful call)
  calls_since_ripcord: number;
}

// Note: last_engagement is 0 here; getUserState() sets it to Date.now() on first init
// This prevents stale timestamps when the module is loaded but state isn't created until later
export const DEFAULT_USER_STATE: UserState = {
  warmth_level: 0,
  last_engagement: 0, // Set to Date.now() on first getUserState() call
  interest_level: 0,
  interest_checkin_sent: [false, false, false],
  onboarding_complete: false,
  ripcord_count: 0,
  calls_since_ripcord: 0,
};

// === Constants ===

export const DECAY_PERIOD_MS = 4 * 7 * 24 * 60 * 60 * 1000; // 4 weeks in ms
export const MIN_CALL_DURATION_FOR_THEME = 180; // 3 minutes in seconds
export const THEME_CONFIDENCE_THRESHOLD = 0.7;

// Interest level thresholds (in ms)
export const INTEREST_THRESHOLDS = {
  CURIOUS: 7 * 24 * 60 * 60 * 1000, // 1 week
  ATTENTIVE: 14 * 24 * 60 * 60 * 1000, // 2 weeks
  GENTLE_CONCERN: 28 * 24 * 60 * 60 * 1000, // 4 weeks
};

// Warmth evolution
export const WARMTH_INCREMENT_SUCCESS = 0.1;
export const WARMTH_INCREMENT_THANKS = 0.2;
export const WARMTH_MAX = 3;
