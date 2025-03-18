// src/middleware/test-mode.js
const { logDetails } = require('../utils/logging-utils');

// In production, we'll only have this stub, which detects test mode
// In test/dev environments, we'll have the full test-database-service
let testDatabaseService = {
  setupTestMode: function(req) {
    req.isTestMode = true;
    req.testResults = { messages: [], dbOperations: [] };
    return req;
  }
};

// Try to load the test service if we're in development/test environment
try {
  testDatabaseService = require('../../test/services/test-database-service');
  logDetails('Loaded test database service');
} catch (err) {
  logDetails('Test database service not available, using stub');
}

/**
 * Middleware to detect test mode and attach test utilities
 */
function detectTestMode(req, res, next) {
  // Centralized test mode detection
  const isInTestMode = (
    (req.headers && req.headers['x-test-mode'] === 'true') ||
    (req.query && req.query.testMode === 'true') ||
    (req.body && req.body.testMode === 'true')
  );
  
  if (isInTestMode) {
    // Initialize test environment
    testDatabaseService.setupTestMode(req);
    
    // Log the activation of test mode
    logDetails(`[TEST MODE] Request running in test mode`);
  }
  
  next();
}

module.exports = { detectTestMode };
