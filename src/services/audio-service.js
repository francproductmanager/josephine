// services/audio-service.js
const { getBuffer } = require('../utils/http-client');
const { logDetails } = require('../utils/logging-utils');

async function downloadAudio(mediaUrl, headers = {}, req = null) {
  // Return mock data for test mode
  if (req && req.isTestMode) {
    logDetails(`[TEST MODE] Simulating audio download from: ${mediaUrl}`);

    // Return mock audio data
    const mockAudioSize = 30000; // ~30KB
    return {
      data: Buffer.from(`This is mock audio data for testing purposes. File: ${mediaUrl}`),
      contentLength: mockAudioSize,
      mockData: true
    };
  }

  // Normal production code
  try {
    logDetails(`Starting audio download from: ${mediaUrl}`);
    const { data, contentLength } = await getBuffer(mediaUrl, {
      timeoutMs: 15000,
      headers: {
        'User-Agent': 'WhatsAppTranscriptionService/1.0',
        ...headers
      }
    });

    logDetails('Audio download complete', {
      size: data.length,
      responseSizeBytes: contentLength
    });

    return { data, contentLength };
  } catch (error) {
    logDetails('Error downloading audio:', error);
    throw error;
  }
}

// OpenAI sniffs the container format from the upload's file *extension*,
// so it must match what Twilio actually delivered. WhatsApp voice notes are
// audio/ogg (opus), but users can also forward audio files (mp3, m4a/aac),
// and those came through mislabelled as .ogg -> HTTP 400 "invalid file".
const EXTENSION_BY_CONTENT_TYPE = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/oga': 'oga',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mpga': 'mpga',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/mpeg': 'mpeg',
  'video/webm': 'webm'
};

function audioFilename(contentType) {
  const base = String(contentType || '').split(';')[0].trim().toLowerCase();
  return `audio.${EXTENSION_BY_CONTENT_TYPE[base] || 'ogg'}`;
}

function prepareFormData(audioData, contentType, model = 'gpt-4o-mini-transcribe') {
  // Native FormData/Blob (Node 18+); fetch sets the multipart boundary.
  const formData = new FormData();

  formData.append('file', new Blob([Buffer.from(audioData)], { type: contentType }), audioFilename(contentType));
  formData.append('model', model);
  formData.append('response_format', 'json');

  return formData;
}

module.exports = {
  downloadAudio,
  prepareFormData,
  audioFilename
};
