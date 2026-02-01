# Memory Layer Specification

> Revised spec synthesizing perspectives from behavioral psychology, adversarial reasoning, and UX design.

## Design Philosophy

### Core Principle
**Memory should make the agent feel like it was paying attention, not like it's watching you.**

The difference is subtle but critical:
- Paying attention → builds trust
- Watching → destroys trust

### Target User Psychology
- Founder/executive with **avoidant attachment style**
- Values independence, distrusts reliance on others
- Ego prevents volunteering vulnerability
- Paranoid about surveillance and being "figured out"
- Will reject anything that feels needy, intrusive, or presumptuous

### The Agent's Role
The agent attempts to function as a **secure base** (Bowlby) — reliably available in times of need, allowing the user to work with confidence. It must prove competence before expecting trust.

---

## Memory Architecture

### Two-Tier Model (Simplified from Three)

The original three-tier model (ephemeral/working/explicit) was overengineered. Simplified to:

| Tier | Scope | Decay | User Visibility |
|------|-------|-------|-----------------|
| **Session** | Current call only | Dies when call ends | Invisible |
| **Remembered** | Cross-session themes | 4 weeks default, extendable | Transparent |

**Why two tiers:**
- Simpler mental model = easier to trust
- User can predict behavior: "It remembers what I told it to, everything else fades"
- No hidden "working" layer that feels like surveillance

### What Gets Remembered

**Themes, not data:**
- "The vendor negotiation" ✓
- "Struggling with delegation" ✓
- "HRV dropped 23% on Tuesday" ✗
- "Stressed 4 times this week" ✗

**Topics, not emotions:**
- "That proposal" ✓
- "The board meeting" ✓
- "You seemed anxious" ✗
- "Your stress levels" ✗

**Preferences, not patterns:**
- "Walks help after tense calls" ✓
- "Mornings are protected" ✓
- "You always get stressed after vendor calls" ✗

---

## Memory Operations

### During Call: Invisible

No memory operations are visible during the call. The call is for presence and regulation, not data management.

**Never say:**
- "I'm saving this"
- "I'll remember that"
- "Adding to your profile"

**Instead:**
- "I'll hold onto that" (only if user explicitly requests)
- Or simply acknowledge and move on

### After Call: Theme Confirmation

After substantive calls (>3 minutes with actual content), the agent may ask for theme confirmation. This happens via low-interruption UI (notification, not voice), not during the call.

**Choice architecture, not yes/no:**

> "Was that call about:"
> - The vendor negotiation
> - Delegation challenges
> - Neither / something else

This:
- Improves accuracy (agent might misidentify theme)
- Gives user autonomy
- Makes memory feel like *their* record, not agent's surveillance

**If user ignores:** Nothing is remembered. Silence = no save. Never prompt twice.

### Prompted Promotion (Not Passive)

When a theme recurs across multiple calls, the agent may offer to extend its memory. But this must be **explicit and consensual**, not automatic.

**Never do:**
- Silently promote because theme appeared 3+ times
- "I noticed this keeps coming up" (bean counter energy)

**Instead, during theme confirmation:**
> "The vendor situation has come up a few times. Want me to hold onto this longer?"

User chooses. If ignored, standard 4-week decay applies.

### Explicit Long-Term Save

User can explicitly mark something as permanent:
- "Remember that walks help me"
- "This is important long-term"

**Agent response:** "Got it." (No ceremony, no database language)

These memories never decay unless explicitly deleted.

### Deletion: Instant and Unceremonious

> User: "Forget what I said about [X]"
> Agent: "Done."

No "are you sure?" No explanation of what was deleted. Just gone.

---

## The Ripcord

**Critical safety mechanism for proactive calls.**

A single bad call can permanently destroy trust. User needs immediate, zero-friction recovery.

### Voice Command: "Dismiss and forget"

This command:
1. Ends the call immediately
2. Purges all session memory
3. Signals false positive (timing was wrong, call was unwanted)
4. Requires zero explanation

**Variations that should work:**
- "Dismiss"
- "Not now"
- "Bad timing"
- "Forget it"

**What happens after:**
- No follow-up
- No "Is everything okay?"
- No retry for at least 24 hours
- Agent learns this context (time, situation) was wrong

---

## Pattern Awareness Rules

The agent can notice patterns. But how it surfaces them determines trust or surveillance.

### The Framing Rule

**Point at the thing, not the user.**

| Bad (observation of user) | Good (service about the thing) |
|---------------------------|-------------------------------|
| "You seem stressed about X" | "That X thing is still going. Want help?" |
| "You've been struggling with this" | "Want me to take a first pass at that?" |
| "This is the 4th time this week" | "That situation again. Walk and talk?" |
| "I noticed your HRV dropped" | "You seem lower energy than usual" |

### The Offer Rule

**Frame as service, not insight.**

The agent opens doors. It doesn't push through them.

