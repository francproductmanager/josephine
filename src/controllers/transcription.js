// src/controllers/transcription.js
const { getUserLanguage, getLocalizedMessage } = require('../helpers/localization');
const { processVoiceNote } = require('../core/voice-note-pipeline');
const { formatTestResponse, formatErrorResponse, formatSuccessResponse } = require('../utils/response-formatter');
const { logDetails } = require('../utils/logging-utils');

/**
 * Handle non-audio media
 */
async function handleNonAudioMedia(req, res) {
  const event = req.body || {};
  const userPhone = event.From || 'unknown';
  const toPhone = event.To || process.env.TWILIO_PHONE_NUMBER;
  const userLang = getUserLanguage(userPhone);
  const twilioClient = req.twilioClient;

  const sendAudioMessage = await getLocalizedMessage('sendAudio', userLang);

  if (twilioClient.isAvailable()) {
    await twilioClient.sendMessage({
      body: sendAudioMessage,
      from: toPhone,
      to: userPhone
    });

    // For test mode, return test results instead of XML
    if (req.isTestMode) {
      return formatTestResponse(res, {
        flow: 'non_audio_media',
        message: sendAudioMessage,
        testResults: twilioClient.getTestResults()
      });
    } else {
      // Generate XML response for Twilio
      const xmlResponse = twilioClient.generateXMLResponse('<Response></Response>');
      res.set('Content-Type', 'text/xml');
      return res.send(xmlResponse);
    }
  } else {
    return formatErrorResponse(res, 400, sendAudioMessage, {
      flow: 'non_audio_media'
    });
  }
}

/**
 * Handle transcription of voice note.
 * The pipeline itself lives in src/core/voice-note-pipeline.js (shared
 * with the Netlify background function); this wrapper only maps the
 * pipeline result onto the same HTTP responses as before.
 */
async function handleVoiceNote(req, res) {
  const twilioClient = req.twilioClient;

  // An Express req is a valid pipeline context: it carries
  // body, isTestMode, testResults and twilioClient.
  const result = await processVoiceNote(req);

  const sendXML = () => {
    const xmlResponse = twilioClient.generateXMLResponse('<Response></Response>');
    res.set('Content-Type', 'text/xml');
    return res.send(xmlResponse);
  };

  switch (result.flow) {
    case 'content_violation':
      if (result.twilioAvailable) {
        if (req.isTestMode) {
          return formatTestResponse(res, {
            flow: 'content_violation',
            message: result.message,
            moderation: result.moderation,
            testResults: twilioClient.getTestResults()
          });
        }
        return sendXML();
      }
      return formatErrorResponse(res, 403, result.message, {
        flow: 'content_violation',
        moderation: result.moderation
      });

    case 'successful_transcription':
      if (result.twilioAvailable) {
        if (req.isTestMode) {
          return formatTestResponse(res, {
            flow: 'successful_transcription',
            summary: result.summary,
            transcription: result.transcription,
            message: result.message,
            testResults: twilioClient.getTestResults()
          });
        }
        return sendXML();
      }
      return formatSuccessResponse(res, {
        flow: 'successful_transcription',
        summary: result.summary,
        transcription: result.transcription,
        message: result.message
      });

    case 'twilio_error':
      return formatErrorResponse(res, 500, 'Failed to send transcription', {
        flow: 'twilio_error',
        error: result.error
      });

    case 'processing_error':
    default:
      if (result.twilioAvailable) {
        if (req.isTestMode) {
          return formatTestResponse(res, {
            flow: 'processing_error',
            message: result.message,
            error: result.error,
            testResults: twilioClient.getTestResults()
          });
        }
        return sendXML();
      }
      return formatErrorResponse(res, 500, result.message, {
        flow: 'processing_error',
        error: result.error
      });
  }
}

module.exports = {
  handleNonAudioMedia,
  handleVoiceNote
};
