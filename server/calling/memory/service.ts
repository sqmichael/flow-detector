/**
 * Memory Service
 *
 * CRUD operations for themes and preferences.
 * Activity-based decay: themes expire 4 weeks after last mention.
 */

import { randomUUID } from "crypto";
import { getDb } from "./db";
import {
  ThemeRecord,
  PreferenceRecord,
  MemorySummary,
  UserState,
  DEFAULT_USER_STATE,
  DECAY_PERIOD_MS,
  INTEREST_THRESHOLDS,
  WARMTH_INCREMENT_SUCCESS,
  WARMTH_INCREMENT_THANKS,
  WARMTH_MAX,
} from "./types";

// === Theme Operations ===

export function saveTheme(
  theme: string,
  context: string,
  source: "call" | "explicit" = "call"
): ThemeRecord {
  const db = getDb();
  const now = Date.now();
  const normalizedTheme = theme.trim().toLowerCase();

  // Check for existing theme with same name (case-insensitive)
  const existing = db
    .prepare("SELECT * FROM themes WHERE LOWER(theme) = ?")
    .get(normalizedTheme) as ThemeRecord | undefined;

  if (existing) {
    // Update existing theme (touch + update context if provided)
    const newContext = context.trim() || existing.context;
    db.prepare(
      `UPDATE themes SET last_mentioned = ?, expires = ?, context = ? WHERE id = ?`
    ).run(now, now + DECAY_PERIOD_MS, newContext, existing.id);

    return {
      ...existing,
      last_mentioned: now,
      expires: now + DECAY_PERIOD_MS,
      context: newContext,
    };
  }

  // Create new theme
  const record: ThemeRecord = {
    id: randomUUID(),
    theme: theme.trim(),
    context: context.trim(),
    last_mentioned: now,
    expires: now + DECAY_PERIOD_MS,
    source,
  };

  db.prepare(
    `INSERT INTO themes (id, theme, context, last_mentioned, expires, source)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.theme,
    record.context,
    record.last_mentioned,
    record.expires,
    record.source
  );

  return record;
}

export function getThemes(): ThemeRecord[] {
  const db = getDb();
  return db.prepare("SELECT * FROM themes ORDER BY last_mentioned DESC").all() as ThemeRecord[];
}

export function getActiveThemes(): ThemeRecord[] {
  const db = getDb();
  const now = Date.now();
  return db
    .prepare("SELECT * FROM themes WHERE expires > ? ORDER BY last_mentioned DESC")
    .all(now) as ThemeRecord[];
}

export function touchTheme(id: string): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `UPDATE themes SET last_mentioned = ?, expires = ? WHERE id = ?`
  ).run(now, now + DECAY_PERIOD_MS, id);
}

export function deleteTheme(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM themes WHERE id = ?").run(id);
  return result.changes > 0;
}

export function findThemeByKeyword(keyword: string): ThemeRecord | null {
  const db = getDb();
  const now = Date.now();
  const normalizedKeyword = keyword.toLowerCase().trim();

  // Search in theme and context fields
  const result = db
    .prepare(
      `SELECT * FROM themes
       WHERE expires > ?
       AND (LOWER(theme) LIKE ? OR LOWER(context) LIKE ?)
       ORDER BY last_mentioned DESC
       LIMIT 1`
    )
    .get(now, `%${normalizedKeyword}%`, `%${normalizedKeyword}%`) as ThemeRecord | undefined;

  return result || null;
}

// === Preference Operations ===

export function savePreference(preference: string): PreferenceRecord {
  const db = getDb();
  const record: PreferenceRecord = {
    id: randomUUID(),
    preference: preference.trim(),
    created: Date.now(),
  };

  db.prepare(
    `INSERT INTO preferences (id, preference, created) VALUES (?, ?, ?)`
  ).run(record.id, record.preference, record.created);

  return record;
}

export function getPreferences(): PreferenceRecord[] {
  const db = getDb();
  return db.prepare("SELECT * FROM preferences ORDER BY created DESC").all() as PreferenceRecord[];
}

export function deletePreference(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM preferences WHERE id = ?").run(id);
  return result.changes > 0;
}

export function findPreferenceByKeyword(keyword: string): PreferenceRecord | null {
  const db = getDb();
  const normalizedKeyword = keyword.toLowerCase().trim();

  const result = db
    .prepare(
      `SELECT * FROM preferences
       WHERE LOWER(preference) LIKE ?
       ORDER BY created DESC
       LIMIT 1`
    )
    .get(`%${normalizedKeyword}%`) as PreferenceRecord | undefined;

  return result || null;
}

// === Cleanup ===

export function expireOldThemes(): number {
  const db = getDb();
  const now = Date.now();
  const result = db.prepare("DELETE FROM themes WHERE expires <= ?").run(now);
  return result.changes;
}

// === Summary ===

export function getMemorySummary(): MemorySummary {
  const themes = getActiveThemes();
  const preferences = getPreferences();

  return {
    themes: themes.map((t) => ({
      theme: t.theme,
      lastMentioned: new Date(t.last_mentioned),
    })),
    preferences: preferences.map((p) => p.preference),
    isEmpty: themes.length === 0 && preferences.length === 0,
  };
}

export function formatMemorySummaryForVoice(): string {
  const summary = getMemorySummary();

  if (summary.isEmpty) {
    return "I don't have anything saved right now.";
  }

  const parts: string[] = [];

  if (summary.themes.length > 0) {
    const themeList = summary.themes.map((t) => t.theme).join(", ");
    parts.push(`Recent topics: ${themeList}`);
  }

  if (summary.preferences.length > 0) {
    const prefList = summary.preferences.join(". ");
    parts.push(`Things you told me: ${prefList}`);
  }

  return parts.join(". ");
}

// === Forget by keyword (for voice command) ===

export function forgetByKeyword(keyword: string): { deleted: boolean; what: string } {
  // Try themes first
  const theme = findThemeByKeyword(keyword);
  if (theme) {
    deleteTheme(theme.id);
    return { deleted: true, what: theme.theme };
  }

  // Try preferences
  const pref = findPreferenceByKeyword(keyword);
  if (pref) {
    deletePreference(pref.id);
    return { deleted: true, what: pref.preference };
  }

  return { deleted: false, what: "" };
}

// === User State Management ===

const USER_STATE_KEY = "user_state";

export function getUserState(): UserState {
  const db = getDb();

  // Ensure user_state table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const row = db.prepare("SELECT value FROM user_state WHERE key = ?").get(USER_STATE_KEY) as
    | { value: string }
    | undefined;

  if (!row) {
    // Initialize with defaults, setting last_engagement to now (not stale module load time)
    const initialState: UserState = {
      ...DEFAULT_USER_STATE,
      last_engagement: Date.now(),
    };
    saveUserState(initialState);
    return initialState;
  }

  // Parse with error handling - return fresh state if corrupted
  try {
    const parsed = JSON.parse(row.value) as UserState;

    // Validate interest_checkin_sent is proper array of 3 booleans
    if (!Array.isArray(parsed.interest_checkin_sent) || parsed.interest_checkin_sent.length !== 3) {
      parsed.interest_checkin_sent = [false, false, false];
    }

    // Validate warmth_level is a number
    if (typeof parsed.warmth_level !== "number" || isNaN(parsed.warmth_level)) {
      parsed.warmth_level = 0;
    }

    return parsed;
  } catch (error) {
    console.error("[Memory] Corrupted user_state JSON, reinitializing:", error);
    const freshState: UserState = {
      ...DEFAULT_USER_STATE,
      last_engagement: Date.now(),
    };
    saveUserState(freshState);
    return freshState;
  }
}

export function saveUserState(state: UserState): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO user_state (key, value) VALUES (?, ?)`
  ).run(USER_STATE_KEY, JSON.stringify(state));
}

