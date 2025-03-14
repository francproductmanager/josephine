// routes/transcribe.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const Twilio = require('twilio');

// Import helper functions from your helpers
const { getLocalizedMessage, getUserLanguage, exceedsWordLimit } = require('../helpers/localization');
const { generateSummary } = require('../helpers/transcription');

// Enhanced debugging middleware
router.use((req, res, next) => {
  console.log('---- REQUEST DEBUG INFO ----');
  console.log('Headers:', JSON.stringify(req.headers));
  console.log('Body:', JSON.stringify(req.body));
  console.log('Content-Type:', req.get('Content-Type'));
  console.log('---------------------------');
  next();
});

router.post('/', async (req, res) => {
  const event = req.body || {};
  console.log('Processing request body:', JSON.stringify(event));

  // Create context object
  const context = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ACCOUNT_SID: process.env.ACCOUNT_SID,
    AUTH_TOKEN: process.env.AUTH_TOKEN
  };

  try {
    // MANUAL TEST MODE FOR LANGUAGE DETECTION
    // Check if this is a language test (special parameter)
    if (event.testLanguage === 'true') {
      const userPhone = event.From || '+1234567890';
      const userLang = getUserLanguage(userPhone);
      
      console.log(`LANGUAGE TEST: Detected language for ${userPhone}: ${userLang.name} (${userLang.code})`);
      
      // Try to get welcome message in detected language
      try {
        const welcomeMessage = await getLocalizedMessage('welcome', userLang, context);
        return res.json({
          status: 'success',
          test_type: 'language_detection',
          phone: userPhone,
          detected_language: userLang,
          translated_message: welcomeMessage
        });
      } catch (translationError) {
        console.error('Translation error:', translationError);
        return res.json({
          status: 'error',
          test_type: 'language_detection',
          message: 'Translation failed',
          error: translationError.message
        });
      }
    }

    // Initialize Twilio client (only if needed)
    let twilioClient = null;
    if (process.env.ACCOUNT_SID && process.env.AUTH_TOKEN) {
      twilioClient = new Twilio(
        process.env.ACCOUNT_SID,
        process.env.AUTH_TOKEN
      );
    }

    // Validate required parameters for Twilio requests
    const userPhone = event.From || 'unknown';
    const toPhone = event.To || process.env.TWILIO_PHONE_NUMBER;
    
    if (!toPhone && twilioClient) {
      console.error('No destination phone number available');
      return res.status(400).json({ 
        error: 'Missing destination phone number',
        help: 'Set TWILIO_PHONE_NUMBER in your environment variables or include To parameter'
      });
    }

    const userLang = getUserLanguage(userPhone);
    console.log(`Detected language for ${userPhone}: ${userLang.name} (${userLang.code})`);

    const numMedia = parseInt(event.NumMedia || 0);
    
    // For regular API testing
    if (!event.MessageSid) {
      console.log('Detected test request - providing helpful response');
      return res.json({ 
        status: 'success', 
        message: 'API endpoint is working. This is a test response.',
        expected_params: {
          From: '+1234567890 (sender phone)',
          To: '+0987654321 (your Twilio number)',
          NumMedia: '1 (if sending media)',
          MediaContentType0: 'audio/ogg (for voice notes)',
          MediaUrl0: 'https://... (URL to media file)',
          MessageSid: 'SM12345... (necessary to trigger Twilio mode)',
        },
        test_language_mode: {
          usage: "To test language detection, add testLanguage=true and From=+COUNTRYCODE...",
          example: "From=+39123456789&testLanguage=true will test Italian detection"
        }
      });
    }
    
    // Handle welcome message for NumMedia=0
    if (numMedia === 0) {
      console.log('No media, sending welcome message');
      const welcomeMessage = await getLocalizedMessage('welcome', userLang, context);
      
      if (twilioClient) {
        // Send via Twilio if client available
        await twilioClient.messages.create({
          body: welcomeMessage,
          from: toPhone,
          to: userPhone
        });
        return res.status(200).send('OK');
      } else {
        // Otherwise just return the message
        return res.json({
          status: 'success',
          message: welcomeMessage,
          language: userLang
        });
      }
    }
    
    // Handle media processing (voice notes)
    if (numMedia > 0) {
      const mediaContentType = event.MediaContentType0;
      const mediaUrl = event.MediaUrl0;
      
      if (!mediaContentType || !mediaUrl) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing media content type or URL'
        });
      }
      
      if (mediaContentType.startsWith('audio/')) {
        console.log('Processing voice note...');
        
        // Rest of your transcription logic goes here...
        // ...
        
        return res.status(200).send('Processing audio');
      } else {
        return res.status(400).json({
          status: 'error',
          message: 'Not an audio file'
        });
      }
    }
    
    // Should never get here, but just in case
    return res.status(400).json({
      status: 'error',
      message: 'Invalid request'
    });
    
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
