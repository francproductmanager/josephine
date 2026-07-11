// test/express-flows.test.js
// End-to-end HTTP tests of the Express app in test mode. Test mode mocks
// every external API (Twilio, OpenAI transcription, moderation), so these
// run offline with no keys. This is the same app served by Heroku/local
// `npm start` and by the Netlify sync function's delegate path.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');

let server;
let base;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function post(body) {
  const res = await fetch(`${base}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}

const VOICE = {
  testMode: 'true',
  From: 'whatsapp:+39123',
  To: 'whatsapp:+1',
  NumMedia: '1',
  MediaContentType0: 'audio/ogg',
  MediaUrl0: 'http://example.invalid/a.ogg',
  MessageSid: 'SM-test'
};

test('health check', async () => {
  const res = await fetch(`${base}/`);
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /Josephine/);
});

test('welcome message in Italian from phone prefix', async () => {
  const { status, json } = await post({ testMode: 'true', From: 'whatsapp:+3912345', NumMedia: '0', MessageSid: 'SM-w' });
  assert.strictEqual(status, 200);
  assert.strictEqual(json.flow, 'welcome_message');
  assert.strictEqual(json.language.code, 'it');
  assert.match(json.message, /Ciao! Sono Josephine/);
});

test('welcome message served from file for pre-translated languages', async () => {
  // These come from languages.json — no OPENAI_API_KEY exists in the test
  // environment, so a correct non-English reply proves no API call happened.
  const cases = [
    ['whatsapp:+380671234567', /Привіт/],
    ['whatsapp:+905321234567', /Merhaba/],
    ['whatsapp:+351911234567', /Olá! Sou a Josephine/]
  ];
  for (const [from, pattern] of cases) {
    const { status, json } = await post({ testMode: 'true', From: from, NumMedia: '0', MessageSid: 'SM-w2' });
    assert.strictEqual(status, 200);
    assert.match(json.message, pattern, `${from} welcome`);
  }
});

test('language detection endpoint', async () => {
  const { status, json } = await post({ testLanguage: 'true', From: '+39123456789' });
  assert.strictEqual(status, 200);
  assert.strictEqual(json.detected_language.code, 'it');
});

test('voice note: successful transcription with summary:null contract', async () => {
  const { status, json } = await post(VOICE);
  assert.strictEqual(status, 200);
  assert.strictEqual(json.flow, 'successful_transcription');
  assert.ok('summary' in json, 'summary key must be present');
  assert.strictEqual(json.summary, null, 'short note summary must be null');
  assert.ok(json.transcription.length > 0);
  assert.strictEqual(json.testResults.messages.length, 1);
});

test('voice note: long transcription generates summary', async () => {
  const { status, json } = await post({ ...VOICE, longTranscription: 'true', MessageSid: 'SM-long' });
  assert.strictEqual(status, 200);
  assert.strictEqual(json.flow, 'successful_transcription');
  assert.ok(json.summary && json.summary.length > 0, 'summary must be generated');
});

test('non-audio media prompts for a voice note', async () => {
  const { status, json } = await post({ ...VOICE, MediaContentType0: 'image/jpeg', MessageSid: 'SM-img' });
  assert.strictEqual(status, 200);
  assert.strictEqual(json.flow, 'non_audio_media');
});

test('missing media fields returns 400', async () => {
  const { status } = await post({ ...VOICE, MediaUrl0: undefined, MediaContentType0: undefined, MessageSid: 'SM-bad' });
  assert.strictEqual(status, 400);
});

test('request without MessageSid returns API info', async () => {
  const { status, json } = await post({});
  assert.strictEqual(status, 200);
  assert.ok(json.expected_params, 'should describe expected params');
});
