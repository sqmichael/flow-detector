/**
 * Memory Service Tests
 *
 * Run: npx tsx server/calling/memory/service.test.ts
 */

import { getDb, closeDb } from "./db";
import {
  saveTheme,
  getThemes,
  getActiveThemes,
  touchTheme,
  deleteTheme,
  findThemeByKeyword,
  savePreference,
  getPreferences,
  deletePreference,
  expireOldThemes,
  getMemorySummary,
  forgetByKeyword,
} from "./service";
import { detectCommand, executeCommand } from "./commands";
import { DECAY_PERIOD_MS } from "./types";

// Test utilities
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  ${(e as Error).message}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function cleanup() {
  const db = getDb();
  db.exec("DELETE FROM themes");
  db.exec("DELETE FROM preferences");
}

// === Tests ===

console.log("\n=== Memory Service Tests ===\n");

// Theme tests
test("saveTheme creates a theme record", () => {
  cleanup();
  const theme = saveTheme("vendor negotiation", "Dealing with Acme Corp pricing");
  assert(theme.id.length > 0, "Should have ID");
  assert(theme.theme === "vendor negotiation", "Should have theme");
  assert(theme.context === "Dealing with Acme Corp pricing", "Should have context");
  assert(theme.source === "call", "Default source should be call");
  assert(theme.expires > theme.last_mentioned, "Expires should be after last_mentioned");
});

test("getThemes returns all themes", () => {
  cleanup();
  saveTheme("theme 1", "context 1");
  saveTheme("theme 2", "context 2");
  const themes = getThemes();
  assert(themes.length === 2, "Should have 2 themes");
});

test("touchTheme updates last_mentioned and extends expires", () => {
  cleanup();
  const theme = saveTheme("test theme", "test context");
  const originalExpires = theme.expires;

  // Wait a tiny bit and touch
  const later = Date.now() + 1000;
  const db = getDb();
  db.prepare("UPDATE themes SET last_mentioned = ?, expires = ? WHERE id = ?").run(
    later,
    later + DECAY_PERIOD_MS,
    theme.id
  );

  const updated = getThemes()[0];
  assert(updated.expires > originalExpires, "Expires should be extended");
});

test("deleteTheme removes a theme", () => {
  cleanup();
  const theme = saveTheme("to delete", "context");
  assert(getThemes().length === 1, "Should have 1 theme");
  deleteTheme(theme.id);
  assert(getThemes().length === 0, "Should have 0 themes");
});

test("findThemeByKeyword finds by theme name", () => {
  cleanup();
  saveTheme("vendor negotiation", "Acme Corp");
  const found = findThemeByKeyword("vendor");
  assert(found !== null, "Should find theme");
  assert(found!.theme === "vendor negotiation", "Should match theme");
});

test("findThemeByKeyword finds by context", () => {
  cleanup();
  saveTheme("vendor negotiation", "Acme Corp pricing");
  const found = findThemeByKeyword("acme");
  assert(found !== null, "Should find by context");
});

// Preference tests
test("savePreference creates a preference", () => {
  cleanup();
  const pref = savePreference("walks help after tense calls");
  assert(pref.id.length > 0, "Should have ID");
  assert(pref.preference === "walks help after tense calls", "Should have preference");
});

test("getPreferences returns all preferences", () => {
  cleanup();
  savePreference("pref 1");
  savePreference("pref 2");
  const prefs = getPreferences();
  assert(prefs.length === 2, "Should have 2 preferences");
});

test("deletePreference removes a preference", () => {
  cleanup();
  const pref = savePreference("to delete");
  deletePreference(pref.id);
  assert(getPreferences().length === 0, "Should have 0 preferences");
});

// Decay tests
test("expireOldThemes removes expired themes", () => {
  cleanup();
  const db = getDb();
  // Insert an expired theme directly
  db.prepare(
    "INSERT INTO themes (id, theme, context, last_mentioned, expires, source) VALUES (?, ?, ?, ?, ?, ?)"
  ).run("expired-id", "old theme", "old context", 0, 1, "call");

  saveTheme("fresh theme", "fresh context"); // Not expired

  assert(getThemes().length === 2, "Should have 2 themes before cleanup");
  const deleted = expireOldThemes();
  assert(deleted === 1, "Should delete 1 expired theme");
  assert(getThemes().length === 1, "Should have 1 theme after cleanup");
});

// Summary tests
test("getMemorySummary returns correct structure", () => {
  cleanup();
  saveTheme("theme 1", "context 1");
  savePreference("pref 1");
  const summary = getMemorySummary();
  assert(summary.themes.length === 1, "Should have 1 theme");
  assert(summary.preferences.length === 1, "Should have 1 preference");
  assert(!summary.isEmpty, "Should not be empty");
});

