// src/services/emotion-service.js
// Vocal-tone analysis via Google's Interactions API (the current Gemini
// surface; generateContent is legacy). Gemini is used (not OpenAI)
// because it accepts WhatsApp's ogg/opus audio natively as inline
// base64: OpenAI's audio-input chat models take only wav/mp3, and
// transcoding would need ffmpeg/WASM, which the zero-dependency rule
// forbids. One REST call over native fetch, same as every other service.
//
// The model authors the description itself (open vocabulary): one short
// phrase in the user's language covering emotional tone, vocal delivery
// and energy, starting with one emoji, e.g. '😤 frustrato e un po'
// stanco, parla in fretta'. Output is schema-enforced JSON
// { neutral, description, confidence } so free-text drift is impossible;
// a light sanitizer still gates the description string since it lands
// verbatim in the reply.
//
// Fail-open by design: any error, timeout, missing key, gated output,
// neutral verdict, or confidence below MIN_CONFIDENCE returns null and
// the transcription goes out without the tone lines.
const { postJson } = require('../utils/http-client');
const { logDetails } = require('../utils/logging-utils');

// Below this the model is guessing; a mood line with a weak number
// attached helps nobody, so the whole block is suppressed.
const MIN_CONFIDENCE = 40;

// Confidence hedge bands (ours, not Google's: the number is the model's
// self-assessment, for which no documented calibration exists; observed
// values cluster at 85). 40-59 gets the "not fully sure" hedge, 60-79
// "moderately confident", 80+ no hedge line at all: a hedge that appears
// on every message is wallpaper, silence means confident.
const CONFIDENCE_HEDGE_LOW = 60;
const CONFIDENCE_HEDGE_NONE = 80;

// languages.json key for the hedge line to show under the tone sentence,
// or null when the reading is confident enough to stand alone.
function confidenceHedgeKey(confidence) {
  if (!Number.isInteger(confidence) || confidence >= CONFIDENCE_HEDGE_NONE) return null;
  return confidence < CONFIDENCE_HEDGE_LOW ? 'emotionConfidenceLow' : 'emotionConfidenceModerate';
}

// Gemini inline requests cap at 20MB total; base64 inflates by ~4/3.
const MAX_EMOTION_AUDIO_BYTES = 14 * 1024 * 1024;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    neutral: {
      type: 'boolean',
      description: 'true when the tone is flat, unclear, or unremarkable'
    },
    description: {
      type: 'string',
      description: 'One emoji, a space, then a short lowercase phrase (max 15 words) describing emotional tone, vocal delivery and energy. Empty when neutral.'
    },
    confidence: {
      type: 'integer',
      description: 'How confident the tone reading is, 0-100'
    }
  },
  required: ['neutral', 'description', 'confidence']
};

function buildPrompt(languageName) {
  return 'Listen to this audio (how it sounds, not what the words mean). ' +
    'Describe the speaker\'s emotional tone, vocal delivery, and energy level in one short phrase ' +
    `(max 15 words) in ${languageName || 'English'}, lowercase, starting with exactly one fitting emoji and a space. ` +
    'If the tone evolves during the recording, describe the shift in the same phrase. ' +
    'Never use dashes; separate ideas with commas. ' +
    'Example description: "😤 tense and rushed, high energy". ' +
    'If the tone is flat, unclear, or unremarkable, set neutral to true and leave description empty. ' +
    'Set confidence (0-100) to how sure you are of the reading.';
}

/**
 * Detect the speaker's vocal tone. Returns
 * { description: '😤 …', confidence: 82 } or null
 * (neutral/low-confidence/unavailable/error). Never throws.
 */
