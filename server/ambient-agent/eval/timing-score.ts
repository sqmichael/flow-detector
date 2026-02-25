#!/usr/bin/env npx tsx
/**
 * Timing Score Replay
 *
 * Computes mistimed rate from logged decision snapshots.
 *
 * Primary metric is feedback-based (explicit user labels).
 * Rule-based timing replay remains a secondary metric.
 *
 * Usage:
 *   npx tsx server/ambient-agent/eval/timing-score.ts [--input <jsonl-path>]
 */

import { readFileSync } from "fs";
import { DEFAULT_CONFIG } from "../types";
import {
  decideTimingPolicy,
  type TimingPolicyContext,
  type TimingMode,
  type TimingLocation,
  type CalendarPressure,
} from "../timing-policy";

const TIMING_MODES: ReadonlySet<TimingMode> = new Set<TimingMode>(["focus", "meeting", "transit", "free"]);
const TIMING_LOCATIONS: ReadonlySet<TimingLocation> = new Set<TimingLocation>(["home", "office", "transit", "other", "unknown"]);
const CALENDAR_PRESSURES: ReadonlySet<CalendarPressure> = new Set<CalendarPressure>(["low", "medium", "high"]);

export interface DecisionSnapshotEntry {
  timestamp: number;
  date: string;
  type: "decision_snapshot";
  decision: unknown;
  feedback: "good" | "bad" | null;
  sent: boolean;
  deferred_until: string | null;
}

export interface TimingScoreSummary {
  totalSnapshots: number;
  pushDecisions: number;
  pushDecisionFeedback: Array<"good" | "bad" | null>;
  feedbackRatedPushDecisions: number;
  scoredPushDecisions: number;
  sentPushDecisions: number;
  deferredPushDecisions: number;
  mistimedCount: number;
  mistimedRate: number | null;
  timingScoredPushDecisions: number;
  timingMistimedCount: number;
  timingMistimedRate: number | null;
  missingTimingPolicy: number;
  mistimedByReason: Record<string, number>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function parsePushFeedback(raw: unknown): "good" | "bad" | null {
  if (raw === "good" || raw === "bad") return raw;
  return null;
}

function toDecisionSnapshot(entry: unknown): DecisionSnapshotEntry | null {
  if (!isObject(entry)) return null;
  if (entry.type !== "decision_snapshot") return null;
  if (typeof entry.timestamp !== "number") return null;
  if (typeof entry.date !== "string") return null;
  if (typeof entry.sent !== "boolean") return null;
  let deferredUntil: string | null;
  if (entry.deferred_until === null) {
    deferredUntil = null;
  } else if (typeof entry.deferred_until === "string") {
    deferredUntil = entry.deferred_until;
  } else {
    return null;
  }

  const feedback = parsePushFeedback(entry.feedback);

  return {
    timestamp: entry.timestamp,
    date: entry.date,
    type: "decision_snapshot",
    decision: entry.decision,
    feedback,
    sent: entry.sent,
    deferred_until: deferredUntil,
  };
}

function getSendPushActions(decision: unknown): Array<Record<string, unknown>> {
  if (!isObject(decision) || !Array.isArray(decision.actions)) return [];

  return decision.actions.filter(
    (action): action is Record<string, unknown> =>
      isObject(action) && action.type === "send_push"
  );
}

function parseTimingContext(raw: unknown): TimingPolicyContext | null {
  if (!isObject(raw)) return null;

  if (typeof raw.can_message_now !== "boolean") return null;
  if (typeof raw.current_mode !== "string" || !TIMING_MODES.has(raw.current_mode as TimingMode)) return null;
  if (
    raw.next_free_window_minutes !== null &&
    (typeof raw.next_free_window_minutes !== "number" || Number.isNaN(raw.next_free_window_minutes))
  ) {
    return null;
  }
  if (typeof raw.location_type !== "string" || !TIMING_LOCATIONS.has(raw.location_type as TimingLocation)) return null;
  if (
    typeof raw.calendar_pressure !== "string" ||
    !CALENDAR_PRESSURES.has(raw.calendar_pressure as CalendarPressure)
  ) {
    return null;
  }

  return {
    canMessageNow: raw.can_message_now,
    currentMode: raw.current_mode as TimingMode,
    nextFreeWindowMinutes: raw.next_free_window_minutes as number | null,
    locationType: raw.location_type as TimingLocation,
    calendarPressure: raw.calendar_pressure as CalendarPressure,
  };
}

function getTimingPolicyContext(snapshot: DecisionSnapshotEntry): TimingPolicyContext | null {
  const pushActions = getSendPushActions(snapshot.decision);
  for (const action of pushActions) {
    const parsed = parseTimingContext(action.timing_policy);
    if (parsed) return parsed;
  }

  if (isObject(snapshot.decision)) {
    const parsed = parseTimingContext(snapshot.decision.timing_policy);
    if (parsed) return parsed;
  }

  return null;
}

export function computeTimingScore(entries: unknown[]): TimingScoreSummary {
  const snapshots = entries
    .map(toDecisionSnapshot)
    .filter((entry): entry is DecisionSnapshotEntry => entry !== null);

  let pushDecisions = 0;
  const pushDecisionFeedback: Array<"good" | "bad" | null> = [];
  let feedbackRatedPushDecisions = 0;
  let scoredPushDecisions = 0;
  let sentPushDecisions = 0;
  let deferredPushDecisions = 0;
  let mistimedCount = 0;
  let timingScoredPushDecisions = 0;
  let timingMistimedCount = 0;
  let missingTimingPolicy = 0;
  const mistimedByReason: Record<string, number> = {};

  for (const snapshot of snapshots) {
    const pushActions = getSendPushActions(snapshot.decision);
    if (pushActions.length === 0) continue;

    pushDecisions++;
    pushDecisionFeedback.push(snapshot.feedback);
    if (snapshot.feedback !== null) feedbackRatedPushDecisions++;
    if (snapshot.sent) sentPushDecisions++;
    if (snapshot.deferred_until !== null) deferredPushDecisions++;

    const timingContext = getTimingPolicyContext(snapshot);
    let timingMistimed = false;
    if (!timingContext) {
      missingTimingPolicy++;
    } else {
      timingScoredPushDecisions++;
      const timingDecision = decideTimingPolicy(timingContext);
      timingMistimed = !timingDecision.messageNow;
      if (timingMistimed) {
        timingMistimedCount++;
        mistimedByReason[timingDecision.reason] = (mistimedByReason[timingDecision.reason] || 0) + 1;
      }
    }

    if (snapshot.feedback !== null) {
      scoredPushDecisions++;
    }

    if (snapshot.feedback === "bad") {
      mistimedCount++;
    }
  }

  return {
    totalSnapshots: snapshots.length,
    pushDecisions,
    pushDecisionFeedback,
    feedbackRatedPushDecisions,
    scoredPushDecisions,
    sentPushDecisions,
    deferredPushDecisions,
    mistimedCount,
    mistimedRate: scoredPushDecisions > 0 ? mistimedCount / scoredPushDecisions : null,
    timingScoredPushDecisions,
    timingMistimedCount,
    timingMistimedRate: timingScoredPushDecisions > 0 ? timingMistimedCount / timingScoredPushDecisions : null,
    missingTimingPolicy,
    mistimedByReason,
  };
}

function parseArgs(): { inputPath: string } {
  const args = process.argv.slice(2);
  let inputPath = DEFAULT_CONFIG.logPath;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input") {
      inputPath = args[++i];
    }
  }

  return { inputPath };
}

