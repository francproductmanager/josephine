// /services/twilio-service.js
const Twilio = require('twilio');
const { messageTracker, isTestMode } = require('../utils/testing-utils');
const { logDetails } = require('../utils/logging-utils');

// Twilio client wrapper
class TwilioClientWrapper {
  constructor(req) {
    this.req = req;
    this.testMode = isTestMode(req);
    
    // Initialize real Twilio client if credentials exist
    if (process.env.ACCOUNT_SID && process.env.AUTH_TOKEN) {
      this.realClient = new Twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
    } else {
      this.realClient = null;
    }
    
    // Reset message tracker in test mode
    if (this.testMode) {
      messageTracker.reset();
    }
  }
  
  isAvailable() {
    // Client is available if we have a real client or in test mode
    return this.realClient !== null || this.testMode;
  }
  
  async sendMessage(options) {
    if (this.testMode) {
      // Log the message but don't actually send it
      logDetails(`[TEST MODE] Would send message to ${options.to}:`, options.body);
      messageTracker.addMessage({
        to: options.to,
        from: options.from,
        body: options.body,
        timestamp: new Date().toISOString()
      });
      return {
        sid: 'TEST-SID-' + Math.random().toString(36).substring(2, 15),
        status: 'test-queued',
        dateCreated: new Date().toISOString()
      };
    } else if (this.realClient) {
      // Send real message in production
      return await this.realClient.messages.create(options);
    } else {
      throw new Error('Twilio client not available');
    }
  }
  
  // Used to send TwiML responses
  generateXMLResponse(xml) {
    if (this.testMode) {
      // Store XML in tracker but don't actually return it to the client
      messageTracker.setXMLResponse(xml);
    }
    return xml;
  }
  
  // Get test results
  getTestResults() {
    if (this.testMode) {
      return messageTracker.getResults();
    }
    return null;
  }
}

module.exports = {
  TwilioClientWrapper
};
