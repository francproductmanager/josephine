// src/index.js
require('dotenv').config();
const express = require('express');
const routes = require('./routes'); // Changed from './src/routes' to './routes'
const { logDetails } = require('./utils/logging-utils');
const referralService = require('./services/referral-service'); // Changed path

// Initialize the app
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug middleware
app.use((req, res, next) => {
  logDetails('Request received', {
    method: req.method,
    path: req.path,
    query: req.query,
    contentType: req.get('Content-Type')
  });
  next();
});

// Use routes
app.use('/', routes);

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
    error: err.message
  });
});

// Initialize the referral system database schema
(async function() {
  try {
    await referralService.setupReferralSchema();
    logDetails('Referral system database schema initialized successfully');
  } catch (error) {
    logDetails('Failed to initialize referral system database schema:', error);
  }
})();

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;
