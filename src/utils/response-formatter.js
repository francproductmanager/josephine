// src/utils/response-formatter.js
/**
 * Format a test mode response with consistent structure
 */
function formatTestResponse(res, data) {
  // Ensure status is always present
  if (!data.status) {
    data.status = 'success';
  }
  
  return res.json(data);
}

/**
 * Format an error response with consistent structure
 */
function formatErrorResponse(res, statusCode, message, details = null) {
  const response = {
    status: 'error',
    message: message
  };
  
  if (details) {
    response.details = details;
  }
  
  return res.status(statusCode).json(response);
}

/**
 * Format a success response with consistent structure
 */
function formatSuccessResponse(res, data) {
  const response = {
    status: 'success',
    ...data
  };
  
  return res.json(response);
}

module.exports = {
  formatTestResponse,
  formatErrorResponse,
  formatSuccessResponse
};
