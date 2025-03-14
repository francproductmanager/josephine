// helpers/transcription.js
const axios = require('axios');

async function generateSummary(text, language, context) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are a helpful assistant that summarizes text in ${language.name}. Provide a single sentence summary.`
          },
          {
            role: "user",
            content: `Summarize this in ONE sentence in ${language.name}: ${text}`
          }
        ],
        max_tokens: 100,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${context.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error generating summary:', error);
    return null;
  }
}

module.exports = { generateSummary };
