// routes/transcribe.js
const express = require('express');
const router = express.Router();
const Twilio = require('twilio');
const db = require('../helpers/database');

// Import our refactored services
const { downloadAudio, prepareFormData } = require('../services/audio-service');
const { transcribeAudio, calculateCosts } = require('../services/transcription-service');
const { checkContentModeration } = require('../services/moderation-service');
const { splitLongMessage, sendMessages } = require('../services/messaging-service');
const { logDetails } = require('../utils/logging-utils');

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
  // Debug OpenAI API key
  console.log('========== API KEY DEBUG ============');
  const apiKey = process.env.OPENAI_API_KEY;
  console.log('API Key exists:', !!apiKey);
  if (apiKey) {
    console.log('API Key length:', apiKey.length);
    console.log('API Key starts with:', apiKey.substring(0, 7));
    console.log('API Key format check:', apiKey.startsWith('sk-'));
    console.log('API Key spaces check:', apiKey.includes(' '));
    console.log('API Key newline check:', apiKey.includes('\n'));
  }
  console.log('====================================');

  let event = req.body || {};
  console.log('Processing request body:', JSON.stringify(event));

  // Create context object
  const context = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ACCOUNT_SID: process.env.ACCOUNT_SID,
    AUTH_TOKEN: process.env.AUTH_TOKEN
  };

  try {
    // Manual test mode for language detection
    if (event.testLanguage === 'true') {
      const userPhone = event.From || '+1234567890';
      const userLang = getUserLanguage(userPhone);
      logDetails(`LANGUAGE TEST: Detected language for ${userPhone}: ${userLang.name} (${userLang.code})`);
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

    // Initialize Twilio client if available
    let twilioClient = null;
    if (process.env.ACCOUNT_SID && process.env.AUTH_TOKEN) {
      twilioClient = new Twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
    }

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
    logDetails(`Detected language for ${userPhone}: ${userLang.name} (${userLang.code})`);

    const numMedia = parseInt(event.NumMedia || 0);

    // If MessageSid is not provided (e.g., test request)
    if (!event.MessageSid) {
      logDetails('Detected test request - providing helpful response');
      return res.json({
        status: 'success',
        message: 'API endpoint is working. This is a test response.',
        expected_params: {
          From: '+1234567890 (sender phone)',
          To: '+0987654321 (your Twilio number)',
          NumMedia: '1 (if sending media)',
          MediaContentType0: 'audio/ogg (for voice notes)',
          MediaUrl0: 'https://... (URL to media file)',
          MessageSid: 'SM12345... (necessary to trigger Twilio mode)'
        },
        test_language_mode: {
          usage: "To test language detection, add testLanguage=true and From=+COUNTRYCODE...",
          example: "From=+39123456789&testLanguage=true will test Italian detection"
        }
      });
    }

    // If no media is provided, send a welcome message
    if (numMedia === 0) {
      logDetails('No media, sending welcome message');
      const welcomeMessage = await getLocalizedMessage('welcome', userLang, context);
      if (twilioClient) {
        await twilioClient.messages.create({
          body: welcomeMessage,
          from: toPhone,
          to: userPhone
        });
        res.set('Content-Type', 'text/xml');
        return res.send('<Response></Response>');
      } else {
        return res.json({
          status: 'success',
          message: welcomeMessage,
          language: userLang
        });
      }
    }

    if (numMedia > 0) {
      const mediaContentType = event.MediaContentType0;
      const mediaUrl = event.MediaUrl0;
      
      if (!mediaContentType || !mediaUrl) {
        return res.status(400).json({
          status: 'error',
          message: 'Missing media content type or URL'
        });
      }
      
      if (!mediaContentType.startsWith('audio/')) {
        const sendAudioMessage = await getLocalizedMessage('sendAudio', userLang, context);
        if (twilioClient) {
          await twilioClient.messages.create({
            body: sendAudioMessage,
            from: toPhone,
            to: userPhone
          });
          res.set('Content-Type', 'text/xml');
          return res.send('<Response></Response>');
        } else {
          return res.status(400).json({
            status: 'error',
            message: sendAudioMessage
          });
        }
      }

      logDetails('Processing voice note...');

      // Check user credits
      const creditStatus = await db.checkUserCredits(userPhone);
      logDetails('Credit status check result', creditStatus);
      
      if (!creditStatus.canProceed) {
        logDetails(`User ${userPhone} has no credits left`);
        const paymentMessage = await getLocalizedMessage('needCredits', userLang, context) ||
          "You've used all your free transcriptions. To continue using Josephine, please send £2 to purchase 50 more transcriptions.";
        
        if (twilioClient) {
          await twilioClient.messages.create({
            body: paymentMessage,
            from: toPhone,
            to: userPhone
          });
          res.set('Content-Type', 'text/xml');
          return res.send('<Response></Response>');
        } else {
          return res.json({
            status: 'error',
            message: paymentMessage,
            credits: creditStatus
          });
        }
      }

      // Check if this is the last credit and prepare warning if needed
      let creditWarning = '';
      if (creditStatus.creditsRemaining === 1) {
        try {
          const userStats = await db.getUserStats(userPhone);
          const totalSecondsFormatted = Math.round(userStats.totalSeconds);
          const totalWordsFormatted = Math.round(userStats.totalWords);
          const totalTranscriptionsFormatted = userStats.totalTranscriptions;
          
          creditWarning = `\n\n❗ Hi! Josephine here with a little heads-up 👋 We've been through ${totalTranscriptionsFormatted} voice notes together - can you believe it? That's about ${totalWordsFormatted} words I've transcribed for you, saving you over ${totalSecondsFormatted} seconds of listening time! Just so you know, you have one more free transcription left. After this one, I'll ask for a small contribution - the equivalent of a croissant - to keep our lovely arrangement going. I've really enjoyed being your transcription assistant and hope we can keep this going!`;
          
          // Translate the warning if needed
          if (userLang.code !== 'en') {
            try {
              const translationResponse = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                  model: "gpt-3.5-turbo",
                  messages: [
                    {
                      role: "system",
                      content: `You are a professional translator. Translate the following text into ${userLang.name} accurately. Preserve emojis and formatting.`
                    },
                    {
                      role: "user",
                      content: `Translate this to ${userLang.name}: ${creditWarning}`
                    }
                  ],
                  max_tokens: 400,
                  temperature: 0.3
                },
                {
                  headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                  }
                }
              );
              creditWarning = translationResponse.data.choices[0].message.content.trim();
            } catch (translationError) {
              logDetails('Error translating credit warning message', translationError);
              // Continue with English warning if translation fails
            }
          }
        } catch (statsError) {
          logDetails('Error getting user stats for credit warning', statsError);
          // If there's an error getting stats, don't show any warning
          creditWarning = '';
        }
      }

      try {
        // Prepare authentication headers for audio download
        const authHeaders = {};
        if (process.env.ACCOUNT_SID && process.env.AUTH_TOKEN) {
          const authHeader = 'Basic ' + Buffer.from(`${process.env.ACCOUNT_SID}:${process.env.AUTH_TOKEN}`).toString('base64');
          authHeaders['Authorization'] = authHeader;
        }
        
        // Download audio file
        const { data: audioData, contentLength } = await downloadAudio(mediaUrl, authHeaders);
        
        // Prepare form data for Whisper API
        const formData = prepareFormData(audioData, mediaContentType);
        
        // Transcribe the audio
        const transcription = await transcribeAudio(formData, process.env.OPENAI_API_KEY);
        
        // Check for prohibited content
        const moderationResult = await checkContentModeration(transcription, process.env.OPENAI_API_KEY);
        if (moderationResult.flagged) {
          logDetails('Content moderation flagged this transcription', moderationResult);
          
          // Get a localized message about content violation
          const contentViolationMessage = await getLocalizedMessage('contentViolation', userLang, context);
          
          if (twilioClient) {
            await twilioClient.messages.create({
              body: contentViolationMessage,
              from: toPhone,
              to: userPhone
            });
            res.set('Content-Type', 'text/xml');
            return res.send('<Response></Response>');
          } else {
            return res.json({
              status: 'error',
              message: contentViolationMessage,
              moderation: {
                flagged: true,
                categories: moderationResult.categories
              }
            });
          }
        }

        // Generate summary for long transcriptions
        let summary = null;
        if (exceedsWordLimit(transcription, 150)) {
          logDetails('Generating summary for long transcription');
          summary = await generateSummary(transcription, userLang, context);
          logDetails('Summary generated', { summary });
        }

        // Prepare the final message
        let finalMessage = '';
        if (summary) {
          const summaryLabel = await getLocalizedMessage('longMessage', userLang, context);
          finalMessage += `✏️ ${summaryLabel.trim()} ${summary}\n\n`;
        }
        
        const transcriptionLabel = await getLocalizedMessage('transcription', userLang, context);
        finalMessage += `🤖 ${transcriptionLabel.trim()}\n\n${transcription}`;
        
        if (creditWarning) {
          finalMessage += creditWarning;
        }

        // Split the message if needed
        const messageParts = splitLongMessage(finalMessage);
        
        // Calculate costs
        const costs = calculateCosts(contentLength, messageParts.length);
        
        // First send the message, then update database
        if (twilioClient) {
          try {
            // Send the messages
            await sendMessages(twilioClient, messageParts, userPhone, toPhone);
            
            // Only after successful send, update the database
            logDetails('Recording transcription in database');
            await db.recordTranscription(
              userPhone,
              costs.audioLengthSeconds,
              transcription.split(/\s+/).length,
              costs.openAICost,
              costs.twilioCost
            );
            logDetails('Transcription recorded in database');
            
            res.set('Content-Type', 'text/xml');
            return res.send('<Response></Response>');
          } catch (twilioError) {
            logDetails('Error sending message via Twilio:', twilioError);
            return res.status(500).json({
              status: 'error',
              message: 'Failed to send transcription',
              error: twilioError.message
            });
          }
        } else {
          logDetails('No Twilio client - returning JSON response');
          
          // For API mode, still record the transcription
          logDetails('Recording transcription in database');
          await db.recordTranscription(
            userPhone,
            costs.audioLengthSeconds,
            transcription.split(/\s+/).length,
            costs.openAICost,
            costs.twilioCost
          );
          logDetails('Transcription recorded in database');
          
          return res.json({
            status: 'success',
            summary: summary,
            transcription: transcription,
            message: finalMessage,
            credits: creditStatus.creditsRemaining
          });
        }
      } catch (processingError) {
        logDetails('ERROR PROCESSING AUDIO:', processingError);
        
        // Determine specific error type
        let errorMessage;
        
        if (processingError.response && processingError.response.status === 429) {
          errorMessage = await getLocalizedMessage('rateLimited', userLang, context);
        } else if (processingError.code === 'ECONNABORTED' || processingError.message.includes('timeout')) {
          errorMessage = await getLocalizedMessage('processingTimeout', userLang, context);
        } else {
          errorMessage = await getLocalizedMessage('apiError', userLang, context);
        }
        
        if (twilioClient) {
          await twilioClient.messages.create({
            body: errorMessage,
            from: toPhone,
            to: userPhone
          });
          res.set('Content-Type', 'text/xml'); 
          return res.send('<Response></Response>');
        } else {
          return res.status(500).json({
            status: 'error',
            message: errorMessage,
            error: processingError.message
          });
        }
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
