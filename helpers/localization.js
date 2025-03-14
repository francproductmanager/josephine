// helpers/localization.js

const axios = require('axios');

const countryLanguageMap = {
  // Europe
  '43': { code: 'de', name: 'German' },
  '32': { code: 'fr', name: 'French' },
  '359': { code: 'bg', name: 'Bulgarian' },
  '420': { code: 'cs', name: 'Czech' },
  '45': { code: 'da', name: 'Danish' },
  '372': { code: 'et', name: 'Estonian' },
  '358': { code: 'fi', name: 'Finnish' },
  '33': { code: 'fr', name: 'French' },
  '49': { code: 'de', name: 'German' },
  '30': { code: 'el', name: 'Greek' },
  '36': { code: 'hu', name: 'Hungarian' },
  '353': { code: 'en', name: 'English' },
  '39': { code: 'it', name: 'Italian' },
  '371': { code: 'lv', name: 'Latvian' },
  '370': { code: 'lt', name: 'Lithuanian' },
  '352': { code: 'fr', name: 'French' },
  '356': { code: 'mt', name: 'Maltese' },
  '31': { code: 'nl', name: 'Dutch' },
  '48': { code: 'pl', name: 'Polish' },
  '351': { code: 'pt', name: 'Portuguese' },
  '40': { code: 'ro', name: 'Romanian' },
  '421': { code: 'sk', name: 'Slovak' },
  '386': { code: 'sl', name: 'Slovenian' },
  '34': { code: 'es', name: 'Spanish' },
  '46': { code: 'sv', name: 'Swedish' },
  '44': { code: 'en', name: 'English' },
  // Other regions
  '1': { code: 'en', name: 'English' },
  '52': { code: 'es', name: 'Spanish' },
  '55': { code: 'pt', name: 'Portuguese' },
  '86': { code: 'zh', name: 'Chinese' },
  '91': { code: 'hi', name: 'Hindi' },
  '81': { code: 'ja', name: 'Japanese' },
  // Default fallback
  'default': { code: 'en', name: 'English' }
};

const systemMessages = {
  welcome: "Hello! I'm Josephine, your voice note transcription assistant. Send me a voice note, and I'll transcribe it for you!",
  processing: "I'm transcribing your voice note. This will take a moment...",
  error: "Sorry, I encountered an error while processing your voice note. Please try again later.",
  longMessage: "📝 Quick Summary (long voice note):\n",
  transcription: "🤖 Transcription:\n\n",
  sendAudio: "Please send a voice note for transcription.",
  fileTooBig: "This voice note is too large to process. Please send a shorter message (under 45 seconds).",
  processingTimeout: "This voice note is taking too long to process. Please try a shorter message or try again later.",
  rateLimited: "Our service is experiencing high demand. Please try again in a few minutes.",
  apiError: "Sorry, there's a temporary issue with our service. Our team has been notified."
};

const translationCache = {};

async function getLocalizedMessage(messageKey, langCode, context) {
  const englishMessage = systemMessages[messageKey];
  
  if (langCode === 'en') {
    return englishMessage;
  }
  
  const cacheKey = `${messageKey}_${langCode}`;
  if (translationCache[cacheKey]) {
    return translationCache[cacheKey];
  }
  
  // Determine language name for translation
  const countryCode = detectCountryCode(langCode);
  const languageName = (countryLanguageMap[countryCode] || countryLanguageMap[langCode] || countryLanguageMap['default']).name;
  
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are a professional translator. Translate the text to ${languageName} accurately. Provide ONLY the translation, no other text.`
          },
          {
            role: "user",
            content: `Translate this to ${languageName}: ${englishMessage}`
          }
        ],
        max_tokens: 150,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${context.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const translation = response.data.choices[0].message.content.trim();
    translationCache[cacheKey] = translation;
    return translation;
  } catch (error) {
    console.error(`Translation error for ${langCode}:`, error);
    return englishMessage;
  }
}

function detectCountryCode(phoneNumber) {
  const number = phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
  for (let i = 3; i > 0; i--) {
    const potentialCode = number.substring(0, i);
    if (countryLanguageMap[potentialCode]) {
      return potentialCode;
    }
  }
  return 'default';
}

function getUserLanguage(phoneNumber) {
  const countryCode = detectCountryCode(phoneNumber);
  return countryLanguageMap[countryCode] || countryLanguageMap['default'];
}

function exceedsWordLimit(text, limit = 150) {
  return text.split(/\s+/).length > limit;
}

module.exports = {
  getLocalizedMessage,
  detectCountryCode,
  getUserLanguage,
  exceedsWordLimit
};
