// src/controllers/transcription.js
const { getUserLanguage, getLocalizedMessage, exceedsWordLimit } = require('../helpers/localization');
const { generateSummary } = require('../helpers/transcription');
const userService = require('../services/user-service');
const { downloadAudio, prepareFormData } = require('../services/audio-service');
const { transcribeAudio, calculateCosts } = require('../services/transcription-service');
const { checkContentModeration } = require('../services/moderation-service');
const { splitLongMessage, sendMessages } = require('../services/messaging-service');
const { formatTestResponse, formatErrorResponse, formatSuccessResponse } = require('../utils/response-formatter');
const { logDetails } = require('../utils/logging-utils');

// Import the new credit manager and referral service
const creditManager = require('../services/credit-manager');
const referralService = require('../services/referral-service');

/**
 * Handle non-audio media
 */
async function handleNonAudioMedia(req, res) {
  const event = req.body || {};
  const userPhone = event.From || 'unknown';
  const toPhone = event.To || process.env.TWILIO_PHONE_NUMBER;
  const userLang = getUserLanguage(userPhone);
  const twilioClient = req.twilioClient;
  
  const sendAudioMessage = await getLocalizedMessage('sendAudio', userLang);
  
  if (twilioClient.isAvailable()) {
    await twilioClient.sendMessage({
      body: sendAudioMessage,
      from: toPhone,
      to: userPhone
    });
    
    // For test mode, return test results instead of XML
    if (req.isTestMode) {
      return formatTestResponse(res, {
        flow: 'non_audio_media',
        message: sendAudioMessage,
        testResults: twilioClient.getTestResults()
      });
    } else {
      // Generate XML response for Twilio
      const xmlResponse = twilioClient.generateXMLResponse('<Response></Response>');
      res.set('Content-Type', 'text/xml');
      return res.send(xmlResponse);
    }
  } else {
    return formatErrorResponse(res, 400, sendAudioMessage, {
      flow: 'non_audio_media'
    });
  }
}

/**
 * Handle transcription of voice note
 */
