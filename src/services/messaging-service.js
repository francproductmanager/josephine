// src/services/messaging-service.js
const { logDetails } = require('../utils/logging-utils');

function splitLongMessage(message, maxLength = 1500) {
  if (!message || message.length <= maxLength) return [message];
  
  const parts = [];
  for (let i = 0; i < message.length; i += maxLength) {
    parts.push(message.substring(i, i + maxLength));
  }
  return parts;
}

// Twilio statuses that mean a message has left the outbound queue and been
// handed to Meta. Once a part reaches one of these, the next part can be
// queued without risk of overtaking it. 'queued'/'accepted'/'scheduled'
// are the states we must wait *out* of.
const DISPATCHED_STATUSES = new Set([
  'sending', 'sent', 'delivered', 'read', 'receiving', 'received',
  'undelivered', 'failed'
]);

/**
 * Wait until a message has left Twilio's outbound queue (status advances
 * past 'queued'/'accepted'), so the next part cannot overtake it on the
 * way to Meta. Fail-open: if the status can't be read or never advances
 * within the budget, we return anyway rather than block the send — worst
 * case is the pre-existing rare-reorder behaviour, never a dropped part.
 */
async function waitUntilDispatched(twilioWrapper, sid, { attempts = 8, intervalMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const status = await twilioWrapper.getMessageStatus(sid);
    if (status === null || DISPATCHED_STATUSES.has(status)) {
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

      // Between parts, wait for this one to actually leave Twilio's queue
      // before submitting the next. Awaiting the REST POST only confirms
      // Twilio *queued* the message; two messages queued back-to-back can
      // still reach Meta out of order. Polling to a dispatched status is
      // what keeps WhatsApp showing the parts in order. (Skipped in test
      // mode — no real sends, nothing to poll.)
      if (!twilioWrapper.testMode && messageParts.length > 1 && index < messageParts.length - 1) {
        await waitUntilDispatched(twilioWrapper, result && result.sid);
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
  waitUntilDispatched
};
