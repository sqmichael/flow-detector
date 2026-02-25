/**
 * OpenClaw Context Builder
 *
 * Constructs a compact (~400 token) JSON context from agent state
 * for each OpenClaw decision request. Stateless — full context
 * passed each call to avoid session context blowout.
 *
 * Now includes calendar context fetched from Google Calendar via
 * Smithery MCP endpoint. Calendar fetch is best-effort — if it
 * fails, the context includes calendar: null and the agent decides
 * without it (conservative default).
 */

import type {
  AmbientAgentState,
  PersonalBaseline,
  Intervention,
} from "./types";
import type { DynamicContext } from "./dynamic-context";
import { buildDynamicContext } from "./dynamic-context";
import { getUserState, getWarmthDescription } from "../calling/memory";

// ── Calendar Types ──────────────────────────────────────────────────

export interface CalendarEvent {
  summary: string;
  start: string;  // ISO timestamp or date
  end: string;
  status: "confirmed" | "tentative" | "cancelled";
  eventType?: string;  // "default" | "focusTime" | "outOfOffice" | "workingLocation"
  /** Google Calendar event ID (for persistence) */
  uid?: string;
  /** Whether this is an all-day event */
  isAllDay?: boolean;
}

export interface CalendarContext {
  /** Events in the next 2 hours */
  upcoming: CalendarEvent[];
  /** Whether there's a meeting/call happening right now */
  inMeeting: boolean;
  /** Summary of current meeting if in one */
  currentMeeting: string | null;
  /** Minutes until next event (null if none) */
  minutesToNext: number | null;
}

// ── Calendar Fetch ──────────────────────────────────────────────────

const SMITHERY_URL = "https://api.smithery.ai/connect/moose-7xil/googlesuper-nXzO/mcp";
const SMITHERY_KEY = process.env.SMITHERY_KEY ?? null;

// Cache calendar results for 2 minutes to avoid hammering the API
let calendarCache: { data: CalendarContext | null; fetchedAt: number } | null = null;
const CALENDAR_CACHE_TTL_MS = 2 * 60 * 1000;

/**
 * Fetch upcoming calendar events from Google Calendar via Smithery MCP.
 * Returns null on any failure — caller should treat as "unknown".
 */
export async function fetchCalendarContext(timezoneOffset: number): Promise<CalendarContext | null> {
  if (!SMITHERY_KEY) {
    console.log("[Calendar] SMITHERY_KEY not set");
    return null;
  }

  // Check cache
  if (calendarCache && (Date.now() - calendarCache.fetchedAt) < CALENDAR_CACHE_TTL_MS) {
    return calendarCache.data;
  }

  try {
    const now = new Date();
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "find_event",
        arguments: {
          calendar_id: "primary",
          timeMin: now.toISOString(),
          timeMax: twoHoursLater.toISOString(),
          single_events: true,
          max_results: 5,
          order_by: "startTime",
        },
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(SMITHERY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": `Bearer ${SMITHERY_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`[Calendar] HTTP ${response.status}`);
      calendarCache = { data: null, fetchedAt: Date.now() };
      return null;
    }

    const result = await response.json() as {
      result?: {
        content?: Array<{ type: string; text: string }>;
      };
      error?: { message: string };
    };

    if (result.error) {
      console.log(`[Calendar] MCP error: ${result.error.message}`);
      calendarCache = { data: null, fetchedAt: Date.now() };
      return null;
    }

    // Parse event data from MCP response
    const textContent = result.result?.content?.find(c => c.type === "text");
    if (!textContent) {
      console.log("[Calendar] No text content in response");
      calendarCache = { data: null, fetchedAt: Date.now() };
      return null;
    }

    const events = parseCalendarEvents(textContent.text, now);
    calendarCache = { data: events, fetchedAt: Date.now() };

    const meetingStatus = events.inMeeting ? `IN MEETING: ${events.currentMeeting}` : "clear";
    console.log(`[Calendar] ${events.upcoming.length} events, ${meetingStatus}`);

    return events;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`[Calendar] Fetch failed: ${msg}`);
    calendarCache = { data: null, fetchedAt: Date.now() };
    return null;
  }
}

// ── Calendar Event Helpers ───────────────────────────────────────────

/**
 * Returns true if `now` is within the event's start–end window.
 *
 * All-day events use date-only strings (YYYY-MM-DD) which `new Date()` parses
 * as UTC midnight. We detect this and adjust to local midnight using
 * `timezoneOffset` so the event covers the correct local day.
 */
export function isCurrentlyInEvent(
  event: CalendarEvent,
  now: Date = new Date(),
  timezoneOffset: number = 8
): boolean {
  const isAllDayDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const offsetMs = timezoneOffset * 60 * 60 * 1000;

  // All-day events: shift from UTC midnight to local midnight
  const startTime = isAllDayDate(event.start)
    ? new Date(event.start).getTime() - offsetMs
    : new Date(event.start).getTime();
  const endTime = isAllDayDate(event.end)
    ? new Date(event.end).getTime() - offsetMs
    : new Date(event.end).getTime();

  const nowMs = now.getTime();
  return startTime <= nowMs && endTime > nowMs;
}