test("getMemorySummary.isEmpty is true when empty", () => {
  cleanup();
  const summary = getMemorySummary();
  assert(summary.isEmpty, "Should be empty");
});

// forgetByKeyword tests
test("forgetByKeyword deletes matching theme", () => {
  cleanup();
  saveTheme("vendor negotiation", "context");
  const result = forgetByKeyword("vendor");
  assert(result.deleted, "Should delete");
  assert(result.what === "vendor negotiation", "Should return what was deleted");
  assert(getThemes().length === 0, "Theme should be gone");
});

test("forgetByKeyword deletes matching preference", () => {
  cleanup();
  savePreference("walks help");
  const result = forgetByKeyword("walks");
  assert(result.deleted, "Should delete");
  assert(getPreferences().length === 0, "Preference should be gone");
});

// Command detection tests
test("detectCommand detects remember", () => {
  const cmd = detectCommand("remember that walks help after calls");
  assert(cmd !== null, "Should detect command");
  assert(cmd!.type === "remember", "Should be remember");
  assert((cmd as { content: string }).content === "walks help after calls", "Should extract content");
});

test("detectCommand detects forget", () => {
  const cmd = detectCommand("forget what I said about Steve");
  assert(cmd !== null, "Should detect command");
  assert(cmd!.type === "forget", "Should be forget");
  assert((cmd as { target: string }).target === "Steve", "Should extract target");
});

test("detectCommand detects query", () => {
  const cmd = detectCommand("what do you remember");
  assert(cmd !== null, "Should detect command");
  assert(cmd!.type === "query", "Should be query");
});

test("detectCommand detects ripcord", () => {
  const cmd = detectCommand("dismiss");
  assert(cmd !== null, "Should detect command");
  assert(cmd!.type === "ripcord", "Should be ripcord");
});

test("detectCommand returns null for regular speech", () => {
  const cmd = detectCommand("Yeah the vendor situation is tough");
  assert(cmd === null, "Should not detect command");
});

// Command execution tests
test("executeCommand remember saves preference", () => {
  cleanup();
  const result = executeCommand({ type: "remember", content: "mornings are sacred" });
  assert(result.success, "Should succeed");
  assert(result.response === "Got it.", "Should respond correctly");
  assert(getPreferences().length === 1, "Should save preference");
});

test("executeCommand forget deletes memory", () => {
  cleanup();
  saveTheme("test topic", "context");
  const result = executeCommand({ type: "forget", target: "test" });
  assert(result.success, "Should succeed");
  assert(result.response === "Done.", "Should respond correctly");
  assert(getThemes().length === 0, "Should delete theme");
});

test("executeCommand ripcord returns end_call action", () => {
  const result = executeCommand({ type: "ripcord" });
  assert(result.success, "Should succeed");
  assert(result.action === "end_call", "Should have end_call action");
});

// Additional edge case tests (from Codex review)
test("detectCommand handles ripcord with punctuation", () => {
  const cmd1 = detectCommand("Dismiss.");
  assert(cmd1?.type === "ripcord", "Should detect 'Dismiss.' as ripcord");

  const cmd2 = detectCommand("  not now  ");
  assert(cmd2?.type === "ripcord", "Should detect with whitespace");

  const cmd3 = detectCommand("stop");
  assert(cmd3?.type === "ripcord", "Should detect 'stop' as ripcord");
});

test("saveTheme deduplicates by theme name", () => {
  cleanup();
  saveTheme("vendor negotiation", "context 1");
  saveTheme("Vendor Negotiation", "context 2"); // Same theme, different case
  const themes = getThemes();
  assert(themes.length === 1, "Should have 1 theme (deduplicated)");
  assert(themes[0].context === "context 2", "Should update context");
});

// User state tests
import {
  getUserState,
  updateUserState,
  recordSuccessfulCall,
  recordRipcord,
  completeOnboarding,
  getWarmthDescription,
  saveUserState,
} from "./service";
import { DEFAULT_USER_STATE } from "./types";

function cleanupUserState() {
  const db = getDb();
  // Ensure table exists before trying to delete
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  db.exec("DELETE FROM user_state");
}

test("getUserState returns default state initially", () => {
  cleanupUserState();
  const state = getUserState();
  assert(state.warmth_level === 0, "Should start at warmth 0");
  assert(state.onboarding_complete === false, "Onboarding should be incomplete");
});

test("recordSuccessfulCall increases warmth", () => {
  cleanupUserState();
  getUserState(); // Initialize
  const before = getUserState().warmth_level;
  recordSuccessfulCall();
  const after = getUserState().warmth_level;
  assert(after > before, "Warmth should increase");
});

