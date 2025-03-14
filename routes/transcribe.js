// routes/transcribe.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const Twilio = require('twilio');

// Import helper functions from your helpers
const { getLocalizedMessage, getUserLanguage, exceedsWordLimit } = require('../helpers/localization');
const { generateSummary } = require('../helpers/transcription');

// Debug middleware - log all requests
router.use((req, res, next) => {
  console.log('Received request:', {
    body: req.body,
    headers: req.headers,
    method: req.method,
    path: req.path
  });
  next();
});

router.post('/', async (req, res) => {
  const event = req.body || {};
  console.log('Processing request with body:', event);

  // Initialize Twilio client
  const twilioClient = new Twilio(
    process.env.ACCOUNT_SID,
    process.env.AUTH_TOKEN
  );

  // Create context object
  const context = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ACCOUNT_SID: process.env.ACCOUNT_SID,
    AUTH_TOKEN: process.env.AUTH_TOKEN
  };

  try {
    // Validate required parameters for Twilio requests
    const userPhone = event.From || 'unknown';
    const toPhone = event.To || process.env.TWILIO_PHONE_NUMBER;
    
    if (!toPhone) {
      console.error('No destination phone number available');
      return res.status(400).send('Missing destination phone number');
    }

    const userLang = getUserLanguage(userPhone);
    console.log(`Detected language for ${userPhone}: ${userLang.name} (${userLang.code})`);

    const numMedia = parseInt(event.NumMedia || 0);
    
    // For testing purposes: If this is not a Twilio request but a regular API test
    const isTwilioRequest = event.MessageSid !== undefined;
    
    if (!isTwilioRequest) {
      console.log('Detected non-Twilio test request');
      return res.json({ 
        status: 'success', 
        message: 'API endpoint is working. This is a test response.',
        expected_params: {
          From: '+1234567890 (sender phone)',
          To: '+0987654321 (your Twilio number)',
          NumMedia: '1 (if sending media)',
          MediaContentType0: 'audio/ogg (for voice notes)',
          MediaUrl0: 'https://... (URL to media file)'
        }
      });
    }
    
    if (numMedia > 0) {
      const mediaContentType = event.MediaContentType0;
      if (mediaContentType && mediaContentType.startsWith('audio/')) {
        const mediaUrl = event.MediaUrl0;
        console.log('Processing voice note...');

        // Send initial processing message
        const processingMessage = await getLocalizedMessage('processing', userLang, context);
        await twilioClient.messages.create({
          body: processingMessage,
          from: toPhone,
          to: userPhone
        });

        // Download the voice note
        const mediaResponse = await axios({
          method: 'get',
          url: mediaUrl,
          auth: {
            username: process.env.ACCOUNT_SID,
            password: process.env.AUTH_TOKEN
          },
          responseType: 'arraybuffer'
        });

        console.log('Audio downloaded, size:', mediaResponse.data.byteLength);

        // Add diagnostic logging
        console.log('Audio metadata:', {
          contentType: mediaContentType,
          sizeInBytes: mediaResponse.data.byteLength,
          estimatedDuration: `~${Math.round(mediaResponse.data.byteLength / 16000)} seconds`
        });

        // Prepare form data for OpenAI
        const form = new FormData();
        form.append('file', Buffer.from(mediaResponse.data), {
          filename: 'audio.ogg',
          contentType: mediaContentType
        });
        form.append('model', 'whisper-1');

        // Call OpenAI API for transcription
        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/audio/transcriptions',
          form,
          {
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
              ...form.getHeaders()
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 30000
          }
        );

        const transcribedText = openaiResponse.data.text;
        
        // Process transcription based on length
        if (exceedsWordLimit(transcribedText)) {
          const summary = await generateSummary(transcribedText, userLang, context);
          if (summary) {
            const longMessage = await getLocalizedMessage('longMessage', userLang, context);
            const transMessage = await getLocalizedMessage('transcription', userLang, context);
            
            // Send response to user
            await twilioClient.messages.create({
              body: `${longMessage}${summary}\n\n${transMessage}${transcribedText}`,
              from: toPhone,
              to: userPhone
            });
          } else {
            // If summary fails, just send transcription
            const transMessage = await getLocalizedMessage('transcription', userLang, context);
            await twilioClient.messages.create({
              body: `${transMessage}${transcribedText}`,
              from: toPhone,
              to: userPhone
            });
          }
        } else {
          const transMessage = await getLocalizedMessage('transcription', userLang, context);
          await twilioClient.messages.create({
            body: `${transMessage}${transcribedText}`,
            from: toPhone,
            to: userPhone
          });
        }
        
        // Return simple acknowledgment to Twilio webhook
        return res.status(200).send('OK');
      } else {
        // If media is not audio
        const sendAudioMessage = await getLocalizedMessage('sendAudio', userLang, context);
        await twilioClient.messages.create({
          body: sendAudioMessage,
          from: toPhone,
          to: userPhone
        });
        return res.status(200).send('OK');
      }
    } else {
      // If there's no media, send welcome message
      const welcomeMessage = await getLocalizedMessage('welcome', userLang, context);
      await twilioClient.messages.create({
        body: welcomeMessage,
        from: toPhone,
        to: userPhone
      });
      return res.status(200).send('OK');
    }
  } catch (error) {
    console.error('Error encountered:', error.message);
    console.error('Error stack:', error.stack);
    
    // Try to send error message to user if possible
    try {
      const userPhone = event.From;
      const toPhone = event.To || process.env.TWILIO_PHONE_NUMBER;
      
      if (userPhone && toPhone) {
        const userLang = getUserLanguage(userPhone);
        const errorMessage = await getLocalizedMessage('error', userLang, context);
        await twilioClient.messages.create({
          body: errorMessage,
          from: toPhone,
          to: userPhone
        });
      }
    } catch (msgError) {
      console.error('Failed to send error message:', msgError);
    }
    
    // Always send a 200 response to Twilio to acknowledge receipt
    return res.status(200).send('Error handled');
  }
});

module.exports = router;
