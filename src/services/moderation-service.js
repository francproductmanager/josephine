// src/services/moderation-service.js
const axios = require('axios');
const { logDetails } = require('../utils/logging-utils');

async function checkContentModeration(text, apiKey) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/moderations',
      {
        input: text
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return {
      flagged: response.data.results[0].flagged,
      categories: response.data.results[0].categories,
      scores: response.data.results[0].category_scores
    };
  } catch (error) {
    logDetails('Error in content moderation:', error);
    // Default to allowing content if the moderation check fails
    return { flagged: false };
  }
}

module.exports = {
  checkContentModeration
};
