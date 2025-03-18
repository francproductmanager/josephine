// src/index.js
require('dotenv').config();
const express = require('express');
const app = express();
const routes = require('./routes');
const { logDetails } = require('./utils/logging-utils');

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

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app; // For testing
