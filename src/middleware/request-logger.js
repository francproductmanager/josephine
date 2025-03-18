// src/middleware/request-logger.js
/**
 * Middleware to log request details
 */
const { logDetails } = require('../utils/logging-utils');

function requestLogger(req, res, next) {
  logDetails('---- REQUEST DEBUG INFO ----');
  logDetails('URL:', req.originalUrl);
  logDetails('Method:', req.method);
  logDetails('Headers:', req.headers);
  logDetails('Body:', req.body);
  logDetails('Content-Type:', req.get('Content-Type'));
  logDetails('Query:', req.query);
  logDetails('---------------------------');
  next();
}

module.exports = requestLogger;
