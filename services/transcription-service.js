// services/transcription-service.js
const axios = require('axios');
const { logDetails } = require('../utils/logging-utils');

async function transcribeAudio(formData, apiKey) {
  try {
    logDetails('Sending request to OpenAI Whisper API...');
    
    const headers = formData.getHeaders();
    headers.Authorization = `Bearer ${apiKey}`;
    
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: headers,
        timeout: 30000
      }
    );
    
    logDetails('Received response from Whisper API', {
      status: response.status,
      hasText: !!response.data.text
    });
    
    return response.data.text.trim();
  } catch (error) {
    logDetails('Error transcribing audio:', error);
    throw error;
  }
}

function calculateCosts(audioLengthBytes, messageParts) {
  // Calculate estimated audio length in seconds
  const estimatedSeconds = Math.ceil(audioLengthBytes / 16000);
  
  // OpenAI cost calculation
  const openAICost = estimatedSeconds / 60 * 0.006; // £0.006 per minute for Whisper API
  
  // Twilio cost calculation
  const inboundTwilioCost = 0.005; // Cost for receiving audio message
  const outboundBaseCost = 0.005; // Base cost for sending a message
  const outboundTwilioCost = outboundBaseCost * messageParts.length;
  const twilioCost = inboundTwilioCost + outboundTwilioCost;
  
  return {
    audioLengthSeconds: estimatedSeconds,
    openAICost,
    twilioCost,
    totalCost: openAICost + twilioCost
  };
}

module.exports = {
  transcribeAudio,
  calculateCosts
};
