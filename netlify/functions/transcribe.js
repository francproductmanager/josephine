// netlify/functions/transcribe.js
// Synchronous webhook endpoint (Twilio posts here via the /transcribe rewrite).
//
// Responsibilities (must finish well under the 10s sync limit):
//   1. Validate the X-Twilio-Signature on production requests.
//   2. Production voice notes: dedup on MessageSid (Netlify Blobs), then
//      dispatch to the background function and ack Twilio with empty TwiML.
//   3. Everything else (welcome, non-audio, API info, language test, and
//      ALL test-mode flows) is delegated to the unchanged Express app —
//      those paths are fast (fully mocked, or at most one Twilio REST call).
const querystring = require('querystring');
const crypto = require('crypto');
const serverless = require('serverless-http');
const app = require('../../src/app');
const { logDetails } = require('../../src/utils/logging-utils');
const { getProcessedStore, EMPTY_TWIML } = require('./lib/shared');

/**
 * Twilio's documented webhook signature scheme: append the sorted POST
 * params (key + value) to the exact public URL, HMAC-SHA1 with the auth
 * token, base64. Implemented locally (cross-validated byte-for-byte
 * against twilio SDK v3's validateRequest in the test suite) — the SDK
 * itself was dropped because its dynamic requires break Netlify's v2
 * function bundling.
 */
function isValidTwilioSignature(authToken, signature, url, params) {
  const data = url + Object.keys(params).sort().map((key) => {
    const value = params[key];
    // Repeated keys arrive as arrays; Twilio signs deduped sorted values.
    return Array.isArray(value)
      ? [...new Set(value)].sort().map((v) => key + v).join('')
      : key + value;
  }).join('');
  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const expressHandler = serverless(app);

function getHeader(event, name) {
  const headers = event.headers || {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || '';
}

function parseParams(event) {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  const contentType = getHeader(event, 'content-type');
  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }
  return { ...querystring.parse(raw) };
}

function isTestMode(event, params) {
  return (
    getHeader(event, 'x-test-mode') === 'true' ||
    (event.queryStringParameters && event.queryStringParameters.testMode === 'true') ||
    params.testMode === 'true'
  );
}

function twimlResponse() {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml' },
    body: EMPTY_TWIML
  };
}

exports.handler = async (event, context) => {
  const params = parseParams(event);
  const testMode = isTestMode(event, params);

  // 1. Twilio signature validation — required for any production request
  //    carrying a MessageSid (those trigger real sends / real spend).
  //    Test mode is exempt: it is mocked end to end and spends nothing.
  if (!testMode && params.MessageSid && process.env.TWILIO_SIGNATURE_VALIDATION !== 'off') {
    const signature = getHeader(event, 'x-twilio-signature');
    const url = process.env.TWILIO_WEBHOOK_URL || event.rawUrl;
    const valid = isValidTwilioSignature(process.env.AUTH_TOKEN || '', signature, url, params);
    if (!valid) {
      // Log enough detail to distinguish a URL mismatch from a token
      // mismatch without exposing secrets (signature prefix only).
      logDetails('Rejected request with invalid Twilio signature', {
        urlUsed: url,
        urlSource: process.env.TWILIO_WEBHOOK_URL ? 'TWILIO_WEBHOOK_URL env' : 'event.rawUrl fallback',
        rawUrl: event.rawUrl,
        signatureHeaderPresent: !!signature,
        signaturePrefix: signature ? signature.slice(0, 6) : null,
        authTokenPresent: !!process.env.AUTH_TOKEN,
        authTokenLength: (process.env.AUTH_TOKEN || '').length,
        paramCount: Object.keys(params).length,
        messageSid: params.MessageSid
      });
      return { statusCode: 403, body: 'Invalid Twilio signature' };
    }
  }

  // 2. Production voice note → dedup + background dispatch + instant ack
  const isProdVoiceNote =
    !testMode &&
    params.MessageSid &&
    parseInt(params.NumMedia || 0) > 0 &&
    params.MediaContentType0 &&
    params.MediaContentType0.startsWith('audio/') &&
    params.MediaUrl0;

  if (isProdVoiceNote) {
    // Dedup is fail-open: a Blobs hiccup must never block a transcription.
    let store = null;
    try {
      store = getProcessedStore(event);
      const existing = await store.get(params.MessageSid, { type: 'json' });
      if (existing) {
        logDetails(`Duplicate webhook for ${params.MessageSid} (status=${existing.status}) — acking without re-dispatch`);
        return twimlResponse();
      }
      await store.setJSON(params.MessageSid, { status: 'dispatched', at: new Date().toISOString() });
    } catch (blobError) {
      logDetails('Blobs unavailable, proceeding without dedup:', blobError.message);
      store = null;
    }

    // Dispatch to the background function (acks 202 as soon as queued).
    try {
      const response = await fetch(`${process.env.URL}/.netlify/functions/transcribe-background`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': process.env.INTERNAL_API_SECRET || ''
        },
        body: JSON.stringify(params)
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Background dispatch returned ${response.status}`);
      }
    } catch (dispatchError) {
      // Roll back the dedup marker so Twilio's retry can re-dispatch.
      logDetails('Background dispatch failed:', dispatchError.message);
      if (store) {
        try { await store.delete(params.MessageSid); } catch (e) { /* best effort */ }
      }
      return { statusCode: 500, body: 'Failed to queue transcription' };
    }

    logDetails(`Dispatched ${params.MessageSid} to background processing`);
    return twimlResponse();
  }

  // 3. Everything else → the unchanged Express app.
  //    Normalize the path so both /transcribe (rewrite) and the direct
  //    function URL reach the Express /transcribe route.
  return expressHandler({ ...event, path: '/transcribe' }, context);
};
