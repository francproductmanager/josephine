// src/services/twilio-service.js
// Sends WhatsApp messages via the Twilio REST API directly (one POST) —
// the twilio SDK was removed because its dynamic requires break Netlify's
// v2 function bundling (production MODULE_NOT_FOUND, 2026-07-11), and the
// SDK's only runtime use here was messages.create.
const { postJson, getJson } = require('../utils/http-client');
const { logDetails } = require('../utils/logging-utils');

// Twilio client wrapper
class TwilioClientWrapper {
  constructor(req) {
    this.req = req;
    this.testMode = req && req.isTestMode;

    // Real sends are possible when credentials exist
    this.hasCredentials = !!(process.env.ACCOUNT_SID && process.env.AUTH_TOKEN);
  }

  isAvailable() {
    // Client is available if we have credentials or in test mode
    return this.hasCredentials || this.testMode;
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
    } else if (this.hasCredentials) {
      // Send real message in production via the Twilio REST API
      const accountSid = process.env.ACCOUNT_SID;
      const auth = Buffer.from(`${accountSid}:${process.env.AUTH_TOKEN}`).toString('base64');
      const params = new URLSearchParams({
        To: options.to,
        From: options.from,
        Body: options.body
      });

      return await postJson(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        params,
        {
          headers: { Authorization: `Basic ${auth}` },
          timeoutMs: 15000
        }
      );
    } else {
      throw new Error('Twilio client not available');
    }
  }

  // Fetch the current delivery status of a previously-sent message.
  // Used to sequence multi-part sends: we only queue the next part once
  // the previous one has left Twilio's outbound queue (see sendMessages),
  // which is what actually guarantees WhatsApp shows them in order.
  // Returns the Twilio status string (e.g. 'queued', 'sent', 'delivered')
  // or null if it can't be read (fail-open — never block a send on this).
  async getMessageStatus(sid) {
    if (this.testMode || !this.hasCredentials || !sid) {
      return null;
    }
    try {
      const accountSid = process.env.ACCOUNT_SID;
      const auth = Buffer.from(`${accountSid}:${process.env.AUTH_TOKEN}`).toString('base64');
      const result = await getJson(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${sid}.json`,
        {
          headers: { Authorization: `Basic ${auth}` },
          timeoutMs: 10000
        }
      );
      return result.status || null;
    } catch (error) {
      logDetails('Could not read Twilio message status:', error.message);
      return null;
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
