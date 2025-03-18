// src/middleware/request-logger.js
/**
 * Middleware to log request details
 */
function requestLogger(req, res, next) {
  console.log('---- REQUEST DEBUG INFO ----');
  console.log('Headers:', JSON.stringify(req.headers));
  console.log('Body:', JSON.stringify(req.body));
  console.log('Content-Type:', req.get('Content-Type'));
  console.log('---------------------------');
  next();
}

module.exports = requestLogger;
