// routes/transcribe.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const Twilio = require('twilio');
const db = require('../helpers/database');

// Import helper functions from your helpers
const { getLocalizedMessage, getUserLanguage, exceedsWordLimit } = require('../helpers/localization');
const { generateSummary } = require('../helpers/transcription');

// Helper function for enhanced logging
function logDetails(message, obj = null) {
  console.log(`[${new Date().toISOString()}] ${message}`);
  if (obj) {
    console.log(JSON.stringify(obj, null, 2));
  }
}

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
        res.set('Content-Type', 'text/xml'); 
        return res.send('<Response></Response>');
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
        logDetails('Processing voice note...');
        
        // Check if user has available credits
        const creditStatus = await db.checkUserCredits(userPhone);
        logDetails('Credit status check result', creditStatus);
        
        if (!creditStatus.canProceed) {
          logDetails(`User ${userPhone} has no credits left`);
          
          // Get payment message in user's language
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

        // Prepare credit warning if needed
        let creditWarning = '';
        if (creditStatus.warningLevel === 'warning') {
          creditWarning = `\n\n⚠️ You have ${creditStatus.creditsRemaining} credits remaining.`;
        } else if (creditStatus.warningLevel === 'urgent') {
          creditWarning = `\n\n❗ ATTENTION: Only ${creditStatus.creditsRemaining} credits left. Add more soon to continue using the service.`;
        }
        
        // Send processing message
        const processingMessage = await getLocalizedMessage('processing', userLang, context);
        if (twilioClient) {
          await twilioClient.messages.create({
            body: processingMessage,
            from: toPhone,
            to: userPhone
          });
        }
        
        // ENHANCED DEBUGGING STARTS HERE
        try {
          // Log OpenAI API key format validation (without revealing the key)
          logDetails('OpenAI API Key check', {
            exists: !!process.env.OPENAI_API_KEY,
            format: process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 5)}...${process.env.OPENAI_API_KEY.substring(process.env.OPENAI_API_KEY.length - 4)}` : 'missing',
            length: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0
          });

          // Log starting to download audio
          logDetails(`Starting audio download from: ${mediaUrl}`);
          
          // Download the audio file
          const audioResponse = await axios({
            method: 'get',
            url: mediaUrl,
            responseType: 'arraybuffer',
            timeout: 15000, // Set a timeout for the request
            headers: {
              'User-Agent': 'WhatsAppTranscriptionService/1.0'
            }
          });
          
          logDetails(`Audio download complete`, {
            contentType: mediaContentType,
            size: audioResponse.data.length,
            responseSizeBytes: audioResponse.headers['content-length']
          });
          
          // Prepare the audio data for OpenAI
          const formData = new FormData();
          
          // Add debug for form data
          logDetails('Creating form data for Whisper API');
          
          formData.append('file', Buffer.from(audioResponse.data), {
            filename: 'audio.ogg',
            contentType: mediaContentType
          });
          
          // Try the updated model name
          formData.append('model', 'whisper-1');
          // Add response format explicitly
          formData.append('response_format', 'json');
          
          logDetails('Preparing to call Whisper API with payload', {
            model: 'whisper-1',
            fileSize: audioResponse.data.length,
            fileType: mediaContentType
          });
          
          // Log the actual API key being used (first and last few characters only)
          const apiKeyPreview = `${process.env.OPENAI_API_KEY.substring(0, 5)}...${process.env.OPENAI_API_KEY.substring(process.env.OPENAI_API_KEY.length - 4)}`;
          logDetails(`Using API key: ${apiKeyPreview}`);
          
          // Transcribe with OpenAI Whisper API
          logDetails('Sending request to OpenAI Whisper API...');
          const whisperResponse = await axios.post(
            'https://api.openai.com/v1/audio/transcriptions',
            formData,
            {
              headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                ...formData.getHeaders()
              },
              timeout: 30000 // 30-second timeout
            }
          );
          
          logDetails('Received successful response from Whisper API', {
            status: whisperResponse.status,
            hasText: !!whisperResponse.data.text
          });
          
          let transcription = whisperResponse.data.text.trim();
          logDetails(`Transcription result: ${transcription.substring(0, 50)}...`);
          
          let summary = null;
          
          // Calculate audio length in seconds (estimate if not available)
          // This would need to be replaced with actual audio length calculation
          const audioLengthBytes = audioResponse.headers['content-length'] || 0;
          const estimatedSeconds = Math.ceil(audioLengthBytes / 16000); // rough estimate
          
          // Generate summary for long transcripts
          if (exceedsWordLimit(transcription, 150)) {
            logDetails('Generating summary for long transcription');
            summary = await generateSummary(transcription, userLang, context);
            logDetails('Summary generated', { summary });
          }
          
          // Calculate costs
          const openAICost = estimatedSeconds / 60 * 0.006; // £0.006 per minute for Whisper API
          const twilioCost = 0.005; // Fixed cost assumption
          
          // Record the transcription in the database
          logDetails('Recording transcription in database');
          await db.recordTranscription(
            userPhone,
            estimatedSeconds,
            transcription.split(/\s+/).length, // Count words
            openAICost,
            twilioCost
          );
          logDetails('Transcription recorded in database');
          
          // Format the final message
          let finalMessage = '';
          
          if (summary) {
            const summaryLabel = await getLocalizedMessage('longMessage', userLang, context);
            finalMessage += `${summaryLabel}${summary}\n\n`;
          }
          
          const transcriptionLabel = await getLocalizedMessage('transcription', userLang, context);
          finalMessage += `${transcriptionLabel}${transcription}`;
          
          // Add credit warning if needed
          if (creditWarning) {
            finalMessage += creditWarning;
          }
          
          // Send the transcription
          logDetails('Sending transcription message to user');
          if (twilioClient) {
            await twilioClient.messages.create({
              body: finalMessage,
              from: toPhone,
              to: userPhone
            });
            logDetails('Transcription sent successfully');
            res.set('Content-Type', 'text/xml'); 
            return res.send('<Response></Response>');
          } else {
            logDetails('No Twilio client - returning JSON response');
            return res.json({
              status: 'success',
              summary: summary,
              transcription: transcription,
              message: finalMessage,
              credits: creditStatus.creditsRemaining
            });
          }
          
        } catch (audioError) {
          logDetails('ERROR PROCESSING AUDIO:');
          logDetails(`Error name: ${audioError.name}`);
          logDetails(`Error message: ${audioError.message}`);
          
          // Check if this is a network error
          if (audioError.code) {
            logDetails(`Network error code: ${audioError.code}`);
          }
          
          // If there's a response from the API with error details
          if (audioError.response) {
            logDetails(`API Response status: ${audioError.response.status}`);
            logDetails('API Response data:', audioError.response.data);
            
            // For 401 errors, log more details about authorization
            if (audioError.response.status === 401) {
              logDetails('Authentication failed with OpenAI API. Verify your API key is correct and has access to the Whisper API.');
            }
            // For 400 errors, log more details about request format
            else if (audioError.response.status === 400) {
              logDetails('Bad request to OpenAI API. Check audio format and request parameters.');
            }
          } else {
            logDetails('No response object available, likely a network or timeout error');
          }
          
          // Determine specific error type
          let errorMessage;
          
          if (audioError.response && audioError.response.status === 429) {
            errorMessage = await getLocalizedMessage('rateLimited', userLang, context);
          } else if (audioError.code === 'ECONNABORTED' || audioError.message.includes('timeout')) {
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
              error: audioError.message
            });
          }
        }
      } else {
        // Not an audio file
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
