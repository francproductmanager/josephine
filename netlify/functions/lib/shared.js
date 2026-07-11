// netlify/functions/lib/shared.js
// Helpers for the sync webhook (legacy Lambda-style handler).
const { getStore, connectLambda } = require('@netlify/blobs');

// The empty TwiML ack Twilio expects (matches the Express app's response).
const EMPTY_TWIML = '<Response></Response>';

// Blobs store used for MessageSid idempotency.
// Marker lifecycle: dispatched -> processing -> done | failed | retrying
//
// The sync webhook runs as a legacy Lambda-style function (serverless-http
// needs Lambda events), where connectLambda(event) provides only the
// edgeURL + token — never the uncachedEdgeURL that strong-consistency
// reads require (verified in @netlify/blobs source; strong reads throw).
// So this store reads at EVENTUAL consistency: a best-effort fast-path
// that absorbs most Twilio webhook retries. The authoritative dedup gate
// is the background function (v2 API, automatic full context, strong
// reads) — anything that slips past this check is caught there.
function getProcessedStore(event) {
  if (event) {
    connectLambda(event);
  }
  return getStore({ name: 'processed-messages', consistency: 'eventual' });
}

module.exports = {
  EMPTY_TWIML,
  getProcessedStore
};
