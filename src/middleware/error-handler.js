// src/middleware/error-handler.js
/**
 * Global error handling middleware
 */
const { formatErrorResponse } = require('../utils/response-formatter');
const { logDetails } = require('../utils/logging-utils');

function errorHandler(err, req, res, next) {
  logDetails('Error encountered:', err.message);
  logDetails('Error stack:', err.stack);
  
  // Determine appropriate status code
  let statusCode = err.status || 500;
  let message = err.message || 'Internal server error';
  
  // Add stack trace in test mode only
  const details = req.isTestMode ? { stack: err.stack } : null;
  
  return formatErrorResponse(res, statusCode, message, details);
}

module.exports = errorHandler;
