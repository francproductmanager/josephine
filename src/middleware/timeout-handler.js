// src/middleware/timeout-handler.js
const { logDetails } = require('../utils/logging-utils');

/**
 * Middleware to handle request timeouts before Heroku's 30-second limit
 * This prevents H12 errors by responding early with a friendly message
 */
function timeoutHandler(req, res, next) {
  const TIMEOUT_MS = 25000; // 25 seconds (shorter than Heroku's 30s limit)
  
  // Set a timeout that will trigger before Heroku cuts the connection
  req.timeoutId = setTimeout(() => {
    logDetails('⚠️ REQUEST TIMEOUT WARNING: Request taking too long, responding early to prevent H12 error');
    
    // If there's a specific cleanup function on the request, call it
    if (typeof req.onTimeout === 'function') {
      try {
        req.onTimeout();
      } catch (err) {
        logDetails('Error in timeout cleanup function:', err);
      }
    }
    
    // Check if headers have already been sent
    if (!res.headersSent) {
      // Send a response before Heroku times out
      res.status(503).json({
        status: 'error',
        message: 'Request processing is taking too long',
        retry: true,
        error_code: 'REQUEST_TIMEOUT'
      });
    }
  }, TIMEOUT_MS);
  
  // Clear the timeout when the response is sent
  res.on('finish', function() {
    if (req.timeoutId) {
      clearTimeout(req.timeoutId);
    }
  });
  
  next();
}

module.exports = timeoutHandler;
