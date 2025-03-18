// routes/transcribe.js
const express = require('express');
const router = express.Router();
const db = require('../helpers/database');

// Import test utilities
const { isTestMode } = require('../utils/testing-utils');
const { TwilioClientWrapper } = require('../services/twilio-service');

// Import our services
const { downloadAudio, prepareFormData } = require('../services/audio-service');
const { transcribeAudio, calculateCosts } = require('../services/transcription-service');
const { checkContentModeration } = require('../services/moderation-service');
const { splitLongMessage, sendMessages } = require('../services/messaging-service');
const { logDetails } = require('../utils/logging-utils');

// Import helper functions
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
    // Initialize our Twilio client wrapper
    const twilioWrapper = new TwilioClientWrapper(req);
    const twilioIsAvailable = twilioWrapper.isAvailable();
    
    // Check if test mode is active
    const testMode = isTestMode(req);
    if (testMode) {
      logDetails('[TEST MODE] Processing request in test mode');
    }
    
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

    const userPhone = event.From || 'unknown';
    const toPhone = event.To || process.env.TWILIO_PHONE_NUMBER;
    if (!toPhone && twilioIsAvailable && !testMode) {
      console.error('No destination phone number available');
      return res.status(400).json({
        error: 'Missing destination phone number',
        help: 'Set TWILIO_PHONE_NUMBER in your environment variables or include To parameter'
      });
    }

    const userLang = getUserLanguage(userPhone);
    logDetails(`Detected language for ${userPhone}: ${userLang.name} (${userLang.code})`);

    const numMedia = parseInt(event.NumMedia || 0);

    // If MessageSid is not provided (e.g., test request) and not in test mode
    if (!event.MessageSid && !testMode) {
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
        },
        test_mode: {
          usage: "To run in test mode, add x-test-mode: true header or testMode=true",
          special_params: {
            testNoCredits: "true (simulate user with no credits)",
            testLowCredits: "true (simulate user with 1 credit left)",
            longTranscription: "true (simulate a longer transcription text)"
          }
        }
      });
    }

    // 1) Check if user is new and hasn't seen intro
    const { user } = await db.findOrCreateUser(userPhone, req);
    
    if (!user.has_seen_intro) {
      // User is brand-new or hasn't seen T&C intro
      if (numMedia > 0 && event.MediaContentType0 && event.MediaContentType0.startsWith('audio/')) {
        // SCENARIO B: First contact is a voice note
        // We DO NOT transcribe. Instead, we respond with T&C link and ask them to resend.
        const messageForVoiceFirst1 = 
          `Hey there! I see you sent me a voice note 👋. ` +
          `Before I transcribe, I want to make sure you've checked my Terms & Conditions.`;
          
        const messageForVoiceFirst2 = 
          `By continuing to send audio, you're confirming you've read and agreed to my Terms & Conditions: ` +
          `https://tinyurl.com/josephine-Terms. Please forward your voice note again, and I'll transcribe it right away!`;

        if (twilioIsAvailable) {
          // Send first message
          await twilioWrapper.sendMessage({
            body: messageForVoiceFirst1,
            from: toPhone,
            to: userPhone
          });
          
          // Small delay to ensure messages arrive in order
          if (!testMode) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          // Send second message
          await twilioWrapper.sendMessage({
            body: messageForVoiceFirst2,
            from: toPhone,
            to: userPhone
          });
          
          // Generate XML response
          const xmlResponse = twilioWrapper.generateXMLResponse('<Response></Response>');
          
          // For test mode, return test results instead of XML
          if (testMode) {
            await db.markUserIntroAsSeen(user.id, req);
            return res.json({
              status: 'success',
              flow: 'first_time_voice_note',
              testResults: twilioWrapper.getTestResults(),
              dbOperations: db.getTestDbOperations()
            });
          } else {
            res.set('Content-Type', 'text/xml');
            return res.send(xmlResponse);
          }
        } else {
          // No Twilio client, return JSON
          await db.markUserIntroAsSeen(user.id, req);
          return res.json({
            status: 'intro_sent',
            flow: 'first_time_voice_note',
            messages: [messageForVoiceFirst1, messageForVoiceFirst2]
          });
        }
      } else {
        // SCENARIO A: First contact is text or non-audio
        // We DO NOT transcribe. Instead, we respond with T&C link and invite them to send audio.
        const messageForTextFirst1 = 
          `Hi! I'm Josephine, your friendly transcription assistant 👋. ` +
          `I turn voice notes into text so you can read them at your convenience.`;
          
        const messageForTextFirst2 = 
          `By sending audio, you confirm you've read and agreed to my Terms & Conditions ` +
          `https://tinyurl.com/josephine-Terms. Forward a voice note, and I'll do the rest!`;

        if (twilioIsAvailable) {
          // Send first message
          await twilioWrapper.sendMessage({
            body: messageForTextFirst1,
            from: toPhone,
            to: userPhone
          });
          
          // Small delay to ensure messages arrive in order
          if (!testMode) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
          
          // Send second message
          await twilioWrapper.sendMessage({
            body: messageForTextFirst2,
            from: toPhone,
            to: userPhone
          });
          
          // Generate XML response
          const xmlResponse = twilioWrapper.generateXMLResponse('<Response></Response>');
          
          // For test mode, return test results instead of XML
          if (testMode) {
            await db.markUserIntroAsSeen(user.id, req);
            return res.json({
              status: 'success',
              flow: 'first_time_text',
              testResults: twilioWrapper.getTestResults(),
              dbOperations: db.getTestDbOperations()
            });
          } else {
            res.set('Content-Type', 'text/xml');
            return res.send(xmlResponse);
          }
        } else {
          await db.markUserIntroAsSeen(user.id, req);
          return res.json({
            status: 'intro_sent',
            flow: 'first_time_text',
            messages: [messageForTextFirst1, messageForTextFirst2]
          });
        }
      }

      // Mark the user as having seen intro
      await db.markUserIntroAsSeen(user.id, req);
      // End here so we don't transcribe anything yet
      return;
    }

    // If no media is provided, send a welcome message
    if (numMedia === 0) {
      logDetails('No media, sending welcome message');
      const welcomeMessage = await getLocalizedMessage('welcome', userLang, context);
      
      if (twilioIsAvailable) {
        await twilioWrapper.sendMessage({
          body: welcomeMessage,
          from: toPhone,
          to: userPhone
        });
        
        // Generate XML response
        const xmlResponse = twilioWrapper.generateXMLResponse('<Response></Response>');
        
        // For test mode, return test results instead of XML
        if (testMode) {
          return res.json({
            status: 'success',
            flow: 'welcome_message',
            message: welcomeMessage,
            language: userLang,
            testResults: twilioWrapper.getTestResults(),
            dbOperations: db.getTestDbOperations()
          });
        } else {
          res.set('Content-Type', 'text/xml');
          return res.send(xmlResponse);
        }
      } else {
        return res.json({
          status: 'success',
          flow: 'welcome_message',
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
        
        if (twilioIsAvailable) {
          await twilioWrapper.sendMessage({
            body: sendAudioMessage,
            from: toPhone,
            to: userPhone
          });
          
          // Generate XML response
          const xmlResponse = twilioWrapper.generateXMLResponse('<Response></Response>');
          
          // For test mode, return test results instead of XML
          if (testMode) {
            return res.json({
              status: 'success',
              flow: 'non_audio_media',
              message: sendAudioMessage,
              testResults: twilioWrapper.getTestResults(),
              dbOperations: db.getTestDbOperations()
            });
          } else {
            res.set('Content-Type', 'text/xml');
            return res.send(xmlResponse);
          }
        } else {
          return res.status(400).json({
            status: 'error',
            flow: 'non_audio_media',
            message: sendAudioMessage
          });
        }
      }

      logDetails('Processing voice note...');

      // Check user credits
      const creditStatus = await db.checkUserCredits(userPhone, req);
      logDetails('Credit status check result', creditStatus);
      
      if (!creditStatus.canProceed) {
        logDetails(`User ${userPhone} has no credits left`);
        const paymentMessage = await getLocalizedMessage('needCredits', userLang, context) ||
          "You've used all your free transcriptions. To continue using Josephine, please send £2 to purchase 50 more transcriptions.";
        
        if (twilioIsAvailable) {
          await twilioWrapper.sendMessage({
            body: paymentMessage,
            from: toPhone,
            to: userPhone
          });
          
          // Generate XML response
          const xmlResponse = twilioWrapper.generateXMLResponse('<Response></Response>');
          
          // For test mode, return test results instead of XML
          if (testMode) {
            return res.json({
              status: 'success',
              flow: 'no_credits',
              message: paymentMessage,
              credits: creditStatus,
              testResults: twilioWrapper.getTestResults(),
              dbOperations: db.getTestDbOperations()
            });
          } else {
            res.set('Content-Type', 'text/xml');
            return res.send(xmlResponse);
          }
        } else {
          return res.json({
            status: 'error',
            flow: 'no_credits',
            message: paymentMessage,
            credits: creditStatus
          });
        }
      }

      // Check if this is the last credit and prepare warning if needed
      let creditWarning = '';
      if (creditStatus.creditsRemaining === 1) {
        try {
          const userStats = await db.getUserStats(userPhone, req);
          const totalSecondsFormatted = Math.round(userStats.totalSeconds);
          const totalWordsFormatted = Math.round(userStats.totalWords);
          const totalTranscriptionsFormatted = userStats.totalTranscriptions;
          
          creditWarning = `\n\n❗ Hi! Josephine here with a little heads-up 👋 We've done ` +
            `${totalTranscriptionsFormatted} voice notes together—about ${totalWordsFormatted} words, ` +
            `saving you ~${totalSecondsFormatted} seconds of listening! You have one free transcription left. ` +
            `After that, I'll ask for a small contribution to keep going. Thanks for letting me help!`;
          
        } catch (statsError) {
          logDetails('Error getting user stats for credit warning', statsError);
          // If there's an error, skip the warning
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
        const { data: audioData, contentLength } = await downloadAudio(mediaUrl, authHeaders, req);
        
        // Prepare form data for Whisper API
        const formData = prepareFormData(audioData, mediaContentType);
        
        // Transcribe the audio
        const transcription = await transcribeAudio(formData, process.env.OPENAI_API_KEY, req);
        
        // Check for prohibited content
        const moderationResult = await checkContentModeration(transcription, process.env.OPENAI_API_KEY);
        if (moderationResult.flagged) {
          logDetails('Content moderation flagged this transcription', moderationResult);
          
          // Get a localized message about content violation
          const contentViolationMessage = await getLocalizedMessage('contentViolation', userLang, context);
          
          if (twilioIsAvailable) {
            await twilioWrapper.sendMessage({
              body: contentViolationMessage,
              from: toPhone,
              to: userPhone
            });
            
            // Generate XML response
            const xmlResponse = twilioWrapper.generateXMLResponse('<Response></Response>');
            
            // For test mode, return test results instead of XML
            if (testMode) {
              return res.json({
                status: 'success',
                flow: 'content_violation',
                message: contentViolationMessage,
                moderation: {
                  flagged: true,
                  categories: moderationResult.categories
                },
                testResults: twilioWrapper.getTestResults(),
                dbOperations: db.getTestDbOperations()
              });
            } else {
              res.set('Content-Type', 'text/xml');
              return res.send(xmlResponse);
            }
          } else {
            return res.json({
              status: 'error',
              flow: 'content_violation',
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
          finalMessage += `${summaryLabel.trim()} ${summary}\n\n`;
        }
        
        const transcriptionLabel = await getLocalizedMessage('transcription', userLang, context);
        // Make sure we don't add an extra emoji here - just use what's in the label
        finalMessage += `${transcriptionLabel.trim()}\n${transcription}`;
        
        if (creditWarning) {
          finalMessage += creditWarning;
        }

        // Split the message if needed
        const messageParts = splitLongMessage(finalMessage);
        
        // Calculate costs
        const costs = calculateCosts(contentLength, messageParts.length);
        
        // First send the message, then update database
        if (twilioIsAvailable) {
          try {
            // Send the messages
            await sendMessages(twilioWrapper, messageParts, userPhone, toPhone);
            
            // Only after successful send, update the database
            logDetails('Recording transcription in database');
            await db.recordTranscription(
              userPhone,
              costs.audioLengthSeconds,
              transcription.split(/\s+/).length,
              costs.openAICost,
              costs.twilioCost,
              req
            );
            logDetails('Transcription recorded in database');
            
            // Generate XML response
            const xmlResponse = twilioWrapper.generateXMLResponse('<Response></Response>');
            
            // For test mode, return test results instead of XML
            if (testMode) {
              return res.json({
                status: 'success',
                flow: 'successful_transcription',
                summary: summary,
                transcription: transcription,
                message: finalMessage,
                costs: costs,
                credits: creditStatus.creditsRemaining,
                testResults: twilioWrapper.getTestResults(),
                dbOperations: db.getTestDbOperations()
              });
            } else {
              res.set('Content-Type', 'text/xml');
              return res.send(xmlResponse);
            }
          } catch (twilioError) {
            logDetails('Error sending message via Twilio:', twilioError);
            return res.status(500).json({
              status: 'error',
              flow: 'twilio_error',
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
            costs.twilioCost,
            req
          );
          logDetails('Transcription recorded in database');
          
          return res.json({
            status: 'success',
            flow: 'successful_transcription',
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
        
        if (twilioIsAvailable) {
          await twilioWrapper.sendMessage({
            body: errorMessage,
            from: toPhone,
            to: userPhone
          });
          
          // Generate XML response
          const xmlResponse = twilioWrapper.generateXMLResponse('<Response></Response>');
          
          // For test mode, return test results instead of XML
          if (testMode) {
            return res.json({
              status: 'error',
              flow: 'processing_error',
              message: errorMessage,
              error: processingError.message,
              testResults: twilioWrapper.getTestResults(),
              dbOperations: db.getTestDbOperations()
            });
          } else {
            res.set('Content-Type', 'text/xml'); 
            return res.send(xmlResponse);
          }
        } else {
          return res.status(500).json({
            status: 'error',
            flow: 'processing_error',
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
