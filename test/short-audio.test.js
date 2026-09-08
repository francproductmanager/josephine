// test/short-audio.test.js
// The sub-second-clip guard runs only outside test mode (the mocked
// download is a tiny text buffer by design), so these tests drive
// processVoiceNote directly with a stubbed fetch serving a few hundred
// bytes of "audio". No Twilio credentials and no API keys: the pipeline
// must bail out before any OpenAI/Gemini call.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const { processVoiceNote } = require('../src/core/voice-note-pipeline');
const { TwilioClientWrapper } = require('../src/services/twilio-service');
const translations = require('../src/helpers/languages.json');

const realFetch = globalThis.fetch;
let fetchCalls;

function stubMediaFetch(bytes) {
  fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    return new Response(Buffer.alloc(bytes, 1), {
      status: 200,
      headers: { 'Content-Type': 'audio/ogg', 'Content-Length': String(bytes) }
    });
  };
}

function buildContext(from) {
  const context = {
    body: {
      MessageSid: 'MM-short-test',
      From: from,
      To: 'whatsapp:+447723199141',
      NumMedia: '1',
      MediaUrl0: 'https://media.test/short.ogg',
      MediaContentType0: 'audio/ogg'
    },
    isTestMode: false,
    testResults: null
  };
  context.twilioClient = new TwilioClientWrapper(context);
  return context;
}

beforeEach(() => {
  // No credentials/keys: twilioClient.isAvailable() is false and any
  // accidental API call would be visible in fetchCalls.
  delete process.env.ACCOUNT_SID;
  delete process.env.AUTH_TOKEN;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
});
afterEach(() => { globalThis.fetch = realFetch; });

test('every language has a tooShort message', () => {
  for (const [lang, block] of Object.entries(translations)) {
    assert.ok(block.tooShort && block.tooShort.trim(), `${lang} missing tooShort`);
  }
});

test('a sub-1KB note short-circuits to audio_too_short with the localized message', async () => {
  stubMediaFetch(557); // the accidental-tap size observed in production
  const result = await processVoiceNote(buildContext('whatsapp:+393201471346'));

  assert.strictEqual(result.flow, 'audio_too_short');
  assert.strictEqual(result.statusCode, 400);
  assert.strictEqual(result.message, translations.it.tooShort, 'Italian sender gets the Italian message');
  // Only the media download hit the network: no OpenAI, no Gemini.
  assert.strictEqual(fetchCalls.length, 1);
  assert.match(fetchCalls[0], /media\.test/);
});

test('a normal-size note passes the guard (and then fails later on the missing API key, not the guard)', async () => {
  stubMediaFetch(25000);
  const result = await processVoiceNote(buildContext('whatsapp:+447753980466'));

  assert.notStrictEqual(result.flow, 'audio_too_short');
  assert.ok(fetchCalls.length > 1, 'pipeline proceeded past the download');
});

test('an over-floor clip that transcribes to empty text gets the localized noSpeech reply', async () => {
  // 2.5KB of "audio" passes the size guard; stub OpenAI to return empty
  // text (silence/breath clip, as seen in production on 2026-09-08).
  fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push(String(url));
    if (String(url).includes('media.test')) {
      return new Response(Buffer.alloc(2562, 1), {
        status: 200,
        headers: { 'Content-Type': 'audio/ogg', 'Content-Length': '2562' }
      });
    }
    if (String(url).includes('api.openai.com')) {
      return new Response(JSON.stringify({ text: '  ' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error('unexpected call to ' + url);
  };
  process.env.OPENAI_API_KEY = 'sk-test';
  try {
    const result = await processVoiceNote(buildContext('whatsapp:+393201471346'));
    assert.strictEqual(result.flow, 'no_speech');
    assert.strictEqual(result.statusCode, 400);
    assert.strictEqual(result.message, translations.it.noSpeech, 'Italian sender gets the Italian message');
  } finally {
    delete process.env.OPENAI_API_KEY;
  }
});

test('every language has a noSpeech message', () => {
  for (const [lang, block] of Object.entries(translations)) {
    assert.ok(block.noSpeech && block.noSpeech.trim(), `${lang} missing noSpeech`);
  }
});
