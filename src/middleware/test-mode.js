// src/middleware/test-mode.js
/**
 * Middleware to detect test mode and attach test utilities
 */
const { logDetails } = require('../utils/logging-utils');

function detectTestMode(req, res, next) {
  // Centralized test mode detection
  req.isTestMode = (
    (req.headers && req.headers['x-test-mode'] === 'true') ||
    (req.query && req.query.testMode === 'true') ||
    (req.body && req.body.testMode === 'true')
  );
  
  if (req.isTestMode) {
    // Initialize test data collectors
    req.testResults = {
      messages: [],
      dbOperations: []
    };
    
    // Log the activation of test mode
    logDetails(`[TEST MODE] Request running in test mode`);
  }
  
  next();
}

module.exports = { detectTestMode };
