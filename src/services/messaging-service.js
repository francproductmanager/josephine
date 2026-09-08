// src/services/messaging-service.js
const { logDetails } = require('../utils/logging-utils');

/**
 * Split a long message into WhatsApp-sized parts. Multi-part messages are
 * split on word boundaries and numbered '[1/3] ...' so the reader can
 * reassemble them even when WhatsApp displays them out of order (observed
 * in production 2026-09-08: Twilio hands parts to Meta in order, but Meta
 * makes no ordering promise to the device). Single-part messages are
 * returned untouched.
 */
function splitLongMessage(message, maxLength = 1500) {
  if (!message || message.length <= maxLength) return [message];

  // Reserve room for the '[nn/nn] ' prefix added after splitting.
  const budget = maxLength - 8;
  const chunks = [];
  let rest = message;
  while (rest.length > budget) {
    const window = rest.slice(0, budget + 1);
    const cutAt = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\n'));
    if (cutAt > 0) {
      // Keep the whitespace at the end of the part: stripping prefixes and
      // joining the parts reconstructs the original exactly (test-enforced).
      chunks.push(rest.slice(0, cutAt + 1));
      rest = rest.slice(cutAt + 1);
    } else {
      // One unbroken 1500-char token: hard cut, nothing better to do.
      chunks.push(rest.slice(0, budget));
      rest = rest.slice(budget);
    }
  }
  chunks.push(rest);
  return chunks.map((chunk, i) => `[${i + 1}/${chunks.length}] ${chunk}`);
}

// Statuses that end the wait between parts: the part reached the device
// ('delivered'/'read'), or terminally failed (waiting longer cannot help).
const DELIVERY_TERMINAL_STATUSES = new Set([
  'delivered', 'read', 'undelivered', 'failed'
]);

/**
 * Wait until a message part has been DELIVERED to the recipient's device
 * before releasing the next part. Merely 'sent' (handed to Meta) is not
 * enough: parts handed over within the same second were displayed out of
 * order in production (2026-09-08). Fail-open: if the status can't be
 * read or delivery isn't confirmed within the budget (~5s), we send
 * anyway — the '[i/n]' part numbering is the safety net for that case.
 */
async function waitUntilDelivered(twilioWrapper, sid, { attempts = 10, intervalMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const status = await twilioWrapper.getMessageStatus(sid);
    if (status === null || DELIVERY_TERMINAL_STATUSES.has(status)) {
      return status;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return null;
}

async function sendMessages(twilioWrapper, messageParts, toPhone, fromPhone) {
  try {
    logDetails(`Message will be split into ${messageParts.length} parts`);

    for (const [index, part] of messageParts.entries()) {
      const result = await twilioWrapper.sendMessage({
        body: part,
        from: fromPhone,
        to: toPhone
      });

      // Between parts, wait for this one to be DELIVERED to the device
      // before submitting the next. Awaiting the REST POST only confirms
      // Twilio queued it, and even Twilio's 'sent' (handed to Meta) is
      // not enough: Meta reorders near-simultaneous handoffs. If delivery
      // isn't confirmed within the budget we send anyway (fail-open) and
      // rely on the '[i/n]' part numbering. (Skipped in test mode — no
      // real sends, nothing to poll.)
      if (!twilioWrapper.testMode && messageParts.length > 1 && index < messageParts.length - 1) {
        await waitUntilDelivered(twilioWrapper, result && result.sid);
      }
    }

    logDetails(`Messages sent successfully in ${messageParts.length} parts`);
    return true;
  } catch (error) {
    logDetails('Error sending messages:', error);
    throw error;
  }
}

module.exports = {
  splitLongMessage,
  sendMessages,
  waitUntilDelivered
};
