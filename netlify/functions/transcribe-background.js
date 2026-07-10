// netlify/functions/transcribe-background.js
// Background worker (the "-background" suffix gives it a 15-minute budget;
// Netlify acks invocations with 202 immediately and auto-retries failed
// runs after 1 min, then 2 min).
//
// Runs the full voice-note pipeline via src/core/voice-note-pipeline.js —
// download, Whisper, moderation, optional summary, Twilio sends. On any
// handled failure the pipeline itself messages the user with the existing
// localized error text, so nothing fails silently.
//
// Idempotency marker (Netlify Blobs, key = MessageSid):
//   done / failed  -> terminal, exit without reprocessing
//   anything else  -> process (covers first delivery, crash retries, and
//                     'retrying' set after a failed Twilio send)
const { TwilioClientWrapper } = require('../../src/services/twilio-service');
const { processVoiceNote } = require('../../src/core/voice-note-pipeline');
const { logDetails } = require('../../src/utils/logging-utils');
const { getProcessedStore } = require('./lib/shared');

exports.handler = async (event) => {
  // Only our own sync function may invoke this endpoint.
  const token = (event.headers && (event.headers['x-internal-token'] || event.headers['X-Internal-Token'])) || '';
  if (!process.env.INTERNAL_API_SECRET || token !== process.env.INTERNAL_API_SECRET) {
    logDetails('Rejected background invocation with missing/invalid internal token');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let params;
  try {
    params = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON payload' };
  }

  const sid = params.MessageSid;
  if (!sid || !params.MediaUrl0) {
    return { statusCode: 400, body: 'Missing MessageSid or MediaUrl0' };
  }

  // Idempotency check — fail-open (a Blobs hiccup must not drop the job).
  let store = null;
  try {
    store = getProcessedStore();
    const marker = await store.get(sid, { type: 'json' });
    if (marker && (marker.status === 'done' || marker.status === 'failed')) {
      logDetails(`Skipping ${sid}: already ${marker.status}`);
      return { statusCode: 200, body: 'Already processed' };
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

  // Terminal states: 'done' (user got transcription or violation notice),
  // 'failed' (user got the localized error message — do not re-spend).
  // 'retrying': the pipeline succeeded but the Twilio send failed, so the
  // user got NOTHING — throw to trigger Netlify's automatic retry.
  const status = result.flow === 'twilio_error'
    ? 'retrying'
    : (result.flow === 'processing_error' ? 'failed' : 'done');

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
  return { statusCode: 200, body: result.flow };
};
