// src/services/twilio-service.js
const Twilio = require('twilio');
const { logDetails } = require('../utils/logging-utils');

// Twilio client wrapper
class TwilioClientWrapper {
  constructor(req) {
    this.req = req;
    this.testMode = req && req.isTestMode;
    
    // Initialize real Twilio client if credentials exist
    if (process.env.ACCOUNT_SID && process.env.AUTH_TOKEN) {
      this.realClient = new Twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN);
    } else {
      this.realClient = null;
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
      
      // Add to test results if available
      if (this.req && this.req.testResults) {
        this.req.testResults.messages.push({
          to: options.to,
          from: options.from,
          body: options.body,
          timestamp: new Date().toISOString()
        });
      }
      
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
    if (this.testMode && this.req && this.req.testResults) {
      // Store XML in test results
      this.req.testResults.xmlResponse = xml;
    }
    return xml;
  }
  
  // Get test results
  getTestResults() {
    return (this.req && this.req.testResults) || null;
  }
}

module.exports = {
  TwilioClientWrapper
};
