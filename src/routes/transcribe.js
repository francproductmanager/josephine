// src/routes/transcribe.js
const express = require('express');
const router = express.Router();

// Middleware
const { detectTestMode } = require('../middleware/test-mode');
const requestLogger = require('../middleware/request-logger');
const errorHandler = require('../middleware/error-handler');

// Controllers
const firstTimeController = require('../controllers/first-time-user');
const welcomeController = require('../controllers/welcome');
const transcriptionController = require('../controllers/transcription');
const languageController = require('../controllers/language-test');

// Services
const userService = require('../services/user-service');
const { TwilioClientWrapper } = require('../services/twilio-service');

// Utils
const { logDetails } = require('../utils/logging-utils');
const { formatErrorResponse } = require('../utils/response-formatter');

// Apply middleware
router.use(detectTestMode);
router.use(requestLogger);

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
    const { user } = await userService.findOrCreateUser(userPhone, req);
    req.user = user;
    
    const numMedia = parseInt(event.NumMedia || 0);
    
    // First time user flows
    if (!user.has_seen_intro) {
      if (numMedia > 0 && event.MediaContentType0 && 
          event.MediaContentType0.startsWith('audio/')) {
        return await firstTimeController.handleFirstTimeUserVoice(req, res);
      } else {
        return await firstTimeController.handleFirstTimeUserText(req, res);
      }
    }
    
    // Regular user flows
    if (numMedia === 0) {
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
    next(error);
  }
});

// Error handler
router.use(errorHandler);

module.exports = router;
