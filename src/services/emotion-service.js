// src/services/emotion-service.js
// Vocal-tone emotion detection via Google Gemini. Gemini is used (not
// OpenAI) because it accepts WhatsApp's ogg/opus audio natively as inline
// base64 — OpenAI's audio-input chat models take only wav/mp3, and
// transcoding would need ffmpeg/WASM, which the zero-dependency rule
// forbids. One REST call over native fetch, same as every other service.
//
// The model chooses the emotion itself (open vocabulary, not a fixed
// label set) and answers directly in the user's language as
// '<one emoji> <one-to-three words>', e.g. '😤 frustrazione'. The reply
// is spliced into the localized 'emotionIntro' sentence by the pipeline.
// 'NEUTRAL' is the model's flat/indistinct verdict and suppresses the
// mood line entirely.
//
// Fail-open by design: any error, timeout, missing key, or a reply that
// fails the sanity checks returns null and the transcription goes out
// without a mood line.
const { postJson } = require('../utils/http-client');
const { logDetails } = require('../utils/logging-utils');

function buildPrompt(languageName) {
  return 'Listen to this audio (how it sounds, not what the words mean). ' +
    'In 1-3 words, describe the speaker\'s emotional tone, vocal delivery, and energy level. ' +
    `Reply with exactly one fitting emoji, a space, then those 1-3 words in ${languageName || 'English'} (lowercase). ` +
    'Example format: "😤 tense, rushed". ' +
    'If the tone is flat, unclear, or unremarkable, reply with exactly NEUTRAL instead.';
}

// Gemini inline requests cap at 20MB total; base64 inflates by ~4/3.
const MAX_EMOTION_AUDIO_BYTES = 14 * 1024 * 1024;

/**
 * Detect the speaker's vocal emotion. Returns a short model-authored
 * phrase in the user's language ('😤 frustrazione') or null
 * (neutral/unavailable/uncertain/error). Never throws.
 */
async function detectEmotion(audioData, mimeType, langObj, req = null) {
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Simulating emotion detection');
    return '😊 happy';
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !audioData || audioData.length > MAX_EMOTION_AUDIO_BYTES) {
    return null;
  }

  // Bare MIME type (Twilio sends e.g. 'audio/ogg; codecs=opus').
  const mime = String(mimeType || '').split(';')[0].trim().toLowerCase() || 'audio/ogg';

  try {
    const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    const data = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        contents: [{
          parts: [
            { inline_data: { mime_type: mime, data: Buffer.from(audioData).toString('base64') } },
            { text: buildPrompt(langObj && langObj.name) }
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
    const phrase = sanitizeEmotion(raw);
    logDetails('Emotion detection result', { raw, phrase });
    return phrase;
  } catch (error) {
    logDetails('Emotion detection failed (continuing without):', error.message);
    return null;
  }
}

// The phrase lands verbatim in a user-facing message, so free-form model
// output gets a tight gate: one line, short, no URLs/digits/markup, and
// not the NEUTRAL sentinel. Anything suspicious -> null (no mood line).
function sanitizeEmotion(raw) {
  if (typeof raw !== 'string') return null;
  const phrase = raw.trim().replace(/["'.]/g, '');
  if (!phrase || /neutral/i.test(phrase)) return null;
  if (phrase.includes('\n') || phrase.length > 40) return null;
  if (/[0-9<>{}[\]\\\/:;=_*#@&%$~^|`]/.test(phrase)) return null;
  if (phrase.split(/\s+/).length > 5) return null;
  return phrase;
}

module.exports = {
  detectEmotion,
  sanitizeEmotion
};
