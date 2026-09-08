// src/core/voice-note-pipeline.js
// The voice-note transcription pipeline, decoupled from Express.
// Callable from the Express controller (Heroku/local) and from the
// Netlify background function. `context` is a req-like object:
//   { body, isTestMode, testResults, twilioClient }
// All user-facing messages (including localized errors) are sent from
// here via the provided twilioClient; the returned result object only
// describes what happened so callers can shape their HTTP response.
const { getUserLanguage, getLocalizedMessage, exceedsWordLimit } = require('../helpers/localization');
const { countWords, estimateNoteShareUsd, formatCostUsd, MONTHLY_DISPLAY } = require('./cost-estimate');
const { generateSummary } = require('../helpers/transcription');
const { downloadAudio, prepareFormData } = require('../services/audio-service');
const { transcribeAudio } = require('../services/transcription-service');
const { checkContentModeration } = require('../services/moderation-service');
const { detectEmotion, confidenceHedgeKey } = require('../services/emotion-service');
const { splitLongMessage, sendMessages } = require('../services/messaging-service');
const { logDetails } = require('../utils/logging-utils');

/**
 * Process a voice note end-to-end: download, transcribe, moderate,
 * summarize (if long), and send the result to the user.
 *
 * Returns a result object:
 *   { flow, twilioAvailable, message, transcription?, summary?,
 *     moderation?, error?, statusCode? }
 * where flow is one of:
 *   'successful_transcription' | 'content_violation' | 'processing_error' |
 *   'twilio_error' | 'file_too_big' | 'audio_too_short' | 'no_speech'
 */
