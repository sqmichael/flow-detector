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

test("keeps feedback mistimed rate primary and timing replay as secondary", () => {
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
  assert(
    JSON.stringify(summary.pushDecisionFeedback) === JSON.stringify([null, null]),
    "expected null feedback for unrated push decisions"
  );
  assert(summary.feedbackRatedPushDecisions === 0, "expected no feedback-rated push decisions");
  assert(summary.scoredPushDecisions === 0, "expected no feedback-scored push decisions");
  assert(summary.sentPushDecisions === 1, "expected 1 sent push decision");
  assert(summary.deferredPushDecisions === 1, "expected 1 deferred push decision");
  assert(summary.mistimedCount === 0, "expected 0 feedback-labeled mistimed decisions");
  assert(summary.mistimedRate === null, "expected null feedback mistimed rate without ratings");
  assert(summary.timingScoredPushDecisions === 2, "expected 2 timing-scored push decisions");
  assert(summary.timingMistimedCount === 1, "expected 1 timing mistimed decision");
  assert(summary.timingMistimedRate === 0.5, "expected timing mistimed rate of 0.5");
  assert(summary.missingTimingPolicy === 0, "expected no missing timing policy entries");
  assert(
    summary.mistimedByReason.can_message_now_false === 1,
    "expected one can_message_now_false reason"
  );
});

test("tracks missing timing policy and keeps decision-level timing policy as secondary", () => {
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
  assert(
    JSON.stringify(summary.pushDecisionFeedback) === JSON.stringify([null, null]),
    "expected null feedback when not present"
  );
  assert(summary.feedbackRatedPushDecisions === 0, "expected no feedback-rated push decisions");
  assert(summary.scoredPushDecisions === 0, "expected no feedback-scored push decisions");
  assert(summary.timingScoredPushDecisions === 1, "expected one timing-scored push decision");
  assert(summary.timingMistimedCount === 1, "expected one timing mistimed decision");
  assert(summary.timingMistimedRate === 1, "expected timing mistimed rate of 1.0");
  assert(summary.missingTimingPolicy === 1, "expected one missing timing policy");
  assert(summary.mistimedCount === 0, "expected no feedback-labeled mistimed decisions");
  assert(summary.mistimedRate === null, "expected null feedback mistimed rate");
  assert(summary.mistimedByReason.can_message_now_false === 1, "expected can_message_now_false reason");
});

test("parses push decision feedback as null|good|bad", () => {
  const entries = [
    {
      timestamp: 6,
      date: "2026-02-24",
      type: "decision_snapshot",
      feedback: "good",
      decision: {
        shouldIntervene: true,
        actions: [{ type: "send_push" }],
      },
      sent: true,
      deferred_until: null,
    },
    {
      timestamp: 7,
      date: "2026-02-24",
      type: "decision_snapshot",
      feedback: "bad",
      decision: {
        shouldIntervene: true,
        actions: [{ type: "send_push" }],
      },
      sent: true,
      deferred_until: null,
    },
    {
      timestamp: 8,
      date: "2026-02-24",
      type: "decision_snapshot",
      feedback: "ok",
      decision: {
        shouldIntervene: true,
        actions: [{ type: "send_push" }],
      },
      sent: true,
      deferred_until: null,
    },
    {
      timestamp: 9,
      date: "2026-02-24",
      type: "decision_snapshot",
      feedback: "good",
      decision: {
        shouldIntervene: false,
        actions: [{ type: "no_action" }],
      },
      sent: false,
      deferred_until: null,
    },
  ];

  const summary = computeTimingScore(entries);
  assert(summary.pushDecisions === 3, "expected 3 push decisions");
  assert(
    JSON.stringify(summary.pushDecisionFeedback) === JSON.stringify(["good", "bad", null]),
    "expected normalized feedback for push decisions only"
  );
  assert(summary.feedbackRatedPushDecisions === 2, "expected 2 feedback-rated push decisions");
  assert(summary.scoredPushDecisions === 2, "expected 2 feedback-scored push decisions");
  assert(summary.mistimedCount === 1, "expected one feedback-labeled mistimed decision");
  assert(summary.mistimedRate === 0.5, "expected feedback-aware mistimed rate of 0.5");
  assert(summary.timingScoredPushDecisions === 0, "expected no timing-scored push decisions");
  assert(summary.timingMistimedCount === 0, "expected no timing mistimed decisions");
  assert(summary.timingMistimedRate === null, "expected null timing mistimed rate");
});

