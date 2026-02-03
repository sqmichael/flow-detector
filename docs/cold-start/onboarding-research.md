# Onboarding Flow Research

> Research notes from background agent implementation session
> Date: 2026-02-03

---

## Phase 1: Research Summary

**Key findings from the codebase:**

1. **Existing infrastructure already supports onboarding:**
   - `UserState.onboarding_complete` boolean tracks onboarding status
   - `completeOnboarding()` function exists in `service.ts` - sets `warmth_level=1` and `onboarding_complete=true`
   - `hume-config.json` already has `conversation_scenarios.onboarding` with the script from the design doc
   - `buildDynamicSystemPrompt()` already injects warmth level (0 = onboarding tone)

2. **Warmth level 0 IS the onboarding persona:**
   - When `warmth_level=0`, `getWarmthDescription()` returns "onboarding"
   - The dynamic prompt already includes: "onboarding: Formal, explicit, educational"
   - No special Hume config needed - just use warmth=0 with an onboarding-specific system prompt addition

3. **Missing pieces:**
   - No dedicated endpoint to trigger onboarding call
   - No special system prompt content specifically for onboarding (the base prompt is for regular calls)
   - No handling for ripcord during onboarding

4. **Design decisions from v0.1-design.md:**
   - Script is already written (lines 47-67)
   - Should trigger "upon registration/setup, before any biometric events"
   - Onboarding is warmth level 0

---

## Phase 2: Implementation Plan

### Design Decisions

1. **Use same Hume config with warmth=0 + onboarding prompt injection**
   - Simpler than maintaining separate configs
   - The dynamic prompt system already supports this pattern
   - Add onboarding-specific instructions to the system prompt when `onboarding_complete=false`

2. **Add new `/call/onboarding` endpoint**
   - Clearer intent than a flag on `/call/trigger`
   - Returns error if already onboarded (idempotency)
   - Triggers a call with onboarding-specific prompt

3. **Onboarding state is already tied to warmth (level 0)**
   - `completeOnboarding()` moves to warmth=1 (crisp professional)
   - No separate tracking needed

4. **Ripcord during onboarding:**
   - Don't mark onboarding complete
   - Don't penalize warmth (already at 0)
   - Allow retry on next call
   - Log the ripcord for debugging

### Files Modified

1. **`server/calling/memory/hume-integration.ts`**
   - Added `ONBOARDING_SYSTEM_PROMPT` constant with scripted flow
   - Added `buildOnboardingSystemPrompt()` function
   - Added `createOnboardingConfigVersion()` function
   - Added `prepareOnboardingCall()` function

2. **`server/calling/call-service.ts`**
   - Added `POST /call/onboarding` endpoint
   - Added `onboardingCallSids` Set to track onboarding calls
   - Added `onboardingInProgress` lock to prevent concurrent triggers
   - Added `MIN_ONBOARDING_DURATION_SECONDS = 30` constant
   - Updated Hume webhook to detect and complete onboarding
   - Returns 400 if already onboarded, 409 if in progress

---

## Phase 3: UX Principles Applied

From `UX_PRINCIPLES.md`:

- **Crisp, professional** - not a tutorial or sales pitch
- **Under 3 minutes** - scripted to be brief
- **Respect user control** - "say 'not now' anytime"
- **Privacy reassurance** - "remembers topics not emotions"

---

## Codex Security Review Findings

| Severity | Issue | Resolution |
|----------|-------|------------|
| High | Concurrent onboarding triggers | Added `onboardingInProgress` lock, returns 409 |
| High | Wrong call can mark onboarding complete | Accepted for v0.1 (single-user system) |
| High | Webhooks unauthenticated | Accepted for v0.1 (localhost only) |
| Medium | In-memory state lost on restart | Accepted for v0.1 |
| Medium | Prompt injection via themes | Accepted for v0.1 |

---

## Usage

```bash
# Trigger onboarding call for new user
curl -X POST http://localhost:8766/call/onboarding

# Response if already onboarded
# 400: { "error": "User already onboarded", "warmthLevel": 1.0 }

# Response if in progress
# 409: { "error": "Onboarding call already in progress" }
```

---

## Onboarding Script (from design doc)

```
[User answers]

Kai: "Hi Michael, this is Kai. I'm your flow state monitor.

I'll check in when your biometrics suggest a quick reset might help —
stress spikes, long focus sessions, that kind of thing.

Brief check-ins, usually under two minutes. I remember topics,
not emotions. Say 'not now' anytime.

Any questions?"

[User responds or says no]

Kai: "Good. I'll reach out when something comes up. Talk soon."

[End call]
```