function printSummary(summary: TimingScoreSummary, inputPath: string): void {
  console.log("\n=== Timing Score Replay ===");
  console.log(`Input: ${inputPath}`);
  console.log(`Decision snapshots: ${summary.totalSnapshots}`);
  console.log(`Push decisions: ${summary.pushDecisions}`);
  console.log(`Feedback-rated push decisions: ${summary.feedbackRatedPushDecisions}`);
  console.log(`Scored push decisions: ${summary.scoredPushDecisions}`);
  console.log(`Push decisions sent: ${summary.sentPushDecisions}`);
  console.log(`Push decisions deferred: ${summary.deferredPushDecisions}`);
  console.log(`Mistimed count: ${summary.mistimedCount}`);
  console.log(
    `Mistimed rate (feedback-aware): ${summary.mistimedRate === null ? "n/a" : `${(summary.mistimedRate * 100).toFixed(1)}%`}`
  );
  console.log(`Timing-scored push decisions: ${summary.timingScoredPushDecisions}`);
  console.log(`Timing mistimed count: ${summary.timingMistimedCount}`);
  console.log(
    `Timing mistimed rate: ${summary.timingMistimedRate === null ? "n/a" : `${(summary.timingMistimedRate * 100).toFixed(1)}%`}`
  );
  console.log(`Missing timing policy: ${summary.missingTimingPolicy}`);

  const reasonEntries = Object.entries(summary.mistimedByReason).sort((a, b) => b[1] - a[1]);
  if (reasonEntries.length > 0) {
    console.log("Mistimed reasons:");
    for (const [reason, count] of reasonEntries) {
      console.log(`  - ${reason}: ${count}`);
    }
  }

  console.log();
}

function main(): void {
  const { inputPath } = parseArgs();

  const content = readFileSync(inputPath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  const entries: unknown[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Keep replay robust to malformed lines in long-running logs.
    }
  }

  const summary = computeTimingScore(entries);
  printSummary(summary, inputPath);
}

if (require.main === module) {
  main();
}
