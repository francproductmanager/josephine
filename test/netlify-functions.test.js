// test/netlify-functions.test.js
// Unit tests for the two Netlify functions: the sync webhook (Lambda-style
// handler) and the background worker (v2 API). Covers Twilio signature
// validation, the dispatch handshake, and the background auth + pipeline
// error classification. Runs offline: Blobs fail-opens by design in local
// environments, and no real API keys are set.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const querystring = require('querystring');

// Environment the functions expect — set before anything is invoked.
process.env.INTERNAL_API_SECRET = 'test-secret-123';
process.env.TWILIO_WEBHOOK_URL = 'https://josephine.test/transcribe';
process.env.AUTH_TOKEN = 'fake-auth-token';
// Deliberately NOT set: ACCOUNT_SID (so no real Twilio client is ever
// created), OPENAI_API_KEY, ADMIN_PHONE.

const syncFn = require('../netlify/functions/transcribe.js');

let bgHandler;
async function invokeBackground(headers, body) {
  if (!bgHandler) {
    bgHandler = (await import('../netlify/functions/transcribe-background.mjs')).default;
  }
  const req = new Request('https://local.test/.netlify/functions/transcribe-background', {
    method: 'POST',
    headers,
    body
  });
  const res = await bgHandler(req);
  return { status: res.status, body: await res.text() };
}

function formEvent(params, headers = {}) {
  return {
    httpMethod: 'POST',
    path: '/transcribe',
    rawUrl: process.env.TWILIO_WEBHOOK_URL,
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    queryStringParameters: {},
    body: querystring.stringify(params),
    isBase64Encoded: false
  };
}

// Twilio's documented signing scheme: URL + sorted key/value concatenation,
// HMAC-SHA1 with the auth token, base64.
function twilioSignature(params) {
  const data = process.env.TWILIO_WEBHOOK_URL +
    Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha1', process.env.AUTH_TOKEN).update(Buffer.from(data, 'utf-8')).digest('base64');
}

const PROD_VOICE = {
  From: 'whatsapp:+393331234567',
  To: 'whatsapp:+1415',
  NumMedia: '1',
  MediaContentType0: 'audio/ogg',
  MediaUrl0: 'https://api.twilio.com/media/ME123',
  MessageSid: 'SM-prod-1'
};

// Mock background server so dispatch tests never leave the machine.
let mock;
let mockStatus = 202;
const dispatches = [];

before(async () => {
  mock = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      dispatches.push({ url: req.url, token: req.headers['x-internal-token'], body: JSON.parse(data) });
      res.writeHead(mockStatus);
      res.end();
    });
  });
  await new Promise((resolve) => mock.listen(0, resolve));
  process.env.URL = `http://127.0.0.1:${mock.address().port}`;
});

after(() => mock.close());

// ---------- sync webhook ----------

test('test-mode flows delegate to Express', async () => {
  const r = await syncFn.handler(formEvent({ testMode: 'true', From: '+3912345', NumMedia: '0', MessageSid: 'SM-w' }), {});
  assert.strictEqual(r.statusCode, 200);
  const json = JSON.parse(r.body);
  assert.strictEqual(json.flow, 'welcome_message');
  assert.strictEqual(json.language.code, 'it');
});

test('test mode via x-test-mode header', async () => {
  const r = await syncFn.handler(formEvent({ From: '+3912345', NumMedia: '0', MessageSid: 'SM-h' }, { 'x-test-mode': 'true' }), {});
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(JSON.parse(r.body).flow, 'welcome_message');
});

test('production request without signature is rejected 403', async () => {
  const r = await syncFn.handler(formEvent(PROD_VOICE), {});
  assert.strictEqual(r.statusCode, 403);
});

test('production request with wrong signature is rejected 403', async () => {
  const r = await syncFn.handler(formEvent(PROD_VOICE, { 'x-twilio-signature': 'bogus' }), {});
  assert.strictEqual(r.statusCode, 403);
});

