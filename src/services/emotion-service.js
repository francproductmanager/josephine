// src/services/emotion-service.js
// Vocal-tone emotion detection via Google Gemini. Gemini is used (not
// OpenAI) because it accepts WhatsApp's ogg/opus audio natively as inline
// base64 — OpenAI's audio-input chat models take only wav/mp3, and
// transcoding would need ffmpeg/WASM, which the zero-dependency rule
// forbids. One REST call over native fetch, same as every other service.
//
// Fail-open by design: any error, timeout, missing key, or unexpected
// reply returns null and the transcription goes out without a mood line.
const { postJson } = require('../utils/http-client');
const { logDetails } = require('../utils/logging-utils');

// Closed label set. The model is instructed to answer with exactly one of
// these; anything else is discarded (LLMs drift — never trust free text).
// 'Neutral' is valid model output but has no emoji: an ordinary calm note
// should not carry a mood line at all.
const EMOTION_EMOJI = {
  Happy: '😊',
  Excited: '🤩',
  Calm: '😌',
  Sad: '😢',
  Frustrated: '😤',
  Angry: '😠',
  Anxious: '😰',
  Surprised: '😮',
  Tired: '😴'
};
const EMOTION_LABELS = ['Neutral', ...Object.keys(EMOTION_EMOJI)];

const PROMPT =
  'Listen to the speaker\'s tone of voice (not the words). ' +
  `Classify the dominant emotion as exactly one of: ${EMOTION_LABELS.join(', ')}. ` +
  'If in doubt, answer Neutral. Reply with only that single word.';

// Gemini inline requests cap at 20MB total; base64 inflates by ~4/3.
const MAX_EMOTION_AUDIO_BYTES = 14 * 1024 * 1024;

/**
 * Detect the speaker's vocal emotion. Returns a label from EMOTION_LABELS
 * or null (unavailable/uncertain/error). Never throws.
 */
async function detectEmotion(audioData, mimeType, req = null) {
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Simulating emotion detection');
    return 'Happy';
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !audioData || audioData.length > MAX_EMOTION_AUDIO_BYTES) {
    return null;
  }

  // Bare MIME type (Twilio sends e.g. 'audio/ogg; codecs=opus').
  const mime = String(mimeType || '').split(';')[0].trim().toLowerCase() || 'audio/ogg';

  try {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const data = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        contents: [{
          parts: [
            { inline_data: { mime_type: mime, data: Buffer.from(audioData).toString('base64') } },
            { text: PROMPT }
          ]
        }]
      },
      {
        headers: { 'x-goog-api-key': apiKey },
        timeoutMs: 25000
      }
    );

    const raw = data
      && data.candidates && data.candidates[0]
      && data.candidates[0].content && data.candidates[0].content.parts
      && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    const label = normalizeEmotion(raw);
    logDetails('Emotion detection result', { raw, label });
    return label;
  } catch (error) {
    logDetails('Emotion detection failed (continuing without):', error.message);
    return null;
  }
}

function normalizeEmotion(raw) {
  if (typeof raw !== 'string') return null;
  const word = raw.trim().replace(/[.!]/g, '');
  return EMOTION_LABELS.find((l) => l.toLowerCase() === word.toLowerCase()) || null;
}

// '😤 Frustrated' for a mood worth showing; null for Neutral/unknown.
// Emoji + English word keeps the line language-neutral enough to skip
// adding 29 translations to languages.json (key-parity is test-enforced).
function formatEmotionLine(label) {
  const emoji = EMOTION_EMOJI[label];
  return emoji ? `${emoji} ${label}` : null;
}

module.exports = {
  detectEmotion,
  formatEmotionLine,
  normalizeEmotion,
  EMOTION_EMOJI,
  EMOTION_LABELS
};
