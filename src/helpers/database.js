// src/helpers/database.js
const { Pool } = require('pg');
const { detectCountryCode } = require('./localization');
const { logDetails } = require('../utils/logging-utils');

// Create a connection pool with timeout settings
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { 
    rejectUnauthorized: false 
  },
  statement_timeout: 5000, // 5 second timeout for queries
  connectionTimeoutMillis: 10000, // 10 second timeout for connecting
  max: 20, // Maximum 20 clients in pool (default is 10)
  idleTimeoutMillis: 30000 // Close idle clients after 30 seconds
});

// Add pool error handler
pool.on('error', (err, client) => {
  logDetails('Unexpected error on idle database client:', err);
  // Don't crash on connection errors
});

// Check if a user exists by phone number, create if not
async function findOrCreateUser(phoneNumber, req = null) {
  // Check for test mode
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Finding or creating user:', phoneNumber);
    
    // Track the operation if we're tracking test results
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'findOrCreateUser',
        timestamp: new Date().toISOString(),
        details: { phoneNumber }
      });
    }
    
    // Use mock DB if available
    if (req.mockDb && req.mockDb.findOrCreateUser) {
      return req.mockDb.findOrCreateUser(phoneNumber, req);
    }
    
    // Default mock response if no mockDb available
    return { 
      user: {
        id: 1001,
        phone_number: phoneNumber,
        country_code: detectCountryCode(phoneNumber),
        credits_remaining: 50,
        free_trial_used: false,
        has_seen_intro: false,
        usage_count: 0,
        total_seconds: 0
      }, 
      created: false 
    };
  }
  
  // Normal production code
  let client = null;
  try {
    client = await pool.connect();
    logDetails(`DB operation: Connecting to find/create user: ${phoneNumber}`);
    
    // Normalize the phone number - store the full WhatsApp format
    let normalizedPhone = phoneNumber;
    let countryCode = detectCountryCode(phoneNumber);

    logDetails(`Looking for user with phone: ${normalizedPhone}, country code: ${countryCode}`);

    // Check if user exists
    let result = await client.query(
      'SELECT * FROM users WHERE phone_number = $1',
      [normalizedPhone]
    );
    
    if (result.rows.length > 0) {
      logDetails(`User found: ${normalizedPhone}`);
      return { user: result.rows[0], created: false };
    }
    
    // Create new user with has_seen_intro = false
    logDetails(`Creating new user: ${normalizedPhone}`);
    result = await client.query(
      `INSERT INTO users 
       (phone_number, country_code, credits_remaining, free_trial_used, has_seen_intro) 
       VALUES ($1, $2, 50, false, false) 
       RETURNING *`,
      [normalizedPhone, countryCode]
    );
    
    return { user: result.rows[0], created: true };
  } catch (error) {
    logDetails('Error in findOrCreateUser:', error);
    throw error;
  } finally {
    if (client) {
      logDetails('Releasing database client from findOrCreateUser');
      client.release();
    }
  }
}

// Check if user has available credits
async function checkUserCredits(phoneNumber, req = null) {
  // Check for test mode
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Checking credits for user:', phoneNumber);
    
    // Track the operation if we're tracking test results
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'checkUserCredits',
        timestamp: new Date().toISOString(),
        details: { phoneNumber }
      });
    }
    
    // Use mock DB if available
    if (req.mockDb && req.mockDb.checkUserCredits) {
      return req.mockDb.checkUserCredits(phoneNumber, req);
    }
    
    // Default mock behavior with test overrides
    let credits = 50;
    let freeTrialUsed = false;
    
    if (req.body) {
      if (req.body.testNoCredits === 'true') {
        credits = 0;
        freeTrialUsed = true;
      } else if (req.body.testLowCredits === 'true') {
        credits = 1;
      }
    }
    
    return {
      canProceed: credits > 0,
      creditsRemaining: credits,
      isFreeTrialUsed: freeTrialUsed,
      warningLevel: credits <= 10 ? 
                  (credits <= 5 ? 'urgent' : 'warning') 
                  : 'none'
    };
  }
  
  // Normal production code
  let client = null;
  try {
    client = await pool.connect();
    logDetails(`DB operation: Checking credits for user: ${phoneNumber}`);
    const { user } = await findOrCreateUser(phoneNumber);
    
    return {
      canProceed: user.credits_remaining > 0,
      creditsRemaining: user.credits_remaining,
      isFreeTrialUsed: user.free_trial_used,
      warningLevel: user.credits_remaining <= 10 ? 
                    (user.credits_remaining <= 5 ? 'urgent' : 'warning') 
                    : 'none'
    };
  } catch (error) {
    logDetails('Error in checkUserCredits:', error);
    throw error;
  } finally {
    if (client) {
      logDetails('Releasing database client from checkUserCredits');
      client.release();
    }
  }
}

