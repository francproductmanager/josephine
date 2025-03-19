// test/services/test-database-service.js
const { logDetails } = require('../../src/utils/logging-utils');

/**
 * Initialize test mode and mock database for a request
 */
function setupTestMode(req) {
  // Mark request as being in test mode
  req.isTestMode = true;
  
  // Initialize test results collection
  req.testResults = {
    messages: [],
    dbOperations: []
  };
  
  // Create mock database functions
  req.mockDb = {
    // Mock users
    users: {
      'whatsapp:+44123456789': {
        id: 1001,
        phone_number: 'whatsapp:+44123456789',
        country_code: '44',
        credits_remaining: 25,
        free_trial_used: false,
        has_seen_intro: true,
        usage_count: 5,
        total_seconds: 120
      },
      'whatsapp:+39123456789': {
        id: 1002,
        phone_number: 'whatsapp:+39123456789',
        country_code: '39',
        credits_remaining: 50,
        free_trial_used: false,
        has_seen_intro: false,
        usage_count: 0,
        total_seconds: 0
      },
      'whatsapp:+33123456789': {
        id: 1003,
        phone_number: 'whatsapp:+33123456789',
        country_code: '33',
        credits_remaining: 50,
        free_trial_used: false,
        has_seen_intro: true,
        usage_count: 0,
        total_seconds: 0
      },
      'whatsapp:+49123456789': {
        id: 1004,
        phone_number: 'whatsapp:+49123456789',
        country_code: '49',
        credits_remaining: 5,
        free_trial_used: false,
        has_seen_intro: true,
        usage_count: 45,
        total_seconds: 1200
      },
      'whatsapp:+34123456789': {
        id: 1005,
        phone_number: 'whatsapp:+34123456789',
        country_code: '34',
        credits_remaining: 0,
        free_trial_used: true,
        has_seen_intro: true,
        usage_count: 50,
        total_seconds: 1500
      }
    },
    
    // Helper function to get a country code from a phone number
    extractCountryCode: function(phoneNumber) {
      // Ensure we're working with a string
      const phoneStr = String(phoneNumber || '');
      
      // Try to extract based on format
      if (phoneStr.startsWith('whatsapp:+')) {
        // Format: "whatsapp:+39123456789"
        return phoneStr.substring(10, 12);
      } else if (phoneStr.startsWith('+')) {
        // Format: "+39123456789"
        return phoneStr.substring(1, 3);
      } else if (phoneStr.match(/^\d+/)) {
        // Format: "39123456789"
        return phoneStr.substring(0, 2);
      }
      
      // Default to UK if we can't determine
      return '44';
    },
    
    // Mock functions
    findOrCreateUser: function(phoneNumber, req) {
      // Get the user if exists
      let user = this.users[phoneNumber];
      let created = false;
      
      // Create if doesn't exist
      if (!user) {
        const countryCode = this.extractCountryCode(phoneNumber);
        user = {
          id: Math.floor(1000 + Math.random() * 9000),
          phone_number: phoneNumber,
          country_code: countryCode,
          credits_remaining: 50,
          free_trial_used: false,
          has_seen_intro: false,
          usage_count: 0,
          total_seconds: 0
        };
        
        // Save the user for future reference
        this.users[phoneNumber] = user;
        created = true;
      }
      
      return { user, created };
    },
    
    checkUserCredits: function(phoneNumber, req) {
      // Find or create user
      const { user } = this.findOrCreateUser(phoneNumber, req);
      
      // Handle test overrides
      if (req.body) {
        if (req.body.testNoCredits === 'true') {
          user.credits_remaining = 0;
          user.free_trial_used = true;
        } else if (req.body.testLowCredits === 'true') {
          user.credits_remaining = 1;
        }
      }
      
      return {
        canProceed: user.credits_remaining > 0,
        creditsRemaining: user.credits_remaining,
        isFreeTrialUsed: user.free_trial_used,
        warningLevel: user.credits_remaining <= 10 ? 
                  (user.credits_remaining <= 5 ? 'urgent' : 'warning') 
                  : 'none'
      };
    },
    
    getUserStats: function(phoneNumber, req) {
      const { user } = this.findOrCreateUser(phoneNumber, req);
      
      return {
        totalSeconds: user.total_seconds || 0,
        totalWords: user.usage_count * 100, // Rough estimate for testing
        totalTranscriptions: user.usage_count || 0,
        creditsRemaining: user.credits_remaining,
        freeTrialUsed: user.free_trial_used
      };
    },
    
    recordTranscription: function(phoneNumber, audioLengthSeconds, wordCount, openAICost, twilioCost, req) {
      const { user } = this.findOrCreateUser(phoneNumber, req);
      
      // Update user stats
      user.credits_remaining = Math.max(0, user.credits_remaining - 1);
      user.usage_count = (user.usage_count || 0) + 1;
      user.total_seconds = (user.total_seconds || 0) + audioLengthSeconds;
      
      if (user.credits_remaining <= 0) {
        user.free_trial_used = true;
      }
      
      const transcription = {
        id: Math.floor(10000 + Math.random() * 90000),
        user_id: user.id,
        audio_length: audioLengthSeconds,
        word_count: wordCount,
        openai_cost: openAICost,
        twilio_cost: twilioCost,
        total_cost: openAICost + twilioCost,
        created_at: new Date().toISOString()
      };
      
      return {
        transcription,
        user
      };
    },
    
    addCredits: function(phoneNumber, credits, amount, paymentMethod, transactionId, req) {
      const { user } = this.findOrCreateUser(phoneNumber, req);
      
      // Add credits
      user.credits_remaining += credits;
      
      const payment = {
        id: Math.floor(10000 + Math.random() * 90000),
        user_id: user.id,
        amount: amount,
        credits_purchased: credits,
        payment_method: paymentMethod,
        transaction_id: transactionId,
        created_at: new Date().toISOString()
      };
      
      return {
        payment,
        user
      };
    },
    
    markUserIntroAsSeen: function(userId, req) {
      // Find user by ID
      let foundUser = null;
      Object.values(this.users).forEach(user => {
        if (user.id === userId) {
          user.has_seen_intro = true;
          foundUser = user;
        }
      });
      
      return foundUser !== null;
    }
  };
  
  logDetails('[TEST MODE] Test database mocks initialized');
  
  return req;
}

module.exports = {
  setupTestMode
};
