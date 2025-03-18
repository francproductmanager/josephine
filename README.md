# Josephine Transcription Service

A WhatsApp-based transcription service for voice notes.

## Project Structure

The codebase is organized as follows:
/
├── src/                       # Main application source
│   ├── routes/                # Route definitions
│   ├── controllers/           # Business logic
│   ├── services/              # Core functionality
│   ├── helpers/               # Helper functions
│   ├── middleware/            # Request processing
│   └── utils/                 # Utility functions
├── test/                      # Test code
│   ├── mocks/                 # Mock objects
│   └── utils/                 # Test utilities
├── config/                    # Configuration
└── index.js                   # Entry point

## Testing with Postman

The application supports test mode which can be activated in three ways:

1. Setting the `x-test-mode: true` header
2. Adding `testMode=true` as a query parameter
3. Including `testMode=true` in the form data

Special test parameters:
- `testLanguage=true` - Test language detection
- `testNoCredits=true` - Simulate a user with no credits
- `testLowCredits=true` - Simulate a user with low credits
- `longTranscription=true` - Simulate a longer transcription
