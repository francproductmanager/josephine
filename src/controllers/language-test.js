// src/controllers/language-test.js
const { getUserLanguage, getLocalizedMessage } = require('../helpers/localization');
const { formatSuccessResponse, formatErrorResponse } = require('../utils/response-formatter');
const { logDetails } = require('../utils/logging-utils');

/**
 * Handle language detection test
 */
async function handleLanguageTest(req, res) {
  const event = req.body || {};
  const userPhone = event.From || '+1234567890';
  const userLang = getUserLanguage(userPhone);
  
  logDetails(`LANGUAGE TEST: Detected language for ${userPhone}: ${userLang.name} (${userLang.code})`);
  
  try {
    const welcomeMessage = await getLocalizedMessage('welcome', userLang);
    
    return formatSuccessResponse(res, {
      test_type: 'language_detection',
      phone: userPhone,
      detected_language: userLang,
      translated_message: welcomeMessage
    });
  } catch (translationError) {
    console.error('Translation error:', translationError);
    
    return formatErrorResponse(res, 500, 'Translation failed', {
      test_type: 'language_detection',
      error: translationError.message
    });
  }
}

module.exports = {
  handleLanguageTest
};
