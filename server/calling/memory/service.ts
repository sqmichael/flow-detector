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
  DECAY_PERIOD_MS,
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
