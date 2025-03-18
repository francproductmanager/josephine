// helpers/database.js
const { Pool } = require('pg');
const { detectCountryCode } = require('./localization');
const { isTestMode } = require('../utils/testing-utils');
const { dbTracker, getMockDbResponse } = require('../utils/db-testing-utils');
const { logDetails } = require('../utils/logging-utils');

// Create a connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { 
    rejectUnauthorized: false 
  }
});

// Check if a user exists by phone number, create if not
async function findOrCreateUser(phoneNumber, req = null) {
  // Check for test mode
  if (req && isTestMode(req)) {
    logDetails('[TEST MODE] Finding or creating user:', phoneNumber);
    dbTracker.addOperation('findOrCreateUser', { phoneNumber });
    
    // Get mock response
    return getMockDbResponse('findOrCreateUser', phoneNumber);
  }
  
  // Normal production code
  const client = await pool.connect();
  try {
    // Normalize the phone number - store the full WhatsApp format
    let normalizedPhone = phoneNumber;
    let countryCode = detectCountryCode(phoneNumber);

    console.log(`Looking for user with phone: ${normalizedPhone}, country code: ${countryCode}`);

    // Check if user exists
    let result = await client.query(
      'SELECT * FROM users WHERE phone_number = $1',
      [normalizedPhone]
    );
    
    if (result.rows.length > 0) {
      console.log(`User found: ${normalizedPhone}`);
      return { user: result.rows[0], created: false };
    }
    
    // Create new user with has_seen_intro = false
    console.log(`Creating new user: ${normalizedPhone}`);
    result = await client.query(
      `INSERT INTO users 
       (phone_number, country_code, credits_remaining, free_trial_used, has_seen_intro) 
       VALUES ($1, $2, 50, false, false) 
       RETURNING *`,
      [normalizedPhone, countryCode]
    );
    
    return { user: result.rows[0], created: true };
  } catch (error) {
    console.error('Error in findOrCreateUser:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Check if user has available credits
async function checkUserCredits(phoneNumber, req = null) {
  // Check for test mode
  if (req && isTestMode(req)) {
    logDetails('[TEST MODE] Checking credits for user:', phoneNumber);
    dbTracker.addOperation('checkUserCredits', { phoneNumber });
    
    // Handle test overrides
    const testOverrides = {};
    if (req.body) {
      if (req.body.testNoCredits === 'true') {
        testOverrides.noCredits = true;
      } else if (req.body.testLowCredits === 'true') {
        testOverrides.lowCredits = true;
      }
    }
    
    // Get mock response
    return getMockDbResponse('checkUserCredits', phoneNumber, { testOverrides });
  }
  
  // Normal production code
  const client = await pool.connect();
  try {
    const { user } = await findOrCreateUser(phoneNumber);
    
    return {
      canProceed: user.credits_remaining > 0,
      creditsRemaining: user.credits_remaining,
      isFreeTrialUsed: user.free_trial_used,
      warningLevel: user.credits_remaining <= 10 ? 
                    (user.credits_remaining <= 5 ? 'urgent' : 'warning') 
                    : 'none'
    };
  } finally {
    client.release();
  }
}

// Get complete user stats
async function getUserStats(phoneNumber, req = null) {
  // Check for test mode
  if (req && isTestMode(req)) {
    logDetails('[TEST MODE] Getting stats for user:', phoneNumber);
    dbTracker.addOperation('getUserStats', { phoneNumber });
    
    // Get mock response
    return getMockDbResponse('getUserStats', phoneNumber);
  }
  
  // Normal production code
  const client = await pool.connect();
  try {
    const { user } = await findOrCreateUser(phoneNumber);
    
    // Get total seconds from the users table
    const totalSeconds = user.total_seconds || 0;
    
    // Get total word count from user's transcriptions
    const wordCountResult = await client.query(
      `SELECT SUM(word_count) as total_words 
       FROM Transcriptions 
       WHERE user_id = $1`,
      [user.id]
    );
    
    const totalWords = wordCountResult.rows[0].total_words || 0;
    
    // Get total number of transcriptions
    const totalTranscriptions = user.usage_count || 0;
    
    return {
      totalSeconds,
      totalWords,
      totalTranscriptions,
      creditsRemaining: user.credits_remaining,
      freeTrialUsed: user.free_trial_used
    };
  } finally {
    client.release();
  }
}

// Record a transcription and update user stats
async function recordTranscription(phoneNumber, audioLengthSeconds, wordCount, openAICost, twilioCost, req = null) {
  // Check for test mode
  if (req && isTestMode(req)) {
    logDetails('[TEST MODE] Recording transcription for user:', phoneNumber);
    dbTracker.addOperation('recordTranscription', { 
      phoneNumber, 
      audioLengthSeconds, 
      wordCount, 
      openAICost, 
      twilioCost 
    });
    
    // Get mock response
    return getMockDbResponse('recordTranscription', phoneNumber, {
      audioLengthSeconds,
      wordCount,
      openAICost,
      twilioCost
    });
  }
  
  // Normal production code
  const client = await pool.connect();
  try {
    // Start transaction
    await client.query('BEGIN');
    
    const { user } = await findOrCreateUser(phoneNumber);
    
    // Calculate total cost
    const totalCost = openAICost + twilioCost;
    
    // Create transcription record
    const transcriptionResult = await client.query(
      `INSERT INTO Transcriptions
       (user_id, audio_length, word_count, openai_cost, twilio_cost, total_cost)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user.id, audioLengthSeconds, wordCount, openAICost, twilioCost, totalCost]
    );
    
    // Update user stats
    const userUpdateResult = await client.query(
      `UPDATE users
       SET usage_count = usage_count + 1,
           total_seconds = total_seconds + $1,
           credits_remaining = credits_remaining - 1,
           last_used = CURRENT_TIMESTAMP,
           free_trial_used = CASE WHEN credits_remaining - 1 <= 0 THEN TRUE ELSE free_trial_used END
       WHERE id = $2
       RETURNING *`,
      [audioLengthSeconds, user.id]
    );
    
    await client.query('COMMIT');
    
    return { 
      transcription: transcriptionResult.rows[0], 
      user: userUpdateResult.rows[0] 
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Add credits after payment
async function addCredits(phoneNumber, credits, amount, paymentMethod, transactionId, req = null) {
  // Check for test mode
  if (req && isTestMode(req)) {
    logDetails('[TEST MODE] Adding credits for user:', phoneNumber);
    dbTracker.addOperation('addCredits', { 
      phoneNumber, 
      credits,
      amount,
      paymentMethod,
      transactionId
    });
    
    // Get mock response
    return getMockDbResponse('addCredits', phoneNumber, {
      credits,
      amount,
      paymentMethod,
      transactionId
    });
  }
  
  // Normal production code
  const client = await pool.connect();
  try {
    // Start transaction
    await client.query('BEGIN');
    
    const { user } = await findOrCreateUser(phoneNumber);
    
    // Record payment
    const paymentResult = await client.query(
      `INSERT INTO Payments
       (user_id, amount, currency, credits_purchased, payment_method, transaction_id)
       VALUES ($1, $2, 'GBP', $3, $4, $5)
       RETURNING *`,
      [user.id, amount, credits, paymentMethod, transactionId]
    );
    
    // Update user credits
    const userUpdateResult = await client.query(
      `UPDATE users
       SET credits_remaining = credits_remaining + $1
       WHERE id = $2
       RETURNING *`,
      [credits, user.id]
    );
    
    await client.query('COMMIT');
    
    return { 
      payment: paymentResult.rows[0], 
      user: userUpdateResult.rows[0] 
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// markUserIntroAsSeen - sets has_seen_intro to true
async function markUserIntroAsSeen(userId, req = null) {
  // Check for test mode
  if (req && isTestMode(req)) {
    logDetails('[TEST MODE] Marking intro as seen for user ID:', userId);
    dbTracker.addOperation('markUserIntroAsSeen', { userId });
    
    // Get mock response
    return getMockDbResponse('markUserIntroAsSeen', userId);
  }
  
  // Normal production code
  const client = await pool.connect();
  try {
    await client.query(
      'UPDATE users SET has_seen_intro = true WHERE id = $1',
      [userId]
    );
  } catch (error) {
    console.error('Error in markUserIntroAsSeen:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Get database operations recorded during testing
function getTestDbOperations() {
  return dbTracker.getOperations();
}

// Reset test database operations tracker
function resetTestDbOperations() {
  dbTracker.reset();
}

module.exports = {
  findOrCreateUser,
  checkUserCredits,
  recordTranscription,
  addCredits,
  getUserStats,
  markUserIntroAsSeen,
  getTestDbOperations,
  resetTestDbOperations
};
