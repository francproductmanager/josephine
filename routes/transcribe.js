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

  const event = req.body || {};
  console.log('Processing request body:', JSON.stringify(event));

  // Create a context object for passing around environment variables if needed
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

    const numMedia = parseInt(event.NumMedia || 0);
    if (numMedia === 0) {
      // No media – send a welcome or instructional message
      const welcomeMessage = await getLocalizedMessage('welcome', userLang, context);
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

      // Check user credits and return error if insufficient
      const creditStatus = await db.checkUserCredits(userPhone);
      logDetails('Credit status check result', creditStatus);
      if (!creditStatus.canProceed) {
        const paymentMessage = await getLocalizedMessage('needCredits', userLang, context) ||
          "You've used all your free transcriptions. Please purchase more credits.";
        return res.status(400).json({ status: 'error', message: paymentMessage, credits: creditStatus });
      }
      
      // Optionally, send a "processing" message via Twilio here if desired
      
      // Download the audio file from the mediaUrl
      logDetails(`Starting audio download from: ${mediaUrl}`);
      const audioResponse = await axios({
        method: 'get',
        url: mediaUrl,
        responseType: 'arraybuffer',
        timeout: 15000, // 15-second timeout
        headers: { 'User-Agent': 'WhatsAppTranscriptionService/1.0' }
      });
      logDetails('Audio download complete', {
        contentType: mediaContentType,
        size: audioResponse.data.length,
        responseSizeBytes: audioResponse.headers['content-length']
      });
      
      // Create FormData and append file and parameters
      const formData = new FormData();
      logDetails('Creating form data for Whisper API');
      formData.append('file', Buffer.from(audioResponse.data), {
        filename: 'audio.ogg',
        contentType: mediaContentType
      });
      formData.append('model', 'whisper-1');
      formData.append('response_format', 'json');
      
      // Merge headers explicitly to include both multipart headers and Authorization
      const formHeaders = formData.getHeaders();
      formHeaders.Authorization = `Bearer ${process.env.OPENAI_API_KEY}`;
      logDetails('Final request headers', formHeaders);
      
      // Call the OpenAI Whisper API
      logDetails('Sending request to OpenAI Whisper API...');
      const whisperResponse = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        formData,
        {
          headers: formHeaders,
          timeout: 30000 // 30-second timeout
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
      const estimatedSeconds = Math.ceil(audioLengthBytes / 16000); // rough estimate of audio length
      if (exceedsWordLimit(transcription, 150)) {
        logDetails('Generating summary for long transcription');
        summary = await generateSummary(transcription, userLang, context);
        logDetails('Summary generated', { summary });
      }
      
      // Calculate costs (example values)
      const openAICost = estimatedSeconds / 60 * 0.006;
      const twilioCost = 0.005;
      
      // Record the transcription and update user stats in the database
      logDetails('Recording transcription in database');
      await db.recordTranscription(
        userPhone,
        estimatedSeconds,
        transcription.split(/\s+/).length,
        openAICost,
        twilioCost
      );
      
      // Format the final message
      let finalMessage = '';
      if (summary) {
        const summaryLabel = await getLocalizedMessage('longMessage', userLang, context);
        finalMessage += `${summaryLabel}${summary}\n\n`;
      }
      const transcriptionLabel = await getLocalizedMessage('transcription', userLang, context);
      finalMessage += `${transcriptionLabel}${transcription}`;
      
      // Optionally, add credit warnings here if necessary
      
      // For now, we respond with JSON (or send via Twilio if needed)
      return res.json({
        status: 'success',
        transcription: transcription,
        summary: summary,
        message: finalMessage,
        credits: creditStatus.creditsRemaining
      });
    }
    
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
