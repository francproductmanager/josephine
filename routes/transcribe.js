// routes/transcribe.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const Twilio = require('twilio');
const db = require('../helpers/database');

// Import helper functions
const { getLocalizedMessage, getUserLanguage, exceedsWordLimit } = require('../helpers/localization');
const { generateSummary } = require('../helpers/transcription');

// Helper logging function
function logDetails(message, obj = null) {
  console.log(`[${new Date().toISOString()}] ${message}`);
  if (obj) {
    console.log(JSON.stringify(obj, null, 2));
  }
}

router.post('/', async (req, res) => {
  console.log('========== API KEY DEBUG ============');
  const apiKey = process.env.OPENAI_API_KEY;
  console.log('API Key exists:', !!apiKey);
  if (apiKey) {
    console.log('API Key length:', apiKey.length);
    console.log('API Key preview:', `${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 4)}`);
  }
  console.log('====================================');

  // Handle cases where Twilio sends a nested Payload
  let event = req.body || {};
  if (event.Payload) {
    try {
      event = JSON.parse(event.Payload);
      console.log("Parsed nested Payload:", event);
    } catch (e) {
      console.error("Error parsing nested Payload:", e);
    }
  }
  console.log('Processing request body:', JSON.stringify(event));

  // Create context object if needed
  const context = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ACCOUNT_SID: process.env.ACCOUNT_SID,
    AUTH_TOKEN: process.env.AUTH_TOKEN
  };

  try {
    // Basic parameter validation
    const userPhone = event.From || 'unknown';
    const toPhone = event.To || process.env.TWILIO_PHONE_NUMBER;
    if (!toPhone) {
      console.error('No destination phone number available');
      return res.status(400).json({ error: 'Missing destination phone number' });
    }
    const userLang = getUserLanguage(userPhone);
    console.log(`Detected language for ${userPhone}: ${userLang.name} (${userLang.code})`);

    // Check for media parameters
    const numMedia = parseInt(event.NumMedia || 0);
    if (numMedia === 0) {
      const welcomeMessage = await getLocalizedMessage('welcome', userLang, context);
      // For non-media requests from Twilio, respond with TwiML as well
      if (event.MessageSid) {
        let twilioClient = null;
        if (process.env.ACCOUNT_SID && process.env.AUTH_TOKEN) {
          twilioClient = new Twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
        }
        if (twilioClient) {
          await twilioClient.messages.create({
            body: welcomeMessage,
            from: toPhone,
            to: userPhone
          });
          res.set('Content-Type', 'text/xml');
          return res.send('<Response></Response>');
        }
      }
      return res.json({ status: 'success', message: welcomeMessage, language: userLang });
    }

    if (numMedia > 0) {
      const mediaContentType = event.MediaContentType0;
      const mediaUrl = event.MediaUrl0;
      if (!mediaContentType || !mediaUrl) {
        return res.status(400).json({ status: 'error', message: 'Missing media content type or URL' });
      }
      if (!mediaContentType.startsWith('audio/')) {
        const sendAudioMessage = await getLocalizedMessage('sendAudio', userLang, context);
        return res.status(400).json({ status: 'error', message: sendAudioMessage });
      }

      logDetails('Processing voice note...');

      // Check user credits
      const creditStatus = await db.checkUserCredits(userPhone);
      logDetails('Credit status check result', creditStatus);
      if (!creditStatus.canProceed) {
        const paymentMessage = await getLocalizedMessage('needCredits', userLang, context) ||
          "You've used all your free transcriptions. Please purchase more credits.";
        return res.status(400).json({ status: 'error', message: paymentMessage, credits: creditStatus });
      }

      // Download the audio file from Twilio's media URL
     // Build Basic Auth header for Twilio using your Twilio Account SID and Auth Token
const authHeader = 'Basic ' + Buffer.from(`${process.env.ACCOUNT_SID}:${process.env.AUTH_TOKEN}`).toString('base64');

logDetails(`Starting audio download from: ${mediaUrl}`);
const audioResponse = await axios({
  method: 'get',
  url: mediaUrl,
  responseType: 'arraybuffer',
  timeout: 15000,
  headers: {
    'User-Agent': 'WhatsAppTranscriptionService/1.0',
    'Authorization': authHeader
  }
});
logDetails('Audio download complete', {
  contentType: mediaContentType,
  size: audioResponse.data.length,
  responseSizeBytes: audioResponse.headers['content-length']
});


      // Create FormData for the Whisper API request
      const formData = new FormData();
      logDetails('Creating form data for Whisper API');
      formData.append('file', Buffer.from(audioResponse.data), {
        filename: 'audio.ogg',
        contentType: mediaContentType
      });
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'json');

      // Merge form-data headers with Authorization header
      const formHeaders = formData.getHeaders();
      formHeaders.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;
      logDetails('Final request headers', formHeaders);

      // Send the request to the Whisper API
      logDetails('Sending request to OpenAI Whisper API...');
      const whisperResponse = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        formData,
        {
          headers: formHeaders,
          timeout: 30000
        }
      );
      logDetails('Received response from Whisper API', {
        status: whisperResponse.status,
        hasText: !!whisperResponse.data.text
      });
      let transcription = whisperResponse.data.text.trim();
      logDetails(`Transcription result: ${transcription.substring(0, 50)}...`);

      let summary = null;
      const audioLengthBytes = audioResponse.headers['content-length'] || 0;
      const estimatedSeconds = Math.ceil(audioLengthBytes / 16000);
      if (exceedsWordLimit(transcription, 150)) {
        logDetails('Generating summary for long transcription');
        summary = await generateSummary(transcription, userLang, context);
        logDetails('Summary generated', { summary });
      }

      // Example cost calculations
      const openAICost = estimatedSeconds / 60 * 0.006;
      const twilioCost = 0.005;

      logDetails('Recording transcription in database');
      await db.recordTranscription(
        userPhone,
        estimatedSeconds,
        transcription.split(/\s+/).length,
        openAICost,
        twilioCost
      );

      // Build the final message
      let finalMessage = '';
      if (summary) {
        const summaryLabel = await getLocalizedMessage('longMessage', userLang, context);
        finalMessage += `${summaryLabel}${summary}\n\n`;
      }
      const transcriptionLabel = await getLocalizedMessage('transcription', userLang, context);
      finalMessage += `${transcriptionLabel}${transcription}`;

      // If request is from Twilio, send the transcription via Twilio and respond with valid TwiML
      if (event.MessageSid) {
        let twilioClient = null;
        if (process.env.ACCOUNT_SID && process.env.AUTH_TOKEN) {
          twilioClient = new Twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
        }
        if (twilioClient) {
          await twilioClient.messages.create({
            body: finalMessage,
            from: toPhone,
            to: userPhone
          });
          res.set('Content-Type', 'text/xml');
          return res.send('<Response></Response>');
        }
      }
      // Otherwise, respond with JSON
      return res.json({
        status: 'success',
        transcription: transcription,
        summary: summary,
        message: finalMessage,
        credits: creditStatus.creditsRemaining
      });
    } // End if (numMedia > 0)

    // Fallback for invalid requests
    return res.status(400).json({ status: 'error', message: 'Invalid request' });
  } catch (error) {
    console.error('Error encountered:', error.message);
    console.error('Error stack:', error.stack);
    return res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: error.message
    });
  }
});

module.exports = router;
