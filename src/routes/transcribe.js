// src/routes/transcribe.js
const express = require('express');
const router = express.Router();

// Middleware
const { detectTestMode } = require('../middleware/test-mode');
const requestLogger = require('../middleware/request-logger');
const errorHandler = require('../middleware/error-handler');
const timeoutHandler = require('../middleware/timeout-handler'); // New timeout handler middleware

// Controllers
const firstTimeController = require('../controllers/first-time-user');
const welcomeController = require('../controllers/welcome');
const transcriptionController = require('../controllers/transcription');
const languageController = require('../controllers/language-test');

// Services
const userService = require('../services/user-service');
const { TwilioClientWrapper } = require('../services/twilio-service');
const referralService = require('../services/referral-service');

// Utils
const { logDetails } = require('../utils/logging-utils');
const { formatErrorResponse } = require('../utils/response-formatter');

// Apply middleware
router.use(detectTestMode);
router.use(requestLogger);
router.use(timeoutHandler); // Add timeout handler middleware

// Main route handler
router.post('/', async (req, res, next) => {
  try {
    const event = req.body || {};
    
    // Initialize Twilio client and make it available to controllers
    req.twilioClient = new TwilioClientWrapper(req);
    
    // Special test mode for language detection
    if (event.testLanguage === 'true') {
      return await languageController.handleLanguageTest(req, res);
    }
    
    // If MessageSid is not provided and not in test mode, return API info
    if (!event.MessageSid && !req.isTestMode) {
      return await welcomeController.handleApiInfo(req, res);
    }
    
    // Get user info
    const userPhone = event.From || 'unknown';
    logDetails(`Processing request for user: ${userPhone}`, {
      numMedia: event.NumMedia,
      messageType: event.MessageType,
      hasBody: !!event.Body
    });
    
    // Find or create user with timeout safety
    let userResult;
    try {
      userResult = await Promise.race([
        userService.findOrCreateUser(userPhone, req),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('User lookup timeout')), 5000)
        )
      ]);
    } catch (timeoutError) {
      logDetails('User lookup timed out, responding with timeout message');
      return formatErrorResponse(res, 503, 'Service temporarily unavailable, please try again');
    }
    
    req.user = userResult.user;
    
    const numMedia = parseInt(event.NumMedia || 0);
    
    // First time user flows
    if (!req.user.has_seen_intro) {
      if (numMedia > 0 && event.MediaContentType0 && 
          event.MediaContentType0.startsWith('audio/')) {
        return await firstTimeController.handleFirstTimeUserVoice(req, res);
      } else {
        return await firstTimeController.handleFirstTimeUserText(req, res);
      }
    }
    
    // Regular user flows
    if (numMedia === 0) {
      // Check if this is a text message with a potential referral code
      if (event.Body) {
        logDetails(`[ROUTER DEBUG] Checking message body for referral code: "${event.Body}"`);
        
        const potentialReferralCode = referralService.extractReferralCodeFromMessage(event.Body);
        
        logDetails(`[ROUTER DEBUG] Referral extraction result: ${potentialReferralCode || 'null'}`);
        
        if (potentialReferralCode) {
          logDetails(`[ROUTER DEBUG] ✓ Processing referral code: ${potentialReferralCode}`);
          
          // Set timeout handler specific for referral processing
          req.onTimeout = function() {
            logDetails('Referral processing timed out - preparing fallback response');
          };
          
          return await transcriptionController.handleVoiceNote(req, res);
        } else {
          logDetails(`[ROUTER DEBUG] ✗ No referral code found, sending welcome message`);
        }
      }
      
      // Only send welcome if no referral code was found
      return await welcomeController.handleWelcomeMessage(req, res);
    } else if (numMedia > 0) {
      if (!event.MediaContentType0 || !event.MediaUrl0) {
        return formatErrorResponse(res, 400, 'Missing media content type or URL');
      }
      
      if (!event.MediaContentType0.startsWith('audio/')) {
        return await transcriptionController.handleNonAudioMedia(req, res);
      }
      
      return await transcriptionController.handleVoiceNote(req, res);
    }
    
    // Fallback for unexpected cases
    return formatErrorResponse(res, 400, 'Invalid request');
    
  } catch (error) {
    // If we've already sent a response (e.g. via timeout handler), don't try to send another one
    if (res.headersSent) {
      logDetails('Error occurred but response already sent:', error);
      return;
    }
    next(error);
  }
});

// Error handler
router.use(errorHandler);

module.exports = router;
