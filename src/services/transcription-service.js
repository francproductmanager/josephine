// src/services/transcription-service.js
const { postJson } = require('../utils/http-client');
const { logDetails } = require('../utils/logging-utils');

async function transcribeAudio(formData, apiKey, req = null) {
  // Return mock data for test mode
  if (req && req.isTestMode) {
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
    return await requestTranscription(formData, apiKey);
  } catch (error) {
    const status = error.response && error.response.status;
    const model = formData.get('model');
    // gpt-4o(-mini)-transcribe rejects input longer than 1500s (25 min)
    // with HTTP 400; whisper-1 has no duration cap (only the 25MB upload
    // limit, which our size guard already enforces). A 400 is also what
    // an unsupported container yields, so one fallback attempt covers
    // both without costing anything on the failure path (4xx are unbilled).
    if (status === 400 && model && model !== FALLBACK_MODEL) {
      logDetails(`Transcription rejected by ${model} (${error.message}) - retrying with ${FALLBACK_MODEL}`);
      try {
        return await requestTranscription(withModel(formData, FALLBACK_MODEL), apiKey);
      } catch (fallbackError) {
        logDetails('Error transcribing audio (fallback):', fallbackError);
        throw fallbackError;
      }
    }
    logDetails('Error transcribing audio:', error);
    throw error;
  }
}

const FALLBACK_MODEL = 'whisper-1';

async function requestTranscription(formData, apiKey) {
  logDetails(`Sending request to OpenAI transcription API (${formData.get('model')})...`);

  const data = await postJson(
    'https://api.openai.com/v1/audio/transcriptions',
    formData,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs: 30000
    }
  );

  logDetails('Received response from transcription API', {
    hasText: !!data.text
  });

  return data.text.trim();
}

// Copy a transcription FormData with a different model (FormData has no
// clone; the File entry is shared by reference, not re-buffered).
function withModel(formData, model) {
  const copy = new FormData();
  for (const [key, value] of formData.entries()) {
    if (key === 'model') continue;
    if (value instanceof Blob) {
      copy.append(key, value, value.name || 'audio.ogg');
    } else {
      copy.append(key, value);
    }
  }
  copy.append('model', model);
  return copy;
}

module.exports = {
  transcribeAudio,
  FALLBACK_MODEL
};
