/**
 * Eval Test Cases for Flow Detector Agent
 *
 * Each case defines:
 * - A context payload (what the agent receives)
 * - Expected outcome (what the agent should decide)
 * - Which scoring dimensions it tests
 *
 * Dimensions: schema, disqualifier, copy, threshold, action
 */

import type { OpenClawContext, CalendarContext } from "../openclaw-context";

export type Dimension = "schema" | "disqualifier" | "copy" | "threshold" | "action";

export interface ExpectedOutcome {
  shouldIntervene: boolean;
  /** Expected action types (order doesn't matter). null = don't check. */
  actionTypes?: string[] | null;
  /** Forbidden action types that must NOT appear */
  forbiddenActions?: string[];
  /** If true, check message text against copy rules */
  checkCopyRules?: boolean;
}

export interface EvalCase {
  id: string;
  name: string;
  /** Which dimensions this case evaluates */
  dimensions: Dimension[];
  context: OpenClawContext;
  expected: ExpectedOutcome;
}

// ── Helpers ─────────────────────────────────────────────────────────

function baseContext(overrides: Partial<OpenClawContext> = {}): OpenClawContext {
  return {
    type: "intervention_decision",
    sensors: {
      hr: 75,
      hrv: 42.0,
      scl: 2.5,
      watchConnected: true,
    },
    baseline: {
      restingHR: 72,
      baselineHRV: 45.0,
      hrDeviation: "+4%",
      hrvDeviation: "-7%",
    },
    detections: {
      flow: { inFlowMode: false, stableMinutes: 5 },
      stress: { isElevated: false, elevatedMinutes: 0, checkinOfferedToday: false },
      recovery: { recoveryDetected: false, reflectionOfferedToday: false },
      energy: "normal",
    },
    calendar: { upcoming: [], inMeeting: false, currentMeeting: null, minutesToNext: null },
    agentState: {
      time: "14:30 Tue",
      dayPart: "afternoon_work",
      interventionsToday: 0,
      maxInterventions: 2,
      lastInterventionHoursAgo: null,
      warmthLevel: "neutral",
    },
    ...overrides,
  };
}

function meetingCalendar(summary = "Team Standup"): CalendarContext {
  const now = new Date();
  const end = new Date(now.getTime() + 30 * 60 * 1000);
  return {
    upcoming: [{
      summary,
      start: now.toISOString(),
      end: end.toISOString(),
      status: "confirmed",
      eventType: "default",
    }],
    inMeeting: true,
    currentMeeting: summary,
    minutesToNext: null,
  };
}

function soonMeeting(minutesAway: number): CalendarContext {
  const now = new Date();
  const start = new Date(now.getTime() + minutesAway * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    upcoming: [{
      summary: "Upcoming Meeting",
      start: start.toISOString(),
      end: end.toISOString(),
      status: "confirmed",
      eventType: "default",
    }],
    inMeeting: false,
    currentMeeting: null,
    minutesToNext: minutesAway,
  };
}

// ── Test Cases ──────────────────────────────────────────────────────

