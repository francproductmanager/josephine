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

function prepareFormData(audioData, contentType, model = 'gpt-4o-mini-transcribe') {
  // Native FormData/Blob (Node 18+); fetch sets the multipart boundary.
  const formData = new FormData();

  formData.append('file', new Blob([Buffer.from(audioData)], { type: contentType }), 'audio.ogg');
  formData.append('model', model);
  formData.append('response_format', 'json');

  return formData;
}

module.exports = {
  downloadAudio,
  prepareFormData
};
