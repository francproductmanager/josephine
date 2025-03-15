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
    // ... rest of the route handler code using the new service modules ...
    
    // (Continuing where we left off with the refactoring)
    
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