test("uses feedback as primary mistimed signal while retaining timing replay as secondary", () => {
  const entries = [
    {
      timestamp: 10,
      date: "2026-02-24",
      type: "decision_snapshot",
      feedback: "good",
      decision: {
        shouldIntervene: true,
        actions: [
          {
            type: "send_push",
            timing_policy: {
              can_message_now: false,
              current_mode: "meeting",
              next_free_window_minutes: 15,
              location_type: "office",
              calendar_pressure: "high",
            },
          },
        ],
      },
      sent: false,
      deferred_until: "2026-02-24T18:30:00.000Z",
    },
    {
      timestamp: 11,
      date: "2026-02-24",
      type: "decision_snapshot",
      feedback: "bad",
      decision: {
        shouldIntervene: true,
        actions: [
          {
            type: "send_push",
            timing_policy: {
              can_message_now: true,
              current_mode: "free",
              next_free_window_minutes: 5,
              location_type: "home",
              calendar_pressure: "low",
            },
          },
        ],
      },
      sent: true,
      deferred_until: null,
    },
    {
      timestamp: 12,
      date: "2026-02-24",
      type: "decision_snapshot",
      decision: {
        shouldIntervene: true,
        actions: [
          {
            type: "send_push",
            timing_policy: {
              can_message_now: false,
              current_mode: "focus",
              next_free_window_minutes: 25,
              location_type: "office",
              calendar_pressure: "medium",
            },
          },
        ],
      },
      sent: false,
      deferred_until: "2026-02-24T18:40:00.000Z",
    },
  ];

  const summary = computeTimingScore(entries);

  assert(summary.pushDecisions === 3, "expected 3 push decisions");
  assert(summary.feedbackRatedPushDecisions === 2, "expected 2 feedback-rated decisions");
  assert(summary.scoredPushDecisions === 2, "expected only feedback-rated push decisions to be scored");
  assert(summary.mistimedCount === 1, "expected one feedback-labeled mistimed decision");
  assert(summary.mistimedRate === 0.5, "expected feedback-aware mistimed rate of 0.5");
  assert(summary.timingScoredPushDecisions === 3, "expected 3 timing-scored decisions");
  assert(summary.timingMistimedCount === 2, "expected 2 timing mistimed decisions");
  assert(summary.timingMistimedRate === 2 / 3, "expected timing mistimed rate of 2/3");
  assert(
    summary.mistimedByReason.can_message_now_false === 2,
    "expected timing reasons to include two can_message_now_false decisions"
  );
});

