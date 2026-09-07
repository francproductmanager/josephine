// test/emotion-service.test.js
// Offline tests for the Gemini vocal-emotion service: label allow-listing,
// the Neutral/unknown suppression rule, MIME normalization, fail-open on
// every error class, and the no-key/oversize guards. fetch is stubbed.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const {
  detectEmotion,
  formatEmotionLine,
  normalizeEmotion,
  EMOTION_LABELS
} = require('../src/services/emotion-service');

const realFetch = globalThis.fetch;
let calls;

function geminiResponse(text) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(response) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (response instanceof Error) throw response;
    return response;
  };
}

beforeEach(() => {
  calls = [];
  process.env.GEMINI_API_KEY = 'test-gemini-key';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_API_KEY;
});

test('normalizeEmotion accepts only the closed label set', () => {
  assert.strictEqual(normalizeEmotion('Happy'), 'Happy');
  assert.strictEqual(normalizeEmotion(' frustrated. '), 'Frustrated');
  assert.strictEqual(normalizeEmotion('NEUTRAL'), 'Neutral');
  assert.strictEqual(normalizeEmotion('Melancholic'), null);
  assert.strictEqual(normalizeEmotion('The speaker sounds Happy'), null);
  assert.strictEqual(normalizeEmotion(undefined), null);
});

test('formatEmotionLine renders emoji + label, and suppresses Neutral/unknown', () => {
  assert.strictEqual(formatEmotionLine('Frustrated'), '😤 Frustrated');
  assert.strictEqual(formatEmotionLine('Happy'), '😊 Happy');
  assert.strictEqual(formatEmotionLine('Neutral'), null);
  assert.strictEqual(formatEmotionLine(null), null);
  for (const label of EMOTION_LABELS) {
    if (label !== 'Neutral') assert.ok(formatEmotionLine(label), `${label} must have an emoji`);
  }
});

test('detectEmotion sends base64 audio with a bare MIME type and returns the label', async () => {
  stubFetch(geminiResponse('Excited'));
  const label = await detectEmotion(Buffer.from('opus-bytes'), 'audio/ogg; codecs=opus');
  assert.strictEqual(label, 'Excited');
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
  const part = calls[0].body.contents[0].parts[0].inline_data;
  assert.strictEqual(part.mime_type, 'audio/ogg');
  assert.strictEqual(Buffer.from(part.data, 'base64').toString(), 'opus-bytes');
});

test('detectEmotion returns null on free-text drift, API errors, and network failure', async () => {
  stubFetch(geminiResponse('It sounds quite cheerful overall!'));
  assert.strictEqual(await detectEmotion(Buffer.from('a'), 'audio/ogg'), null);

  stubFetch(new Response('{"error":{"message":"quota"}}', { status: 429 }));
  assert.strictEqual(await detectEmotion(Buffer.from('a'), 'audio/ogg'), null);

  stubFetch(new Error('network down'));
  assert.strictEqual(await detectEmotion(Buffer.from('a'), 'audio/ogg'), null);
});

test('detectEmotion skips without a key and on oversize audio (no fetch made)', async () => {
  stubFetch(geminiResponse('Happy'));
  delete process.env.GEMINI_API_KEY;
  assert.strictEqual(await detectEmotion(Buffer.from('a'), 'audio/ogg'), null);
  assert.strictEqual(calls.length, 0);

  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const huge = Buffer.alloc(15 * 1024 * 1024);
  assert.strictEqual(await detectEmotion(huge, 'audio/ogg'), null);
  assert.strictEqual(calls.length, 0);
});

test('test mode mocks without any network call', async () => {
  stubFetch(geminiResponse('Sad'));
  const label = await detectEmotion(Buffer.from('a'), 'audio/ogg', { isTestMode: true });
  assert.strictEqual(label, 'Happy');
  assert.strictEqual(calls.length, 0);
});
