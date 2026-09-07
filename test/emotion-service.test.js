// test/emotion-service.test.js
// Offline tests for the Gemini vocal-emotion service: the open-vocabulary
// sanitizer gate, the NEUTRAL suppression rule, language-targeted
// prompting, MIME normalization, fail-open on every error class, and the
// no-key/oversize guards. fetch is stubbed.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const { detectEmotion, sanitizeEmotion } = require('../src/services/emotion-service');
const translations = require('../src/helpers/languages.json');

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

test('sanitizeEmotion passes short emoji phrases and rejects drift, markup, and NEUTRAL', () => {
  assert.strictEqual(sanitizeEmotion('😤 frustrazione'), '😤 frustrazione');
  assert.strictEqual(sanitizeEmotion('😤 tense, rushed'), '😤 tense, rushed');
  assert.strictEqual(sanitizeEmotion(' "😊 quiet joy." '), '😊 quiet joy');
  assert.strictEqual(sanitizeEmotion('😰 un po’ ansioso'), '😰 un po’ ansioso');
  assert.strictEqual(sanitizeEmotion('NEUTRAL'), null);
  assert.strictEqual(sanitizeEmotion('neutral'), null);
  assert.strictEqual(sanitizeEmotion(''), null);
  assert.strictEqual(sanitizeEmotion(undefined), null);
  assert.strictEqual(sanitizeEmotion('😊 happy\nand also other text'), null);
  assert.strictEqual(sanitizeEmotion('The speaker seems to be feeling rather melancholic today'), null);
  assert.strictEqual(sanitizeEmotion('😊 visit https://evil.example'), null);
  assert.strictEqual(sanitizeEmotion('call me at 555 1234'), null);
  assert.strictEqual(sanitizeEmotion('<b>happy</b>'), null);
});

test('every language has an emotionIntro template with the {emotion} placeholder', () => {
  for (const [lang, block] of Object.entries(translations)) {
    assert.match(block.emotionIntro, /\{emotion\}/, `${lang} emotionIntro must contain {emotion}`);
  }
});

test('detectEmotion sends base64 audio, bare MIME type, and the user language in the prompt', async () => {
  stubFetch(geminiResponse('😊 felicità'));
  const phrase = await detectEmotion(Buffer.from('opus-bytes'), 'audio/ogg; codecs=opus', { code: 'it', name: 'Italian' });
  assert.strictEqual(phrase, '😊 felicità');
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com/);
  const parts = calls[0].body.contents[0].parts;
  assert.strictEqual(parts[0].inline_data.mime_type, 'audio/ogg');
  assert.strictEqual(Buffer.from(parts[0].inline_data.data, 'base64').toString(), 'opus-bytes');
  assert.match(parts[1].text, /Italian/, 'prompt asks for the reply in the user language');
});

test('detectEmotion returns null on NEUTRAL, drift, API errors, and network failure', async () => {
  stubFetch(geminiResponse('NEUTRAL'));
  assert.strictEqual(await detectEmotion(Buffer.from('a'), 'audio/ogg', { name: 'English' }), null);

  stubFetch(geminiResponse('It sounds quite cheerful overall, with hints of excitement!'));
  assert.strictEqual(await detectEmotion(Buffer.from('a'), 'audio/ogg', { name: 'English' }), null);

  stubFetch(new Response('{"error":{"message":"quota"}}', { status: 429 }));
  assert.strictEqual(await detectEmotion(Buffer.from('a'), 'audio/ogg', { name: 'English' }), null);

  stubFetch(new Error('network down'));
  assert.strictEqual(await detectEmotion(Buffer.from('a'), 'audio/ogg', { name: 'English' }), null);
});

test('detectEmotion skips without a key and on oversize audio (no fetch made)', async () => {
  stubFetch(geminiResponse('😊 happy'));
  delete process.env.GEMINI_API_KEY;
  assert.strictEqual(await detectEmotion(Buffer.from('a'), 'audio/ogg', { name: 'English' }), null);
  assert.strictEqual(calls.length, 0);

  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const huge = Buffer.alloc(15 * 1024 * 1024);
  assert.strictEqual(await detectEmotion(huge, 'audio/ogg', { name: 'English' }), null);
  assert.strictEqual(calls.length, 0);
});

test('test mode mocks without any network call', async () => {
  stubFetch(geminiResponse('😢 sad'));
  const phrase = await detectEmotion(Buffer.from('a'), 'audio/ogg', { name: 'Italian' }, { isTestMode: true });
  assert.strictEqual(phrase, '😊 happy');
  assert.strictEqual(calls.length, 0);
});
