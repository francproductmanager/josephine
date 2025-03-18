// /utils/db-testing-utils.js
const { isTestMode } = require('./testing-utils');
const { logDetails } = require('./logging-utils');

// Database operations tracker
class DbOperationsTracker {
  constructor() {
    this.reset();
  }
  
  reset() {
    this.operations = [];
  }
  
  addOperation(type, details) {
    this.operations.push({
      type,
      timestamp: new Date().toISOString(),
      details
    });
  }
  
  getOperations() {
    return this.operations;
  }
}

const dbTracker = new DbOperationsTracker();

// Mock user data for testing
const mockUsers = {
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
    has_seen_intro: false,
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
};

function getTestUser(phoneNumber) {
  return mockUsers[phoneNumber] || null;
}

function createTestUser(phoneNumber) {
  // Create a new mock user if it doesn't exist
  if (!mockUsers[phoneNumber]) {
    mockUsers[phoneNumber] = {
      id: Math.floor(1000 + Math.random() * 9000),
      phone_number: phoneNumber,
      country_code: phoneNumber.substring(9, 11) || '44',
      credits_remaining: 50,
      free_trial_used: false,
      has_seen_intro: false,
      usage_count: 0,
      total_seconds: 0
    };
  }
  return mockUsers[phoneNumber];
}

// For mocking database operations
function getMockDbResponse(operation, phoneNumber, args) {
  // Get the user or create it if it doesn't exist
  let user = getTestUser(phoneNumber);
  if (!user) {
    user = createTestUser(phoneNumber);
  }
  
  // Handle special test overrides
  if (args && args.testOverrides) {
    if (args.testOverrides.noCredits) {
      user.credits_remaining = 0;
      user.free_trial_used = true;
    } else if (args.testOverrides.lowCredits) {
      user.credits_remaining = 1;
    }
    
    if (args.testOverrides.hasSeenIntro !== undefined) {
      user.has_seen_intro = args.testOverrides.hasSeenIntro;
    }
  }
  
  // Return mock data based on the operation
  switch (operation) {
    case 'findOrCreateUser':
      return { 
        user, 
        created: false // Always assume user exists for simplicity
      };
      
    case 'checkUserCredits':
      return {
        canProceed: user.credits_remaining > 0,
        creditsRemaining: user.credits_remaining,
        isFreeTrialUsed: user.free_trial_used,
        warningLevel: user.credits_remaining <= 10 ? 
                   (user.credits_remaining <= 5 ? 'urgent' : 'warning') 
                   : 'none'
      };
      
    case 'getUserStats':
      return {
        totalSeconds: user.total_seconds,
        totalWords: user.usage_count * 100, // Rough estimate for testing
        totalTranscriptions: user.usage_count,
        creditsRemaining: user.credits_remaining,
        freeTrialUsed: user.free_trial_used
      };
      
    case 'recordTranscription':
      // Update user stats
      user.credits_remaining = Math.max(0, user.credits_remaining - 1);
      user.usage_count += 1;
      
      if (args && args.audioLengthSeconds) {
        user.total_seconds += args.audioLengthSeconds;
      }
      
      if (user.credits_remaining <= 0) {
        user.free_trial_used = true;
      }
      
      return {
        transcription: {
          id: Math.floor(10000 + Math.random() * 90000),
          user_id: user.id,
          audio_length: args ? args.audioLengthSeconds : 0,
          word_count: args ? args.wordCount : 0,
          openai_cost: args ? args.openAICost : 0,
          twilio_cost: args ? args.twilioCost : 0,
          total_cost: (args ? args.openAICost : 0) + (args ? args.twilioCost : 0),
          created_at: new Date().toISOString()
        },
        user: user
      };
      
    case 'markUserIntroAsSeen':
      user.has_seen_intro = true;
      return true;
      
    case 'addCredits':
      if (args && args.credits) {
        user.credits_remaining += args.credits;
      }
      return {
        payment: {
          id: Math.floor(10000 + Math.random() * 90000),
          user_id: user.id,
          amount: args ? args.amount : 0,
          credits_purchased: args ? args.credits : 0,
          payment_method: args ? args.paymentMethod : 'test',
          transaction_id: args ? args.transactionId : 'test-trans-' + Date.now(),
          created_at: new Date().toISOString()
        },
        user: user
      };
      
    default:
      return null;
  }
}

module.exports = {
  dbTracker,
  getMockDbResponse,
  getTestUser,
  createTestUser
};