async function detectEmotion(audioData, mimeType, langObj, req = null) {
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Simulating emotion detection');
    return { description: '😊 happy', confidence: 95 };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !audioData || audioData.length > MAX_EMOTION_AUDIO_BYTES) {
    return null;
  }

  // Bare MIME type (Twilio sends e.g. 'audio/ogg; codecs=opus').
  const mime = String(mimeType || '').split(';')[0].trim().toLowerCase() || 'audio/ogg';

  try {
    const data = await postJson(
      'https://generativelanguage.googleapis.com/v1beta/interactions',
      {
        model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
        input: [
          { type: 'audio', data: Buffer.from(audioData).toString('base64'), mime_type: mime },
          { type: 'text', text: buildPrompt(langObj && langObj.name) }
        ],
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: RESPONSE_SCHEMA
        },
        // One-shot classification; no reason to store server-side state.
        store: false,
        // Generous budget: on thinking models the internal reasoning
        // counts against this, and a starved budget truncated the JSON
        // to prose mid-sentence in production (2026-09-08).
        generation_config: { max_output_tokens: 2048, thinking_level: 'low' }
      },
      {
        headers: { 'x-goog-api-key': apiKey },
        // Inner cap only: the PIPELINE decides how long the reply
        // actually waits (until transcription+summary are done plus a
        // short grace, see voice-note-pipeline.js). This just stops a
        // truly hung connection from living forever. Verdicts normally
        // land in 1-8s; a 10s hard cap dropped a saveable verdict in
        // production (2026-09-08 17:21).
        timeoutMs: 20000
      }
    );

    const result = parseInteraction(data);
    logDetails('Emotion detection result', result);
    return result;
  } catch (error) {
    logDetails('Emotion detection failed (continuing without):', error.message);
    return null;
  }
}

// Pull the structured verdict out of an Interaction resource: the output
// JSON lives as a string in the model_output step's text content. A null
// return always logs WHY plus the raw verdict, so a missing tone line in
// production is diagnosable from the log alone (a bare "result: null"
// cost a debugging session on 2026-09-07).
function parseInteraction(data) {
  const suppressed = (reason, verdict) => {
    logDetails('Emotion suppressed', { reason, verdict: verdict || null });
    return null;
  };

  if (!data || !Array.isArray(data.steps)) return suppressed('no_steps');
  const output = data.steps.filter((s) => s && s.type === 'model_output').pop();
  // The output text can arrive split across several content parts, and
  // (seen in production 2026-09-08: a bare "Here is the") the model can
  // wrap or truncate the JSON despite the schema. Join every text part,
  // then parse the outermost {...} substring rather than the raw string.
  const text = output && Array.isArray(output.content)
    ? output.content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('')
    : '';
  if (!text) return suppressed('no_model_output');

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return suppressed('no_json_in_output', text.slice(0, 200));

  let verdict;
  try {
    verdict = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return suppressed('unparseable_json', text.slice(0, 200));
  }
  if (!verdict) return suppressed('empty_verdict');
  if (verdict.neutral === true) return suppressed('neutral', verdict);

  const description = sanitizeDescription(verdict.description);
  const confidence = Number.isInteger(verdict.confidence)
    ? Math.max(0, Math.min(100, verdict.confidence))
    : null;
  if (!description) return suppressed('gated_description', verdict);
  if (confidence === null) return suppressed('invalid_confidence', verdict);
  if (confidence < MIN_CONFIDENCE) return suppressed('low_confidence', verdict);

  return { description, confidence };
}

// The description lands verbatim in a user-facing message, so it gets a
// tight gate even though the schema already constrains the shape: one
// line, short, no digits/URLs/markup, and never an em/en dash (house
// style) - those become commas.
function sanitizeDescription(raw) {
  if (typeof raw !== 'string') return null;
  let phrase = raw.trim().replace(/^["']+|["'.]+$/g, '').trim();
  phrase = phrase.replace(/\s*[—–]\s*/g, ', ');
  if (!phrase || phrase.includes('\n') || phrase.length > 140) return null;
  if (/[0-9<>{}[\]\\/:;=*#@&%$~^|`_]/.test(phrase)) return null;
  if (phrase.split(/\s+/).length > 20) return null;
  return phrase;
}

module.exports = {
  detectEmotion,
  parseInteraction,
  sanitizeDescription,
  confidenceHedgeKey,
  MIN_CONFIDENCE,
  CONFIDENCE_HEDGE_LOW,
  CONFIDENCE_HEDGE_NONE
};
