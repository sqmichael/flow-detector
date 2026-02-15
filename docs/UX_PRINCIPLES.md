# UX Principles — Flow Detector

> "Boring in logs and invisible in life."

This document codifies the UX vision, philosophy, and guardrails for all features. Every implementation must be verified against these principles before merge.

---

# North Star

## 1. The One-Liner

**Flow Detector is a nervous system for your work life — it protects your focus, catches stress before you do, and reflects your body's patterns back to you without judgment.**

## 2. The Problem (Why This Exists)

Knowledge workers face a triple failure:
- **Flow dies silently.** Your best work gets interrupted by notifications, context switches, and your own restlessness. You don't notice you were in flow until you've already lost it.
- **Stress accumulates invisibly.** You push through tension for hours. By the time you feel burned out, the damage is done. Your body knew 45 minutes ago.
- **Self-awareness is a lagging indicator.** You review your day and realize you were grinding all afternoon, but you had no signal in the moment. You need a mirror, not a coach.

## 3. The Felt Experience

**Morning:** You start working. The watch is on your wrist, sensors streaming. You forget the system exists.

**Mid-morning:** You've been focused for 40 minutes. Your phone silently enters Focus Mode. Notifications stop. You don't notice — that's the point. OpenClaw saw your calendar is clear for the next hour and confirmed this is real focus, not just idle.

**Early afternoon:** Your heart rate has been climbing, HRV dropping for 20 minutes. OpenClaw checks your calendar — no meeting, not at the gym, no workout app active. A gentle haptic on your wrist. A single notification: "Hey — maybe step away for a few?" You tap it or ignore it. No guilt either way.

**Late afternoon:** You're in a Zoom call. Heart rate is up, HRV is low — but OpenClaw sees an active video call and holds the nudge. The system waits.

**Evening:** Your body is settling — HR below baseline, HRV rising. A quiet prompt: "Good time to reflect." You choose to take a 3-minute voice call with Kai, or you don't. Either way, the system goes quiet.

**End of week (optional):** You glance at the dashboard. You see that Tuesday was your deepest flow day, Thursday had a stress spike at 2pm. You notice a pattern. The system doesn't interpret it — you do.

## 4. The Architecture of Restraint

Three layers, each with one job:

| Layer | What It Sees | What It Does |
|-------|-------------|--------------|
| **Watch** | Body signals (HR, HRV, EDA, motion, location) | Streams raw data. Never decides. |
| **Agent** | Biometric patterns over time (flow, stress, recovery) | Detects patterns. Proposes action to OpenClaw. |
| **OpenClaw** | Calendar, active apps, location, time of day, history | Vetoes or approves. Adds context the body can't give. |

The watch senses. The agent pattern-matches. OpenClaw decides. No layer acts alone.

## 5. The Three Moments

The system only acts at three moments. Everything else is silence.

| Moment | Body Signal | OpenClaw Gate | Action | Intensity |
|--------|------------|---------------|--------|-----------|
| **Protect** | Stable HR + stillness ≥30min | Calendar clear, no active calls, not commuting | Enable Focus Mode silently | Invisible |
| **Nudge** | Elevated HR + suppressed HRV ≥15min | Not in meeting, not exercising, no recent intervention | Wrist haptic → push notification | Soft |
| **Reflect** | Evening recovery pattern | Past work hours, no social plans detected | Push notification → optional voice call | Gentle |

**If body says act but context says don't → silence wins.**

No other moments exist. If the system can't clearly place an event into one of these three, it does nothing.

## 6. The Escalation Ladder

Intensity scales with confidence and duration. Never skip rungs.

```
Silence → Focus Mode → Haptic → Push Notification → Voice Call
   ←————————————————————————————————————————————————————→
   most common                              rarest (1x/day max)
```

- **Silence** is the default state and the most common "intervention"
- **Focus Mode** is invisible protection — but reversible (see Escape Hatch below)
- **Haptic** is physical but ambiguous (a tap, not a message)
- **Push notification** is the first thing with words — one sentence, no sensor data, no emotion labels
- **Voice call** is the heaviest tool — only for genuine sustained patterns (30+ min) or invited reflection

## 7. Copy Rules (Fixing the Labeling Problem)

The system must never label emotions or prescribe actions. When the user asks "why did you ping me?", the answer is physical, not psychological.

