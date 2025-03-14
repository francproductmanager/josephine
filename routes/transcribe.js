// routes/transcribe.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const Twilio = require('twilio');

// Import helper functions from your helpers
const { getLocalizedMessage, getUserLanguage, exceedsWordLimit } = require('../helpers/localization');
const { generateSummary } = require('../helpers/transcription');

router.post('/', async (req, res) => {
  const event = req.body;

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
    const userPhone = event.From;
    const userLang = getUserLanguage(userPhone);
    console.log(`Detected language for ${userPhone}: ${userLang.name} (${userLang.code})`);

    const numMedia = parseInt(event.NumMedia || 0);
    
    if (numMedia > 0) {
      const mediaContentType = event.MediaContentType0;
      if (mediaContentType && mediaContentType.startsWith('audio/')) {
        const mediaUrl = event.MediaUrl0;
        console.log('Processing voice note...');

        // Send initial processing message
        const processingMessage = await getLocalizedMessage('processing', userLang, context);
        await twilioClient.messages.create({
          body: processingMessage,
          from: event.To,
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
              from: event.To,
              to: userPhone
            });
          } else {
            // If summary fails, just send transcription
            const transMessage = await getLocalizedMessage('transcription', userLang, context);
            await twilioClient.messages.create({
              body: `${transMessage}${transcribedText}`,
              from: event.To,
              to: userPhone
            });
          }
        } else {
          const transMessage = await getLocalizedMessage('transcription', userLang, context);
          await twilioClient.messages.create({
            body: `${transMessage}${transcribedText}`,
            from: event.To,
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
          from: event.To,
          to: userPhone
        });
        return res.status(200).send('OK');
      }
    } else {
      // If there's no media, send welcome message
      const welcomeMessage = await getLocalizedMessage('welcome', userLang, context);
      await twilioClient.messages.create({
        body: welcomeMessage,
        from: event.To,
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
      if (userPhone) {
        const userLang = getUserLanguage(userPhone);
        const errorMessage = await getLocalizedMessage('error', userLang, context);
        await twilioClient.messages.create({
          body: errorMessage,
          from: event.To,
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
