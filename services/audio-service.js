// services/audio-service.js
const axios = require('axios');
const FormData = require('form-data');
const { logDetails } = require('../utils/logging-utils');

async function downloadAudio(mediaUrl, headers = {}) {
  try {
    logDetails(`Starting audio download from: ${mediaUrl}`);
    const response = await axios({
      method: 'get',
      url: mediaUrl,
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'WhatsAppTranscriptionService/1.0',
        ...headers
      }
    });
    
    logDetails('Audio download complete', {
      size: response.data.length,
      responseSizeBytes: response.headers['content-length']
    });
    
    return {
      data: response.data,
      contentLength: response.headers['content-length'] || 0
    };
  } catch (error) {
    logDetails('Error downloading audio:', error);
    throw error;
  }
}

function prepareFormData(audioData, contentType, model = 'whisper-1') {
  const formData = new FormData();
  
  formData.append('file', Buffer.from(audioData), {
    filename: 'audio.ogg',
    contentType: contentType
  });
  formData.append('model', model);
  formData.append('response_format', 'json');
  
  return formData;
}

module.exports = {
  downloadAudio,
  prepareFormData
};