test("scores feedback-present push entries even when timing policy is missing", () => {
  const entries = [
    {
      timestamp: 13,
      date: "2026-02-24",
      type: "decision_snapshot",
      feedback: "bad",
      decision: {
        shouldIntervene: true,
        actions: [{ type: "send_push", message: "Missing timing context" }],
      },
      sent: true,
      deferred_until: null,
    },
    {
      timestamp: 14,
      date: "2026-02-24",
      type: "decision_snapshot",
      feedback: "good",
      decision: {
        shouldIntervene: true,
        actions: [
          {
            type: "send_push",
            message: "Has timing context",
            timing_policy: {
              can_message_now: false,
              current_mode: "meeting",
              next_free_window_minutes: 20,
              location_type: "office",
              calendar_pressure: "high",
            },
          },
        ],
      },
      sent: false,
      deferred_until: "2026-02-24T18:50:00.000Z",
    },
  ];

  const summary = computeTimingScore(entries);

  assert(summary.pushDecisions === 2, "expected 2 push decisions");
  assert(
    JSON.stringify(summary.pushDecisionFeedback) === JSON.stringify(["bad", "good"]),
    "expected feedback to be tracked for all feedback-present push entries"
  );
  assert(summary.feedbackRatedPushDecisions === 2, "expected 2 feedback-rated push decisions");
  assert(summary.scoredPushDecisions === 2, "expected 2 feedback-scored push decisions");
  assert(summary.mistimedCount === 1, "expected one feedback-labeled mistimed decision");
  assert(summary.mistimedRate === 0.5, "expected feedback mistimed rate of 0.5");
  assert(summary.timingScoredPushDecisions === 1, "expected only one timing-scored push decision");
  assert(summary.missingTimingPolicy === 1, "expected one missing timing policy");
  assert(summary.timingMistimedCount === 1, "expected one timing mistimed decision");
  assert(summary.timingMistimedRate === 1, "expected timing mistimed rate of 1.0");
  assert(summary.sentPushDecisions === 1, "expected one sent push decision");
  assert(summary.deferredPushDecisions === 1, "expected one deferred push decision");
  assert(
    summary.mistimedByReason.can_message_now_false === 1,
    "expected one timing reason for can_message_now_false"
  );
});

test("treats feedback-missing push entries as unrated while preserving timing replay", () => {
  const entries = [
    {
      timestamp: 15,
      date: "2026-02-24",
      type: "decision_snapshot",
      feedback: "bad",
      decision: {
        shouldIntervene: true,
        actions: [
          {
            type: "send_push",
            timing_policy: {
              can_message_now: true,
              current_mode: "free",
              next_free_window_minutes: 5,
              location_type: "home",
              calendar_pressure: "low",
            },
          },
        ],
      },
      sent: true,
      deferred_until: null,
    },
    {
      timestamp: 16,
      date: "2026-02-24",
      type: "decision_snapshot",
      decision: {
        shouldIntervene: true,
        actions: [{ type: "send_push", message: "Missing feedback and timing" }],
      },
      sent: false,
      deferred_until: null,
    },
    {
      timestamp: 17,
      date: "2026-02-24",
      type: "decision_snapshot",
      feedback: "good",
      decision: {
        shouldIntervene: true,
        actions: [
          {
            type: "send_push",
            timing_policy: {
              can_message_now: false,
              current_mode: "focus",
              next_free_window_minutes: 30,
              location_type: "office",
              calendar_pressure: "medium",
            },
          },
        ],
      },
      sent: false,
      deferred_until: "2026-02-24T19:00:00.000Z",
    },
  ];

  const summary = computeTimingScore(entries);

  assert(summary.pushDecisions === 3, "expected 3 push decisions");
  assert(
    JSON.stringify(summary.pushDecisionFeedback) === JSON.stringify(["bad", null, "good"]),
    "expected missing feedback to normalize to null in push feedback list"
  );
  assert(summary.feedbackRatedPushDecisions === 2, "expected only 2 feedback-rated push decisions");
  assert(summary.scoredPushDecisions === 2, "expected only feedback-present push decisions to be scored");
  assert(summary.mistimedCount === 1, "expected one feedback-labeled mistimed decision");
  assert(summary.mistimedRate === 0.5, "expected feedback mistimed rate of 0.5");
  assert(summary.timingScoredPushDecisions === 2, "expected two timing-scored push decisions");
  assert(summary.missingTimingPolicy === 1, "expected one missing timing policy");
  assert(summary.timingMistimedCount === 1, "expected one timing mistimed decision");
  assert(summary.timingMistimedRate === 0.5, "expected timing mistimed rate of 0.5");
  assert(summary.sentPushDecisions === 1, "expected one sent push decision");
  assert(summary.deferredPushDecisions === 1, "expected one deferred push decision");
  assert(
    summary.mistimedByReason.can_message_now_false === 1,
    "expected one timing reason for can_message_now_false"
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
