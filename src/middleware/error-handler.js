// src/middleware/error-handler.js
/**
 * Global error handling middleware
 */
const { formatErrorResponse } = require('../utils/response-formatter');

function errorHandler(err, req, res, next) {
  console.error('Error encountered:', err.message);
  console.error('Error stack:', err.stack);
  
  return formatErrorResponse(
    res,
    err.status || 500,
    err.message || 'Internal server error',
    req.isTestMode ? { stack: err.stack } : null
  );
}

module.exports = errorHandler;
