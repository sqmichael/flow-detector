# Technical Specification

## Feature Scope
Implement a loop-optimized context timing engine for assistant notifications:
- Input: compact context snapshot
- Decision: `send_now` or `delay`
- Output: one of `protect|reflect|reset|none`
- Logging: persist decision + context snapshot for offline scoring

## Context Contract (v1)
| Field | Type | Notes |
|------|------|------|
| `can_message_now` | boolean | Final gate after disqualifiers |
| `current_mode` | `"focus" \| "meeting" \| "transit" \| "free"` | Timing-centric mode only |
| `next_free_window_minutes` | number \| null | Null if unknown |
| `location_type` | `"home" \| "office" \| "transit" \| "other" \| "unknown"` | No raw coordinates in prompts |
| `calendar_pressure` | `"low" \| "medium" \| "high"` | Derived from near-term calendar density |

## Decision Contract (v1)
| Field | Type | Notes |
|------|------|------|
| `message_now` | boolean | Binary decision |
| `message_type` | `"protect" \| "reflect" \| "reset" \| "none"` | Limited taxonomy |
| `delay_minutes` | number \| null | Required when `message_now=false` and delayed |
| `reason` | string | Compact explanation for logs |

## Files to Change
| File | Changes |
|------|---------|
| `server/ambient-agent/types.ts` | Add decision/context contract types. |
| `server/ambient-agent/agent.ts` | Build context snapshot, call policy, gate ntfy send. |
| `server/ambient-agent/reasoning.ts` or new `server/ambient-agent/timing-policy.ts` | Deterministic v1 timing decision function + tests. |
| `server/ambient-agent/logger.ts` | Persist `decision_context` and `decision_result`. |
| `intervention-log.jsonl` schema usage | Append decision payload on every attempted message cycle. |

## Failure Modes
| What Could Go Wrong | Handling |
|--------------------|----------|
| Overfitting context fields that do not help timing | Keep v1 contract minimal; compare before/after mistimed rate. |
| Message spam from retries/restarts | Deduplicate on decision ID + cooldown window. |
| Ambiguous context at decision time | Force `message_now=false`, `message_type=none`. |
| Location/calendar unavailable | Use `unknown`/`null` defaults, never block processing. |

## Change Sequence
| Step | Change | Depends On |
|------|--------|------------|
| 1 | Define contracts (types + schema) | — |
| 2 | Implement deterministic timing policy | Step 1 |
| 3 | Wire policy into agent send path | Step 2 |
| 4 | Persist decision snapshots to log | Step 3 |
| 5 | Add replay/scoring script for mistimed-rate measurement | Step 4 |