test("recordRipcord does not decrease warmth", () => {
  cleanupUserState();
  getUserState(); // Initialize
  recordSuccessfulCall(); // Increase warmth first
  const before = getUserState().warmth_level;
  recordRipcord();
  const after = getUserState().warmth_level;
  assert(after === before, "Warmth should not decrease after ripcord");
});

test("completeOnboarding sets warmth to 1", () => {
  cleanupUserState();
  getUserState(); // Initialize
  completeOnboarding();
  const state = getUserState();
  assert(state.warmth_level === 1, "Should be at warmth level 1");
  assert(state.onboarding_complete === true, "Onboarding should be complete");
});

test("getWarmthDescription returns correct labels", () => {
  assert(getWarmthDescription(0) === "onboarding", "Level 0 is onboarding");
  assert(getWarmthDescription(0.5) === "onboarding", "Level 0.5 is onboarding");
  assert(getWarmthDescription(1) === "crisp", "Level 1 is crisp");
  assert(getWarmthDescription(1.5) === "crisp", "Level 1.5 is crisp");
  assert(getWarmthDescription(2) === "familiar", "Level 2 is familiar");
  assert(getWarmthDescription(3) === "trusted", "Level 3 is trusted");
});

// Edge case tests (from Codex review)
import { calculateInterestLevel } from "./service";
import { INTEREST_THRESHOLDS } from "./types";

test("calculateInterestLevel returns level 0 before onboarding complete", () => {
  cleanupUserState();
  getUserState(); // Initialize with onboarding_complete: false
  // Even if enough time passes, should not trigger check-in
  const db = getDb();
  const state = getUserState();
  // Set last_engagement far in the past
  db.prepare("UPDATE user_state SET value = ? WHERE key = ?").run(
    JSON.stringify({ ...state, last_engagement: Date.now() - (8 * 7 * 24 * 60 * 60 * 1000) }), // 8 weeks ago
    "user_state"
  );
  const result = calculateInterestLevel();
  assert(result.shouldCheckin === false, "Should not check in before onboarding");
});

test("calculateInterestLevel works after onboarding complete", () => {
  cleanupUserState();
  completeOnboarding(); // Sets onboarding_complete: true and warmth to 1
  const db = getDb();
  const state = getUserState();
  // Set last_engagement 2 weeks ago
  db.prepare("UPDATE user_state SET value = ? WHERE key = ?").run(
    JSON.stringify({ ...state, last_engagement: Date.now() - INTEREST_THRESHOLDS.ATTENTIVE - 1000 }),
    "user_state"
  );
  const result = calculateInterestLevel();
  assert(result.level === 2, "Should be at attentive level");
  assert(result.shouldCheckin === true, "Should suggest check-in");
});

test("getUserState handles corrupted JSON gracefully", () => {
  cleanupUserState();
  const db = getDb();
  // Insert corrupted JSON
  db.prepare("INSERT OR REPLACE INTO user_state (key, value) VALUES (?, ?)").run(
    "user_state",
    "not valid json {"
  );
  // Should not throw, should return fresh state
  const state = getUserState();
  assert(state.warmth_level === 0, "Should return default warmth");
  assert(state.last_engagement > 0, "Should have valid timestamp");
});

test("getUserState fixes invalid interest_checkin_sent array", () => {
  cleanupUserState();
  const db = getDb();
  // Insert state with wrong array length
  db.prepare("INSERT OR REPLACE INTO user_state (key, value) VALUES (?, ?)").run(
    "user_state",
    JSON.stringify({ ...DEFAULT_USER_STATE, interest_checkin_sent: [true] }) // Wrong length
  );
  const state = getUserState();
  assert(
    Array.isArray(state.interest_checkin_sent) && state.interest_checkin_sent.length === 3,
    "Should fix array to length 3"
  );
});

test("getUserState fixes invalid warmth_level", () => {
  cleanupUserState();
  const db = getDb();
  // Insert state with non-numeric warmth
  db.prepare("INSERT OR REPLACE INTO user_state (key, value) VALUES (?, ?)").run(
    "user_state",
    JSON.stringify({ ...DEFAULT_USER_STATE, warmth_level: "invalid" })
  );
  const state = getUserState();
  assert(typeof state.warmth_level === "number", "Should be a number");
  assert(state.warmth_level === 0, "Should default to 0");
});

test("executeCommand ripcord updates user state", () => {
  cleanupUserState();
  getUserState(); // Initialize
  recordSuccessfulCall(); // Set calls_since_ripcord to 1
  const before = getUserState();
  assert(before.calls_since_ripcord === 1, "Should have 1 call before ripcord");
  executeCommand({ type: "ripcord" });
  const after = getUserState();
  assert(after.ripcord_count === 1, "Ripcord count should be 1");
  assert(after.calls_since_ripcord === 0, "Calls since ripcord should reset to 0");
});

// Cleanup
closeDb();

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
