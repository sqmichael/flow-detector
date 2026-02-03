/**
 * Ambient Empathic Agent - Call Service
 *
 * Triggers outbound calls via Twilio + Hume EVI with memory layer.
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
 *   OPENROUTER_API_KEY (for theme extraction)
 */

import express from 'express';
import cors from 'cors';
import twilio from 'twilio';
import {
  getDb,
  closeDb,
  expireOldThemes,
  getMemorySummary,
  saveTheme,
  touchTheme,
  findThemeByKeyword,
  prepareCallWithMemory,
  prepareOnboardingCall,
  extractTheme,
  HumeWebhookEvent,
  extractTranscriptText,
  MIN_CALL_DURATION_FOR_THEME,
  // User state management
  getUserState,
  recordSuccessfulCall,
  recordRipcord,
  recordUserThanks,
  completeOnboarding,
} from './memory';

// === Call Outcome Detection ===

const RIPCORD_PHRASES = ['dismiss', 'not now', 'stop', 'bad timing', 'gotta go', 'let me go'];
const THANKS_PHRASES = ['thank', 'thanks', 'appreciate'];
const MIN_SUCCESSFUL_CALL_SECONDS = 60; // 1 minute minimum for "successful" call
const MAX_RIPCORD_DURATION_SECONDS = 30; // Very short calls are likely ripcords
const MIN_TECH_FAILURE_SECONDS = 10; // Below this, assume technical failure not user rejection

// Word boundary matching to avoid false positives (e.g., "stop" in "unstoppable")
function matchesPhrase(text: string, phrases: string[]): boolean {
  const lower = text.toLowerCase();
  return phrases.some(phrase => {
    const regex = new RegExp(`\\b${phrase}\\b`, 'i');
    return regex.test(lower);
  });
}

function detectRipcord(transcriptText: string, duration: number): boolean {
  // Very short calls (<10s) are likely technical failures, not user rejection
  if (duration < MIN_TECH_FAILURE_SECONDS) {
    return false;
  }

  // Short calls (10-30s) are implicit ripcords (user hung up quickly)
  if (duration < MAX_RIPCORD_DURATION_SECONDS) {
    return true;
  }

  // For medium-length calls (30-60s), check transcript for explicit ripcord
  // If call lasted 60+ seconds, the agent didn't catch the ripcord intent,
  // so the phrase was likely used in a different context
  if (duration < MIN_SUCCESSFUL_CALL_SECONDS) {
    return matchesPhrase(transcriptText, RIPCORD_PHRASES);
  }

  // Long calls (>=60s) are not ripcords
  return false;
}

function detectThanks(transcriptText: string): boolean {
  return matchesPhrase(transcriptText, THANKS_PHRASES);
}

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
  console.error('OPENROUTER_API_KEY=your_openrouter_key (optional, for theme extraction)');
  process.exit(1);
}

// Initialize memory layer
console.log('[Memory] Initializing database...');
getDb(); // This initializes the database
const expiredCount = expireOldThemes();
if (expiredCount > 0) {
  console.log(`[Memory] Cleaned up ${expiredCount} expired themes`);
}
const summary = getMemorySummary();
const initialUserState = getUserState();
console.log(`[Memory] Loaded ${summary.themes.length} themes, ${summary.preferences.length} preferences`);
console.log(`[State] Warmth: ${initialUserState.warmth_level.toFixed(1)}, Onboarded: ${initialUserState.onboarding_complete}`);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

interface CallTrigger {
  reason?: string;
  context?: string;
}

// Track which call SIDs are onboarding calls
// This is needed because Hume webhook doesn't tell us the call type
const onboardingCallSids = new Set<string>();

// Lock to prevent concurrent onboarding triggers
let onboardingInProgress = false;

// Minimum duration for successful onboarding call (30 seconds)
// Shorter than regular successful call because onboarding is scripted
const MIN_ONBOARDING_DURATION_SECONDS = 30;

/**
 * POST /call/trigger
 *
 * Trigger an outbound call to the user with memory context injected.
 *
 * Body:
 *   reason: "stress_check_in" | "user_requested"
 *   context: optional context string (deprecated, use memory layer)
 */
