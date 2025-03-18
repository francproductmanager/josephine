// test/utils/test-utils.js
/**
 * Check if request is in test mode
 */
function isTestMode(req) {
  // Check for test mode header or query parameter
  return (
    (req.headers && req.headers['x-test-mode'] === 'true') ||
    (req.query && req.query.testMode === 'true') ||
    (req.body && req.body.testMode === 'true')
  );
}

/**
 * Message tracking for test mode
 */
class MessageTracker {
  constructor() {
    this.reset();
  }
  
  reset() {
    this.messages = [];
    this.xmlResponse = null;
  }
  
  addMessage(message) {
    this.messages.push(message);
  }
  
  setXMLResponse(xml) {
    this.xmlResponse = xml;
  }
  
  getResults() {
    return {
      messages: this.messages,
      xmlResponse: this.xmlResponse
    };
  }
}

const messageTracker = new MessageTracker();

module.exports = {
  isTestMode,
  messageTracker
};
