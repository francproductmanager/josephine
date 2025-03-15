// services/messaging-service.js
const { logDetails } = require('../utils/logging-utils');

function splitLongMessage(message, maxLength = 1500) {
  if (!message || message.length <= maxLength) return [message];
  
  const parts = [];
  for (let i = 0; i < message.length; i += maxLength) {
    parts.push(message.substring(i, i + maxLength));
  }
  return parts;
}

async function sendMessages(twilioClient, messageParts, toPhone, fromPhone) {
  try {
    logDetails(`Message will be split into ${messageParts.length} parts`);
    
    for (const [index, part] of messageParts.entries()) {
      await twilioClient.messages.create({
        body: part,
        from: fromPhone,
        to: toPhone
      });
      
      // Add a small delay between messages to maintain order
      if (messageParts.length > 1 && index < messageParts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
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
  sendMessages
};
