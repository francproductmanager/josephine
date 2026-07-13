// src/core/cost-estimate.js
// Realistic per-message cost estimate shown to users in the support
// footer. Pricing assumptions (verified 2026-07, update when they drift):
//   - Twilio per-message fee: $0.005, inbound or outbound
//     (https://www.twilio.com/en-us/whatsapp/pricing)
//   - Meta fee: $0 — Josephine only ever sends free-form replies inside
//     the 24h customer-service window
//   - OpenAI gpt-4o-mini-transcribe: ~$0.003 per minute of audio
//   - Moderation: free; summary (gpt-4o-mini): negligible (~$0.0002)
//
// Audio duration is estimated from byte size: WhatsApp voice notes are
// Opus at ~16 kbps, i.e. ~120 KB per minute.
const TWILIO_PER_MESSAGE_USD = 0.005;
const TRANSCRIBE_PER_MINUTE_USD = 0.003;
const OPUS_BYTES_PER_MINUTE = 120 * 1024;

/**
 * Estimate the total cost of one transcription exchange in USD.
 *
 * @param {number} audioBytes - size of the downloaded voice note
 * @param {number} messageParts - outbound message parts sent
 */
function estimateCostUsd(audioBytes, messageParts = 1) {
  const minutes = Math.max((audioBytes || 0) / OPUS_BYTES_PER_MINUTE, 0.25);
  const openai = TRANSCRIBE_PER_MINUTE_USD * minutes;
  const twilio = TWILIO_PER_MESSAGE_USD * (1 + messageParts); // inbound + replies
  return openai + twilio;
}

/**
 * Format a USD amount for the user-facing footer, e.g. "$0.01".
 * Never displays less than one cent.
 */
function formatCostUsd(usd) {
  return `$${Math.max(usd, 0.01).toFixed(2)}`;
}

module.exports = {
  estimateCostUsd,
  formatCostUsd
};
