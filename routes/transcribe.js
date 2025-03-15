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

  // Handle cases where Twilio sends a nested payload
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

  // Create a context object if needed
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

    // Ensure we get the media parameters from the parsed event
    const numMedia = parseInt(event.NumMedia || 0);
    if (numMedia === 0) {
      // No media – send a welcome/instruction message
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

      // Check user credits
      const creditStatus = await db.checkUserCredits(userPhone);
      logDetails('Credit status check result', creditStatus);
      if (!creditStatus.canProceed) {
        const paymentMessage = await getLocalizedMessage('needCredits', userLang, context) ||
          "You've used all your free transcriptions. Please purchase more credits.";
        return res.status(400).json({ status: 'error', message: paymentMessage, credits: creditStatus });
      }

      // Download the audio file from Twilio's media URL
      logDetails(`Starting audio download from: ${mediaUrl}`);
      // If Twilio's media URL requires basic auth, you might need to include it here:
      const audioResponse = await axios({
        method: 'get',
        url: mediaUrl,
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: { 
          'User-Agent': 'WhatsAppTranscriptionService/1.0'
          // You can add Twilio basic auth here if needed:
          // 'Authorization': 'Basic ' + Buffer.from(`${process.env.ACCOUNT_SID}:${process.env.AUTH_TOKEN}`).toString('base64')
        }
      });
      logDetails('Audio download complete', {
        contentType: mediaContentType,
        size: audioResponse.data.length,
        responseSizeBytes: audioResponse.headers['content-length']
      });

      // Create FormData for the Whisper API request
     
