// src/index.js - Server entry point (Heroku / local dev)
const app = require('./app');

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app; // For testing