// Get complete user stats
async function getUserStats(phoneNumber, req = null) {
  // Check for test mode
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Getting stats for user:', phoneNumber);
    
    // Track the operation if we're tracking test results
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'getUserStats',
        timestamp: new Date().toISOString(),
        details: { phoneNumber }
      });
    }
    
    // Use mock DB if available
    if (req.mockDb && req.mockDb.getUserStats) {
      return req.mockDb.getUserStats(phoneNumber, req);
    }
    
    // Default mock response
    return {
      totalSeconds: 120,
      totalWords: 500,
      totalTranscriptions: 5,
      creditsRemaining: 45,
      freeTrialUsed: false
    };
  }
  
  // Normal production code
  let client = null;
  try {
    client = await pool.connect();
    logDetails(`DB operation: Getting stats for user: ${phoneNumber}`);
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
  } catch (error) {
    logDetails('Error in getUserStats:', error);
    throw error;
  } finally {
    if (client) {
      logDetails('Releasing database client from getUserStats');
      client.release();
    }
  }
}

// Record a transcription and update user stats
async function recordTranscription(phoneNumber, audioLengthSeconds, wordCount, openAICost, twilioCost, req = null) {
  // Check for test mode
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Recording transcription for user:', phoneNumber);
    
    // Track the operation if we're tracking test results
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'recordTranscription',
        timestamp: new Date().toISOString(),
        details: { 
          phoneNumber, 
          audioLengthSeconds, 
          wordCount, 
          openAICost, 
          twilioCost 
        }
      });
    }
    
    // Use mock DB if available
    if (req.mockDb && req.mockDb.recordTranscription) {
      return req.mockDb.recordTranscription(
        phoneNumber, 
        audioLengthSeconds, 
        wordCount, 
        openAICost, 
        twilioCost, 
        req
      );
    }
    
    // Default mock response
    return { 
      transcription: {
        id: 12345,
        user_id: 1001,
        audio_length: audioLengthSeconds,
        word_count: wordCount,
        openai_cost: openAICost,
        twilio_cost: twilioCost,
        total_cost: openAICost + twilioCost,
        created_at: new Date().toISOString()
      }, 
      user: {
        id: 1001,
        phone_number: phoneNumber,
        country_code: detectCountryCode(phoneNumber),
        credits_remaining: 49,
        free_trial_used: false,
        has_seen_intro: true,
        usage_count: 1,
        total_seconds: audioLengthSeconds
      } 
    };
  }
  
  // Normal production code
  let client = null;
  try {
    client = await pool.connect();
    logDetails(`DB operation: Recording transcription for user: ${phoneNumber}`);
    
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
    if (client) {
      await client.query('ROLLBACK');
    }
    logDetails('Error in recordTranscription:', error);
    throw error;
  } finally {
    if (client) {
      logDetails('Releasing database client from recordTranscription');
      client.release();
    }
  }
}

// Add credits after payment
async function addCredits(phoneNumber, credits, amount, paymentMethod, transactionId, req = null) {
  // Check for test mode
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Adding credits for user:', phoneNumber);
    
    // Track the operation if we're tracking test results
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'addCredits',
        timestamp: new Date().toISOString(),
        details: { 
          phoneNumber, 
          credits,
          amount,
          paymentMethod,
          transactionId
        }
      });
    }
    
    // Use mock DB if available
    if (req.mockDb && req.mockDb.addCredits) {
      return req.mockDb.addCredits(
        phoneNumber, 
        credits, 
        amount, 
        paymentMethod, 
        transactionId, 
        req
      );
    }
    
    // Default mock response
    return { 
      payment: {
        id: 54321,
        user_id: 1001,
        amount: amount,
        currency: 'GBP',
        credits_purchased: credits,
        payment_method: paymentMethod,
        transaction_id: transactionId,
        created_at: new Date().toISOString()
      }, 
      user: {
        id: 1001,
        phone_number: phoneNumber,
        country_code: detectCountryCode(phoneNumber),
        credits_remaining: 50 + credits,
        free_trial_used: false,
        has_seen_intro: true
      } 
    };
  }
  
  // Normal production code
  let client = null;
  try {
    client = await pool.connect();
    logDetails(`DB operation: Adding ${credits} credits for user: ${phoneNumber}`);
    
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
    if (client) {
      await client.query('ROLLBACK');
    }
    logDetails('Error in addCredits:', error);
    throw error;
  } finally {
    if (client) {
      logDetails('Releasing database client from addCredits');
      client.release();
    }
  }
}

// markUserIntroAsSeen - sets has_seen_intro to true
async function markUserIntroAsSeen(userId, req = null) {
  // Check for test mode
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Marking intro as seen for user ID:', userId);
    
    // Track the operation if we're tracking test results
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'markUserIntroAsSeen',
        timestamp: new Date().toISOString(),
        details: { userId }
      });
    }
    
    // Use mock DB if available
    if (req.mockDb && req.mockDb.markUserIntroAsSeen) {
      return req.mockDb.markUserIntroAsSeen(userId, req);
    }
    
    // Default mock response
    return true;
  }
  
  // Normal production code
  let client = null;
  try {
    client = await pool.connect();
    logDetails(`DB operation: Marking intro as seen for user ID: ${userId}`);
    await client.query(
      'UPDATE users SET has_seen_intro = true WHERE id = $1',
      [userId]
    );
    return true;
  } catch (error) {
    logDetails('Error in markUserIntroAsSeen:', error);
    throw error;
  } finally {
    if (client) {
      logDetails('Releasing database client from markUserIntroAsSeen');
      client.release();
    }
  }
}

module.exports = {
  findOrCreateUser,
  checkUserCredits,
  recordTranscription,
  addCredits,
  getUserStats,
  markUserIntroAsSeen
};
