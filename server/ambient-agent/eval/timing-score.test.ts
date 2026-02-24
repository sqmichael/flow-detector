import { computeTimingScore } from "./timing-score";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
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

console.log("\ntiming-score tests");

test("computes mistimed rate from decision snapshots with send_push actions", () => {
  const entries = [
    {
      timestamp: 1,
      date: "2026-02-24",
      type: "decision_snapshot",
      decision: {
        shouldIntervene: true,
        actions: [
          {
            type: "send_push",
            message: "Check in",
            timing_policy: {
              can_message_now: false,
              current_mode: "meeting",
              next_free_window_minutes: 10,
              location_type: "office",
              calendar_pressure: "high",
            },
          },
        ],
      },
      sent: false,
      deferred_until: "2026-02-24T18:00:00.000Z",
    },
    {
      timestamp: 2,
      date: "2026-02-24",
      type: "decision_snapshot",
      decision: {
        shouldIntervene: true,
        actions: [
          {
            type: "send_push",
            message: "Check in",
            timing_policy: {
              can_message_now: true,
              current_mode: "free",
              next_free_window_minutes: 15,
              location_type: "office",
              calendar_pressure: "low",
            },
          },
        ],
      },
      sent: true,
      deferred_until: null,
    },
    {
      timestamp: 3,
      date: "2026-02-24",
      type: "decision_snapshot",
      decision: {
        shouldIntervene: false,
        actions: [{ type: "no_action" }],
      },
      sent: false,
      deferred_until: null,
    },
  ];

  const summary = computeTimingScore(entries);

  assert(summary.totalSnapshots === 3, "expected 3 snapshots");
  assert(summary.pushDecisions === 2, "expected 2 push decisions");
  assert(summary.scoredPushDecisions === 2, "expected 2 scored push decisions");
  assert(summary.sentPushDecisions === 1, "expected 1 sent push decision");
  assert(summary.deferredPushDecisions === 1, "expected 1 deferred push decision");
  assert(summary.mistimedCount === 1, "expected 1 mistimed decision");
  assert(summary.mistimedRate === 0.5, "expected mistimed rate of 0.5");
  assert(summary.missingTimingPolicy === 0, "expected no missing timing policy entries");
  assert(
    summary.mistimedByReason.can_message_now_false === 1,
    "expected one can_message_now_false reason"
  );
});

test("tracks missing timing policy and falls back to decision-level timing policy", () => {
  const entries = [
    {
      timestamp: 4,
      date: "2026-02-24",
      type: "decision_snapshot",
      decision: {
        shouldIntervene: true,
        actions: [{ type: "send_push", message: "Missing context" }],
      },
      sent: false,
      deferred_until: null,
    },
    {
      timestamp: 5,
      date: "2026-02-24",
      type: "decision_snapshot",
      decision: {
        shouldIntervene: true,
        actions: [{ type: "send_push", message: "Decision-level context" }],
        timing_policy: {
          can_message_now: false,
          current_mode: "focus",
          next_free_window_minutes: 20,
          location_type: "office",
          calendar_pressure: "medium",
        },
      },
      sent: false,
      deferred_until: "2026-02-24T18:20:00.000Z",
    },
  ];

  const summary = computeTimingScore(entries);

  assert(summary.pushDecisions === 2, "expected 2 push decisions");
  assert(summary.scoredPushDecisions === 1, "expected one scored push decision");
  assert(summary.missingTimingPolicy === 1, "expected one missing timing policy");
  assert(summary.mistimedCount === 1, "expected one mistimed decision");
  assert(summary.mistimedRate === 1, "expected mistimed rate of 1.0");
  assert(summary.mistimedByReason.can_message_now_false === 1, "expected can_message_now_false reason");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
