// services/transcription-service.js
const axios = require('axios');
const { logDetails } = require('../utils/logging-utils');
const { isTestMode } = require('../utils/testing-utils');

async function transcribeAudio(formData, apiKey, req = null) {
  // Return mock data for test mode
  if (req && isTestMode(req)) {
    logDetails('[TEST MODE] Simulating audio transcription');
    
    // Debug the phone number from the request
    const phoneNumber = req.body && req.body.From ? req.body.From : 'unknown';
    logDetails(`[DEBUG] Phone number for transcription: ${phoneNumber}`);
    
    // Force the language based on explicitly checking the exact phone number
    let mockText;
    
    // Exact match test for specific numbers
    if (phoneNumber === 'whatsapp:+44123456789') {
      logDetails('[DEBUG] UK NUMBER DETECTED - Using English');
      mockText = "This is a mock transcription for testing purposes. It would normally contain the actual transcribed content from the audio file.";
    }
    else if (phoneNumber === 'whatsapp:+33123456789') {
      logDetails('[DEBUG] FRENCH NUMBER DETECTED');
      mockText = "Ceci est une transcription simulée à des fins de test. Elle contiendrait normalement le contenu réel transcrit du fichier audio.";
    }
    else if (phoneNumber === 'whatsapp:+49123456789') {
      logDetails('[DEBUG] GERMAN NUMBER DETECTED');
      mockText = "Dies ist eine simulierte Transkription zu Testzwecken. Normalerweise würde sie den tatsächlichen transkribierten Inhalt der Audiodatei enthalten.";
    }
    else if (phoneNumber === 'whatsapp:+34123456789') {
      logDetails('[DEBUG] SPANISH NUMBER DETECTED');
      mockText = "Esta es una transcripción simulada con fines de prueba. Normalmente contendría el contenido real transcrito del archivo de audio.";
    }
    else if (phoneNumber === 'whatsapp:+39123456789') {
      logDetails('[DEBUG] ITALIAN NUMBER DETECTED');
      mockText = "Questa è una trascrizione simulata a scopo di test. Normalmente conterrebbe il contenuto effettivamente trascritto dal file audio.";
    }
    else {
      // If we can't determine the language specifically, check more broadly
      if (phoneNumber.includes('+44') || phoneNumber.includes('44')) {
        logDetails('[DEBUG] UK pattern detected - using English');
        mockText = "This is a mock transcription for testing purposes. It would normally contain the actual transcribed content from the audio file.";
      }
      else if (phoneNumber.includes('+33') || phoneNumber.includes('33')) {
        logDetails('[DEBUG] French pattern detected');
        mockText = "Ceci est une transcription simulée à des fins de test. Elle contiendrait normalement le contenu réel transcrit du fichier audio.";
      }
      else if (phoneNumber.includes('+49') || phoneNumber.includes('49')) {
        logDetails('[DEBUG] German pattern detected');
        mockText = "Dies ist eine simulierte Transkription zu Testzwecken. Normalerweise würde sie den tatsächlichen transkribierten Inhalt der Audiodatei enthalten.";
      }
      else if (phoneNumber.includes('+34') || phoneNumber.includes('34')) {
        logDetails('[DEBUG] Spanish pattern detected');
        mockText = "Esta es una transcripción simulada con fines de prueba. Normalmente contendría el contenido real transcrito del archivo de audio.";
      }
      else if (phoneNumber.includes('+39') || phoneNumber.includes('39')) {
        logDetails('[DEBUG] Italian pattern detected');
        mockText = "Questa è una trascrizione simulata a scopo di test. Normalmente conterrebbe il contenuto effettivamente trascritto dal file audio.";
      }
      else {
        // Default to English for any other number
        logDetails('[DEBUG] No specific pattern detected - using default English');
        mockText = "This is a mock transcription for testing purposes. It would normally contain the actual transcribed content from the audio file.";
      }
    }
    
    // Add extra text to make it longer if requested
    if (req.body && req.body.longTranscription === 'true') {
      mockText += " " + mockText.repeat(3);
    }
    
    logDetails(`[DEBUG] Selected mock text: ${mockText.substring(0, 30)}...`);
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

module.exports = {
  transcribeAudio,
  calculateCosts
};
