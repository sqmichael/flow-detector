# UX Principles — Ambient Empathic Agent

> "Boring in logs and invisible in life."

This document codifies the UX philosophy for all features. Every implementation must be verified against these principles before merge.

---

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
