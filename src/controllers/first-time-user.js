// src/controllers/first-time-user.js
const { getUserLanguage, getLocalizedMessage } = require('../helpers/localization');
const userService = require('../services/user-service');
const { formatTestResponse } = require('../utils/response-formatter');
const { logDetails } = require('../utils/logging-utils');

/**
 * Handle a first-time user sending a text message
 */
async function handleFirstTimeUserText(req, res) {
  const event = req.body || {};
  const userPhone = event.From || 'unknown';
  const toPhone = event.To || process.env.TWILIO_PHONE_NUMBER;
  const userLang = getUserLanguage(userPhone);
  const twilioClient = req.twilioClient;
  
  logDetails('Handling first-time user text message', { userPhone });
  
  // Get welcome messages
  const messageForTextFirst1 = await getLocalizedMessage('welcomeIntro', userLang);
  const messageForTextFirst2 = await getLocalizedMessage('termsIntro', userLang);
  
  if (twilioClient.isAvailable()) {
    // Send first message
    await twilioClient.sendMessage({
      body: messageForTextFirst1,
      from: toPhone,
      to: userPhone
    });
    
    // Small delay to ensure messages arrive in order (not in test mode)
    if (!req.isTestMode) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Send second message
    await twilioClient.sendMessage({
      body: messageForTextFirst2,
      from: toPhone,
      to: userPhone
    });
    
    // Mark the user as having seen intro
    await userService.markUserIntroAsSeen(req.user.id, req);
    
    // For test mode, return test results instead of XML
    if (req.isTestMode) {
      return formatTestResponse(res, {
        status: 'success',
        flow: 'first_time_text',
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
    // No Twilio client, return JSON
    await userService.markUserIntroAsSeen(req.user.id, req);
    return res.json({
      status: 'intro_sent',
      flow: 'first_time_text',
      messages: [messageForTextFirst1, messageForTextFirst2]
    });
  }
}

/**
 * Handle a first-time user sending a voice note
 */
async function handleFirstTimeUserVoice(req, res) {
  const event = req.body || {};
  const userPhone = event.From || 'unknown';
  const toPhone = event.To || process.env.TWILIO_PHONE_NUMBER;
  const userLang = getUserLanguage(userPhone);
  const twilioClient = req.twilioClient;
  
  logDetails('Handling first-time user voice message', { userPhone });
  
  // Get messages
  const messageForVoiceFirst1 = await getLocalizedMessage('voiceNoteIntro', userLang);
  const messageForVoiceFirst2 = await getLocalizedMessage('voiceNoteTerms', userLang);
  
  if (twilioClient.isAvailable()) {
    // Send first message
    await twilioClient.sendMessage({
      body: messageForVoiceFirst1,
      from: toPhone,
      to: userPhone
    });
    
    // Small delay to ensure messages arrive in order
    if (!req.isTestMode) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Send second message
    await twilioClient.sendMessage({
      body: messageForVoiceFirst2,
      from: toPhone,
      to: userPhone
    });
    
    // Mark the user as having seen intro
    await userService.markUserIntroAsSeen(req.user.id, req);
    
    // For test mode, return test results instead of XML
    if (req.isTestMode) {
      return formatTestResponse(res, {
        status: 'success',
        flow: 'first_time_voice_note',
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
    // No Twilio client, return JSON
    await userService.markUserIntroAsSeen(req.user.id, req);
    return res.json({
      status: 'intro_sent',
      flow: 'first_time_voice_note',
      messages: [messageForVoiceFirst1, messageForVoiceFirst2]
    });
  }
}

module.exports = {
  handleFirstTimeUserText,
  handleFirstTimeUserVoice
};
