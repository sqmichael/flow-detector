import { AmbientAgent, evaluatePushTimingGate, hasMissingCalendarTimingContext } from "./agent";
import type { Intervention, OpenClawResponse } from "./types";
import type { CalendarContext } from "./openclaw-context";
import { existsSync, unlinkSync } from "fs";

let passed = 0;
let failed = 0;
const TEST_LOG_PATH = "/tmp/test-ambient-agent-timing-policy.jsonl";

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

function makeAgent(): AmbientAgent {
  if (existsSync(TEST_LOG_PATH)) unlinkSync(TEST_LOG_PATH);
  return new AmbientAgent({
    relayUrl: "ws://localhost:9999/browser",
    logPath: TEST_LOG_PATH,
  });
}

function makeIntervention(type: Intervention["type"], triggeredAt: number): Intervention {
  return {
    id: `int_${triggeredAt}`,
    type,
    triggeredAt,
    trigger: {
      reason: "test",
      context: {},
    },
  };
}

function makeCalendar(overrides: Partial<CalendarContext> = {}): CalendarContext {
  return {
    upcoming: [],
    inMeeting: false,
    currentMeeting: null,
    minutesToNext: null,
    ...overrides,
  };
}

console.log("\nagent timing-policy gate tests");

async function run(): Promise<void> {
  await test("evaluatePushTimingGate allows valid message_now context", () => {
  const result = evaluatePushTimingGate({
    can_message_now: true,
    current_mode: "free",
    next_free_window_minutes: 30,
    location_type: "office",
    calendar_pressure: "low",
  });

  assert(result.messageNow === true, "valid context should allow message_now=true");
  assert(result.reason === "free_window_available", "expected free_window_available reason");
  assert(result.delayMinutes === null, "message_now=true should not include delay");
  });

  await test("evaluatePushTimingGate fails safe on unknown context", () => {
    const result = evaluatePushTimingGate(null);
    assert(result.messageNow === false, "unknown context should default to message_now=false");
    assert(result.reason === "bad_or_unknown_context", "unknown context reason mismatch");
    assert(result.delayMinutes === null, "unknown context should not include delay");
  });

  await test("hasMissingCalendarTimingContext detects missing calendar fields", () => {
    const missingPressure = hasMissingCalendarTimingContext({
      can_message_now: true,
      current_mode: "free",
      next_free_window_minutes: 20,
      location_type: "office",
    });
    assert(missingPressure === true, "missing calendar_pressure should be detected");

    const missingWindow = hasMissingCalendarTimingContext({
      can_message_now: true,
      current_mode: "free",
      location_type: "office",
      calendar_pressure: "low",
    });
    assert(missingWindow === true, "missing next_free_window_minutes should be detected");

    const complete = hasMissingCalendarTimingContext({
      can_message_now: true,
      current_mode: "free",
      next_free_window_minutes: 20,
      location_type: "office",
      calendar_pressure: "low",
    });
    assert(complete === false, "complete timing payload should not be flagged");
  });

  await test("evaluatePushTimingGate maps partial timing payload to delay-safe decision", () => {
    const result = evaluatePushTimingGate({
      can_message_now: false,
      current_mode: "meeting",
      location_type: "office",
      // next_free_window_minutes + calendar_pressure are missing
    });
    assert(result.messageNow === false, "partial payload should not message now");
    assert(result.reason === "can_message_now_false", "partial payload should normalize to deterministic gate");
    assert(result.delayMinutes === null, "missing free window should keep delay null when can_message_now=false");
  });

  await test("evaluatePushTimingGate maps missing calendar_pressure to high", () => {
    const result = evaluatePushTimingGate({
      can_message_now: true,
      current_mode: "free",
      next_free_window_minutes: 20,
      location_type: "office",
    });
    assert(result.messageNow === false, "missing calendar_pressure should fail safe");
    assert(result.reason === "high_calendar_pressure", "missing calendar_pressure should map to high");
    assert(result.delayMinutes === 20, "delay should use provided next_free_window_minutes");
  });

  await test("evaluatePushTimingGate derives calendar_pressure from available calendar context", () => {
    const result = evaluatePushTimingGate(
      {
        can_message_now: true,
        current_mode: "free",
        next_free_window_minutes: 20,
        location_type: "office",
      },
      makeCalendar()
    );
    assert(result.messageNow === true, "clear calendar should allow message_now=true");
    assert(result.reason === "free_window_available", "clear calendar should produce free_window_available");
    assert(result.delayMinutes === null, "clear calendar should not include delay");
  });

  await test("evaluatePushTimingGate derives next_free_window_minutes from available calendar context", () => {
    const result = evaluatePushTimingGate(
      {
        can_message_now: true,
        current_mode: "free",
        location_type: "office",
        calendar_pressure: "low",
      },
      makeCalendar({
        minutesToNext: 20,
        upcoming: [
          {
            summary: "1:1",
            start: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
            end: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
            status: "confirmed",
          },
        ],
      })
    );
    assert(result.messageNow === true, "calendar-derived free window should allow message_now=true");
    assert(result.reason === "free_window_available", "calendar-derived free window should produce free_window_available");
    assert(result.delayMinutes === null, "calendar-derived free window should not include delay");
  });

  await test("evaluatePushTimingGate defaults missing next_free_window_minutes to null", () => {
    const result = evaluatePushTimingGate({
      can_message_now: true,
      current_mode: "free",
      location_type: "office",
      calendar_pressure: "low",
    });
    assert(result.messageNow === false, "missing next_free_window_minutes should fail safe");
    assert(result.reason === "no_free_window", "missing next_free_window_minutes should normalize to null");
    assert(result.delayMinutes === 15, "missing free window should use default delay");
  });

  await test("evaluatePushTimingGate returns calendar_missing when calendar fields are both absent", () => {
    const result = evaluatePushTimingGate({
      can_message_now: true,
      current_mode: "free",
      location_type: "office",
    });
    assert(result.messageNow === false, "missing calendar fields should fail safe");
    assert(result.reason === "calendar_missing", "missing calendar fields should map to calendar_missing");
    assert(result.delayMinutes === 15, "calendar missing should use default delay");
  });

  await test("send_push is skipped safely when calendar integration is disconnected", async () => {
    const agent = makeAgent();
    const response = {
      shouldIntervene: true,
      reasoning: "Check in now",
      actions: [
        {
          type: "send_push",
          message: "Checking in",
          timing_policy: {
            can_message_now: true,
            current_mode: "free",
            next_free_window_minutes: 10,
            location_type: "office",
          },
        },
      ],
    } as unknown as OpenClawResponse;

    const execution = await (agent as any).executeOpenClawActions(response, null);
    const interventions = ((agent as any).state.interventionsToday as unknown[]);
    assert(interventions.length === 0, "disconnected calendar integration should suppress send_push");
    assert(execution.sent === false, "disconnected calendar integration should fail safe");
    assert(execution.decisionReason === "high_calendar_pressure", "should default to conservative pressure when calendar is null");
  });

  await test("send_push is skipped when timing context is missing", async () => {
    const agent = makeAgent();
    const response: OpenClawResponse = {
      shouldIntervene: true,
      reasoning: "Check in now",
      actions: [{ type: "send_push", message: "Checking in" }],
    };

    const execution = await (agent as any).executeOpenClawActions(response);
    const interventions = ((agent as any).state.interventionsToday as unknown[]);
    assert(interventions.length === 0, "send_push should be skipped when timing context is missing");
    assert(execution.sent === false, "send_push skip should mark sent=false");
    assert(execution.deferredUntil === null, "missing timing context should not set deferredUntil");
    assert(execution.decisionReason === "bad_or_unknown_context", "expected bad_or_unknown_context decision reason");
    assert(
      JSON.stringify(execution.feedback) === JSON.stringify({
        action: "send_push",
        outcome: "skipped",
        reason: "bad_or_unknown_context",
        deferred_until: null,
      }),
      "expected push feedback for skipped send_push"
    );
  });

  await test("send_push skip captures deferredUntil when next free window is known", async () => {
    const agent = makeAgent();
    const before = Date.now();
    const response = {
      shouldIntervene: true,
      reasoning: "Wait until free window",
      actions: [
        {
          type: "send_push",
          message: "Checking in",
          timing_policy: {
            can_message_now: false,
            current_mode: "meeting",
            next_free_window_minutes: 10,
            location_type: "office",
            calendar_pressure: "high",
          },
        },
      ],
    } as unknown as OpenClawResponse;

    const execution = await (agent as any).executeOpenClawActions(response);

    assert(execution.sent === false, "deferred send_push should mark sent=false");
    assert(execution.decisionReason === "can_message_now_false", "expected can_message_now_false decision reason");
    assert(typeof execution.deferredUntil === "string", "expected deferredUntil to be set");
    const feedback = execution.feedback as { deferred_until?: string | null; reason?: string; outcome?: string };
    assert(feedback?.outcome === "skipped", "expected skipped feedback outcome");
    assert(feedback?.reason === "can_message_now_false", "expected can_message_now_false feedback reason");
    assert(typeof feedback?.deferred_until === "string", "expected deferred_until feedback timestamp");
    const deferredMs = Date.parse(execution.deferredUntil as string);
    assert(!Number.isNaN(deferredMs), "deferredUntil should be a valid ISO timestamp");
    assert(
      deferredMs >= before + 9 * 60 * 1000 && deferredMs <= before + 11 * 60 * 1000,
      "deferredUntil should be about 10 minutes in the future"
    );
  });

  await test("send_push skip captures deferredUntil when calendar_pressure is missing", async () => {
    const agent = makeAgent();
    const before = Date.now();
    const response = {
      shouldIntervene: true,
      reasoning: "Wait until free window",
      actions: [
        {
          type: "send_push",
          message: "Checking in",
          timing_policy: {
            can_message_now: true,
            current_mode: "free",
            next_free_window_minutes: 10,
            location_type: "office",
          },
        },
      ],
    } as unknown as OpenClawResponse;

    const execution = await (agent as any).executeOpenClawActions(response);

    assert(execution.sent === false, "deferred send_push should mark sent=false");
    assert(typeof execution.deferredUntil === "string", "expected deferredUntil to be set");
    const deferredMs = Date.parse(execution.deferredUntil as string);
    assert(!Number.isNaN(deferredMs), "deferredUntil should be a valid ISO timestamp");
    assert(
      deferredMs >= before + 9 * 60 * 1000 && deferredMs <= before + 11 * 60 * 1000,
      "deferredUntil should be about 10 minutes in the future"
    );
  });

  await test("send_push uses integrated calendar context when calendar_pressure is missing", async () => {
    const agent = makeAgent();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("", { status: 200 });

    try {
      const response = {
        shouldIntervene: true,
        reasoning: "Check in now",
        actions: [
          {
            type: "send_push",
            message: "Checking in",
            timing_policy: {
              can_message_now: true,
              current_mode: "free",
              next_free_window_minutes: 10,
              location_type: "office",
            },
          },
        ],
      } as unknown as OpenClawResponse;

      const execution = await (agent as any).executeOpenClawActions(response, makeCalendar());
      const interventions = ((agent as any).state.interventionsToday as unknown[]);

      assert(execution.sent === true, "calendar-derived pressure should allow send_push");
      assert(execution.decisionReason === "push_sent", "expected push_sent decision reason");
      assert(interventions.length === 1, "send_push should create one intervention");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test("send_push is deferred with default delay when both calendar timing fields are missing", async () => {
    const agent = makeAgent();
    const before = Date.now();
    const response = {
      shouldIntervene: true,
      reasoning: "Wait for better timing",
      actions: [
        {
          type: "send_push",
          message: "Checking in",
          timing_policy: {
            can_message_now: true,
            current_mode: "free",
            location_type: "office",
          },
        },
      ],
    } as unknown as OpenClawResponse;

    const execution = await (agent as any).executeOpenClawActions(response);
    const interventions = ((agent as any).state.interventionsToday as unknown[]);
    assert(interventions.length === 0, "send_push should be skipped when calendar timing fields are missing");
    assert(execution.sent === false, "send_push skip should mark sent=false");
    assert(execution.decisionReason === "calendar_missing", "expected calendar_missing decision reason");
    assert(typeof execution.deferredUntil === "string", "expected deferredUntil to be set");
    const deferredMs = Date.parse(execution.deferredUntil as string);
    assert(!Number.isNaN(deferredMs), "deferredUntil should be a valid ISO timestamp");
    assert(
      deferredMs >= before + 14 * 60 * 1000 && deferredMs <= before + 16 * 60 * 1000,
      "deferredUntil should be about 15 minutes in the future"
    );
  });

  await test("send_push skip captures deferredUntil when next_free_window_minutes is missing", async () => {
    const agent = makeAgent();
    const before = Date.now();
    const response = {
      shouldIntervene: true,
      reasoning: "Wait for safer window",
      actions: [
        {
          type: "send_push",
          message: "Checking in",
          timing_policy: {
            can_message_now: true,
            current_mode: "free",
            location_type: "office",
            calendar_pressure: "low",
          },
        },
      ],
    } as unknown as OpenClawResponse;

    const execution = await (agent as any).executeOpenClawActions(response);

    assert(execution.sent === false, "deferred send_push should mark sent=false");
    assert(typeof execution.deferredUntil === "string", "expected deferredUntil to be set");
    const deferredMs = Date.parse(execution.deferredUntil as string);
    assert(!Number.isNaN(deferredMs), "deferredUntil should be a valid ISO timestamp");
    assert(
      deferredMs >= before + 14 * 60 * 1000 && deferredMs <= before + 16 * 60 * 1000,
      "deferredUntil should be about 15 minutes in the future"
    );
  });

  await test("send_push uses integrated calendar context when next_free_window_minutes is missing", async () => {
    const agent = makeAgent();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("", { status: 200 });

    try {
      const response = {
        shouldIntervene: true,
        reasoning: "Check in now",
        actions: [
          {
            type: "send_push",
            message: "Checking in",
            timing_policy: {
              can_message_now: true,
              current_mode: "free",
              location_type: "office",
              calendar_pressure: "low",
            },
          },
        ],
      } as unknown as OpenClawResponse;

      const execution = await (agent as any).executeOpenClawActions(
        response,
        makeCalendar({
          minutesToNext: 20,
          upcoming: [
            {
              summary: "1:1",
              start: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
              end: new Date(Date.now() + 50 * 60 * 1000).toISOString(),
              status: "confirmed",
            },
          ],
        })
      );
      const interventions = ((agent as any).state.interventionsToday as unknown[]);

      assert(execution.sent === true, "calendar-derived next_free_window_minutes should allow send_push");
      assert(execution.decisionReason === "push_sent", "expected push_sent decision reason");
      assert(interventions.length === 1, "send_push should create one intervention");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test("send_push success returns messageId from created intervention", async () => {
    const agent = makeAgent();
    const before = Date.now();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response("", { status: 200 });

    try {
      const response = {
        shouldIntervene: true,
        reasoning: "Check in now",
        actions: [
          {
            type: "send_push",
            message: "Checking in",
            timing_policy: {
              can_message_now: true,
              current_mode: "free",
              next_free_window_minutes: 20,
              location_type: "office",
              calendar_pressure: "low",
            },
          },
        ],
      } as unknown as OpenClawResponse;

      const execution = await (agent as any).executeOpenClawActions(response);
      const interventions = (agent as any).state.interventionsToday as Array<{ id: string }>;
      const pushIntervention = interventions.find((entry) => entry.id.startsWith("int_"));

      assert(execution.sent === true, "send_push should mark sent=true");
      assert(execution.decisionReason === "push_sent", "expected push_sent decision reason");
      assert(typeof execution.messageId === "string", "expected messageId to be set");
      assert(execution.messageId === pushIntervention?.id, "messageId should match created intervention id");
      assert(typeof execution.sentAt === "string", "expected sentAt to be set for send_push");
      const feedback = execution.feedback as {
        action?: string;
        outcome?: string;
        reason?: string;
        message_id?: string;
        sent_at?: string;
      };
      assert(feedback?.action === "send_push", "expected send_push feedback action");
      assert(feedback?.outcome === "sent", "expected sent feedback outcome");
      assert(feedback?.reason === "push_sent", "expected push_sent feedback reason");
      assert(feedback?.message_id === execution.messageId, "feedback message_id should match execution messageId");
      assert(feedback?.sent_at === execution.sentAt, "feedback sent_at should match execution sentAt");
      const sentAtMs = Date.parse(execution.sentAt as string);
      assert(!Number.isNaN(sentAtMs), "sentAt should be a valid ISO timestamp");
      assert(sentAtMs >= before && sentAtMs <= Date.now(), "sentAt should be set at execution time");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await test("message guard skips duplicate send in same decision window", () => {
    const agent = makeAgent();
    const now = Date.now();
    (agent as any).state.interventionsToday = [makeIntervention("proactive_checkin", now - 5_000)];
    (agent as any).lastDecisionWindowStart = now - 30_000;
    (agent as any).lastDecisionWindowEnd = now;
    (agent as any).lastDecisionWindowMs = 30_000;

    const decision = (agent as any).getMessageGuardDecision("proactive_checkin");
    assert(decision.skip === true, "expected guard to skip duplicate message");
    assert(decision.reason === "duplicate_decision_window", "expected duplicate_decision_window reason");
  });

  await test("message guard skips send while cooldown is active", () => {
    const agent = makeAgent();
    const now = Date.now();
    (agent as any).state.interventionsToday = [makeIntervention("proactive_checkin", now - 45_000)];
    (agent as any).lastDecisionWindowStart = now - 30_000;
    (agent as any).lastDecisionWindowEnd = now;
    (agent as any).lastDecisionWindowMs = 30_000;

    const decision = (agent as any).getMessageGuardDecision("proactive_checkin");
    assert(decision.skip === true, "expected guard to skip during cooldown");
    assert(decision.reason === "message_cooldown_active", "expected message_cooldown_active reason");
  });

  await test("message guard allows send after cooldown outside current window", () => {
    const agent = makeAgent();
    const now = Date.now();
    (agent as any).state.interventionsToday = [makeIntervention("proactive_checkin", now - 70_000)];
    (agent as any).lastDecisionWindowStart = now - 30_000;
    (agent as any).lastDecisionWindowEnd = now;
    (agent as any).lastDecisionWindowMs = 30_000;

    const decision = (agent as any).getMessageGuardDecision("proactive_checkin");
    assert(decision.skip === false, "expected guard to allow send after cooldown");
    assert(decision.reason === "clear", "expected clear reason");
  });

  await test("send_push skip captures message guard decision reason", async () => {
    const agent = makeAgent();
    const now = Date.now();
    (agent as any).state.interventionsToday = [makeIntervention("proactive_checkin", now - 5_000)];
    (agent as any).lastDecisionWindowStart = now - 30_000;
    (agent as any).lastDecisionWindowEnd = now;
    (agent as any).lastDecisionWindowMs = 30_000;
    const response = {
      shouldIntervene: true,
      reasoning: "Check in now",
      actions: [
        {
          type: "send_push",
          message: "Checking in",
          timing_policy: {
            can_message_now: true,
            current_mode: "free",
            next_free_window_minutes: 20,
            location_type: "office",
            calendar_pressure: "low",
          },
        },
      ],
    } as unknown as OpenClawResponse;

    const execution = await (agent as any).executeOpenClawActions(response);
    assert(execution.sent === false, "message guard should skip push");
    assert(execution.decisionReason === "duplicate_decision_window", "expected duplicate_decision_window decision reason");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
