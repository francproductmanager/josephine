# Josephine Transcription Service Backend

A Node.js/Express backend that powers a WhatsApp-based voice note transcription service. It receives Twilio webhook events, transcribes audio with OpenAI, and returns localized responses.

## Features

- WhatsApp webhook handling via Twilio
- Audio transcription and moderation checks using OpenAI
- Localization support for responses
- Test-mode hooks for simulated scenarios

## Project Structure

```
.
├── src/
│   ├── controllers/    # Request handlers and business logic
│   ├── helpers/        # Localization and transcription helpers
│   ├── middleware/     # Request processing utilities
│   ├── routes/         # Express route definitions
│   ├── services/       # External service integrations (e.g., Twilio)
│   └── utils/          # Shared utilities and logging
├── test/               # Test helpers and mocks
├── index.js            # Entry point (loads src/index.js)
└── package.json
```

## Requirements

- Node.js 18+
- A Twilio account (WhatsApp sandbox or production sender)
- OpenAI API key

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file and set the required environment variables:
   ```bash
   PORT=8080
   OPENAI_API_KEY=your_openai_api_key
   TWILIO_PHONE_NUMBER=whatsapp:+1234567890
   ACCOUNT_SID=your_twilio_account_sid
   AUTH_TOKEN=your_twilio_auth_token
   ```

3. Start the server:
   ```bash
   npm start
   ```

The server listens on `PORT` (default: `8080`).

## Test Mode

Test mode can be activated in three ways:

1. Setting the `x-test-mode: true` header
2. Adding `testMode=true` as a query parameter
3. Including `testMode=true` in the form data

Special test parameters:

- `testLanguage=true` - Test language detection
- `testNoCredits=true` - Simulate a user with no credits
- `testLowCredits=true` - Simulate a user with low credits
- `longTranscription=true` - Simulate a longer transcription

## Useful Scripts

- `npm start` - Run the server
- `npm run dev` - Run with nodemon
