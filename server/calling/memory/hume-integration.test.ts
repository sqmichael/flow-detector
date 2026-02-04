/**
 * Hume Integration Tests
 *
 * Tests for prompt building functions.
 * Run: npx tsx server/calling/memory/hume-integration.test.ts
 */

import { getDb, closeDb } from "./db";
import { saveTheme, savePreference, completeOnboarding, getUserState } from "./service";
import {
  buildMemoryContext,
  buildDynamicSystemPrompt,
  buildOnboardingSystemPrompt,
  buildTwilioHumeUrl,
  extractTranscriptText,
} from "./hume-integration";

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
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
  db.exec("DELETE FROM user_state");
}

// === Tests ===

console.log("\n=== Hume Integration Tests ===\n");

// buildMemoryContext tests
test("buildMemoryContext returns empty string when no memory", () => {
  cleanup();
  const context = buildMemoryContext();
  assert(context === "", "Should be empty");
});

test("buildMemoryContext includes themes", () => {
  cleanup();
  saveTheme("vendor negotiation", "Acme Corp pricing");
  const context = buildMemoryContext();
  assert(context.includes("vendor negotiation"), "Should include theme");
  assert(context.includes("Acme Corp pricing"), "Should include context");
  assert(context.includes("Recent topics"), "Should have topics header");
});

test("buildMemoryContext includes preferences", () => {
  cleanup();
  savePreference("walks help after tense calls");
  const context = buildMemoryContext();
  assert(context.includes("walks help"), "Should include preference");
  assert(context.includes("remember"), "Should have remember header");
});

test("buildMemoryContext includes both themes and preferences", () => {
  cleanup();
  saveTheme("board meeting", "Q4 review");
  savePreference("mornings are sacred");
  const context = buildMemoryContext();
  assert(context.includes("board meeting"), "Should include theme");
  assert(context.includes("mornings are sacred"), "Should include preference");
});

test("buildMemoryContext limits to 3 themes", () => {
  cleanup();
  saveTheme("theme 1", "ctx 1");
  saveTheme("theme 2", "ctx 2");
  saveTheme("theme 3", "ctx 3");
  saveTheme("theme 4", "ctx 4");
  const context = buildMemoryContext();
  // Should only include 3 themes (most recent)
  const themeMatches = context.match(/- /g);
  assert(themeMatches !== null && themeMatches.length <= 3, "Should limit to 3 themes");
});

// buildDynamicSystemPrompt tests
test("buildDynamicSystemPrompt includes base prompt", () => {
  cleanup();
  const prompt = buildDynamicSystemPrompt();
  assert(prompt.includes("You are Kai"), "Should include Kai identity");
  assert(prompt.includes("flow state monitoring"), "Should include role");
});

test("buildDynamicSystemPrompt includes warmth level", () => {
  cleanup();
  getUserState(); // Initialize with default warmth 0
  const prompt = buildDynamicSystemPrompt();
  assert(prompt.includes("Warmth Level:"), "Should include warmth header");
  assert(prompt.includes("onboarding"), "Should show onboarding level");
});

test("buildDynamicSystemPrompt includes memory when available", () => {
  cleanup();
  saveTheme("test topic", "test context");
  const prompt = buildDynamicSystemPrompt();
  assert(prompt.includes("User Context"), "Should include context section");
  assert(prompt.includes("test topic"), "Should include the theme");
});

test("buildDynamicSystemPrompt shows crisp level after onboarding", () => {
  cleanup();
  completeOnboarding();
  const prompt = buildDynamicSystemPrompt();
  assert(prompt.includes("crisp"), "Should show crisp level");
  assert(prompt.includes("1.0/3"), "Should show numeric level");
});

// buildOnboardingSystemPrompt tests
test("buildOnboardingSystemPrompt returns onboarding script", () => {
  const prompt = buildOnboardingSystemPrompt();
  assert(prompt.includes("ONBOARDING CALL"), "Should mention onboarding");
  assert(prompt.includes("Hi Michael, this is Kai"), "Should include opening line");
  assert(prompt.includes("under 3 minutes"), "Should mention time limit");
});

test("buildOnboardingSystemPrompt does not include memory context", () => {
  cleanup();
  saveTheme("should not appear", "context");
  const prompt = buildOnboardingSystemPrompt();
  assert(!prompt.includes("should not appear"), "Should not include themes");
  assert(!prompt.includes("User Context"), "Should not have context section");
});

// buildTwilioHumeUrl tests
test("buildTwilioHumeUrl builds correct URL without version", () => {
  const url = buildTwilioHumeUrl("config-123", "api-key-456");
  assert(url.includes("config_id=config-123"), "Should include config ID");
  assert(url.includes("api_key=api-key-456"), "Should include API key");
  assert(!url.includes("version="), "Should not include version");
});

test("buildTwilioHumeUrl builds correct URL with version", () => {
  const url = buildTwilioHumeUrl("config-123", "api-key-456", 5);
  assert(url.includes("version=5"), "Should include version");
});

// extractTranscriptText tests
test("extractTranscriptText returns empty for no transcript", () => {
  const result = extractTranscriptText({
    type: "chat_ended",
    session_id: "s1",
    config_id: "c1",
    timestamp: new Date().toISOString(),
  });
  assert(result === "", "Should be empty");
});

test("extractTranscriptText formats transcript correctly", () => {
  const result = extractTranscriptText({
    type: "chat_ended",
    session_id: "s1",
    config_id: "c1",
    timestamp: new Date().toISOString(),
    transcript: [
      { role: "assistant", content: "Hello", timestamp: "t1" },
      { role: "user", content: "Hi there", timestamp: "t2" },
    ],
  });
  assert(result.includes("assistant: Hello"), "Should include assistant line");
  assert(result.includes("user: Hi there"), "Should include user line");
});

// Cleanup
closeDb();

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
