import { AmbientAgent, evaluatePushTimingGate } from "./agent";
import type { Intervention, OpenClawResponse } from "./types";

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

function makeAgent(): AmbientAgent {
  return new AmbientAgent({
    relayUrl: "ws://localhost:9999/browser",
    logPath: "/tmp/test-ambient-agent-timing-policy.jsonl",
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
  });

  await test("evaluatePushTimingGate fails safe on unknown context", () => {
    const result = evaluatePushTimingGate(null);
    assert(result.messageNow === false, "unknown context should default to message_now=false");
    assert(result.reason === "bad_or_unknown_context", "unknown context reason mismatch");
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
    assert(typeof execution.deferredUntil === "string", "expected deferredUntil to be set");
    const deferredMs = Date.parse(execution.deferredUntil as string);
    assert(!Number.isNaN(deferredMs), "deferredUntil should be a valid ISO timestamp");
    assert(
      deferredMs >= before + 9 * 60 * 1000 && deferredMs <= before + 11 * 60 * 1000,
      "deferredUntil should be about 10 minutes in the future"
    );
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

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
