// netlify/functions/transcribe-background.mjs
// Background worker (the "-background" suffix gives it a 15-minute budget;
// Netlify acks invocations with 202 immediately and auto-retries failed
// runs after 1 min, then 2 min).
//
// Uses the modern (v2) function API on purpose: v2 functions receive the
// full Netlify Blobs context automatically — including the uncachedEdgeURL
// required for strong-consistency reads, which the legacy Lambda-style
// context (connectLambda) never provides. This function is the
// authoritative dedup gate, so it must have strong reads; the sync
// webhook's best-effort check runs at eventual consistency.
//
// Runs the full voice-note pipeline via src/core/voice-note-pipeline.js —
// download, transcription, moderation, optional summary, Twilio sends. On
// any handled failure the pipeline itself messages the user with the
// existing localized error text, so nothing fails silently.
//
// Idempotency marker (Netlify Blobs, key = MessageSid):
//   done / failed  -> terminal, exit without reprocessing
//   anything else  -> process (covers first delivery, crash retries, and
//                     'retrying' set after a failed Twilio send)
import { getStore } from '@netlify/blobs';
import { TwilioClientWrapper } from '../../src/services/twilio-service.js';
import { processVoiceNote } from '../../src/core/voice-note-pipeline.js';
import { logDetails } from '../../src/utils/logging-utils.js';

const ALERT_MARKER_KEY = '_admin-alert-last';
const ALERT_MUTE_MS = 60 * 60 * 1000; // one alert per hour

/**
 * Send a WhatsApp alert to the operator (ADMIN_PHONE), debounced via the
 * Blobs store. Best-effort on every level: if Blobs is down we alert
 * anyway (visibility over silence), and a failed send is only logged.
 */
async function sendAdminAlert(store, twilioClient, result, params) {
  try {
    if (store) {
      const last = await store.get(ALERT_MARKER_KEY, { type: 'json' });
      if (last && Date.now() - new Date(last.at).getTime() < ALERT_MUTE_MS) {
        logDetails('Admin alert suppressed (within mute window)');
        return;
      }
      await store.setJSON(ALERT_MARKER_KEY, { at: new Date().toISOString() });
    }
    await twilioClient.sendMessage({
      body: `⚠️ Josephine: transcription failed for ${params.From || 'unknown'} (${params.MessageSid}): ${result.error || 'unknown error'}. Alerts muted for 1h.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.ADMIN_PHONE
    });
    logDetails('Admin alert sent');
  } catch (alertError) {
    logDetails('Failed to send admin alert:', alertError.message);
  }
}

export default async (req) => {
  // Only our own sync function may invoke this endpoint.
  const token = req.headers.get('x-internal-token') || '';
  if (!process.env.INTERNAL_API_SECRET || token !== process.env.INTERNAL_API_SECRET) {
    logDetails('Rejected background invocation with missing/invalid internal token');
    return new Response('Unauthorized', { status: 401 });
  }

  let params;
  try {
    params = await req.json();
  } catch (e) {
    return new Response('Invalid JSON payload', { status: 400 });
  }

  const sid = params.MessageSid;
  if (!sid || !params.MediaUrl0) {
    return new Response('Missing MessageSid or MediaUrl0', { status: 400 });
  }

  // Idempotency check — fail-open (a Blobs hiccup must not drop the job).
  let store = null;
  try {
    store = getStore({ name: 'processed-messages', consistency: 'strong' });
    const marker = await store.get(sid, { type: 'json' });
    if (marker && (marker.status === 'done' || marker.status === 'failed')) {
      logDetails(`Skipping ${sid}: already ${marker.status}`);
      return new Response('Already processed', { status: 200 });
    }
    await store.setJSON(sid, { status: 'processing', at: new Date().toISOString() });
  } catch (blobError) {
    logDetails('Blobs unavailable in background, proceeding without markers:', blobError.message);
    store = null;
  }

  // Build a req-like context for the shared pipeline and services.
  const context = { body: params, isTestMode: false, testResults: null };
  context.twilioClient = new TwilioClientWrapper(context);

  const result = await processVoiceNote(context);

  // Alert the operator on processing errors (expired API key, OpenAI
  // outage, etc. — the user gets a localized error message, but without
  // this the operator would never know). Debounced to one alert per hour
  // via the Blobs store so an outage doesn't spam.
  if (result.flow === 'processing_error' && process.env.ADMIN_PHONE) {
    await sendAdminAlert(store, context.twilioClient, result, params);
  }

  // Terminal states: 'done' (user got transcription or violation notice),
  // 'failed'/'file_too_big' (user got the localized message — do not
  // re-spend). 'retrying': the pipeline succeeded but the Twilio send
  // failed, so the user got NOTHING — throw to trigger Netlify's
  // automatic retry.
  const status = result.flow === 'twilio_error'
    ? 'retrying'
    : (result.flow === 'processing_error' || result.flow === 'file_too_big' ? 'failed' : 'done');

  if (store) {
    try {
      await store.setJSON(sid, { status, flow: result.flow, at: new Date().toISOString() });
    } catch (e) { /* best effort */ }
  }

  if (result.flow === 'twilio_error') {
    logDetails(`Twilio send failed for ${sid}, throwing to trigger platform retry`, { error: result.error });
    throw new Error(`Twilio send failed for ${sid}: ${result.error}`);
  }

  logDetails(`Background processing finished for ${sid}: ${result.flow}`);
  return new Response(result.flow, { status: 200 });
};