async function processVoiceNote(context) {
  const event = context.body || {};
  const userPhone = event.From || 'unknown';
  const toPhone = event.To || process.env.TWILIO_PHONE_NUMBER;
  const userLang = getUserLanguage(userPhone);
  const twilioClient = context.twilioClient;
  const mediaContentType = event.MediaContentType0;
  const mediaUrl = event.MediaUrl0;

  logDetails('Processing voice note...');

  try {
    // Prepare authentication headers for audio download
    const authHeaders = {};
    if (process.env.ACCOUNT_SID && process.env.AUTH_TOKEN) {
      const authHeader = 'Basic ' + Buffer.from(`${process.env.ACCOUNT_SID}:${process.env.AUTH_TOKEN}`).toString('base64');
      authHeaders['Authorization'] = authHeader;
    }

    // Download audio file
    const { data: audioData } = await downloadAudio(mediaUrl, authHeaders, context);

    // Guard against files too large to transcribe (OpenAI caps uploads at
    // 25MB; leave headroom). WhatsApp media tops out at 16MB so this is a
    // belt-and-braces check, mostly for non-WhatsApp callers.
    const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
    if (audioData && audioData.length > MAX_AUDIO_BYTES) {
      logDetails('Audio file too large', { size: audioData.length, limit: MAX_AUDIO_BYTES });
      const fileTooBigMessage = await getLocalizedMessage('fileTooBig', userLang);
      if (twilioClient.isAvailable()) {
        await twilioClient.sendMessage({
          body: fileTooBigMessage,
          from: toPhone,
          to: userPhone
        });
        return { flow: 'file_too_big', twilioAvailable: true, message: fileTooBigMessage };
      }
      return { flow: 'file_too_big', twilioAvailable: false, statusCode: 413, message: fileTooBigMessage };
    }

    // Guard against accidental-tap notes: a sub-second opus clip is a few
    // hundred bytes, transcribes to empty text, and (observed 2026-09-07)
    // tricks the tone model into inventing a mood from ~0.3s of audio.
    // Real notes are >=~2KB, so 1KB is a safe floor. Skipped in test mode:
    // the mocked download is a tiny text buffer by design.
    const MIN_AUDIO_BYTES = 1024;
    if (!context.isTestMode && audioData && audioData.length < MIN_AUDIO_BYTES) {
      logDetails('Audio file too short to transcribe', { size: audioData.length, floor: MIN_AUDIO_BYTES });
      const tooShortMessage = await getLocalizedMessage('tooShort', userLang);
      if (twilioClient.isAvailable()) {
        await twilioClient.sendMessage({
          body: tooShortMessage,
          from: toPhone,
          to: userPhone
        });
        return { flow: 'audio_too_short', twilioAvailable: true, message: tooShortMessage };
      }
      return { flow: 'audio_too_short', twilioAvailable: false, statusCode: 400, message: tooShortMessage };
    }

    // Vocal-tone emotion needs only the audio, so it starts here and runs
    // through the whole transcribe/moderate/summarize stretch. detectEmotion
    // never throws (fail-open: null = no mood line). The model answers in
    // the user's language directly, so no label translation is needed.
    const emotionPromise = detectEmotion(audioData, mediaContentType, userLang, context);

    // Prepare form data for Whisper API
    const formData = prepareFormData(audioData, mediaContentType);

    // Transcribe the audio
    const transcription = await transcribeAudio(formData, process.env.OPENAI_API_KEY, context);

    // Silence/breath clips transcribe to empty text (a 2.5KB clip did in
    // production, 2026-09-08). Sending the reply scaffold around an empty
    // transcription helps nobody: tell the user nothing was heard instead.
    // (The already-started emotion promise is left to resolve; it never
    // throws and its result is simply unused.)
    if (!transcription || !transcription.trim()) {
      logDetails('Empty transcription (no speech detected)');
      const noSpeechMessage = await getLocalizedMessage('noSpeech', userLang);
      if (twilioClient.isAvailable()) {
        await twilioClient.sendMessage({
          body: noSpeechMessage,
          from: toPhone,
          to: userPhone
        });
        return { flow: 'no_speech', twilioAvailable: true, message: noSpeechMessage };
      }
      return { flow: 'no_speech', twilioAvailable: false, statusCode: 400, message: noSpeechMessage };
    }

    // Moderation and summary generation both depend only on the
    // transcript, so run them concurrently (saves the moderation time
    // on long notes). The summary is simply discarded if moderation
    // flags the content — rare enough that the wasted call is a fair
    // trade for the latency win on every clean long note.
    const summaryPromise = (async () => {
      // Special handling for test mode with longTranscription=true
      if (context.isTestMode && event.longTranscription === 'true') {
        logDetails('Forcing summary generation for test with longTranscription=true');
        return "This is a test summary of the transcription. The main points discussed include testing functionality, mock data generation, and verification of the summary feature.";
      }
      if (exceedsWordLimit(transcription, 150)) {
        logDetails('Generating summary for long transcription');
        const generated = await generateSummary(transcription, userLang);
        logDetails('Summary generated', { summary: generated });
        return generated;
      }
      return null;
    })();

    // Check for prohibited content
    const [moderationResult, summary] = await Promise.all([
      checkContentModeration(transcription, process.env.OPENAI_API_KEY, context),
      summaryPromise
    ]);

    // The tone verdict gets however long the rest of the pipeline took
    // (it has been running in parallel since the download) plus a short
    // grace period, then loses its slot. This spends waiting time only
    // when it is cheap: long notes, where Gemini is slowest, naturally
    // grant the longest budget, and the reply is never delayed more than
    // the grace beyond ready. (A fixed 10s cap dropped a verdict on
    // 2026-09-08 that this design would likely have saved; the fetch
    // itself still has a 20s inner cap so nothing dangles forever.)
    const EMOTION_GRACE_MS = 4000;
    const GRACE_EXPIRED = Symbol('emotion-grace-expired');
    let graceTimer;
    const raced = await Promise.race([
      emotionPromise,
      new Promise((resolve) => { graceTimer = setTimeout(() => resolve(GRACE_EXPIRED), EMOTION_GRACE_MS); })
    ]);
    clearTimeout(graceTimer);
    if (raced === GRACE_EXPIRED) {
      logDetails('Emotion verdict not ready within grace period, sending without');
    }
    const emotion = raced === GRACE_EXPIRED ? null : raced;
    if (moderationResult.flagged) {
      logDetails('Content moderation flagged this transcription', moderationResult);

      // Get a localized message about content violation
      const contentViolationMessage = await getLocalizedMessage('contentViolation', userLang);

      if (twilioClient.isAvailable()) {
        await twilioClient.sendMessage({
          body: contentViolationMessage,
          from: toPhone,
          to: userPhone
        });

        return {
          flow: 'content_violation',
          twilioAvailable: true,
          message: contentViolationMessage,
          moderation: {
            flagged: true,
            categories: moderationResult.categories
          }
        };
      }

      return {
        flow: 'content_violation',
        twilioAvailable: false,
        statusCode: 403,
        message: contentViolationMessage,
        moderation: {
          flagged: true,
          categories: moderationResult.categories
        }
      };
    }

    // Prepare the final message: tone block first (always, before summary
    // and transcription), then summary (long notes), then transcription.
    // The localized 'emotionIntro' template gets the model-authored
    // '<emoji> <phrase>' (already in the user's language) spliced into
    // its {emotion} placeholder. A hedge line follows ONLY when the
    // model's self-reported confidence is middling (40-79); confident
    // readings (80+) stand alone, e.g.:
    //   "Based on the tone and emotions of the voice message, this
    //    person seems 😤 frustrated and tired, speaking quickly.
    //    I'm moderately confident in this tone reading."
    // Neutral, sub-40 confidence, or unavailable means no tone block.
    let finalMessage = '';
    if (emotion) {
      const emotionIntro = await getLocalizedMessage('emotionIntro', userLang);
      finalMessage += `${emotionIntro.trim().replace('{emotion}', emotion.description)}\n`;
      const hedgeKey = confidenceHedgeKey(emotion.confidence);
      if (hedgeKey) {
        const hedgeLine = await getLocalizedMessage(hedgeKey, userLang);
        finalMessage += `${hedgeLine.trim()}\n`;
      }
      finalMessage += '\n';
    }
    if (summary) {
      const summaryLabel = await getLocalizedMessage('longMessage', userLang);
      finalMessage += `${summaryLabel.trim()} ${summary}\n\n`;
    }

    const transcriptionLabel = await getLocalizedMessage('transcription', userLang);
    // Make sure we don't add an extra emoji here - just use what's in the label
    finalMessage += `${transcriptionLabel.trim()}\n${transcription}`;

    // Append the support footer: monthly running cost + this note's
    // word-count-scaled share (see src/core/cost-estimate.js).
    const cost = formatCostUsd(estimateNoteShareUsd(countWords(transcription)));
    const supportFooter = await getLocalizedMessage('supportFooter', userLang);
    finalMessage += `\n\n${supportFooter.replace('{cost}', cost).replace('{monthly}', MONTHLY_DISPLAY)}`;

    // Split the message if needed
    const messageParts = splitLongMessage(finalMessage);

    if (twilioClient.isAvailable()) {
      try {
        // Send the messages
        await sendMessages(twilioClient, messageParts, userPhone, toPhone);

        return {
          flow: 'successful_transcription',
          twilioAvailable: true,
          summary: summary,
          emotion: emotion ? emotion.description : null,
          emotionConfidence: emotion ? emotion.confidence : null,
          transcription: transcription,
          message: finalMessage
        };
      } catch (twilioError) {
        logDetails('Error sending message via Twilio:', twilioError);
        return {
          flow: 'twilio_error',
          twilioAvailable: true,
          statusCode: 500,
          message: 'Failed to send transcription',
          error: twilioError.message
        };
      }
    }

    logDetails('No Twilio client - returning JSON response');
    return {
      flow: 'successful_transcription',
      twilioAvailable: false,
      summary: summary,
      emotion: emotion ? emotion.description : null,
      emotionConfidence: emotion ? emotion.confidence : null,
      transcription: transcription,
      message: finalMessage
    };
  } catch (processingError) {
    logDetails('ERROR PROCESSING AUDIO:', processingError);

    // Determine specific error type
    let errorMessage;

    if (processingError.response && processingError.response.status === 429) {
      errorMessage = await getLocalizedMessage('rateLimited', userLang);
    } else if (processingError.code === 'ECONNABORTED' || processingError.message.includes('timeout')) {
      errorMessage = await getLocalizedMessage('processingTimeout', userLang);
    } else {
      errorMessage = await getLocalizedMessage('apiError', userLang);
    }

    if (twilioClient.isAvailable()) {
      await twilioClient.sendMessage({
        body: errorMessage,
        from: toPhone,
        to: userPhone
      });

      return {
        flow: 'processing_error',
        twilioAvailable: true,
        message: errorMessage,
        error: processingError.message
      };
    }

    return {
      flow: 'processing_error',
      twilioAvailable: false,
      statusCode: 500,
      message: errorMessage,
      error: processingError.message
    };
  }
}

module.exports = {
  processVoiceNote
};