export const EVAL_CASES: EvalCase[] = [

  // ══════════════════════════════════════════════════════════════════
  // DISQUALIFIER CASES (must return shouldIntervene: false)
  // ══════════════════════════════════════════════════════════════════

  {
    id: "DQ-01",
    name: "Watch disconnected → silence",
    dimensions: ["disqualifier", "schema"],
    context: baseContext({
      sensors: { hr: null, hrv: null, scl: null, watchConnected: false },
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 20, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
    }),
    expected: { shouldIntervene: false },
  },

  {
    id: "DQ-02",
    name: "In meeting + stressed → hold nudge",
    dimensions: ["disqualifier", "schema"],
    context: baseContext({
      sensors: { hr: 95, hrv: 25.0, scl: 4.0, watchConnected: true },
      baseline: { restingHR: 72, baselineHRV: 45.0, hrDeviation: "+32%", hrvDeviation: "-44%" },
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 22, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
      calendar: meetingCalendar("1:1 with Sarah"),
    }),
    expected: { shouldIntervene: false },
  },

  {
    id: "DQ-03",
    name: "Daily limit reached → no more",
    dimensions: ["disqualifier", "schema"],
    context: baseContext({
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 25, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
      agentState: {
        time: "15:00 Tue",
        dayPart: "afternoon_work",
        interventionsToday: 2,
        maxInterventions: 2,
        lastInterventionHoursAgo: 3.0,
        warmthLevel: "neutral",
      },
    }),
    expected: { shouldIntervene: false },
  },

  {
    id: "DQ-04",
    name: "Recent intervention (<2h ago) → wait",
    dimensions: ["disqualifier", "schema"],
    context: baseContext({
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 18, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
      agentState: {
        time: "15:00 Tue",
        dayPart: "afternoon_work",
        interventionsToday: 1,
        maxInterventions: 2,
        lastInterventionHoursAgo: 0.5,
        warmthLevel: "neutral",
      },
    }),
    expected: { shouldIntervene: false },
  },

  {
    id: "DQ-05",
    name: "Night time → silence",
    dimensions: ["disqualifier", "schema"],
    context: baseContext({
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 30, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
      agentState: {
        time: "02:30 Tue",
        dayPart: "night",
        interventionsToday: 0,
        maxInterventions: 2,
        lastInterventionHoursAgo: null,
        warmthLevel: "neutral",
      },
    }),
    expected: { shouldIntervene: false },
  },

  {
    id: "DQ-06",
    name: "No baseline → can't decide",
    dimensions: ["disqualifier", "schema"],
    context: baseContext({
      baseline: null,
      detections: {
        flow: { inFlowMode: false, stableMinutes: 35 },
        stress: { isElevated: false, elevatedMinutes: 0, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "normal",
      },
    }),
    expected: { shouldIntervene: false },
  },

  {
    id: "DQ-07",
    name: "Lunch break → leave alone",
    dimensions: ["disqualifier", "schema"],
    context: baseContext({
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 20, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
      agentState: {
        time: "12:30 Tue",
        dayPart: "lunch",
        interventionsToday: 0,
        maxInterventions: 2,
        lastInterventionHoursAgo: null,
        warmthLevel: "neutral",
      },
    }),
    expected: { shouldIntervene: false },
  },

  {
    id: "DQ-08",
    name: "Checkin already offered today → no repeat",
    dimensions: ["disqualifier", "schema"],
    context: baseContext({
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 25, checkinOfferedToday: true },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
    }),
    expected: { shouldIntervene: false },
  },

  {
    id: "DQ-09",
    name: "Meeting starting in 3 min → suppress",
    dimensions: ["disqualifier", "schema"],
    context: baseContext({
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 18, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
      calendar: soonMeeting(3),
    }),
    expected: { shouldIntervene: false },
  },

  {
    id: "DQ-10",
    name: "Calendar null + stress → conservative (allow or deny, but valid schema)",
    dimensions: ["schema", "disqualifier"],
    context: baseContext({
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 20, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
      calendar: null,
    }),
    // With null calendar, either answer is acceptable — we just check schema
    expected: { shouldIntervene: false },  // conservative preference
  },

  // ══════════════════════════════════════════════════════════════════
  // THRESHOLD BOUNDARY CASES
  // ══════════════════════════════════════════════════════════════════

  {
    id: "TH-01",
    name: "Flow at 28 min (below threshold) → no action",
    dimensions: ["threshold", "schema"],
    context: baseContext({
      detections: {
        flow: { inFlowMode: false, stableMinutes: 28 },
        stress: { isElevated: false, elevatedMinutes: 0, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "normal",
      },
    }),
    expected: { shouldIntervene: false },
  },

  {
    id: "TH-02",
    name: "Flow at 32 min (above threshold) → enable focus mode",
    dimensions: ["threshold", "action", "schema"],
    context: baseContext({
      sensors: { hr: 70, hrv: 48.0, scl: 2.0, watchConnected: true },
      detections: {
        flow: { inFlowMode: false, stableMinutes: 32 },
        stress: { isElevated: false, elevatedMinutes: 0, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "normal",
      },
    }),
    expected: {
      shouldIntervene: true,
      actionTypes: ["enable_focus_mode"],
      forbiddenActions: ["send_push", "send_haptic", "trigger_call"],
    },
  },

  {
    id: "TH-03",
    name: "Stress at 12 min (below threshold) → no action",
    dimensions: ["threshold", "schema"],
    context: baseContext({
      sensors: { hr: 88, hrv: 30.0, scl: 3.5, watchConnected: true },
      baseline: { restingHR: 72, baselineHRV: 45.0, hrDeviation: "+22%", hrvDeviation: "-33%" },
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 12, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
    }),
    expected: { shouldIntervene: false },
  },

  {
    id: "TH-04",
    name: "Stress at 16 min (above threshold) → nudge",
    dimensions: ["threshold", "action", "copy", "schema"],
    context: baseContext({
      sensors: { hr: 92, hrv: 28.0, scl: 3.8, watchConnected: true },
      baseline: { restingHR: 72, baselineHRV: 45.0, hrDeviation: "+28%", hrvDeviation: "-38%" },
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 16, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
    }),
    expected: {
      shouldIntervene: true,
      actionTypes: ["send_haptic", "send_push"],
      forbiddenActions: ["trigger_call", "enable_focus_mode"],
      checkCopyRules: true,
    },
  },

  {
    id: "TH-05",
    name: "Stress at 35 min → may escalate to call",
    dimensions: ["threshold", "action", "schema"],
    context: baseContext({
      sensors: { hr: 98, hrv: 22.0, scl: 4.5, watchConnected: true },
      baseline: { restingHR: 72, baselineHRV: 45.0, hrDeviation: "+36%", hrvDeviation: "-51%" },
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 35, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
    }),
    expected: {
      shouldIntervene: true,
      // trigger_call is allowed (not required) at 30+ min
      actionTypes: null,  // don't enforce specific combo
      forbiddenActions: ["enable_focus_mode"],
      checkCopyRules: true,
    },
  },

  // ══════════════════════════════════════════════════════════════════
  // ACTION CORRECTNESS CASES
  // ══════════════════════════════════════════════════════════════════

  {
    id: "AC-01",
    name: "Flow → focus mode only (no heavier actions)",
    dimensions: ["action", "schema"],
    context: baseContext({
      sensors: { hr: 68, hrv: 50.0, scl: 1.8, watchConnected: true },
      detections: {
        flow: { inFlowMode: false, stableMinutes: 45 },
        stress: { isElevated: false, elevatedMinutes: 0, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "normal",
      },
    }),
    expected: {
      shouldIntervene: true,
      actionTypes: ["enable_focus_mode"],
      forbiddenActions: ["send_push", "send_haptic", "trigger_call", "send_reflection"],
    },
  },

  {
    id: "AC-02",
    name: "Evening recovery → send_reflection only",
    dimensions: ["action", "schema"],
    context: baseContext({
      sensors: { hr: 65, hrv: 55.0, scl: 1.5, watchConnected: true },
      baseline: { restingHR: 72, baselineHRV: 45.0, hrDeviation: "-10%", hrvDeviation: "+22%" },
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: false, elevatedMinutes: 0, checkinOfferedToday: false },
        recovery: { recoveryDetected: true, reflectionOfferedToday: false },
        energy: "low",
      },
      agentState: {
        time: "19:30 Tue",
        dayPart: "evening",
        interventionsToday: 0,
        maxInterventions: 2,
        lastInterventionHoursAgo: null,
        warmthLevel: "neutral",
      },
    }),
    expected: {
      shouldIntervene: true,
      actionTypes: ["send_reflection"],
      forbiddenActions: ["trigger_call", "enable_focus_mode"],
      checkCopyRules: true,
    },
  },

  {
    id: "AC-03",
    name: "Nothing happening → no action",
    dimensions: ["action", "schema"],
    context: baseContext(),  // Normal vitals, no flags
    expected: { shouldIntervene: false },
  },

  {
    id: "AC-04",
    name: "Stress during flow → protect flow (don't interrupt)",
    dimensions: ["action", "schema"],
    context: baseContext({
      sensors: { hr: 85, hrv: 32.0, scl: 3.0, watchConnected: true },
      detections: {
        flow: { inFlowMode: true, stableMinutes: 50 },
        stress: { isElevated: true, elevatedMinutes: 10, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
    }),
    expected: {
      shouldIntervene: false,
      forbiddenActions: ["send_push", "send_haptic", "trigger_call"],
    },
  },

  // ══════════════════════════════════════════════════════════════════
  // COPY RULE CASES (check message text)
  // ══════════════════════════════════════════════════════════════════

  {
    id: "CP-01",
    name: "Stress nudge message must follow copy rules",
    dimensions: ["copy", "schema"],
    context: baseContext({
      sensors: { hr: 90, hrv: 27.0, scl: 3.5, watchConnected: true },
      baseline: { restingHR: 72, baselineHRV: 45.0, hrDeviation: "+25%", hrvDeviation: "-40%" },
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 20, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
    }),
    expected: {
      shouldIntervene: true,
      checkCopyRules: true,
    },
  },

  {
    id: "CP-02",
    name: "Reflection message must follow copy rules",
    dimensions: ["copy", "schema"],
    context: baseContext({
      sensors: { hr: 63, hrv: 58.0, scl: 1.2, watchConnected: true },
      baseline: { restingHR: 72, baselineHRV: 45.0, hrDeviation: "-12%", hrvDeviation: "+29%" },
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: false, elevatedMinutes: 0, checkinOfferedToday: false },
        recovery: { recoveryDetected: true, reflectionOfferedToday: false },
        energy: "low",
      },
      agentState: {
        time: "20:00 Wed",
        dayPart: "evening",
        interventionsToday: 0,
        maxInterventions: 2,
        lastInterventionHoursAgo: null,
        warmthLevel: "neutral",
      },
    }),
    expected: {
      shouldIntervene: true,
      checkCopyRules: true,
    },
  },

  {
    id: "CP-03",
    name: "High-stress 30+ min nudge — copy rules under pressure",
    dimensions: ["copy", "action", "schema"],
    context: baseContext({
      sensors: { hr: 100, hrv: 20.0, scl: 5.0, watchConnected: true },
      baseline: { restingHR: 72, baselineHRV: 45.0, hrDeviation: "+39%", hrvDeviation: "-56%" },
      detections: {
        flow: { inFlowMode: false, stableMinutes: 0 },
        stress: { isElevated: true, elevatedMinutes: 35, checkinOfferedToday: false },
        recovery: { recoveryDetected: false, reflectionOfferedToday: false },
        energy: "high",
      },
    }),
    expected: {
      shouldIntervene: true,
      checkCopyRules: true,
    },
  },
];
