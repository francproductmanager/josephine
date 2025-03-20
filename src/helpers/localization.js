// src/helpers/localization.js
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

/**
 * Retrieves a localized message and replaces placeholders with provided values.
 * @param {string} messageKey - The key for the message in the translations file.
 * @param {object} langObj - Object with language info (code and name).
 * @param {object} [context={}] - An object containing key-value pairs for placeholder replacement.
 * @returns {Promise<string>} - The localized message with placeholders replaced.
 */
async function getLocalizedMessage(messageKey, langObj, context = {}) {
  const langCode = (langObj && langObj.code) ? langObj.code : 'en';
  let message = translations[langCode] && translations[langCode][messageKey]
    ? translations[langCode][messageKey]
    : translations.en[messageKey] || "Message not found";

  // Replace placeholders in the format {placeholder} with actual values from context
  for (const [key, value] of Object.entries(context)) {
    const placeholder = new RegExp(`\\{${key}\\}`, 'g');
    message = message.replace(placeholder, value);
  }

  return message;
}

function detectCountryCode(phoneNumber) {
  if (!phoneNumber) {
    console.warn("Phone number is undefined or null");
    return 'default';
  }
  
  // Remove 'whatsapp:' prefix if present
  let cleanNumber = phoneNumber;
  if (cleanNumber.startsWith('whatsapp:')) {
    cleanNumber = cleanNumber.substring('whatsapp:'.length);
  }
  
  // Now handle the plus sign
  const number = cleanNumber.startsWith('+') ? cleanNumber.substring(1) : cleanNumber;
  
  console.log(`Debug - Original: ${phoneNumber}, Cleaned: ${cleanNumber}, Without +: ${number}`);
  
  for (let i = 3; i > 0; i--) {
    if (number.length >= i) {
      const potentialCode = number.substring(0, i);
      console.log(`Debug - Testing code: ${potentialCode}, Valid: ${!!countryLanguageMap[potentialCode]}`);
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
