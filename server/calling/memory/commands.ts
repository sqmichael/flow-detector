/**
 * Voice Command Processing
 *
 * Detects and executes memory-related voice commands:
 * - "Remember that..." → Save preference
 * - "Forget what I said about..." → Delete matching memory
 * - "What do you remember?" → Return summary
 * - "Dismiss" / "Not now" → Ripcord
 */

import {
  VoiceCommand,
  CommandResult,
} from "./types";
import {
  savePreference,
  forgetByKeyword,
  formatMemorySummaryForVoice,
  recordRipcord,
} from "./service";

// === Command Detection Patterns ===

const REMEMBER_PATTERNS = [
  /remember that (.+)/i,
  /remember (.+)/i,
  /save that (.+)/i,
  /keep in mind that (.+)/i,
];

const FORGET_PATTERNS = [
  /forget (?:what i said )?about (.+)/i,
  /forget (.+)/i,
  /delete (?:what i said )?about (.+)/i,
  /remove (.+)/i,
];

const QUERY_PATTERNS = [
  /what do you remember/i,
  /what have you saved/i,
  /what do you know about me/i,
  /show me (?:my )?memories/i,
];

const RIPCORD_PATTERNS = [
  /^\s*dismiss[.!]?\s*$/i,
  /^\s*not now[.!]?\s*$/i,
  /^\s*bad timing[.!]?\s*$/i,
  /^\s*forget it[.!]?\s*$/i,
  /dismiss and forget/i,
  /^\s*stop[.!]?\s*$/i,
  /^\s*end call[.!]?\s*$/i,
];

// === Command Detection ===

export function detectCommand(transcript: string): VoiceCommand | null {
  const text = transcript.trim();

  // Check ripcord first (highest priority)
  for (const pattern of RIPCORD_PATTERNS) {
    if (pattern.test(text)) {
      return { type: "ripcord" };
    }
  }

  // Check query
  for (const pattern of QUERY_PATTERNS) {
    if (pattern.test(text)) {
      return { type: "query" };
    }
  }

  // Check forget (before remember, to catch "forget" not "remember to forget")
  for (const pattern of FORGET_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return { type: "forget", target: match[1].trim() };
    }
  }

  // Check remember
  for (const pattern of REMEMBER_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return { type: "remember", content: match[1].trim() };
    }
  }

  return null;
}

// === Command Execution ===

export function executeCommand(command: VoiceCommand): CommandResult {
  switch (command.type) {
    case "remember":
      return executeRemember(command.content);

    case "forget":
      return executeForget(command.target);

    case "query":
      return executeQuery();

    case "ripcord":
      return executeRipcord();
  }
}

function executeRemember(content: string): CommandResult {
  try {
    savePreference(content);
    return {
      success: true,
      response: "Got it.",
    };
  } catch (error) {
    console.error("[Memory] Failed to save preference:", error);
    return {
      success: false,
      response: "Sorry, I couldn't save that.",
    };
  }
}

function executeForget(target: string): CommandResult {
  const result = forgetByKeyword(target);

  if (result.deleted) {
    return {
      success: true,
      response: "Done.",
    };
  }

  return {
    success: false,
    response: "I don't have anything saved about that.",
  };
}

function executeQuery(): CommandResult {
  const summary = formatMemorySummaryForVoice();
  return {
    success: true,
    response: summary,
  };
}

function executeRipcord(): CommandResult {
  // Update user state to track ripcord
  recordRipcord();

  return {
    success: true,
    response: "", // No response, just end
    action: "end_call",
  };
}

// === Convenience function ===

export function processTranscript(transcript: string): CommandResult | null {
  const command = detectCommand(transcript);
  if (!command) {
    return null;
  }
  return executeCommand(command);
}