async function handleVoiceNote(req, res) {
  const event = req.body || {};
  const userPhone = event.From || 'unknown';
  const toPhone = event.To || process.env.TWILIO_PHONE_NUMBER;
  const userLang = getUserLanguage(userPhone);
  const twilioClient = req.twilioClient;
  const mediaContentType = event.MediaContentType0;
  const mediaUrl = event.MediaUrl0;
  const numMedia = parseInt(event.NumMedia || 0);
  
  // NEW: Check if this is a text message with a potential referral code
  if (numMedia === 0 && event.Body) {
    const potentialReferralCode = referralService.extractReferralCodeFromMessage(event.Body);
    
    if (potentialReferralCode) {
      try {
        logDetails('Potential referral code detected:', potentialReferralCode);
        
        // Process the referral code
        const referralResult = await referralService.processReferralCode(
          potentialReferralCode, 
          req.user, 
          req
        );
        
        if (referralResult.success) {
          logDetails('Referral code processed successfully:', {
            referrerId: referralResult.referrer.id,
            refereeId: referralResult.referee.id,
            referrerCreditsAdded: referralResult.referrerCreditsAdded,
            refereeCreditsAdded: referralResult.refereeCreditsAdded
          });
          
          // Send success message to the person who entered the code
          await referralService.sendReferralSuccessMessage(
            twilioClient, 
            userPhone, 
            toPhone, 
            referralResult, 
            req
          );
        } else {
          logDetails('Referral code processing failed:', referralResult);
          
// Get the appropriate error message key based on the error type
const errorKey = 
  referralResult.error === 'INVALID_CODE' ? 'referralInvalid' : 
  referralResult.error === 'SELF_REFERRAL' ? 'referralSelfUse' : 
  referralResult.error === 'CODE_MAXED_OUT' ? 'referralCodeMaxedOut' :
  'referralAlreadyUsed';

const errorMessage = await getLocalizedMessage(errorKey, userLang);

await twilioClient.sendMessage({
  body: errorMessage,
  from: toPhone,
  to: userPhone
});
        }
        
        // Generate appropriate response based on test mode
        if (req.isTestMode) {
          return formatTestResponse(res, {
            flow: 'referral_code_processed',
            success: referralResult.success,
            result: referralResult,
            testResults: twilioClient.getTestResults()
          });
        } else {
          // Generate XML response for Twilio
          const xmlResponse = twilioClient.generateXMLResponse('<Response></Response>');
          res.set('Content-Type', 'text/xml');
          return res.send(xmlResponse);
        }
      } catch (error) {
        logDetails('Error processing referral code:', error);
        // If there's an error, we'll continue with normal processing
      }
    }
  }
  
  logDetails('Processing voice note...');
  
  // Check user credits
  const creditStatus = await userService.checkUserCredits(userPhone, req);
  logDetails('Credit status check result', creditStatus);
  
  if (!creditStatus.canProceed) {
    logDetails(`User ${userPhone} has no credits left`);
    const paymentMessage = await getLocalizedMessage('needCredits', userLang) ||
      "You've used all your free transcriptions. To continue using Josephine, please send £2 to purchase 50 more transcriptions.";
    
    if (twilioClient.isAvailable()) {
      await twilioClient.sendMessage({
        body: paymentMessage,
        from: toPhone,
        to: userPhone
      });
      
      // For test mode, return test results instead of XML
      if (req.isTestMode) {
        return formatTestResponse(res, {
          flow: 'no_credits',
          message: paymentMessage,
          credits: creditStatus,
          testResults: twilioClient.getTestResults()
        });
      } else {
        // Generate XML response for Twilio
        const xmlResponse = twilioClient.generateXMLResponse('<Response></Response>');
        res.set('Content-Type', 'text/xml');
        return res.send(xmlResponse);
      }
    } else {
      return formatErrorResponse(res, 402, paymentMessage, {
        flow: 'no_credits',
        credits: creditStatus
      });
    }
  }

  // Check if this is the last credit and prepare warning if needed
  let creditWarning = '';
  if (creditStatus.creditsRemaining === 1) {
    try {
      const userStats = await userService.getUserStats(userPhone, req);
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
      const contentViolationMessage = await getLocalizedMessage('contentViolation', userLang);
      
      if (twilioClient.isAvailable()) {
        await twilioClient.sendMessage({
          body: contentViolationMessage,
          from: toPhone,
          to: userPhone
        });
        
        // For test mode, return test results instead of XML
        if (req.isTestMode) {
          return formatTestResponse(res, {
            flow: 'content_violation',
            message: contentViolationMessage,
            moderation: {
              flagged: true,
              categories: moderationResult.categories
            },
            testResults: twilioClient.getTestResults()
          });
        } else {
          // Generate XML response for Twilio
          const xmlResponse = twilioClient.generateXMLResponse('<Response></Response>');
          res.set('Content-Type', 'text/xml');
          return res.send(xmlResponse);
        }
      } else {
        return formatErrorResponse(res, 403, contentViolationMessage, {
          flow: 'content_violation',
          moderation: {
            flagged: true,
            categories: moderationResult.categories
          }
        });
      }
    }

    // Generate summary for long transcriptions
    let summary = null;
    // Special handling for test mode with longTranscription=true
    if (req.isTestMode && req.body && req.body.longTranscription === 'true') {
      logDetails('Forcing summary generation for test with longTranscription=true');
      summary = "This is a test summary of the transcription. The main points discussed include testing functionality, mock data generation, and verification of the summary feature.";
    } else if (exceedsWordLimit(transcription, 150)) {
      logDetails('Generating summary for long transcription');
      summary = await generateSummary(transcription, userLang);
      logDetails('Summary generated', { summary });
    }

    // Prepare the final message
    let finalMessage = '';
    if (summary) {
      const summaryLabel = await getLocalizedMessage('longMessage', userLang);
      finalMessage += `${summaryLabel.trim()} ${summary}\n\n`;
    }
    
    const transcriptionLabel = await getLocalizedMessage('transcription', userLang);
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
    if (twilioClient.isAvailable()) {
      try {
        // Send the messages
        await sendMessages(twilioClient, messageParts, userPhone, toPhone);
        
        // Only after successful send, update the database
        logDetails('Recording transcription in database');
        const dbResult = await userService.recordTranscription(
          userPhone,
          costs.audioLengthSeconds,
          transcription.split(/\s+/).length,
          costs.openAICost,
          costs.twilioCost,
          req
        );
        logDetails('Transcription recorded in database');
        
        // NEW: Check if user should get a referral code (4 credits left and on free trial)
        // Get the updated user data from the database operation
        const updatedUserData = dbResult.user;
        
        if (creditManager.shouldGenerateReferralCode(updatedUserData)) {
          try {
            logDetails('Generating referral code for user with 4 credits left');
            // Generate referral code if user doesn't have one
            await referralService.generateReferralCodeForUser(
              updatedUserData.id, 
              req
            );
          } catch (error) {
            logDetails('Error generating referral code:', error);
          }
        }
        
        // NEW: Check if user is down to their last credit to send referral info
        if (updatedUserData.credits_remaining === 1) {
          try {
            logDetails('User has 1 credit left, sending referral information');
            
            // Get the user's referral code
            const userReferralCode = updatedUserData.referral_code;
            
            // If no code is stored yet (unlikely but possible due to race conditions)
            // generate one now
            const referralCode = userReferralCode || 
              await referralService.generateReferralCodeForUser(updatedUserData.id, req);
            
            // Calculate estimated usage
            const estimatedMonths = await creditManager.calculateUsageEstimate(
              updatedUserData.id, 
              req
            );
            
            // Send low credits message with referral info
            // This happens after the main transcription message
            await referralService.sendLowCreditsWithReferralInfo(
              twilioClient,
              userPhone,
              toPhone,
              updatedUserData,
              referralCode,
              estimatedMonths,
              req
            );
          } catch (error) {
            logDetails('Error sending low credits referral message:', error);
          }
        }
        
        // Generate XML response
        const xmlResponse = twilioClient.generateXMLResponse('<Response></Response>');
        
        // For test mode, return test results instead of XML
        if (req.isTestMode) {
          return formatTestResponse(res, {
            flow: 'successful_transcription',
            summary: summary,
            transcription: transcription,
            message: finalMessage,
            costs: costs,
            credits: creditStatus.creditsRemaining,
            testResults: twilioClient.getTestResults()
          });
        } else {
          res.set('Content-Type', 'text/xml');
          return res.send(xmlResponse);
        }
      } catch (twilioError) {
        logDetails('Error sending message via Twilio:', twilioError);
        return formatErrorResponse(res, 500, 'Failed to send transcription', {
          flow: 'twilio_error',
          error: twilioError.message
        });
      }
    } else {
      logDetails('No Twilio client - returning JSON response');
      
      // For API mode, still record the transcription
      logDetails('Recording transcription in database');
      await userService.recordTranscription(
        userPhone,
        costs.audioLengthSeconds,
        transcription.split(/\s+/).length,
        costs.openAICost,
        costs.twilioCost,
        req
      );
      logDetails('Transcription recorded in database');
      
      return formatSuccessResponse(res, {
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
      errorMessage = await getLocalizedMessage('rateLimited', userLang);
    } else if (processingError.code === 'ECONNABORTED' || processingError.message.includes('timeout')) {
      errorMessage = await getLocalizedMessage('processingTimeout', userLang);
    } else {
      errorMessage = await getLocalizedMessage('apiError', userLang);
    }
    
    if (twilioClient.isAvailable()) {
      await twilioClient.sendMessage({
        body: errorMessage,
        from: toPhone,
        to: userPhone
      });
      
      // For test mode, return test results instead of XML
      if (req.isTestMode) {
        return formatTestResponse(res, {
          flow: 'processing_error',
          message: errorMessage,
          error: processingError.message,
          testResults: twilioClient.getTestResults()
        });
      } else {
        // Generate XML response for Twilio
        const xmlResponse = twilioClient.generateXMLResponse('<Response></Response>');
        res.set('Content-Type', 'text/xml'); 
        return res.send(xmlResponse);
      }
    } else {
      return formatErrorResponse(res, 500, errorMessage, {
        flow: 'processing_error',
        error: processingError.message
      });
    }
  }
}

module.exports = {
  handleNonAudioMedia,
  handleVoiceNote
};
