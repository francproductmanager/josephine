// src/services/moderation-service.js
const { postJson } = require('../utils/http-client');
const { logDetails } = require('../utils/logging-utils');

async function checkContentModeration(text, apiKey, req = null) {
  // Return mock data for test mode (consistent with the other services —
  // test mode must never make real API calls)
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Simulating content moderation check');
    return { flagged: false, categories: {}, scores: {}, mockData: true };
  }

  try {
    const data = await postJson(
      'https://api.openai.com/v1/moderations',
      { input: text },
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );

    return {
      flagged: data.results[0].flagged,
      categories: data.results[0].categories,
      scores: data.results[0].category_scores
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
