// helpers/localization.js
const axios = require('axios');
const translations = require('./languages.json');

const countryLanguageMap = {
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
  '1': { code: 'en', name: 'English' },
  '52': { code: 'es', name: 'Spanish' },
  '55': { code: 'pt', name: 'Portuguese' },
  '86': { code: 'zh', name: 'Chinese' },
  '91': { code: 'hi', name: 'Hindi' },
  '81': { code: 'ja', name: 'Japanese' },
  'default': { code: 'en', name: 'English' }
};

async function getLocalizedMessage(messageKey, langObj, context) {
  const langCode = (langObj && langObj.code) ? langObj.code : 'en';
  // Return hardcoded translation if available
  if (translations[langCode] && translations[langCode][messageKey]) {
    return translations[langCode][messageKey];
  }
  // Fallback to English message
  const englishMessage = translations.en[messageKey] || "Message not found";
  // Use OpenAI translation as a last resort
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are a professional translator. Translate the following text into ${langObj ? langObj.name : 'the target language'} accurately. Provide ONLY the translation, no additional text.`
          },
          {
            role: "user",
            content: `Translate this to ${langObj ? langObj.name : 'the target language'}: ${englishMessage}`
          }
        ],
        max_tokens: 150,
        temperature: 0.3
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const translation = response.data.choices[0].message.content.trim();
    return translation;
  } catch (error) {
    console.error(`Translation error for ${langCode}:`, error);
    return englishMessage;
  }
}

function detectCountryCode(phoneNumber) {
  if (!phoneNumber) {
    console.warn("Phone number is undefined or null");
    return 'default';
  }
  const number = phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
  for (let i = 3; i > 0; i--) {
    if (number.length >= i) {
      const potentialCode = number.substring(0, i);
      if (countryLanguageMap[potentialCode]) {
        return potentialCode;
      }
    }
  }
  return 'default';
}

function getUserLanguage(phoneNumber) {
  const countryCode = detectCountryCode(phoneNumber);
  return countryLanguageMap[countryCode] || countryLanguageMap['default'];
}

function exceedsWordLimit(text, limit = 150) {
  if (!text) return false;
  return text.split(/\s+/).length > limit;
}

module.exports = {
  getLocalizedMessage,
  detectCountryCode,
  getUserLanguage,
  exceedsWordLimit
};