/**
 * Parse raw calendar response text into structured events.
 * Handles both JSON array and text-based formats from the MCP.
 */
function parseCalendarEvents(text: string, now: Date): CalendarContext {
  const upcoming: CalendarEvent[] = [];
  let inMeeting = false;
  let currentMeeting: string | null = null;
  let minutesToNext: number | null = null;

  try {
    // Try JSON parse first — MCP may return structured data
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : parsed?.items || parsed?.events || [];

    for (const item of items) {
      if (!item) continue;

      const summary = item.summary || item.title || "Untitled";
      const startStr = item.start?.dateTime || item.start?.date || item.start || "";
      const endStr = item.end?.dateTime || item.end?.date || item.end || "";
      const status = item.status || "confirmed";
      const eventType = item.eventType || "default";
      const uid = item.id || item.uid || item.eventId || "";
      const isAllDay = !!(item.start?.date && !item.start?.dateTime);

      if (status === "cancelled") continue;

      const event: CalendarEvent = { summary, start: startStr, end: endStr, status, eventType, uid, isAllDay };
      upcoming.push(event);

      // Check if event is happening now
      const startTime = new Date(startStr).getTime();
      const endTime = new Date(endStr).getTime();
      const nowMs = now.getTime();

      if (startTime <= nowMs && endTime > nowMs) {
        inMeeting = true;
        currentMeeting = summary;
      }

      // Track minutes to next event
      if (startTime > nowMs) {
        const mins = Math.round((startTime - nowMs) / (60 * 1000));
        if (minutesToNext === null || mins < minutesToNext) {
          minutesToNext = mins;
        }
      }
    }
  } catch {
    // If JSON parse fails, return empty — we tried
    console.log("[Calendar] Could not parse response as JSON, treating as empty");
  }

  return { upcoming, inMeeting, currentMeeting, minutesToNext };
}

// ── Main Context Type ───────────────────────────────────────────────

export interface OpenClawContext {
  type: "intervention_decision";
  sensors: {
    hr: number | null;
    hrv: number | null;
    scl: number | null;
    watchConnected: boolean;
    watchQuality: {
      status: "good" | "bad" | "unknown";
      value: number | null;
    };
    location?: { latitude: number; longitude: number; accuracy: number };
    /** Seconds since last sensor update (data freshness) */
    dataAgeSec: number | null;
  };
  baseline: {
    restingHR: number;
    baselineHRV: number;
    hrDeviation: string | null;
    hrvDeviation: string | null;
  } | null;
  detections: {
    flow: {
      inFlowMode: boolean;
      stableMinutes: number;
      /** Minutes in flow mode (null if not in flow) */
      flowDurationMinutes: number | null;
    };
    stress: {
      isElevated: boolean;
      elevatedMinutes: number;
      checkinOfferedToday: boolean;
    };
    recovery: {
      recoveryDetected: boolean;
      reflectionOfferedToday: boolean;
    };
    energy: string; // "normal" | "low" | "high"
  };
  calendar: CalendarContext | null;
  dynamicContext: DynamicContext;
  agentState: {
    time: string;
    dayPart: string;
    interventionsToday: number;
    maxInterventions: number;
    lastInterventionHoursAgo: number | null;
    warmthLevel: string;
    /** Minutes since agent started */
    uptimeMinutes: number;
  };
}

export function deriveWatchQualityStatus(
  watchQuality: number | null
): "good" | "bad" | "unknown" {
  if (watchQuality === null) return "unknown";
  return watchQuality < 50 ? "bad" : "good";
}

/**
 * Build compact context for OpenClaw decision-making.
 * Calendar context must be pre-fetched and passed in.
 */
