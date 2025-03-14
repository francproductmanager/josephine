// index.js

// Load environment variables from .env (if you later add one)
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const Twilio = require('twilio');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Helper Functions --- //

// Example: Detect country code (simplified)
function detectCountryCode(phoneNumber) {
  const number = phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
  // For demo, assume '1' for US and default otherwise
  return number.startsWith('1') ? '1' : 'default';
}

// Example: Determine user language based on phone number
function getUserLanguage(phoneNumber) {
  // For simplicity, return English always. Replace with your mapping if needed.
  return { code: 'en', name: 'English' };
}

// Check if text exceeds word limit
function exceedsWordLimit(text, limit = 150) {
  return text.split(/\s+/).length > limit;
}

// Placeholder for localized messages. Replace with your translation logic if desired.
async function getLocalizedMessage(messageKey, langCode, context) {
  const messages = {
    welcome: "Hello! I'm Josephine, your voice note transcription assistant.",
    processing: "I'm transcribing your voice note. This will take a moment...",
    error: "Sorry, I encountered an error while processing your voice note.",
    sendAudio: "Please send a voice note for transcription.",
    transcription: "Transcription:"
  };
  return messages[messageKey] || "Message not found";
}

// Placeholder for summary generation using OpenAI. Replace with your full implementation.
async function generateSummary(text, language, context) {
  // For now, just return a dummy summary.
  return "This is a summary of your voice note.";
}

// --- Routes --- //

// A simple route to check if the server is running.
app.get('/', (req, res) => {
  res.send('Josephine Transcription Service is running!');
});

// The /transcribe endpoint to process voice notes.
app.post('/transcribe', async (req, res) => {
  // In a real-world scenario, Twilio sends the event data in the request body.
  const event = req.body;
  
  // Create a context object from environment variables.
  const context = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ACCOUNT_SID: process.env.ACCOUNT_SID,
    AUTH_TOKEN: process.env.AUTH_TOKEN,
    getTwilioClient: function() {
      return Twilio(this.ACCOUNT_SID, this.AUTH_TOKEN);
    }
  };

  try {
    const userPhone = event.From;
    const userLang = getUserLanguage(userPhone);
    console.log(`Detected language for ${userPhone}: ${userLang.name} (${userLang.code})`);

    const numMedia = parseInt(event.NumMedia || 0);
    if (numMedia > 0) {
      const mediaContentType = event.MediaContentType0;
      if (mediaContentType && mediaContentType.startsWith('audio/')) {
        const mediaUrl = event.MediaUrl0;
        console.log('Processing voice note...');

        // Download the audio file
        const mediaResponse = await axios({
          method: 'get',
          url: mediaUrl,
          auth: {
            username: context.ACCOUNT_SID,
            password: context.AUTH_TOKEN
          },
          responseType: 'arraybuffer'
        });

        console.log('Audio downloaded, size:', mediaResponse.data.byteLength);

        // Prepare form data for the OpenAI transcription API
        const form = new FormData();
        form.append('file', Buffer.from(mediaResponse.data), {
          filename: 'audio.ogg',
          contentType: mediaContentType
        });
        form.append('model', 'whisper-1');

        // Call OpenAI API for transcription
        const openaiResponse = await axios.post(
          'https://api.openai.com/v1/audio/transcriptions',
          form,
          {
            headers: {
              'Authorization': `Bearer ${context.OPENAI_API_KEY}`,
              ...form.getHeaders()
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 30000
          }
        );

        const transcribedText = openaiResponse.data.text;
        let messageBody = '';

        // If transcription is too long, generate a summary.
        if (exceedsWordLimit(transcribedText)) {
          const summary = await generateSummary(transcribedText, userLang, context);
          const longMessage = await getLocalizedMessage('welcome', userLang.code, context); // Replace with 'longMessage' if available.
          const transMessage = await getLocalizedMessage('transcription', userLang.code, context);
          messageBody = `${longMessage}\n${summary}\n\n${transMessage}\n${transcribedText}`;
        } else {
          const transMessage = await getLocalizedMessage('transcription', userLang.code, context);
          messageBody = `${transMessage}\n${transcribedText}`;
        }

        return res.json({ success: true, message: messageBody });
      } else {
        const sendAudioMessage = await getLocalizedMessage('sendAudio', userLang.code, context);
        return res.json({ success: false, message: sendAudioMessage });
      }
    } else {
      const welcomeMessage = await getLocalizedMessage('welcome', userLang.code, context);
      return res.json({ success: true, message: welcomeMessage });
    }
  } catch (error) {
    console.error('Error encountered:', error.message);
    console.error('Error stack:', error.stack);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// --- Start the Server --- //
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
