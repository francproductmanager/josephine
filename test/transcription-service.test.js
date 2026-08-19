// test/transcription-service.test.js
// Offline tests for the OpenAI transcription request path: content-type
// aware upload filenames, the whisper-1 fallback on HTTP 400 (25-minute
// cap on gpt-4o-mini-transcribe / unsupported containers), and provider
// error messages being surfaced on error.message for logs and alerts.
// fetch is stubbed; nothing leaves the process.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const { prepareFormData, audioFilename } = require('../src/services/audio-service');
const { transcribeAudio, FALLBACK_MODEL } = require('../src/services/transcription-service');
const { postJson, extractErrorDetail } = require('../src/utils/http-client');

const realFetch = globalThis.fetch;
let calls;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Queue of responses; each fetch call records its parsed FormData.
function stubFetch(responses) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const form = init && init.body instanceof FormData ? init.body : null;
    calls.push({
      url,
      model: form ? form.get('model') : null,
      fileName: form && form.get('file') ? form.get('file').name : null,
      fileSize: form && form.get('file') ? form.get('file').size : null
    });
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra fetch call');
    return next;
  };
}

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

test('audioFilename maps Twilio media content types to the extension OpenAI expects', () => {
  assert.strictEqual(audioFilename('audio/ogg'), 'audio.ogg');
  assert.strictEqual(audioFilename('audio/ogg; codecs=opus'), 'audio.ogg');
  assert.strictEqual(audioFilename('audio/mpeg'), 'audio.mp3');
  assert.strictEqual(audioFilename('audio/mp4'), 'audio.m4a');
  assert.strictEqual(audioFilename('audio/aac'), 'audio.m4a');
  assert.strictEqual(audioFilename('AUDIO/WAV'), 'audio.wav');
  assert.strictEqual(audioFilename('video/mp4'), 'audio.mp4');
  // Unknown / missing -> ogg (the WhatsApp voice-note default)
  assert.strictEqual(audioFilename(undefined), 'audio.ogg');
  assert.strictEqual(audioFilename('application/octet-stream'), 'audio.ogg');
});

test('prepareFormData names the upload from the content type and sets the default model', () => {
  const form = prepareFormData(Buffer.from('abc'), 'audio/mpeg');
  assert.strictEqual(form.get('file').name, 'audio.mp3');
  assert.strictEqual(form.get('model'), 'gpt-4o-mini-transcribe');
  assert.strictEqual(form.get('response_format'), 'json');
});

test('HTTP errors carry the provider error message (OpenAI and Twilio shapes)', async () => {
  stubFetch([
    jsonResponse(400, { error: { message: 'audio duration 1712 seconds is longer than 1500 seconds', type: 'invalid_request_error' } })
  ]);
  await assert.rejects(
    () => postJson('https://api.openai.com/v1/audio/transcriptions', new FormData(), {}),
    (err) => {
      assert.strictEqual(err.response.status, 400);
      assert.match(err.message, /^HTTP 400 from .*: audio duration 1712 seconds is longer than 1500 seconds$/);
      return true;
    }
  );

  assert.strictEqual(extractErrorDetail({ message: 'Unable to create record', code: 21211 }), 'Unable to create record');
  assert.strictEqual(extractErrorDetail({ error: 'plain string' }), 'plain string');
  assert.strictEqual(extractErrorDetail(null), null);
  assert.strictEqual(extractErrorDetail({ error: {} }), null);
  assert.strictEqual(extractErrorDetail('x'.repeat(5)), null);
});

test('a 400 from gpt-4o-mini-transcribe falls back to whisper-1 with the same file', async () => {
  stubFetch([
    jsonResponse(400, { error: { message: 'audio duration 1712 seconds is longer than 1500 seconds' } }),
    jsonResponse(200, { text: '  long note transcribed  ' })
  ]);
  const form = prepareFormData(Buffer.from('fake-ogg-bytes'), 'audio/ogg');
  const text = await transcribeAudio(form, 'sk-test');

  assert.strictEqual(text, 'long note transcribed');
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].model, 'gpt-4o-mini-transcribe');
  assert.strictEqual(calls[1].model, FALLBACK_MODEL);
  assert.strictEqual(calls[1].fileName, 'audio.ogg');
  assert.strictEqual(calls[1].fileSize, calls[0].fileSize);
  // The caller's FormData is not mutated.
  assert.strictEqual(form.get('model'), 'gpt-4o-mini-transcribe');
});

test('a 400 from whisper-1 itself is not retried (no loop)', async () => {
  stubFetch([
    jsonResponse(400, { error: { message: 'Invalid file format.' } }),
    jsonResponse(400, { error: { message: 'Invalid file format.' } })
  ]);
  const form = prepareFormData(Buffer.from('not-audio'), 'audio/amr');
  await assert.rejects(() => transcribeAudio(form, 'sk-test'), /HTTP 400 from .*: Invalid file format\./);
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[1].model, FALLBACK_MODEL);
});

test('non-400 errors are not retried with the fallback model', async () => {
  stubFetch([jsonResponse(429, { error: { message: 'Rate limit reached' } })]);
  const form = prepareFormData(Buffer.from('x'), 'audio/ogg');
  await assert.rejects(() => transcribeAudio(form, 'sk-test'), (err) => {
    assert.strictEqual(err.response.status, 429); // pipeline classifies on this
    assert.match(err.message, /Rate limit reached/);
    return true;
  });
  assert.strictEqual(calls.length, 1);
});

test('success on the first attempt makes exactly one request', async () => {
  stubFetch([jsonResponse(200, { text: 'hello' })]);
  const form = prepareFormData(Buffer.from('x'), 'audio/ogg');
  assert.strictEqual(await transcribeAudio(form, 'sk-test'), 'hello');
  assert.strictEqual(calls.length, 1);
});
