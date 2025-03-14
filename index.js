// index.js
require('dotenv').config();

const express = require('express');
const app = express();

// Import routes
const transcribeRoute = require('./routes/transcribe');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic route for checking the server
app.get('/', (req, res) => {
  res.send('Josephine Transcription Service is running!');
});

// Use the transcribe route
app.use('/transcribe', transcribeRoute);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
