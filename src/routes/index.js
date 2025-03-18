// src/routes/index.js
const express = require('express');
const router = express.Router();
const transcribeRouter = require('./transcribe');

// Basic route for checking the server
router.get('/', (req, res) => {
  res.send('Josephine Transcription Service is running!');
});

// Use the transcribe route
router.use('/transcribe', transcribeRouter);

module.exports = router;