export function buildOpenClawContext(
  state: AmbientAgentState,
  baseline: PersonalBaseline | null,
  interventionsToday: Intervention[],
  maxInterventionsPerDay: number,
  timezoneOffset: number,
  calendar: CalendarContext | null = null
): OpenClawContext {
  const watchQualityStatus = deriveWatchQualityStatus(state.watchQuality);
  const shouldRedactBiometrics = watchQualityStatus === "bad";

  // Calculate baseline deviations
  let hrDeviation: string | null = null;
  let hrvDeviation: string | null = null;
  if (!shouldRedactBiometrics && baseline && state.currentHR !== null) {
    const pct = Math.round(
      ((state.currentHR - baseline.restingHR) / baseline.restingHR) * 100
    );
    hrDeviation = `${pct >= 0 ? "+" : ""}${pct}%`;
  }
  if (!shouldRedactBiometrics && baseline && state.currentHRV !== null) {
    const pct = Math.round(
      ((state.currentHRV - baseline.baselineHRV) / baseline.baselineHRV) * 100
    );
    hrvDeviation = `${pct >= 0 ? "+" : ""}${pct}%`;
  }

  // Local time (using timezone offset)
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const localHour = ((utcHour + timezoneOffset) % 24 + 24) % 24;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const time = `${localHour.toString().padStart(2, "0")}:${utcMin.toString().padStart(2, "0")} ${dayNames[now.getUTCDay()]}`;

  let dayPart = "night";
  if (localHour >= 6 && localHour < 12) dayPart = "morning";
  else if (localHour >= 12 && localHour < 14) dayPart = "lunch";
  else if (localHour >= 14 && localHour < 18) dayPart = "afternoon_work";
  else if (localHour >= 18 && localHour < 22) dayPart = "evening";

  // Last intervention timing
  let lastInterventionHoursAgo: number | null = null;
  if (interventionsToday.length > 0) {
    const last = interventionsToday[interventionsToday.length - 1];
    lastInterventionHoursAgo =
      Math.round(((Date.now() - last.triggeredAt) / (1000 * 60 * 60)) * 10) /
      10;
  }

  // Warmth from memory layer
  const userState = getUserState();
  const warmthDesc = getWarmthDescription(userState.warmth_level);

  // Infer energy from HR/HRV vs baseline
  let energy = "normal";
  if (baseline && state.currentHR !== null && state.currentHRV !== null) {
    if (
      state.currentHR < baseline.restingHR - 5 &&
      state.currentHRV > baseline.baselineHRV * 1.2
    ) {
      energy = "low";
    } else if (
      state.currentHR > baseline.restingHR + 15 &&
      state.currentHRV < baseline.baselineHRV * 0.6
    ) {
      energy = "high";
    }
  }

  // Data freshness — how old is the last sensor reading
  const dataAgeSec = state.lastSensorUpdate
    ? Math.round((Date.now() - state.lastSensorUpdate) / 1000)
    : null;

  // Flow duration — how long has flow mode been active
  const flowDurationMinutes = state.flowProtection.flowModeStartedAt
    ? Math.round((Date.now() - state.flowProtection.flowModeStartedAt) / (60 * 1000))
    : null;

  // Agent uptime
  const uptimeMinutes = Math.round((Date.now() - state.startedAt) / (60 * 1000));

  // Dynamic context (sensor mood, memory themes, calendar proximity)
  const dynamicContext = buildDynamicContext(state, baseline, calendar, undefined, timezoneOffset);

  return {
    type: "intervention_decision",
    sensors: {
      hr: shouldRedactBiometrics ? null : state.currentHR,
      hrv: shouldRedactBiometrics
        ? null
        : state.currentHRV !== null
          ? Math.round(state.currentHRV * 10) / 10
          : null,
      scl: shouldRedactBiometrics
        ? null
        : state.currentSCL !== null
          ? Math.round(state.currentSCL * 100) / 100
          : null,
      watchConnected: state.isWatchConnected,
      watchQuality: {
        status: watchQualityStatus,
        value: state.watchQuality,
      },
      ...(state.currentLocation ? { location: state.currentLocation } : {}),
      dataAgeSec,
    },
    baseline: baseline
      ? {
          restingHR: baseline.restingHR,
          baselineHRV: Math.round(baseline.baselineHRV * 10) / 10,
          hrDeviation,
          hrvDeviation,
        }
      : null,
    detections: {
      flow: {
        inFlowMode: state.flowProtection.inFlowMode,
        stableMinutes: state.flowProtection.stableMinutes,
        flowDurationMinutes,
      },
      stress: {
        isElevated: state.stressDetection.isElevated,
        elevatedMinutes: state.stressDetection.elevatedMinutes,
        checkinOfferedToday: state.stressDetection.checkinOfferedToday,
      },
      recovery: {
        recoveryDetected: state.eveningReflection.recoveryDetected,
        reflectionOfferedToday:
          state.eveningReflection.reflectionOfferedToday,
      },
      energy,
    },
    calendar,
    dynamicContext,
    agentState: {
      time,
      dayPart,
      interventionsToday: interventionsToday.length,
      maxInterventions: maxInterventionsPerDay,
      lastInterventionHoursAgo,
      warmthLevel: warmthDesc,
      uptimeMinutes,
    },
  };
}

export function buildOpenClawDecisionPrompt(context: OpenClawContext): string {
  return `You are deciding interventions from biometric context.

Hard gate on watch quality:
- If watchQuality.status == "bad", treat biometric data as unreliable.
- In that case:
  - Do NOT use HR/HRV/SCL to infer stress/flow/recovery.
  - Return shouldIntervene=false unless calendar-only safety logic requires silence.
  - reasoning must mention poor watch quality.
  - actions must be [] (or no_action only).

If watchQuality.status == "good":
- Use HR/HRV/SCL + baseline + calendar + intervention history normally.
- Prefer conservative decisions.

Display policy:
- bad quality: show "Watch quality bad" and hide numeric readings.
- good quality: show numeric readings.

Return JSON only:
{
  "shouldIntervene": boolean,
  "actions": [{"type":"enable_focus_mode|disable_focus_mode|send_haptic|send_push|trigger_call|send_reflection|no_action","message":"optional","priority":"low|default|high","pattern":"gentle|urgent"}],
  "reasoning": "one sentence"
}

Context:
${JSON.stringify(context)}`;
}
