/**
 * Deterministic timing policy for notification gating.
 *
 * Contract is intentionally minimal:
 * - binary decision (`messageNow`)
 * - bounded message taxonomy (`protect|reflect|reset|none`)
 * - optional delay hint in minutes
 */

export type TimingMode = "focus" | "meeting" | "transit" | "free";
export type TimingLocation = "home" | "office" | "transit" | "other" | "unknown";
export type CalendarPressure = "low" | "medium" | "high";
export type TimingMessageType = "protect" | "reflect" | "reset" | "none";

export interface TimingPolicyContext {
  canMessageNow: boolean;
  currentMode: TimingMode;
  nextFreeWindowMinutes: number | null;
  locationType: TimingLocation;
  calendarPressure: CalendarPressure;
}

export interface TimingPolicyDecision {
  messageNow: boolean;
  messageType: TimingMessageType;
  delayMinutes: number | null;
  reason: string;
}

const DEFAULT_DELAY_MINUTES = 15;

export function decideTimingPolicy(context: TimingPolicyContext): TimingPolicyDecision {
  if (!context.canMessageNow) {
    return {
      messageNow: false,
      messageType: "none",
      delayMinutes: context.nextFreeWindowMinutes,
      reason: "can_message_now_false",
    };
  }

  if (context.currentMode === "meeting") {
    return {
      messageNow: false,
      messageType: "none",
      delayMinutes: context.nextFreeWindowMinutes ?? DEFAULT_DELAY_MINUTES,
      reason: "meeting",
    };
  }

  if (context.currentMode === "transit" || context.locationType === "transit") {
    return {
      messageNow: false,
      messageType: "none",
      delayMinutes: context.nextFreeWindowMinutes ?? DEFAULT_DELAY_MINUTES,
      reason: "transit",
    };
  }

  if (context.locationType === "unknown" || context.locationType == null) {
    return {
      messageNow: false,
      messageType: "none",
      delayMinutes: context.nextFreeWindowMinutes ?? DEFAULT_DELAY_MINUTES,
      reason: "unknown_location",
    };
  }

  if (context.nextFreeWindowMinutes === null && context.calendarPressure === "high") {
    return {
      messageNow: false,
      messageType: "none",
      delayMinutes: DEFAULT_DELAY_MINUTES,
      reason: "calendar_missing",
    };
  }

  if (context.calendarPressure === "high") {
    return {
      messageNow: false,
      messageType: "none",
      delayMinutes: context.nextFreeWindowMinutes ?? DEFAULT_DELAY_MINUTES,
      reason: "high_calendar_pressure",
    };
  }

  if (context.nextFreeWindowMinutes === null) {
    return {
      messageNow: false,
      messageType: "none",
      delayMinutes: DEFAULT_DELAY_MINUTES,
      reason: "no_free_window",
    };
  }

  return {
    messageNow: true,
    messageType: "reset",
    delayMinutes: null,
    reason: "free_window_available",
  };
}
