/**
 * Ambient Empathic Agent - Call Service
 *
 * Triggers outbound calls via Twilio + Hume EVI
 *
 * Usage:
 *   npm run call-service
 *
 * Environment variables needed:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_PHONE_NUMBER
 *   HUME_API_KEY
 *   HUME_CONFIG_ID
 *   USER_PHONE_NUMBER
 */

import express from 'express';
import cors from 'cors';
import twilio from 'twilio';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.CALL_SERVICE_PORT || 8766;

// Validate environment variables
const requiredEnvVars = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'HUME_API_KEY',
  'HUME_CONFIG_ID',
  'USER_PHONE_NUMBER'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('Missing required environment variables:', missingVars.join(', '));
  console.error('\nCreate a .env file with:');
  console.error('TWILIO_ACCOUNT_SID=your_account_sid');
  console.error('TWILIO_AUTH_TOKEN=your_auth_token');
  console.error('TWILIO_PHONE_NUMBER=your_twilio_number');
  console.error('HUME_API_KEY=your_hume_api_key');
  console.error('HUME_CONFIG_ID=your_hume_config_id');
  console.error('USER_PHONE_NUMBER=your_phone_number');
  process.exit(1);
}

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

interface CallTrigger {
  reason?: string;
  context?: string;
}

/**
 * POST /call/trigger
 *
 * Trigger an outbound call to the user
 *
 * Body:
 *   reason: "stress_check_in" | "user_requested"
 *   context: optional context string
 */
app.post('/call/trigger', async (req, res) => {
  const { reason = 'user_requested', context = '' }: CallTrigger = req.body;

  console.log(`[Call Trigger] Reason: ${reason}`);
  if (context) {
    console.log(`[Call Trigger] Context: ${context}`);
  }

  try {
    // Hume EVI endpoint for Twilio integration
    // This URL tells Twilio to connect the call to Hume's EVI system
    const humeEviUrl = `https://api.hume.ai/v0/evi/twilio?config_id=${process.env.HUME_CONFIG_ID}&api_key=${process.env.HUME_API_KEY}`;

    // Initiate outbound call via Twilio
    const call = await twilioClient.calls.create({
      to: process.env.USER_PHONE_NUMBER!,
      from: process.env.TWILIO_PHONE_NUMBER!,
      url: humeEviUrl,
      method: 'POST',
      statusCallback: `http://localhost:${PORT}/call/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST'
    });

    console.log(`[Call Initiated] SID: ${call.sid}`);
    console.log(`[Call Status] ${call.status}`);

    res.json({
      success: true,
      callSid: call.sid,
      status: call.status,
      reason
    });

  } catch (error: unknown) {
    // Narrow error type for safe access and deterministic messages
    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown error occurred while triggering call';

    console.error('[Call Error]', errorMessage);
    if (error instanceof Error && error.stack) {
      console.error('[Call Error Stack]', error.stack);
    }

    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

/**
 * POST /call/status
 *
 * Webhook for call status updates from Twilio
 */
app.post('/call/status', (req, res) => {
  const { CallSid, CallStatus, Duration } = req.body;

  console.log(`[Call Status Update] SID: ${CallSid}, Status: ${CallStatus}`);

  if (Duration) {
    console.log(`[Call Duration] ${Duration} seconds`);
  }

  res.sendStatus(200);
});

/**
 * GET /health
 *
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ambient-empathic-agent-calling',
    twilioConfigured: !!process.env.TWILIO_ACCOUNT_SID,
    humeConfigured: !!process.env.HUME_API_KEY
  });
});

app.listen(PORT, () => {
  console.log(`\n🎯 Ambient Empathic Agent - Call Service`);
  console.log(`📞 Listening on http://localhost:${PORT}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /call/trigger - Trigger outbound call`);
  console.log(`  POST /call/status  - Call status webhook`);
  console.log(`  GET  /health       - Health check`);
  console.log(`\nTo trigger a test call:`);
  console.log(`  curl -X POST http://localhost:${PORT}/call/trigger \\\n       -H "Content-Type: application/json" \\\n       -d '{"reason": "stress_check_in"}'`);
  console.log('');
});
