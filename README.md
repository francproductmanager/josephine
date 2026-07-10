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
│   ├── app.js          # Express app definition (shared by server + serverless)
│   ├── index.js        # Server entry point (Heroku / local dev)
│   ├── controllers/    # Request handlers and business logic
│   ├── core/           # Voice-note pipeline (Express-free, shared)
│   ├── helpers/        # Localization and transcription helpers
│   ├── middleware/     # Request processing utilities
│   ├── routes/         # Express route definitions
│   ├── services/       # External service integrations (e.g., Twilio)
│   └── utils/          # Shared utilities and logging
├── netlify/functions/  # Netlify deployment (sync webhook + background worker)
├── public/             # Static landing page (Netlify publish dir)
├── netlify.toml        # Netlify build config + /transcribe rewrite
├── index.js            # Entry point (loads src/index.js)
└── package.json
```

## Deployment

The app runs in two modes from the same codebase:

- **Server mode** (Heroku / any Node host): `npm start` runs the Express
  server; the whole pipeline executes inside the webhook request.
- **Netlify mode**: `netlify/functions/transcribe.js` acks the Twilio
  webhook instantly (signature-validated), dedupes on `MessageSid` via
  Netlify Blobs, and hands the pipeline to
  `transcribe-background.js` (15-minute budget). Fast flows (welcome,
  non-audio, test mode) are served by the same Express app via
  `serverless-http`. Point the Twilio webhook at
  `https://<site>/transcribe`.

Netlify-only environment variables (set in the Netlify UI, in addition
to the ones below): `INTERNAL_API_SECRET` (random 32+ chars; auth
between the two functions) and `TWILIO_WEBHOOK_URL` (the exact URL
configured in Twilio, used for signature validation). Set
`TWILIO_SIGNATURE_VALIDATION=off` only for local development.

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
