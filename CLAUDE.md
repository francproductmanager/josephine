# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Josephine: a WhatsApp voice-note transcription service. Users send a voice note to a WhatsApp number; Twilio webhooks the audio here; OpenAI transcribes (and summarizes if >150 words); the reply goes back over WhatsApp via the Twilio REST API. Free and **deliberately stateless** — no database, no user accounts, no credits. A complete paid version (credits + referrals + Postgres) once existed and was intentionally removed; it is preserved at the git tag `archive/testing-applications` if ever needed.

## Commands

```bash
npm start        # run the Express server locally (port 8080 / $PORT)
npm run dev      # same, with nodemon
npm test         # offline test suite (Node built-in runner, no test deps)

# single test file:
node --test test/localization.test.js

# run functions on the real Netlify runtime locally:
npx netlify functions:serve --port 9999
```

`npm test` lists test files explicitly in package.json — `node --test <dir>` is broken on Windows, and bare `node --test` wrongly sweeps in `src/controllers/language-test.js` and `src/middleware/test-mode.js` (they match `*-test.js`/`test-*.js` discovery patterns). When adding a test file, add it to the `test` script.

CI (GitHub Actions, `.github/workflows/ci.yml`) runs `npm test` on every PR and push to main. Tests run fully offline with no API keys.

## Dual deployment — the core architectural fact

The same codebase runs two ways, and **both must keep working**:

1. **Express server** (`npm start` → `index.js` → `src/index.js` → `src/app.js`): the whole pipeline runs synchronously inside the webhook request. Used for local dev, and was the Heroku production mode (Heroku kept as rollback until ~2026-07-18).
2. **Netlify Functions** (production since 2026-07-11, site `josephine-transcriber.netlify.app`): Netlify sync functions time out at 10s but the pipeline takes 20–40s, so it is split:
   - `netlify/functions/transcribe.js` — sync webhook. Validates the Twilio signature, dedups on MessageSid, POSTs the params to the background function (with `x-internal-token` shared-secret header), and acks Twilio with empty TwiML in <2s. Everything that is fast (welcome, non-audio, API info, language test, **all test-mode flows**) is delegated to the unchanged Express app via `serverless-http` (path is normalized to `/transcribe` before delegation).
   - `netlify/functions/transcribe-background.mjs` — background worker (`-background` suffix = 15-min budget; invocations ack 202 immediately; Netlify auto-retries failed runs after 1 min then 2 min). Runs the pipeline, updates the dedup marker, alerts the operator on errors.

The user-visible reply is **always sent via the Twilio REST API, never via the TwiML response** (TwiML returned is always the empty `<Response></Response>`). That is what makes the background split possible with zero UX change.

`netlify.toml` rewrites `/transcribe` → `/.netlify/functions/transcribe` with `status = 200, force = true` (a proxy, not a redirect — Twilio never sees a 3xx and the public URL stays stable).

## The shared pipeline and the context-object convention

`src/core/voice-note-pipeline.js` (`processVoiceNote(context)`) is the heart: download → size guard → transcribe → (moderation ∥ summary via `Promise.all`) → split → send, including localized error handling. It is **Express-free by design** — callable from both the Express controller and the background worker. It sends all user messages itself and returns a result object `{ flow, twilioAvailable, message, transcription?, summary?, moderation?, error?, statusCode? }`; callers only map that onto their HTTP response. Flows: `successful_transcription | content_violation | processing_error | twilio_error | file_too_big`.

The pipeline `context` is a req-like object: `{ body, isTestMode, testResults, twilioClient }`. An Express `req` is a valid context. Every service (`audio-service`, `transcription-service`, `moderation-service`, `TwilioClientWrapper`) accepts this object and reads only those fields — preserve that contract when touching services.

Response contract worth knowing: a successful short-note test response includes `summary: null` (the key is always present). Tests enforce this.

## Netlify Blobs / idempotency — hard-won constraints

Store `processed-messages`, key = MessageSid. Marker lifecycle: `dispatched → processing → done | failed | retrying`. `retrying` is set when the pipeline succeeded but the Twilio send failed — the worker then **throws** so Netlify's auto-retry re-runs it (user got nothing yet). `failed`/`file_too_big` are terminal (user already got a localized message — never re-spend).