- "Want me to draft something?" ✓
- "Should I block your calendar?" ✓
- "You need to take a break" ✗
- "You should talk to someone about this" ✗

### The Ego Rule

**Create permission for vulnerability without requiring admission.**

A good assistant notices something is heavy and offers practical help. The user can accept without admitting they're struggling.

> "That proposal has been on your plate for a while. Want me to take a first pass?"

This gives an exit from struggle without confronting ego.

---

## Biometric Context (HRV Energy Proxy)

### Use Objective Language, Not Emotional Labels

Following Whoop/Oura precedent: medicalize and quantify, removing emotional judgment.

| Don't say | Do say |
|-----------|--------|
| "You seem stressed" | "Your energy seems lower than usual" |
| "You're anxious" | "You're running hot today" |
| "Calm down" | (never say this) |

### HRV as Shared Vocabulary

HRV trends provide an objective basis for check-ins without emotional presumption.

- Agent can reference "energy" or "recovery" as neutral concepts
- User and agent share a language that's physiological, not psychological
- Reduces defensiveness for avoidant users

### What HRV Informs (Not What It Says)

HRV informs:
- Whether to initiate a call (low recovery + sustained = maybe check in)
- Tone and pacing during call (lower energy = slower, simpler)
- What NOT to do (high flow state = do not interrupt)

HRV never becomes:
- A score shown to user
- A pattern logged over time
- Evidence cited during conversation

---

## Storage Design

### Local-First, No Cloud

All memory stored on user's device (MacBook where call-service runs). No external sync.

### Simple Schema

```
remembered_themes:
  - id: string
  - theme: string (e.g., "vendor negotiation")
  - context: string (brief, 1-2 sentences)
  - created: timestamp
  - expires: timestamp (4 weeks from created, or null if permanent)
  - source: "call" | "explicit"

preferences:
  - id: string
  - preference: string (e.g., "walks help after tense calls")
  - approved: timestamp
  - permanent: true
```

### Cleanup

On each call-service startup:
- Delete expired themes
- No logging of what was deleted
- Simple timestamp comparison

---

## Failure Modes and Mitigations

| Failure Mode | Mitigation |
|--------------|------------|
| Theme misidentification | Choice architecture in confirmation ("Was it A, B, or neither?") |
| Pattern-awareness feels like surveillance | Service framing, never count occurrences aloud |
| Important things forgotten | Prompted promotion for recurring themes, user's choice |
| Decay kills meaningful continuity | 4-week default (longer than 2), permanent option for explicit saves |
| Explicit save has too much friction | Simple voice: "Remember that" → "Got it" |
| Bad call destroys trust | Ripcord: "Dismiss and forget" |
| User feels "figured out" | No passive promotion, no emotional logging |
| Opening line feels random | Energy proxy: "You seem lower energy than usual. Got a minute?" |

---

## UX Moments (Reference Scenarios)

### First Call
Agent: "Hey Michael. Just checking in. Want to talk for a bit?"
*(No memory needed. Just presence.)*

### Second Call (3 days later)
User: "Another tough call with that vendor."
Agent: "That situation again. Want to walk and talk about it?"
*(Callback enabled by remembered theme, not surveillance.)*

### After Call (notification, not voice)
> "Was that call about:"
> - The vendor negotiation
> - Something else
> - [Dismiss]

### Recurring Theme
During theme confirmation:
> "The vendor situation has come up a few times. Want me to hold onto this longer?"

### User Requests Memory
User: "Remember that walks help me after these calls."
Agent: "Got it."
*(Stored permanently, no ceremony.)*

### Bad Timing
Agent calls during a meeting.
User: "Not now."
*(Call ends. No retry for 24h. No follow-up.)*

### Deletion
User: "Forget what I said about Steve."
Agent: "Done."
*(Gone. No confirmation needed.)*

---

## Success Criteria

The memory layer succeeds if:

1. **User forgets it exists** — during calls, memory is invisible
2. **Callbacks feel natural** — "that thing again" not "your 4th stress event"
3. **User never feels surveilled** — no counting, no emotional logging
4. **Important things persist** — through explicit save or prompted promotion
5. **Bad calls are recoverable** — ripcord works, trust survives
6. **Agent feels like a friend who saw you last week** — not a therapist reviewing your file

---

## What This System Avoids

- Emotional profiling
- Productivity tracking
- Pattern surveillance
- Case-file building
- Gamification or streaks
- Coaching or diagnosis
- Dependency creation
- Intelligence theater

---

## References

- **Attachment Theory** (Bowlby) — secure base, avoidant attachment
- **Self-Determination Theory** (Deci & Ryan) — autonomy, competence, relatedness
- **Calm Technology** (Weiser & Brown) — periphery to center, minimal attention demand
- **The Media Equation** (Nass & Moon) — predictability in human-computer trust
- **Whoop/Oura** — objective physiological language
- **Woebot** — therapeutic chatbot memory as user's journal, not agent's file
