// netlify/functions/lib/shared.js
// Small helpers shared by the sync webhook and the background worker.
const { getStore } = require('@netlify/blobs');

// The empty TwiML ack Twilio expects (matches the Express app's response).
const EMPTY_TWIML = '<Response></Response>';

// Blobs store used for MessageSid idempotency. Strong consistency so a
// Twilio webhook retry (seconds later) sees the marker immediately.
// Marker lifecycle: dispatched -> processing -> done | failed | retrying
function getProcessedStore() {
  return getStore({ name: 'processed-messages', consistency: 'strong' });
}

module.exports = {
  EMPTY_TWIML,
  getProcessedStore
};
