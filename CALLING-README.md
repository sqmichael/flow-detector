# Ambient Empathic Agent - Calling Demo

A prototype voice calling interface for the Flow Detector that enables bidirectional conversations with an emotionally-aware AI agent.

## What This Demo Does

Click the **"📞 Call Me"** button in the dashboard and your phone will ring within seconds. Answer it and you'll hear a calm AI voice that:

- Adapts its tone and pacing based on your emotional state (stress, fatigue, agitation)
- Responds naturally with brief acknowledgments ("Hang on", "I hear you")
- Never diagnoses your emotions or tells you how you feel
- Suggests walks when appropriate, but doesn't push
- Ends gracefully if you seem uncomfortable

This is built on **Hume AI's Empathic Voice Interface (EVI)** — the same technology powering production mental health coaching apps with 2x engagement rates.

## Architecture

```
Dashboard UI               Call Service           Twilio Voice           Hume EVI API
(localhost:3000)          (localhost:8766)       (Phone Network)      (Emotion Detection)
     │                          │                       │                      │
     │  Click "Call Me"         │                       │                      │
     ├─────────────────────────>│                       │                      │
     │                          │                       │                      │
     │                          │  POST /calls          │                      │
     │                          ├──────────────────────>│                      │
     │                          │                       │                      │
     │                          │  Dial user's phone    │                      │
     │                          │<──────────────────────┤                      │
     │                          │                       │                      │
     │                          │  Connect to Hume EVI  │                      │
     │                          │──────────────────────────────────────────────>│
     │                          │                       │                      │
     │  Toast: "Calling..."     │                       │   Your phone rings   │
     │<─────────────────────────┤                       │<─────────────────────┤
     │                          │                       │                      │
     │                          │              [You answer and talk]            │
     │                          │                       │                      │
     │                          │              Emotion-aware conversation       │
     │                          │              with real-time adaptation        │
```

## Quick Start

### 1. Sign up for services (15 minutes)

**Twilio** (free trial with $15 credit):
1. https://www.twilio.com/try-twilio
2. Get Account SID, Auth Token, and buy a phone number
3. Verify your personal phone number (trial limitation)

**Hume AI** (generous free tier):
1. https://platform.hume.ai
2. Create API key
3. Create EVI configuration (use `server/calling/hume-config.json` or see setup guide)
4. Copy Config ID

### 2. Configure environment

```bash
cd server/calling
cp .env.example .env
# Edit .env with your credentials
```

### 3. Install and run

```bash
# Install dependencies
npm install

# Terminal 1: Start the call service
npm run call-service

# Terminal 2: Start the dashboard
npm run dev

# Terminal 3 (optional): Start watch relay if you want full flow detection
npm run watch-server
```

### 4. Test it

1. Open http://localhost:3000
2. Click the purple **"📞 Call Me"** button in the top-right corner
3. Your phone should ring within 5 seconds
4. Answer and say "Hey, how's it going?"

The AI will respond naturally and adapt to your vocal tone.

## Design Principles (from vision doc)

**The agent should:**
- Disappear into the background most of the time
- Support existing behaviors, not create new dependencies
- Adapt tone/pacing based on emotion, never diagnose emotions
- Handle latency gracefully with natural markers ("Hang on", "Let me think")
- Defer deep reasoning to text/app, keep voice brief and regulating

**The agent should NEVER say:**
- "You sound stressed"
- "You seem angry"
- "You need to calm down"
- "Let me help you" (too coaching-like)

**The agent CAN say:**
- "How are things?"
- "Want to step outside and talk?"
- "I hear you"
- "That sounds like a lot"
- "Hang on" (when thinking)

## Files Structure

```
server/calling/
├── call-service.ts          # Express server that triggers Twilio calls
├── hume-config.json         # AI personality configuration
├── .env.example             # Environment template
└── SETUP.md                 # Detailed setup guide

src/hooks/
└── use-call-trigger.ts      # React hook for triggering calls from UI

src/app/page.tsx             # Dashboard with "Call Me" button
```

## Costs

- **Twilio**: ~$0.013/minute (trial includes $15 free credit ≈ 1,150 minutes)
- **Hume EVI**: Check current pricing at https://platform.hume.ai/pricing

For personal testing, costs are minimal.

## Next Steps (Roadmap)

**Phase 1 (Current)**: Manual call trigger via dashboard button ✅

**Phase 2**: Automatic stress detection
- Wire flow detector to trigger calls when stress spikes are detected
- Add consent mechanism and opt-out controls

**Phase 3**: Bidirectional calling
- Allow user to call the agent (Twilio inbound calls)
- Add "thinking together" mode for voice journaling

**Phase 4**: Memory layers
- Short-term memory (auto-expires)
- Medium-term memory (preferences, patterns)
- Explicit memory (user chooses what to save)

**Phase 5**: Integration with journaling app
- Send reflection prompts after calls
- Sync with Samsung Fold orchestration layer

**Phase 6**: WhatsApp migration
- Use WhatsApp Business Calling API for more natural integration
- Keep phone calls as fallback

## Troubleshooting

**Button does nothing / Toast shows error:**
- Make sure call service is running: `npm run call-service`
- Check that all environment variables are set in `server/calling/.env`
- Look at call service console logs for errors

**Call doesn't come through:**
- Verify your phone number is verified in Twilio Console (trial requirement)
- Check phone numbers are in E.164 format: +1234567890
- Verify Twilio account has credit

**AI doesn't respond / dead air:**
- Check Hume API key and Config ID are correct
- Verify the EVI configuration is active in Hume platform
- Try recreating the configuration manually

**Call quality is poor:**
- This is VoIP — network quality matters
- Twilio production quality is better than trial
- Consider upgrading Twilio account if needed

See `server/calling/SETUP.md` for detailed troubleshooting.

## Legal / Compliance

**IMPORTANT**: Before production use:

1. **Get written consent** from users before making outbound calls (FCC TCPA regulations)
2. **Disclose it's AI** at the start of calls
3. **Provide opt-out mechanism**
4. **Keep consent records**

For personal demos with your own phone number, these regulations don't apply.

## Resources

- [Hume EVI Documentation](https://dev.hume.ai/docs/empathic-voice-interface-evi/overview)
- [Twilio Voice API](https://www.twilio.com/docs/voice)
- [Ream Case Study: 2x Engagement with EVI](https://www.hume.ai/blog/case-study-hume-ream-app-limited)
- Vision document: See top of this file for design principles

## Feedback

This is a early prototype. The goal is to demo the UX and see if the interaction feels right — calm, present, non-intrusive.

Try it out and notice:
- Does the AI feel calm or coaching?
- Does latency handling feel natural?
- Would you actually want this to call you after a stressful meeting?

The system should feel boring in logs and invisible in life. If it's clever, talkative, or opinionated, it has failed.
