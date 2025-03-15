// 1. MODIFY THE FIRST MESSAGE SCENARIO (when user sends text first)
// Find this section in transcribe.js:

      } else {
        // SCENARIO A: First contact is text or non-audio
        // We DO NOT transcribe. Instead, we respond with T&C link and invite them to send audio.
        const messageForTextFirst1 = 
          `Hi! I'm Josephine, your friendly transcription assistant 👋. ` +
          `I turn voice notes into text so you can read them at your convenience.`;
          
        const messageForTextFirst2 = 
          `By sending audio, you confirm you've read and agreed to my Terms & Conditions ` +
          `https://tinyurl.com/josephine-Terms. Forward a voice note, and I'll do the rest!`;

        if (twilioClient) {
          // Send first message
          await twilioClient.messages.create({
            body: messageForTextFirst1,
            from: toPhone,
            to: userPhone
          });
          
          // Small delay to ensure messages arrive in order
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Send second message
          await twilioClient.messages.create({
            body: messageForTextFirst2,
            from: toPhone,
            to: userPhone
          });
          
          res.set('Content-Type', 'text/xml');
          res.send('<Response></Response>');
        } else {
          return res.json({
            status: 'intro_sent',
            messages: [messageForTextFirst1, messageForTextFirst2]
          });
        }
      }


// 2. MODIFY THE SECOND MESSAGE SCENARIO (when user sends voice note first)
// Find this section in transcribe.js:

      if (numMedia > 0 && event.MediaContentType0 && event.MediaContentType0.startsWith('audio/')) {
        // SCENARIO B: First contact is a voice note
        // We DO NOT transcribe. Instead, we respond with T&C link and ask them to resend.
        const messageForVoiceFirst1 = 
          `Hey there! I see you sent me a voice note 👋. ` +
          `Before I transcribe, I want to make sure you've checked my Terms & Conditions.`;
          
        const messageForVoiceFirst2 = 
          `By continuing to send audio, you're confirming you've read and agreed to my Terms & Conditions: ` +
          `https://tinyurl.com/josephine-Terms. Please forward your voice note again, and I'll transcribe it right away!`;

        if (twilioClient) {
          // Send first message
          await twilioClient.messages.create({
            body: messageForVoiceFirst1,
            from: toPhone,
            to: userPhone
          });
          
          // Small delay to ensure messages arrive in order
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Send second message
          await twilioClient.messages.create({
            body: messageForVoiceFirst2,
            from: toPhone,
            to: userPhone
          });
          
          res.set('Content-Type', 'text/xml');
          res.send('<Response></Response>');
        } else {
          // No Twilio client, return JSON
          return res.json({
            status: 'intro_sent',
            messages: [messageForVoiceFirst1, messageForVoiceFirst2]
          });
        }
      }


// 3. MODIFY THE TRANSCRIPTION OUTPUT TO FIX POTENTIAL DOUBLE EMOJI
// Find the section where you prepare the final message:

        // Prepare the final message
        let finalMessage = '';
        if (summary) {
          const summaryLabel = await getLocalizedMessage('longMessage', userLang, context);
          finalMessage += `${summaryLabel.trim()} ${summary}\n\n`;
        }
        
        const transcriptionLabel = await getLocalizedMessage('transcription', userLang, context);
        // Make sure we don't add an extra emoji here
        finalMessage += `${transcriptionLabel.trim()}\n${transcription}`;
        
        if (creditWarning) {
          finalMessage += creditWarning;
        }
