# Feature Specification: Calendar + Location + Dynamic Context

> Close the integration gaps in calendar and location data, then inject all context
> into intervention prompts so decisions feel situationally aware.

## Overview

The ambient agent has three context sources that are partially wired:
1. **Calendar** — fetched and cached but only used as a suppression signal (meeting = suppress)
2. **Location** — collected from watch but never persisted or used in decisions
3. **Dynamic context** — sensor mood, memory themes, and warmth level not yet injected into prompts

This spec closes all three gaps in dependency order: persist location → use calendar event types → build dynamic context → inject into prompts.

---

## Part 1: Location Persistence

### Schema Changes

Add location fields to `WatchBatchRow` and `WatchBatchInsert` in `server/sensor-fusion/types.ts`:

```typescript
// Add to WatchBatchRow and WatchBatchInsert
location_lat: number | null;
location_lon: number | null;
location_accuracy: number | null;
```

Add matching columns to the `watch_batches` CREATE TABLE in `server/sensor-fusion/database.ts`.

### Storage

Update `insertWatchBatch()` to persist location fields. Update the relay's batch handler in `watch-relay.ts` to pass location through when calling `insertWatchBatch()`.

### Staleness

In `agent.ts`, clear `state.currentLocation` when watch disconnects AND when location data is older than 5 minutes (no fresh batch with location).

---

## Part 2: Calendar Event Type Handling

### New Disqualifiers in `agent.ts`

| Event Type | Behavior |
|-----------|----------|
| `focusTime` | Treat as flow — enable Focus Mode, suppress all interventions |
| `outOfOffice` | Suppress all interventions |
| `workingLocation` | No special handling (informational) |
| `default` (meeting) | Existing behavior — suppress during + 5min before |

### Integration Point

In `processViaOpenClaw()` (agent.ts ~728), after the existing meeting check, add:

```typescript
const focusEvent = calendar?.upcoming.find(e => e.eventType === "focusTime" && isCurrentlyInEvent(e));
if (focusEvent) {
  // Silently enable Focus Mode, suppress interventions
  await enableFocusMode();
  this.log(`[DQ] Calendar Focus Time: "${focusEvent.summary}" — protecting`);
  return;
}

const oooEvent = calendar?.upcoming.find(e => e.eventType === "outOfOffice" && isCurrentlyInEvent(e));
if (oooEvent) {
  this.log(`[DQ] Out of Office: "${oooEvent.summary}" — suppressing`);
  return;
}
```

Add helper `isCurrentlyInEvent(event: CalendarEvent): boolean` that checks `now` is between `start` and `end`.

---

## Part 3: Dynamic Context Assembly

### `buildDynamicContext(state, baseline, calendar): DynamicContext`

New file: `server/ambient-agent/dynamic-context.ts`

```typescript
interface DynamicContext {
  sensorMood: "calm" | "focused" | "restless" | "winding_down" | "unknown";
  timeOfDay: "morning" | "midday" | "afternoon" | "evening" | "night";
  dayOfWeek: string;
  warmthLevel: number;           // 0-3, from memory layer
  recentThemes: string[];        // last 3 themes
  lastInterventionType: string | null;
  lastInterventionHoursAgo: number | null;
  lastInterventionRating: number | null;
  nextEventMinutes: number | null;
  nextEventName: string | null;
  location: "available" | "unavailable"; // never expose coordinates in prompts
}
```

### sensorMood Derivation

| Mood | Condition |
|------|-----------|
| `calm` | HR < baseline, HRV > baseline, low movement |
| `focused` | HR ≈ baseline (±5%), HRV slightly below, high stillness |
| `restless` | HR > baseline +10%, HRV < baseline ×0.7, high movement |
| `winding_down` | HR declining trend over 15min, HRV rising |
| `unknown` | Insufficient data or < 5min since watch connected |

### Memory Layer Read

Call existing `getUserState()` for warmth level. Add `getRecentThemes(limit)` to `server/calling/memory/service.ts` — returns N most recent themes sorted by recency.

---

## Part 4: Prompt Injection

### reasoning.ts

Append dynamic context block to the user prompt (not system prompt — keeps system prompt stable):

```
Context:
- Mood: focused (stable HR, still for 40min)
- Time: Thursday afternoon, 3:30 PM
- Warmth: level 2
- Themes: sleep quality, deadlines
- Last check-in: 4h ago, rated 4/5
- Next calendar: "Standup" in 25min
```

Skip lines where data is null/unknown. Budget: +50-80 tokens.

### openclaw-context.ts

Add `dynamicContext` field to the context object passed to `buildOpenClawContext()`.

---

## Error Cases

| Scenario | Behavior |
|----------|----------|
| Memory DB not initialized | `warmthLevel: 0`, `recentThemes: []` |
| No calendar data | Skip calendar lines in prompt |
| Watch disconnected | `sensorMood: "unknown"`, skip mood line |
| No previous interventions | Skip last-intervention line |
| Location unavailable | `location: "unavailable"`, skip in prompt |
| Context > 100 tokens | Truncate themes, drop calendar line |

## Performance

- Context assembly: < 50ms (local SQLite + in-memory state)
- No additional LLM calls — richer prompts on existing ~3-5 calls/day
- Token budget: +50-80 tokens per call (negligible cost)
- Location persistence: 1 extra INSERT per 30s batch (trivial)
