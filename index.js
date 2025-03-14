// index.js

// Load environment variables from .env file (if any)
require('dotenv').config();

const express = require('express');
const app = express();

// Middleware to parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// A simple route to check if the server is running
app.get('/', (req, res) => {
  res.send('Josephine Transcription Service is running!');
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
