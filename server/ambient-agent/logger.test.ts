import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { InterventionLogger } from "./logger";
import type { Intervention } from "./types";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  ✗ ${name}: ${msg}`);
    failed++;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

console.log("\nlogger tests");

async function run(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "ambient-logger-test-"));
  const logPath = join(dir, "interventions.jsonl");

  try {
    await test("logs decision snapshot with required fields", async () => {
      const logger = new InterventionLogger(logPath);
      const context = { trigger: "stress", hr: 91 };
      const decision = {
        shouldIntervene: true,
        reason: "stress_detected",
        actions: [{ type: "send_push" }],
      };

      await logger.logDecisionSnapshot({
        message_id: "msg-123",
        feedback: { score: 4, note: "less interruption" },
        context,
        decision,
        sent: false,
        deferred_until: "2026-02-24T18:30:00.000Z",
      });

      const content = await readFile(logPath, "utf-8");
      const entries = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      assert(entries.length === 1, "expected exactly one log entry");

      const entry = entries[0] as {
        type?: string;
        message_id?: string | null;
        decision_reason?: string | null;
        feedback?: unknown;
        context?: unknown;
        decision?: unknown;
        sent?: boolean;
        sent_at?: string | null;
        deferred_until?: string | null;
      };
      assert(entry.type === "decision_snapshot", "expected decision_snapshot type");
      assert(entry.message_id === "msg-123", "message_id mismatch");
      assert(entry.decision_reason === "stress_detected", "decision_reason mismatch");
      assert(
        JSON.stringify(entry.feedback) === JSON.stringify({ score: 4, note: "less interruption" }),
        "feedback mismatch"
      );
      assert(JSON.stringify(entry.context) === JSON.stringify(context), "context mismatch");
      assert(JSON.stringify(entry.decision) === JSON.stringify(decision), "decision mismatch");
      assert(entry.sent === false, "sent mismatch");
      assert(entry.sent_at === null, "sent_at should be null when not sent");
      assert(
        entry.deferred_until === "2026-02-24T18:30:00.000Z",
        "deferred_until mismatch"
      );
    });

    await test("logs provided sent_at when decision snapshot is sent", async () => {
      const logger = new InterventionLogger(logPath);
      const sentAt = "2026-02-24T19:00:00.000Z";

      await logger.logDecisionSnapshot({
        message_id: "msg-124",
        context: { trigger: "stress" },
        decision: { shouldIntervene: true, actions: [{ type: "send_push" }] },
        sent: true,
        sent_at: sentAt,
        deferred_until: null,
      });

      const content = await readFile(logPath, "utf-8");
      const entries = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const entry = entries[1] as { sent_at?: string | null; feedback?: unknown };

      assert(entry.sent_at === sentAt, "sent_at should match provided timestamp");
      assert(entry.feedback === null, "feedback should default to null");
    });

    await test("logs explicit decision_reason when provided", async () => {
      const logger = new InterventionLogger(logPath);

      await logger.logDecisionSnapshot({
        message_id: "msg-125",
        decision_reason: "calendar_in_meeting",
        context: { trigger: "calendar" },
        decision: { shouldIntervene: false },
        sent: false,
        deferred_until: null,
      });

      const content = await readFile(logPath, "utf-8");
      const entries = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const entry = entries[2] as { decision_reason?: string | null };

      assert(entry.decision_reason === "calendar_in_meeting", "explicit decision_reason mismatch");
    });

    await test("keeps sent_at null when omitted", async () => {
      const logger = new InterventionLogger(logPath);

      await logger.logDecisionSnapshot({
        message_id: "msg-126",
        context: { trigger: "stress" },
        decision: { shouldIntervene: true, actions: [{ type: "send_push" }] },
        sent: true,
        deferred_until: null,
      });

      const content = await readFile(logPath, "utf-8");
      const entries = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const entry = entries[3] as { sent_at?: string | null };

      assert(entry.sent_at === null, "sent_at should remain null when not provided");
    });

    await test("updateRating works when decision snapshots share the same log file", async () => {
      const logger = new InterventionLogger(logPath);
      const intervention: Intervention = {
        id: "int-mixed-1",
        type: "proactive_checkin",
        triggeredAt: Date.now(),
        trigger: {
          reason: "mixed-log-test",
          context: { hr: 80, hrv: 40 },
        },
      };

      await logger.logDecisionSnapshot({
        message_id: "msg-mixed-1",
        context: { trigger: "stress" },
        decision: { shouldIntervene: true, actions: [{ type: "send_push" }] },
        sent: true,
        deferred_until: null,
      });
      await logger.logIntervention(intervention);

      const updated = await logger.updateRating(intervention.id, {
        wellTimed: 5,
        helpedRegulation: 4,
        feltIntrusive: 1,
        wantAgainTomorrow: true,
      });
      assert(updated, "expected updateRating to succeed with mixed entry types");

      const content = await readFile(logPath, "utf-8");
      const entries = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const updatedIntervention = entries.find((entry) => entry?.intervention?.id === intervention.id);
      assert(updatedIntervention?.intervention?.rating?.wellTimed === 5, "expected intervention rating to be updated");
    });

    await test("updateDecisionSnapshotFeedback sets snapshot feedback by message_id", async () => {
      const logger = new InterventionLogger(logPath);
      const messageId = "int-feedback-1";

      await logger.logDecisionSnapshot({
        message_id: messageId,
        feedback: null,
        context: { trigger: "stress" },
        decision: { shouldIntervene: true, actions: [{ type: "send_push" }] },
        sent: true,
        deferred_until: null,
      });

      const updated = await logger.updateDecisionSnapshotFeedback(messageId, "bad");
      assert(updated, "expected snapshot feedback update to succeed");

      const content = await readFile(logPath, "utf-8");
      const entries = content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
      const snapshot = entries.find((entry) => entry?.type === "decision_snapshot" && entry?.message_id === messageId);
      assert(snapshot?.feedback === "bad", "expected decision snapshot feedback to be updated to bad");
    });

    await test("getDailySummary ignores decision_snapshot rows", async () => {
      const logger = new InterventionLogger(logPath);
      const intervention: Intervention = {
        id: "int-summary-1",
        type: "proactive_checkin",
        triggeredAt: Date.now(),
        trigger: {
          reason: "summary-test",
          context: { hr: 78, hrv: 42 },
        },
      };

      await logger.logDecisionSnapshot({
        message_id: "msg-summary-1",
        context: { trigger: "stress" },
        decision: { shouldIntervene: true, actions: [{ type: "send_push" }] },
        sent: false,
        deferred_until: null,
      });
      await logger.logIntervention(intervention);
      await logger.updateRating(intervention.id, {
        wellTimed: 4,
        helpedRegulation: 4,
        feltIntrusive: 2,
        wantAgainTomorrow: true,
      });

      const today = new Date().toISOString().split("T")[0];
      const summary = await logger.getDailySummary(today);
      assert(summary !== null, "expected a daily summary");
      assert(summary.interventionCount >= 1, "expected intervention rows to be counted");
      assert(summary.avgWellTimed !== null, "expected avgWellTimed to be computed");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