export function updateUserState(updates: Partial<UserState>): UserState {
  const current = getUserState();
  const updated = { ...current, ...updates };
  saveUserState(updated);
  return updated;
}

// === Warmth Evolution ===

export function recordSuccessfulCall(): UserState {
  const state = getUserState();
  const newWarmth = Math.min(state.warmth_level + WARMTH_INCREMENT_SUCCESS, WARMTH_MAX);

  return updateUserState({
    warmth_level: newWarmth,
    last_engagement: Date.now(),
    ripcord_count: 0,
    calls_since_ripcord: state.calls_since_ripcord + 1,
    // Reset interest tracking on engagement
    interest_level: 0,
    interest_checkin_sent: [false, false, false],
  });
}

export function recordUserThanks(): UserState {
  const state = getUserState();
  const newWarmth = Math.min(state.warmth_level + WARMTH_INCREMENT_THANKS, WARMTH_MAX);

  return updateUserState({
    warmth_level: newWarmth,
    last_engagement: Date.now(),
  });
}

export function recordRipcord(): UserState {
  const state = getUserState();

  return updateUserState({
    last_engagement: Date.now(),
    ripcord_count: state.ripcord_count + 1,
    calls_since_ripcord: 0,
    // Warmth does NOT decrease
  });
}

export function completeOnboarding(): UserState {
  return updateUserState({
    onboarding_complete: true,
    warmth_level: 1, // Move to crisp professional
    last_engagement: Date.now(),
  });
}

// === Interest Level Calculation ===

export function calculateInterestLevel(): {
  level: number;
  shouldCheckin: boolean;
  checkinType: "curious" | "attentive" | "gentle_concern" | null;
} {
  const state = getUserState();

  // Don't send interest check-ins until onboarding is complete
  if (!state.onboarding_complete) {
    return { level: 0, shouldCheckin: false, checkinType: null };
  }

  const now = Date.now();
  const gap = now - state.last_engagement;

  if (gap < INTEREST_THRESHOLDS.CURIOUS) {
    return { level: 0, shouldCheckin: false, checkinType: null };
  }

  if (gap < INTEREST_THRESHOLDS.ATTENTIVE) {
    // 1-2 weeks: curious
    const shouldCheckin = !state.interest_checkin_sent[0];
    return { level: 1, shouldCheckin, checkinType: shouldCheckin ? "curious" : null };
  }

  if (gap < INTEREST_THRESHOLDS.GENTLE_CONCERN) {
    // 2-4 weeks: attentive
    const shouldCheckin = !state.interest_checkin_sent[1];
    return { level: 2, shouldCheckin, checkinType: shouldCheckin ? "attentive" : null };
  }

  // 4+ weeks: gentle concern
  const shouldCheckin = !state.interest_checkin_sent[2];
  return { level: 3, shouldCheckin, checkinType: shouldCheckin ? "gentle_concern" : null };
}

export function markInterestCheckinSent(level: 1 | 2 | 3): UserState {
  const state = getUserState();
  const newSent = [...state.interest_checkin_sent];
  newSent[level - 1] = true;

  return updateUserState({
    interest_level: level,
    interest_checkin_sent: newSent as [boolean, boolean, boolean],
  });
}

// === Warmth Level Helpers ===

export function getWarmthDescription(level: number): string {
  if (level < 1) return "onboarding";
  if (level < 2) return "crisp";
  if (level < 3) return "familiar";
  return "trusted";
}
