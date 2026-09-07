// test/emotion-service.test.js
// Offline tests for the Gemini Interactions API vocal-tone service:
// request shape (inline audio, schema-enforced JSON output), Interaction
// resource parsing, the neutral/low-confidence suppression rules, the
// description gate (house style: em dashes become commas), and fail-open
// on every error class. fetch is stubbed.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const {
  detectEmotion,
  parseInteraction,
  sanitizeDescription,
  MIN_CONFIDENCE
} = require('../src/services/emotion-service');
const translations = require('../src/helpers/languages.json');

const realFetch = globalThis.fetch;
let calls;

function interactionResponse(verdict) {
  return new Response(JSON.stringify({
    id: 'v1_test',
    object: 'interaction',
    status: 'completed',
    steps: [
      { type: 'thinking', content: [] },
      { type: 'model_output', content: [{ type: 'text', text: JSON.stringify(verdict) }] }
    ]
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

test('sanitizeDescription passes short phrases, converts em dashes to commas, rejects drift', () => {
  assert.strictEqual(sanitizeDescription('😤 tense and rushed, high energy'), '😤 tense and rushed, high energy');
  assert.strictEqual(sanitizeDescription('😤 tense — high energy'), '😤 tense, high energy');
  assert.strictEqual(sanitizeDescription(' "😊 un po\' allegro." '), '😊 un po\' allegro');
  assert.strictEqual(sanitizeDescription(''), null);
  assert.strictEqual(sanitizeDescription(undefined), null);
  assert.strictEqual(sanitizeDescription('😊 happy\nplus another line'), null);
  assert.strictEqual(sanitizeDescription('😊 visit https://evil.example'), null);
  assert.strictEqual(sanitizeDescription('call 555 1234'), null);
  assert.strictEqual(sanitizeDescription('x'.repeat(150)), null);
});

test('every language has emotionIntro and emotionConfidence templates with placeholders', () => {
  for (const [lang, block] of Object.entries(translations)) {
    assert.match(block.emotionIntro, /\{emotion\}/, `${lang} emotionIntro must contain {emotion}`);
    assert.match(block.emotionConfidence, /\{pct\}/, `${lang} emotionConfidence must contain {pct}`);
    assert.ok(!/[—]/.test(block.emotionIntro + block.emotionConfidence), `${lang} templates must not contain em dashes`);
  }
});

test('detectEmotion posts to the Interactions API with inline audio, schema, and language', async () => {
  stubFetch(interactionResponse({ neutral: false, description: '😊 allegro e vivace', confidence: 82 }));
  const result = await detectEmotion(Buffer.from('opus-bytes'), 'audio/ogg; codecs=opus', { code: 'it', name: 'Italian' });

  assert.deepStrictEqual(result, { description: '😊 allegro e vivace', confidence: 82 });
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/interactions/);
  const body = calls[0].body;
  assert.strictEqual(body.input[0].type, 'audio');
  assert.strictEqual(body.input[0].mime_type, 'audio/ogg');
  assert.strictEqual(Buffer.from(body.input[0].data, 'base64').toString(), 'opus-bytes');
  assert.match(body.input[1].text, /Italian/, 'prompt asks for the user language');
  assert.match(body.input[1].text, /Never use dashes/, 'prompt bans dashes');
  assert.strictEqual(body.response_format.mime_type, 'application/json');
  assert.deepStrictEqual(body.response_format.schema.required, ['neutral', 'description', 'confidence']);
  assert.strictEqual(body.store, false);
});

test('parseInteraction suppresses neutral, low-confidence, and malformed verdicts', () => {
  const wrap = (verdict) => ({
    steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(verdict) }] }]
  });
  assert.deepStrictEqual(
    parseInteraction(wrap({ neutral: false, description: '😤 tense', confidence: MIN_CONFIDENCE })),
    { description: '😤 tense', confidence: MIN_CONFIDENCE }
  );
  assert.strictEqual(parseInteraction(wrap({ neutral: true, description: '', confidence: 90 })), null);
  assert.strictEqual(parseInteraction(wrap({ neutral: false, description: '😤 tense', confidence: MIN_CONFIDENCE - 1 })), null);
  assert.strictEqual(parseInteraction(wrap({ neutral: false, description: '😤 tense', confidence: 'high' })), null);
  assert.strictEqual(parseInteraction(wrap({ neutral: false, description: '', confidence: 90 })), null);
  // Confidence above 100 is clamped, not rejected.
  assert.deepStrictEqual(
    parseInteraction(wrap({ neutral: false, description: '😊 warm', confidence: 250 })),
    { description: '😊 warm', confidence: 100 }
  );
  assert.strictEqual(parseInteraction({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'not json' }] }] }), null);
  assert.strictEqual(parseInteraction({ steps: [] }), null);
  assert.strictEqual(parseInteraction(null), null);
});

test('detectEmotion returns null on API errors and network failure', async () => {
  stubFetch(new Response('{"error":{"message":"quota"}}', { status: 429 }));
  assert.strictEqual(await detectEmotion(Buffer.from('a'), 'audio/ogg', { name: 'English' }), null);

  stubFetch(new Error('network down'));
  assert.strictEqual(await detectEmotion(Buffer.from('a'), 'audio/ogg', { name: 'English' }), null);
});

test('detectEmotion skips without a key and on oversize audio (no fetch made)', async () => {
  stubFetch(interactionResponse({ neutral: false, description: '😊 warm', confidence: 90 }));
  delete process.env.GEMINI_API_KEY;
  assert.strictEqual(await detectEmotion(Buffer.from('a'), 'audio/ogg', { name: 'English' }), null);
  assert.strictEqual(calls.length, 0);

  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const huge = Buffer.alloc(15 * 1024 * 1024);
  assert.strictEqual(await detectEmotion(huge, 'audio/ogg', { name: 'English' }), null);
  assert.strictEqual(calls.length, 0);
});

test('test mode mocks without any network call', async () => {
  stubFetch(interactionResponse({ neutral: false, description: '😢 sad', confidence: 70 }));
  const result = await detectEmotion(Buffer.from('a'), 'audio/ogg', { name: 'Italian' }, { isTestMode: true });
  assert.deepStrictEqual(result, { description: '😊 happy', confidence: 95 });
  assert.strictEqual(calls.length, 0);
});