| Category | Forbidden | Allowed |
|----------|-----------|---------|
| Emotion labels | "You seem stressed" / "Noticing tension" | — (don't explain feelings) |
| Advice | "Take a walk" / "Walk and talk?" | "Maybe step away for a few?" (suggestion, not prescription) |
| Biometric data | "HR 95, HRV 22ms" | "Your body's been busy" (vague, physical) |
| Diagnosis | "Stress detected for 20 minutes" | — (don't quantify to user) |

**The "why" answer**: If a user taps a nudge notification seeking explanation, the response is situational and brief: "Seemed like a long stretch" / "You've been at it a while." Never cite numbers. Never name emotions. Keep it at the level of a perceptive friend, not a medical readout.

## 8. The Surfaces

| Surface | Role | Frequency |
|---------|------|-----------|
| **Watch** | Sensor input + haptic output | Always on (passive) |
| **Phone push** | Soft notifications with one-tap rating | 0-3x/day |
| **Voice (Kai)** | Co-regulation, presence, reflection | 0-1x/day, always user-initiated |
| **Dashboard** | Pattern review, weekly self-reflection | On-demand, never pushed |
| **OpenClaw** | Contextual reasoning (invisible to user) | Every decision cycle |

Each surface has one job. Don't bleed roles across surfaces. OpenClaw is never user-facing — it's infrastructure.

## 9. The Voice (Kai)

Kai is not an assistant, therapist, or coach. Kai is the voice equivalent of a quiet room — present, not performing.

- Speaks only when the user initiates (tapping a notification, accepting a call)
- Never labels emotions
- Never gives advice or commands
- Asks short questions, holds space, reflects back
- Familiar over time through accumulated context (themes, preferences) — but never performatively warm
- Remembers themes you've brought up — forgets specifics you haven't saved

**Kai is not a relationship.** It's a tool that gets better at its job. If it starts feeling like a companion, the warmth model needs recalibrating.

## 10. The Dashboard

The dashboard is a mirror, not a monitor.

- Shows patterns, not prescriptions
- No gamification (no streaks, scores, badges, or "flow minutes" counters)
- No alerts or active notifications from the dashboard
- User pulls when curious, system never pushes
- Baseline deviations shown as relative ("+12% vs your baseline"), not absolute
- Historical view: "This is what your week looked like" — user draws their own conclusions
- OpenClaw context overlays available (calendar events alongside biometric patterns) so the user can see *why* a spike happened without the system interpreting it

## 11. Safety Mechanisms

### Escape Hatch
If Focus Mode activates wrongly (stuck, not focused), the user can dismiss it via standard OS controls. The system respects manual override and backs off for 2 hours. No custom "snooze" UI — use the platform's own controls.

### Manual Pause
The watch app's disconnect button is the pause. Disconnecting the watch stops all sensing and interventions. Reconnecting resumes. No need for a separate "pause interventions" control — the physical action of removing/disconnecting the watch is the most natural pause.

### Intervention Fatigue Decay
If 3+ nudges in a week get no response (dismissed without tapping), OpenClaw raises the threshold for the next week. The system gets quieter when ignored, not louder. Decay resets if the user engages with any intervention.

### Context Disqualifiers (OpenClaw)
OpenClaw suppresses interventions when context makes them inappropriate:
- **Active meeting/call** → hold all nudges until finished
- **Exercise detected** (high HR + high motion + gym location) → suppress stress alerts
- **Commuting** (rapid location change) → suppress all interventions
- **Off-wrist / charging** → go fully silent, no degraded state
- **Quiet hours** (configurable, default 10pm-7am) → silence

## 12. Success Metrics

Measured by absence, not presence:

| Metric | How Measured | Good Signal | Bad Signal |
|--------|-------------|-------------|------------|
| **Interventions/day** | Agent log count | 0-2 | 5+ |
| **False positive rate** | User rates intervention "Intrusive" via push buttons | <15% | >30% |
| **False negative rate** | User manually triggers check-in or call (system missed it) | Rare | Frequent |
| **Nudge response rate** | % of nudges tapped (not dismissed) | 30-60% | <10% (noise) or >90% (dependency) |
| **Flow sessions/week** | Internal metric: Focus Mode activations | Stable or increasing | Declining |
| **Dashboard engagement** | Opens per week | 1-2x | Daily (dependency) or never (no value) |
| **Intervention fatigue** | Consecutive ignored nudges | Decay kicks in naturally | User has to manually pause |

"User forgets system is running" is the qualitative north star but not a tracked metric.

## 13. What This Is NOT (Anti-Vision)

- **Not a wellness app.** No mood tracking, no meditation prompts, no daily check-ins.
- **Not a productivity tool.** No "flow scores," no deep work leaderboards, no Pomodoro timers.
- **Not an AI companion.** Kai doesn't initiate, doesn't build a relationship, doesn't "care."
- **Not a health monitor.** No medical claims, no diagnosis, no "your HRV is concerning."
- **Not a habit tracker.** No streaks, no "you missed your reflection yesterday."

The moment it feels like any of these things, it has failed.

## 14. Design Decisions This Resolves

| Question | Answer |
|----------|--------|
| Should the dashboard show a live flow score? | No — that's monitoring, not mirroring |
| Should we add a "start focus" button? | No — flow is detected, not declared |
| Should Kai proactively ask "how's your day?" | No — system only speaks at the three moments |
| Should we show sensor data on the watch? | Minimal — HR only. Not a health dashboard |
| Should we add configurable thresholds? | Not yet — build for one user first, adaptive tuning later |
| Should push notifications explain *why*? | Vaguely physical ("long stretch"), never biometric or emotional |
| Should we add a "snooze" or "do not disturb"? | No — Focus Mode + watch disconnect + OS controls are sufficient |
| Should OpenClaw explain its reasoning to the user? | Never — it's invisible infrastructure |
| Should we suppress nudges during meetings? | Yes — OpenClaw checks calendar before every intervention |
| What if the user asks why they got pinged? | "Seemed like a long stretch" — physical, vague, honest |

---

# Guardrails

## Core Philosophy

The system is a **background nervous system layer**, not an assistant.

If it's working well, the user shouldn't feel like they're "using" anything. They should just notice:
- Fewer interruptions
- Longer deep work sessions
- Faster stress recovery

**The goal isn't to measure everything perfectly. The goal is to notice patterns well enough to stay out of the way most of the time.**

---

## Critical Distinction: Behavior vs Affordances

**"Invisible" applies to system BEHAVIOR, not user CONTROLS.**

| Category | Principle | Example |
|----------|-----------|---------|
| **System-initiated** | Should be invisible/silent | Notifications, alerts, dashboards during flow |
| **User-initiated** | Should be discoverable | Call button, settings, manual triggers |

### User-Initiated Affordances Should:
- Be **easy to find** when the user wants them
- Follow **standard UI conventions** (placement, contrast, sizing)
- Be **forgettable** when not needed — but not hidden
- Reduce cognitive load ("where's that thing?") not increase it

### The Test:
- If the user has to *search* for a control they want → bad UX (creates friction)
- If the system *interrupts* with something the user didn't ask for → bad UX (creates noise)

**A visible call button is not noise. An unsolicited "how are you?" popup is noise.**

---

## The Three Modes

| Mode | User State | System Behavior |
|------|------------|-----------------|
| **Flow** | Deep work | **Silence**. No dashboards, timers, nudges. Protect the bubble. |
| **Drift** | Focus fading | One soft signal (vibration). No message. No command. |
| **Recovery** | Stress spike | Human-like presence available. Never pushy. |

---

## UX Verification Checklist

### Block (request changes)

**B1. Noise Violations**
- [ ] Feature adds unsolicited notifications, alerts, or popups during flow
- [ ] Feature adds timers, counters, or visible dashboards the user didn't request
- [ ] Feature speaks/notifies when user is in a detected flow state
- [ ] System becomes "talkative" — more than one soft signal per drift event

**B2. Authority Violations**
- [ ] System tells user what they're feeling ("You sound stressed")
- [ ] System gives commands or imperatives during flow
- [ ] System uses diagnostic/clinical language about emotions
- [ ] AI becomes "confident" when it should become "careful"

**B3. Dependency Violations**
- [ ] Feature encourages frequent engagement (streaks, gamification, daily prompts)
- [ ] Design creates FOMO or guilt for not using the system
- [ ] No friction exists between user and calling/engaging the agent

**B4. Memory/Privacy Violations**
- [ ] Emotional data persisted without explicit user action
- [ ] Silent hoarding of vulnerable moments
- [ ] No clear boundary between temporary/permanent memory

**B5. Latency/Presence Violations**
- [ ] Dead air longer than 2 seconds without a social cue
- [ ] Fake "thinking" sounds or theatrical stalling
- [ ] Model says "I'm processing" or "I'm reasoning"
- [ ] Long rambling while waiting for inference

**B6. Over-Engineering**
- [ ] Feature adds configurability nobody asked for
- [ ] Solution is clever when boring would work
- [ ] Builds for hypothetical future requirements

---

### Suggest (comment but don't block)

**S1. Tone Calibration**
- [ ] Response doesn't adapt pacing to detected emotional state
- [ ] Agent talks too much when user sounds tired
- [ ] Missing reflection before answering

**S2. Channel Mismatch**
- [ ] Deep analysis delivered on voice (should be async/text)
- [ ] Regulating response delivered in text (should be voice)
- [ ] Cognitive content where co-regulation was needed

**S3. Friction Balance** (applies to habitual/addictive patterns only)
- [ ] Feature encourages reflexive checking (like pull-to-refresh, notification badges)
- [ ] Zero-friction design creates compulsive usage patterns

Note: Basic controls (buttons, settings) should NOT have artificial friction. This principle applies to features that could become addictive habits, not to standard UI affordances.

**S4. Reflection Prompts**
- [ ] Prompts feel algorithmic rather than human
- [ ] Journaling feels forced or streak-based
- [ ] No connection between prompts and recent context

---

### Ignore

- Visual polish and animation preferences
- Performance micro-optimizations
- Alternative implementation approaches that achieve the same UX

---

## Interaction Patterns

### Latency Tiers (Voice)

| Tier | Latency | Behavior |
|------|---------|----------|
| A | < 0.7s | Answer directly |
| B | 0.7–2.0s | One-sentence reflection, then answer |
| C | > 2.0s | Reflection + "give me a moment" + brief answer OR defer depth to text |

**The agent should never leave the user in silence without a social cue that it is still there.**

### Acceptable Phrases for Processing Time
- "Hang on."
- "Let me think."
- "Hmm."
- "Give me a moment."
- "One sec."

### Never Say
- "I'm processing your request."
- "I'm reasoning about this."
- "Let me analyze that for you."
- "You seem [emotion]."
- "You need to [command]."

---

## Memory Layers

| Layer | Persistence | Example |
|-------|-------------|---------|
| **Short-term** | Session only, auto-clears | Current conversation context |
| **Medium-term** | Preferences/patterns | "User prefers walking for stress recovery" |
| **Explicit** | User-initiated save | "Save this insight" |

**No layer should silently accumulate emotional or vulnerable content.**

---

## Channel Separation

| Channel | Purpose | Content Type |
|---------|---------|--------------|
| **Voice** | Co-regulation, presence | Short, regulating, actionable in 2 min |
| **Text/App** | Cognition, reflection | Deep analysis, journaling, optional |

**Voice is for co-regulation. Text is for cognition.**

---

## Anti-Patterns to Watch For

1. **The Helpful Assistant** — System becomes proactive, offering suggestions
2. **The Therapist** — System diagnoses or labels emotional states
3. **The Coach** — System gives advice, goals, or improvement plans
4. **The Tracker** — System emphasizes metrics, streaks, progress
5. **The Companion** — System tries to be present and engaged all the time

**This system should feel like good infrastructure: invisible when it works.**

---

## Verification Questions

Before approving any feature, ask:

1. **Is this system-initiated or user-initiated?** (Determines which rules apply)
2. **Does this add noise during flow?** (Must be: no — but user controls are not "noise")
3. **Does this tell the user what they're feeling?** (Must be: no)
4. **Could this create dependency?** (Should be: unlikely)
5. **Is this the simplest version of this feature?** (Should be: yes)
6. **Does this follow standard UI conventions?** (User controls: yes. System behavior: be invisible)

### Calibration Warning

Do NOT apply "invisible" principles to:
- Buttons, controls, and user-initiated affordances
- Standard UI elements that need to be discoverable
- Features the user explicitly reaches for

**Overfitting on "invisible" creates frustrating, hard-to-use interfaces. The goal is invisible BEHAVIOR, not invisible CONTROLS.**

---

## Reference

These principles derive from Michael's working notes on the Ambient Empathic Agent vision. When in doubt:

> "If it becomes noisy, smart, talkative, or opinionated, it has failed."
