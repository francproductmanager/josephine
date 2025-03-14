// routes/transcribe.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const FormData = require('form-data');
const Twilio = require('twilio');

// Import helper functions from your helpers
const { getLocalizedMessage, detectCountryCode, getUserLanguage, exceedsWordLimit } = require('../helpers/localization');
const { generateSummary } = require('../helpers/transcription');

router.post('/', async (req, res) => {
  const event = req.body;

  const context = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ACCOUNT_SID: process.env.ACCOUNT_SID,
    AUTH_TOKEN: process.env.AUTH_TOKEN,
    getTwilioClient: function () {
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

        const form = new FormData();
        form.append('file', Buffer.from(mediaResponse.data), {
          filename: 'audio.ogg',
          contentType: mediaContentType
        });
        form.append('model', 'whisper-1');

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

        if (exceedsWordLimit(transcribedText)) {
          const summary = await generateSummary(transcribedText, userLang, context);
          const longMessage = await getLocalizedMessage('longMessage', userLang, context);
          const transMessage = await getLocalizedMessage('transcription', userLang, context);

          messageBody = `${longMessage}${summary}\n\n${transMessage}${transcribedText}`;
        } else {
          const transMessage = await getLocalizedMessage('transcription', userLang.code, context);
          messageBody = `${transMessage}${transcribedText}`;
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

module.exports = router;