- **Strong-consistency reads are impossible in Lambda-style (v1) functions.** `connectLambda(event)` provides only `edgeURL` + `token`, never the `uncachedEdgeURL` strong reads require (verified in `@netlify/blobs` source). This is why the background worker is a **v2 function** (`.mjs`, default export, Request/Response — gets full context automatically) and is the authoritative dedup gate, while the sync webhook stays v1 (serverless-http needs Lambda events) doing a best-effort **eventual**-consistency check.
- Every Blobs access is **fail-open**: a Blobs outage must never block a transcription (worst case = a rare duplicate). Local runs always fail-open (no Blobs context) — that is expected, not a bug.

## Twilio signature validation gotchas

- Signature is computed over the **exact** public URL. Validation uses env `TWILIO_WEBHOOK_URL` (fallback `event.rawUrl`) — a trailing slash or wrong value breaks it (this caused a failed first cutover). Must match the URL configured in Twilio character-for-character.
- Signatures are computed with the **primary** auth token only; a secondary token works for REST calls but fails validation.
- Test-mode requests bypass validation (they are mocked end-to-end and spend nothing). Requests without `MessageSid` just get the static API info.
- On rejection, a detailed diagnostic (URL used + source, signature prefix, token length) is logged — check Netlify function logs.
- `TWILIO_SIGNATURE_VALIDATION=off` disables it (local dev only).

## Test mode

Activated by `x-test-mode: true` header, `testMode=true` query, or `testMode=true` in the body — **the string `'true'`, not a boolean** (JSON `true` silently fails to activate it). Every external service has a mock branch keyed on `context.isTestMode`; no real API calls or sends happen. Special params: `testLanguage=true` (language detection), `longTranscription=true` (forces the summary path). Mock transcription language is chosen from the `From` phone prefix.

## Localization

`getLocalizedMessage(key, langObj)` in `src/helpers/localization.js`: phone prefix → `countryLanguageMap` → `languages.json` (29 languages × 11 keys) → English fallback → live `gpt-4o-mini` translation as last resort. **Invariant (test-enforced): every prefix in `countryLanguageMap` must resolve to a language present in `languages.json`** — otherwise every message to those users silently fires a live translation call (~1s + cost, uncached). When adding a language: add both the prefix map entry and the full translation block (key parity with `en` is also test-enforced). All translated strings must preserve the Revolut support link and any URLs.

## OpenAI models in use

- Transcription: `gpt-4o-mini-transcribe` (default param in `prepareFormData`)
- Summaries (>150 words): `gpt-4o-mini`
- Translation fallback: `gpt-4o-mini`

## Environment variables

Core: `OPENAI_API_KEY`, `ACCOUNT_SID`, `AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `PORT` (Express only).
Netlify-only: `INTERNAL_API_SECRET` (webhook→background auth, required), `TWILIO_WEBHOOK_URL` (signature validation), `ADMIN_PHONE` (optional — WhatsApp alert to the operator on `processing_error`, debounced 1/hour via Blobs), `TWILIO_SIGNATURE_VALIDATION=off` (dev only). `URL` is auto-provided by Netlify.
Changing an env var in Netlify requires a **redeploy** to take effect.

## Deployment & rollback

Merging to `main` auto-deploys to Netlify. Verify against the live URL with test-mode curls (safe: mocked, no spend). Rollback for webhook-level problems = repoint the Twilio webhook URL ("When a message comes in") — Heroku (`josephine-transcription-servic-49976576c135.herokuapp.com/transcribe`) remains functional until decommissioned.

## Known deferred items

- Keep-warm scheduled ping (cold starts ~0.5–1.5s on first message after idle)
- Long notes: send transcription immediately, summary as a follow-up message (UX decision pending)
- Twilio SDK v3 → v5 (v3 causes a harmless `url.parse` deprecation warning)
- Users are never shown Terms & Conditions (the consent flow was removed with the database; product/legal decision pending)
- Machine-drafted translations for bg/cs/da/et/fi/lv/lt/mt/pt/sk/sl/zh/hi/ja await native-speaker review