app.post('/call/trigger', async (req, res) => {
  const { reason = 'user_requested', context = '' }: CallTrigger = req.body;

  console.log(`[Call Trigger] Reason: ${reason}`);
  if (context) {
    console.log(`[Call Trigger] Context: ${context}`);
  }

  try {
    // Prepare call with memory-injected config
    const humeEviUrl = await prepareCallWithMemory(
      process.env.HUME_CONFIG_ID!,
      process.env.HUME_API_KEY!
    );

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
      reason,
      memoryInjected: !summary.isEmpty
    });

  } catch (error: unknown) {
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
 * POST /call/onboarding
 *
 * Trigger the onboarding call for a new user.
 * This introduces Kai and sets expectations.
 *
 * Returns 400 if user is already onboarded.
 */
app.post('/call/onboarding', async (req, res) => {
  const userState = getUserState();

  // Check if already onboarded (idempotency)
  if (userState.onboarding_complete) {
    console.log('[Onboarding] User already onboarded, skipping');
    return res.status(400).json({
      success: false,
      error: 'User already onboarded',
      warmthLevel: userState.warmth_level
    });
  }

  // Check if onboarding already in progress (prevent concurrent triggers)
  if (onboardingInProgress) {
    console.log('[Onboarding] Already in progress, rejecting');
    return res.status(409).json({
      success: false,
      error: 'Onboarding call already in progress'
    });
  }

  onboardingInProgress = true;
  console.log('[Onboarding] Starting onboarding call...');

  try {
    // Prepare call with onboarding-specific prompt
    const humeEviUrl = await prepareOnboardingCall(
      process.env.HUME_CONFIG_ID!,
      process.env.HUME_API_KEY!
    );

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

    // Track this as an onboarding call
    onboardingCallSids.add(call.sid);

    console.log(`[Onboarding] Call initiated, SID: ${call.sid}`);

    res.json({
      success: true,
      callSid: call.sid,
      status: call.status,
      callType: 'onboarding'
    });

  } catch (error: unknown) {
    onboardingInProgress = false; // Release the lock on failure

    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Unknown error occurred while triggering onboarding call';

    console.error('[Onboarding Error]', errorMessage);
    if (error instanceof Error && error.stack) {
      console.error('[Onboarding Error Stack]', error.stack);
    }

    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// Track call SID to session ID mapping for onboarding detection
// Twilio gives us CallSid, Hume gives us session_id - we need to correlate them
// For now, we track the most recent call SID and assume Hume webhook comes shortly after
let pendingOnboardingCallSid: string | null = null;

/**
 * POST /call/status
 *
 * Webhook for call status updates from Twilio
 */
app.post('/call/status', (req, res) => {
  const { CallSid, CallStatus, Duration } = req.body;

  console.log(`[Call Status Update] SID: ${CallSid}, Status: ${CallStatus}`);

  // Track if this is an onboarding call that just started
  if (CallStatus === 'in-progress' && onboardingCallSids.has(CallSid)) {
    pendingOnboardingCallSid = CallSid;
    console.log(`[Call Status] Onboarding call in progress: ${CallSid}`);
  }

  // Clean up completed onboarding calls
  if (CallStatus === 'completed' && onboardingCallSids.has(CallSid)) {
    onboardingCallSids.delete(CallSid);
    console.log(`[Call Status] Onboarding call completed: ${CallSid}`);
  }

  if (Duration) {
    console.log(`[Call Duration] ${Duration} seconds`);
  }

  res.sendStatus(200);
});

/**
 * POST /call/hume-webhook
 *
 * Webhook for Hume EVI events (chat_started, chat_ended).
 * Processes transcripts for theme extraction after substantive calls.
 * Handles onboarding completion.
 */
app.post('/call/hume-webhook', async (req, res) => {
  const event = req.body as HumeWebhookEvent;

  console.log(`[Hume Webhook] Event: ${event.type}, Session: ${event.session_id}`);

  if (event.type === 'chat_ended') {
    const duration = event.duration_seconds || 0;
    const transcriptText = event.transcript ? extractTranscriptText(event) : '';
    console.log(`[Hume Webhook] Call ended, duration: ${duration}s`);

    // Check if this was an onboarding call
    const isOnboardingCall = pendingOnboardingCallSid !== null;
    const userState = getUserState();

    if (isOnboardingCall && !userState.onboarding_complete) {
      // Handle onboarding call completion
      pendingOnboardingCallSid = null; // Clear the pending state
      onboardingInProgress = false; // Release the lock

      const wasRipcord = detectRipcord(transcriptText, duration);

      if (wasRipcord) {
        // User ripcorded during onboarding - don't mark complete
        console.log(`[Onboarding] User ripcorded during onboarding, will retry later`);
        // Note: We don't call recordRipcord() because warmth is already 0
        // The user can try onboarding again later
      } else if (duration >= MIN_ONBOARDING_DURATION_SECONDS) {
        // Successful onboarding call
        const state = completeOnboarding();
        console.log(`[Onboarding] Completed! Warmth level now: ${state.warmth_level.toFixed(1)}`);
      } else {
        // Too short but not a ripcord - likely technical issue
        console.log(`[Onboarding] Call too short (${duration}s), not marking complete`);
      }
    } else {
      // Regular call - existing logic
      const wasRipcord = detectRipcord(transcriptText, duration);

      if (wasRipcord) {
        // User ended call quickly or explicitly dismissed
        const state = recordRipcord();
        console.log(`[State] Ripcord recorded. Count: ${state.ripcord_count}, Warmth: ${state.warmth_level.toFixed(1)}`);
      } else if (duration >= MIN_SUCCESSFUL_CALL_SECONDS) {
        // Successful call - update warmth
        let state = recordSuccessfulCall();
        console.log(`[State] Successful call. Warmth: ${state.warmth_level.toFixed(1)}`);

        // Bonus warmth for thanks
        if (detectThanks(transcriptText)) {
          state = recordUserThanks();
          console.log(`[State] Thanks bonus applied. Warmth: ${state.warmth_level.toFixed(1)}`);
        }

        // Extract theme from substantive calls (>3 minutes)
        if (duration >= MIN_CALL_DURATION_FOR_THEME && transcriptText.length > 100) {
          console.log('[Hume Webhook] Extracting theme from transcript...');

          try {
            const extracted = await extractTheme(transcriptText);

            if (extracted) {
              // Check if this matches an existing theme
              const existing = findThemeByKeyword(extracted.theme);

              if (existing) {
                // Touch existing theme to extend its life
                touchTheme(existing.id);
                console.log(`[Memory] Touched existing theme: ${existing.theme}`);
              } else {
                // Save as new theme
                const saved = saveTheme(extracted.theme, extracted.context, 'call');
                console.log(`[Memory] Saved new theme: ${saved.theme}`);
              }
            } else {
              console.log('[Hume Webhook] No theme extracted (confidence too low or no clear topic)');
            }
          } catch (error) {
            console.error('[Hume Webhook] Theme extraction failed:', error);
          }
        }
      } else if (duration < MIN_TECH_FAILURE_SECONDS) {
        // Very short call - likely technical failure
        console.log(`[State] Tech failure assumed (${duration}s), no state change`);
      } else {
        // Short call (30-60s) but no explicit ripcord - ambiguous, no state change
        console.log(`[State] Ambiguous short call (${duration}s), no state change`);
      }
    }
  }

  res.sendStatus(200);
});

/**
 * GET /memory
 *
 * Returns current memory contents (for debugging/transparency)
 */
app.get('/memory', (req, res) => {
  const summary = getMemorySummary();
  const userState = getUserState();
  res.json({
    ...summary,
    userState: {
      warmthLevel: userState.warmth_level,
      onboardingComplete: userState.onboarding_complete,
      ripcordCount: userState.ripcord_count,
      callsSinceRipcord: userState.calls_since_ripcord,
      lastEngagement: new Date(userState.last_engagement).toISOString(),
    }
  });
});

/**
 * GET /health
 *
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  const memorySummary = getMemorySummary();
  const userState = getUserState();
  res.json({
    status: 'ok',
    service: 'ambient-empathic-agent-calling',
    twilioConfigured: !!process.env.TWILIO_ACCOUNT_SID,
    humeConfigured: !!process.env.HUME_API_KEY,
    memory: {
      themes: memorySummary.themes.length,
      preferences: memorySummary.preferences.length
    },
    warmth: userState.warmth_level,
    onboarded: userState.onboarding_complete
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Shutdown] Closing database...');
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Shutdown] Closing database...');
  closeDb();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`\n[Call Service] Ambient Empathic Agent - Call Service`);
  console.log(`[Call Service] Listening on http://localhost:${PORT}`);
  console.log(`[Call Service] Memory layer active`);
  console.log(`\nEndpoints:`);
  console.log(`  POST /call/trigger      - Trigger outbound call (with memory)`);
  console.log(`  POST /call/onboarding   - Trigger onboarding call (new users)`);
  console.log(`  POST /call/status       - Call status webhook (Twilio)`);
  console.log(`  POST /call/hume-webhook - Hume events webhook`);
  console.log(`  GET  /memory            - View current memory`);
  console.log(`  GET  /health            - Health check`);
  console.log(`\nTo trigger onboarding call (new users):`);
  console.log(`  curl -X POST http://localhost:${PORT}/call/onboarding`);
  console.log(`\nTo trigger a regular call:`);
  console.log(`  curl -X POST http://localhost:${PORT}/call/trigger \\`);
  console.log(`       -H "Content-Type: application/json" \\`);
  console.log(`       -d '{"reason": "stress_check_in"}'`);
  console.log(`\nTo view memory:`);
  console.log(`  curl http://localhost:${PORT}/memory`);
  console.log('');
});
