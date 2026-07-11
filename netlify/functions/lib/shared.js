// netlify/functions/lib/shared.js
// Small helpers shared by the sync webhook and the background worker.
const { getStore, connectLambda } = require('@netlify/blobs');

// The empty TwiML ack Twilio expects (matches the Express app's response).
const EMPTY_TWIML = '<Response></Response>';

// Blobs store used for MessageSid idempotency. Strong consistency so a
// Twilio webhook retry (seconds later) sees the marker immediately.
// Marker lifecycle: dispatched -> processing -> done | failed | retrying
//
// These functions use the legacy Lambda-style handler API, where the
// Blobs environment context is delivered on the event rather than
// injected automatically — connectLambda(event) wires it up. Without it
// getStore() throws "environment has not been configured" (observed in
// production 2026-07-11) and dedup silently fail-opens.
function getProcessedStore(event) {
  if (event) {
    connectLambda(event);
  }
  return getStore({ name: 'processed-messages', consistency: 'strong' });
}

module.exports = {
  EMPTY_TWIML,
  getProcessedStore
};
