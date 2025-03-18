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
            content: `You are a helpful assistant that summarizes text in ${language.name}. Transform the transcription into a brief, clear summary that starts with the main objective. Use gender-neutral language (avoid personal pronouns like 'he' or 'she'), remove superfluous details, and keep it concise. The summary should clearly state the core purpose or request of the note right away.`
          },
          {
            role: "user",
            content: `Summarize this in ${language.name}: ${text}`
          }
        ],
        max_tokens: 150,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
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
