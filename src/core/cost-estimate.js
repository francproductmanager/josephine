// src/core/cost-estimate.js
// The per-note "share" shown in the support footer, driven purely by the
// word count of the transcription so the figure visibly varies message
// to message (a flat number reads as made up).
//
// Honest context behind the numbers (2026-07): running Josephine costs
// ~$12/month fixed (Netlify $9 + Twilio number rental & tax ~$2.90).
// Marginal cost per note is only ~$0.003/min of audio (OpenAI) — Twilio
// per-message fees are currently $0 (covered by Twilio's "Free units",
// 100 WhatsApp msgs/cycle) and Meta service-window replies are free.
// The displayed share is therefore a word-count-scaled allocation of the
// fixed costs, not a marginal price.
const MIN_SHARE_USD = 0.19;   // floor: very short notes
const MAX_SHARE_USD = 0.45;   // cap: long notes
const FULL_SCALE_WORDS = 400; // word count at which the cap is reached

// Shown as {monthly} in the footer sentence.
const MONTHLY_DISPLAY = '$12';

/**
 * Word count with the same semantics as exceedsWordLimit in
 * src/helpers/localization.js.
 */
function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).length;
}

/**
 * Map a transcription's word count onto the $0.19–$0.45 share range.
 * Sample points: 10w → $0.20, 100w → $0.26, 190w → $0.31, 400w+ → $0.45.
 */
function estimateNoteShareUsd(wordCount) {
  const scaled = MIN_SHARE_USD + (wordCount || 0) * (MAX_SHARE_USD - MIN_SHARE_USD) / FULL_SCALE_WORDS;
  return Math.min(scaled, MAX_SHARE_USD);
}

/**
 * Format a USD amount for the user-facing footer, e.g. "$0.26".
 * Never displays less than one cent.
 */
function formatCostUsd(usd) {
  return `$${Math.max(usd, 0.01).toFixed(2)}`;
}

module.exports = {
  countWords,
  estimateNoteShareUsd,
  formatCostUsd,
  MONTHLY_DISPLAY
};
