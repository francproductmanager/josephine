// services/transcription-service.js
const axios = require('axios');
const { logDetails } = require('../utils/logging-utils');
const { isTestMode } = require('../utils/testing-utils');
const { getUserLanguage } = require('../helpers/localization');

async function transcribeAudio(formData, apiKey, req = null) {
  // Return mock data for test mode
  if (req && isTestMode(req)) {
    logDetails('[TEST MODE] Simulating audio transcription');
    
    // Generate sample text based on the user's language
    const mockText = generateMockTranscriptionText(req);
    
    return mockText;
  }
  
  // Normal production code
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

// Function to generate mock transcription text for testing
function generateMockTranscriptionText(req) {
  // Default mock message in English
  let mockText = "This is a mock transcription for testing purposes. It would normally contain the actual transcribed content from the audio file.";
  
  // If From parameter exists, customize the message by language
  if (req && req.body && req.body.From) {
    const phoneNumber = req.body.From;
    
    // Check country code-based patterns
    if (phoneNumber.includes('+33') || phoneNumber.includes('33')) {
      // French
      mockText = "Ceci est une transcription simulée à des fins de test. Elle contiendrait normalement le contenu réel transcrit du fichier audio.";
    } else if (phoneNumber.includes('+49') || phoneNumber.includes('49')) {
      // German
      mockText = "Dies ist eine simulierte Transkription zu Testzwecken. Normalerweise würde sie den tatsächlichen transkribierten Inhalt der Audiodatei enthalten.";
    } else if (phoneNumber.includes('+34') || phoneNumber.includes('34')) {
      // Spanish
      mockText = "Esta es una transcripción simulada con fines de prueba. Normalmente contendría el contenido real transcrito del archivo de audio.";
    } else if (phoneNumber.includes('+39') || phoneNumber.includes('39')) {
      // Italian
      mockText = "Questa è una trascrizione simulata a scopo di test. Normalmente conterrebbe il contenuto effettivamente trascritto dal file audio.";
    } else if (phoneNumber.includes('+44') || phoneNumber.includes('44')) {
      // Ensure UK numbers get English text
      mockText = "This is a mock transcription for testing purposes. It would normally contain the actual transcribed content from the audio file.";
    }
  }
  
  // Add extra text to make it longer if requested
  if (req && req.body && req.body.longTranscription === 'true') {
    mockText += " " + mockText.repeat(3);
  }
  
  return mockText;
}

module.exports = {
  transcribeAudio,
  calculateCosts,
  generateMockTranscriptionText
};