test('valid signature dispatches to background and acks with empty TwiML', async () => {
  dispatches.length = 0;
  const r = await syncFn.handler(formEvent(PROD_VOICE, { 'x-twilio-signature': twilioSignature(PROD_VOICE) }), {});
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.headers['Content-Type'], 'text/xml');
  assert.strictEqual(r.body, '<Response></Response>');
  assert.strictEqual(dispatches.length, 1);
  assert.strictEqual(dispatches[0].url, '/.netlify/functions/transcribe-background');
  assert.strictEqual(dispatches[0].token, 'test-secret-123');
  assert.strictEqual(dispatches[0].body.MessageSid, PROD_VOICE.MessageSid);
  assert.strictEqual(dispatches[0].body.MediaUrl0, PROD_VOICE.MediaUrl0);
});

test('failed dispatch returns 500 so Twilio retries', async () => {
  mockStatus = 500;
  const params = { ...PROD_VOICE, MessageSid: 'SM-prod-2' };
  const r = await syncFn.handler(formEvent(params, { 'x-twilio-signature': twilioSignature(params) }), {});
  assert.strictEqual(r.statusCode, 500);
  mockStatus = 202;
});

// ---------- background worker (v2) ----------

test('background rejects missing internal token', async () => {
  const r = await invokeBackground({}, JSON.stringify(PROD_VOICE));
  assert.strictEqual(r.status, 401);
});

test('background rejects wrong internal token', async () => {
  const r = await invokeBackground({ 'x-internal-token': 'wrong' }, JSON.stringify(PROD_VOICE));
  assert.strictEqual(r.status, 401);
});

test('background rejects malformed payloads', async () => {
  let r = await invokeBackground({ 'x-internal-token': 'test-secret-123' }, 'not json');
  assert.strictEqual(r.status, 400);
  r = await invokeBackground({ 'x-internal-token': 'test-secret-123' }, JSON.stringify({ foo: 1 }));
  assert.strictEqual(r.status, 400);
});

test('background runs the pipeline and classifies download failure', async () => {
  // Unreachable media host, no Twilio client, no OpenAI key: the pipeline
  // must fail on download and classify it as processing_error (which the
  // worker records as terminal — no retry, user already got the message).
  const badMedia = { ...PROD_VOICE, MessageSid: 'SM-bg-1', MediaUrl0: 'http://nonexistent.invalid/a.ogg' };
  const r = await invokeBackground({ 'x-internal-token': 'test-secret-123' }, JSON.stringify(badMedia));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body, 'processing_error');
});

test('admin alert is always a WhatsApp message, sent from the sender the user messaged', async () => {
  // Regression: from 2026-08-15 to 08-17 every operator alert failed with
  // Twilio 21660 because env held a bare (SMS) number for a stale sandbox
  // sender. The alert must use whatsapp: on both ends and prefer the live
  // sender from the webhook over TWILIO_PHONE_NUMBER.
  const { asWhatsApp, alertSender } = await import('../netlify/functions/transcribe-background.mjs');

  assert.strictEqual(asWhatsApp('+447753980466'), 'whatsapp:+447753980466');
  assert.strictEqual(asWhatsApp('whatsapp:+447753980466'), 'whatsapp:+447753980466');
  assert.strictEqual(asWhatsApp(' +44 7753 980466 '), 'whatsapp:+44 7753 980466');
  assert.strictEqual(asWhatsApp(undefined), '');

  const prevEnv = process.env.TWILIO_PHONE_NUMBER;
  process.env.TWILIO_PHONE_NUMBER = '+14155238886'; // stale sandbox number
  try {
    assert.strictEqual(alertSender({ To: 'whatsapp:+447450325919' }), 'whatsapp:+447450325919');
    assert.strictEqual(alertSender({}), 'whatsapp:+14155238886');
  } finally {
    if (prevEnv === undefined) delete process.env.TWILIO_PHONE_NUMBER; else process.env.TWILIO_PHONE_NUMBER = prevEnv;
  }
});
