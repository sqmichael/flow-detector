# Ambient Empathic Agent - Setup Guide

## Quick Demo Setup (15 minutes)

### 1. Get Twilio Credentials (Free Trial)

1. Sign up at https://www.twilio.com/try-twilio
2. After signup, go to https://console.twilio.com
3. Copy your **Account SID** and **Auth Token**
4. Buy a phone number:
   - Go to Phone Numbers → Manage → Buy a number
   - Choose a number (free with trial credit)
   - Copy the phone number (format: +1234567890)

### 2. Get Hume AI Credentials

1. Sign up at https://platform.hume.ai
2. Create an API key:
   - Go to Settings → API Keys
   - Create new key and copy it
3. Create an EVI configuration:
   - Go to EVI → Configurations
   - Click "Create Configuration"
   - Upload the `hume-config.json` file from this directory
   - After creation, copy the **Config ID** (looks like: `conf_xxxxx`)

Alternatively, you can manually create the config with these settings:
   - **Name**: ambient-empathic-agent
   - **System Prompt**: Copy from `hume-config.json`
   - **Voice**: Choose a calm, conversational voice
   - **Enable emotion detection**: Yes

### 3. Configure Environment Variables

**Backend (Call Service):**

1. Create `server/calling/.env`:
   ```bash
   cd server/calling
   cat > .env << 'EOF'
   TWILIO_ACCOUNT_SID=AC1234...
   TWILIO_AUTH_TOKEN=abc123...
   TWILIO_PHONE_NUMBER=+15551234567
   HUME_API_KEY=hume_...
   HUME_CONFIG_ID=conf_...
   USER_PHONE_NUMBER=+15559876543
   EOF
   ```

2. Replace the placeholder values with real credentials.

**Frontend (Next.js Dashboard):**

The frontend needs to know where to find the call service. If you're using the default port (8766), no configuration is needed. If you change the port:

1. Create `.env.local` in the project root:
   ```bash
   cd /path/to/flow-detector
   cat > .env.local << 'EOF'
   NEXT_PUBLIC_CALL_SERVICE_PORT=8766
   EOF
   ```

2. Uncomment and set the port:
   ```bash
   NEXT_PUBLIC_CALL_SERVICE_PORT=8766
   ```

   Or set the full URL:
   ```bash
   NEXT_PUBLIC_CALL_SERVICE_URL=http://localhost:8766
   ```

### 4. Install Dependencies

```bash
cd /path/to/flow-detector
npm install
```

### 5. Run the Call Service

```bash
npm run call-service
```

You should see:
```
🎯 Ambient Empathic Agent - Call Service
📞 Listening on http://localhost:8766

Endpoints:
  POST /call/trigger - Trigger outbound call
  POST /call/status  - Call status webhook
  GET  /health       - Health check
```

### 6. Test Your First Call

**Option A: Via Dashboard UI**

1. Start the Next.js dashboard:
   ```bash
   npm run dev
   ```
2. Open http://localhost:3000
3. Click the "Call Me" button in the top-right corner

**Option B: Via Command Line**

```bash
curl -X POST http://localhost:8766/call/trigger \
     -H "Content-Type: application/json" \
     -d '{"reason": "stress_check_in"}'
```

Your phone should ring within a few seconds. Answer it and the AI will greet you with:

> "Hey Michael, how are things?"

Try responding naturally. The AI will adapt its pacing based on your vocal tone (stress, fatigue, etc.).

## Troubleshooting

**Call doesn't come through:**
- Check that Twilio account is active and has credit
- Verify phone numbers are in E.164 format (+1234567890)
- Check the call-service logs for errors

**AI doesn't respond:**
- Verify Hume API key and Config ID are correct
- Check that the Hume EVI configuration is active
- Try recreating the Hume config manually

**Twilio trial limitations:**
- Can only call verified phone numbers (verify yours in Twilio Console)
- Limited to outbound calls within your country
- Adds a message about trial usage before connecting

**Costs:**
- Twilio: ~$0.013/minute for voice calls (trial includes $15 credit)
- Hume EVI: Check current pricing at https://platform.hume.ai/pricing

## Next Steps

Once the demo is working:

1. **Connect to flow detector**: Wire stress detection to trigger automatic check-in calls
2. **Add bidirectional calling**: Allow yourself to call the agent
3. **Implement memory layers**: Short-term, medium-term, and explicit memory
4. **Add journaling prompts**: Send reflection prompts to the app after calls
5. **Migrate to WhatsApp**: Use WhatsApp Business API for more natural integration

## Architecture

```
┌─────────────────────┐
│  Dashboard UI       │  (Call Me button)
│  localhost:3000     │
└──────────┬──────────┘
           │ HTTP POST /call/trigger
           ▼
┌─────────────────────┐
│  Call Service       │  (Express server)
│  localhost:8766     │
└──────────┬──────────┘
           │ Twilio API call
           ▼
┌─────────────────────┐
│  Twilio Voice API   │  (Places call to your phone)
└──────────┬──────────┘
           │ Connects call to Hume EVI URL
           ▼
┌─────────────────────┐
│  Hume EVI API       │  (Handles conversation with emotion detection)
└─────────────────────┘
           │
           ▼
      Your Phone
```

## Security Notes

- **Never commit `.env` files** to version control (already in .gitignore)
- Keep Twilio Auth Token and Hume API key private
- For production, use environment variables or secrets management
- Implement rate limiting for /call/trigger endpoint to prevent abuse
- Add authentication to the call-service API endpoints

## Legal Notes (TCPA Compliance)

Before using this in production:

1. **Express prior written consent required** for outbound calls (FCC TCPA regulations)
2. **Must disclose it's AI** at the beginning of calls
3. Consider adding opt-out mechanism
4. Keep records of user consent

For personal/demo use with your own phone number, these regulations don't apply.
