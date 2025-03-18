// src/controllers/welcome.js
const { getUserLanguage, getLocalizedMessage } = require('../helpers/localization');
const { formatTestResponse, formatSuccessResponse } = require('../utils/response-formatter');
const { logDetails } = require('../utils/logging-utils');

/**
 * Handle API info request (no MessageSid, not test mode)
 */
async function handleApiInfo(req, res) {
  logDetails('Detected test request - providing helpful response');
  
  return formatSuccessResponse(res, {
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

/**
 * Handle welcome message (user exists, no media)
 */
async function handleWelcomeMessage(req, res) {
  const event = req.body || {};
  const userPhone = event.From || 'unknown';
  const toPhone = event.To || process.env.TWILIO_PHONE_NUMBER;
  const userLang = getUserLanguage(userPhone);
  const twilioClient = req.twilioClient;
  
  logDetails('No media, sending welcome message');
  
  const welcomeMessage = await getLocalizedMessage('welcome', userLang);
  
  if (twilioClient.isAvailable()) {
    await twilioClient.sendMessage({
      body: welcomeMessage,
      from: toPhone,
      to: userPhone
    });
    
    // For test mode, return test results instead of XML
    if (req.isTestMode) {
      return formatTestResponse(res, {
        flow: 'welcome_message',
        message: welcomeMessage,
        language: userLang,
        testResults: twilioClient.getTestResults(),
        dbOperations: req.testResults.dbOperations
      });
    } else {
      // Generate XML response for Twilio
      const xmlResponse = twilioClient.generateXMLResponse('<Response></Response>');
      res.set('Content-Type', 'text/xml');
      return res.send(xmlResponse);
    }
  } else {
    return formatSuccessResponse(res, {
      flow: 'welcome_message',
      message: welcomeMessage,
      language: userLang
    });
  }
}

module.exports = {
  handleApiInfo,
  handleWelcomeMessage
};
