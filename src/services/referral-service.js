// src/services/referral-service.js
/**
 * Service for managing user referrals and referral codes
 */

const { Pool } = require('pg');
const { logDetails } = require('../utils/logging-utils');
const creditManager = require('./credit-manager');
const { getLocalizedMessage, getUserLanguage } = require('../helpers/localization');

// Use the same pool configuration as in database.js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { 
    rejectUnauthorized: false 
  }
});

// All valid characters for referral codes - using your friend's approach
const ALLOWED_CHARS = "ABCDEFGHJKMNPRTUVWXY01258";

/**
 * Generate a random 6-character referral code
 * Using only valid characters (uppercase letters except I,L,O,Q,S,Z and numbers except 3,4,6,7,9)
 * 
 * @returns {string} Generated referral code
 */
function generateReferralCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    const randomIndex = Math.floor(Math.random() * ALLOWED_CHARS.length);
    code += ALLOWED_CHARS[randomIndex];
  }
  return code;
}

/**
 * Generate and save a referral code for a user
 * 
 * @param {number} userId - User ID to generate code for
 * @param {object} [req=null] - Express request object (for test mode)
 * @returns {Promise<string>} The generated referral code
 */
async function generateReferralCodeForUser(userId, req = null) {
  // Check for test mode
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Generating referral code for user:', userId);
    
    // Track operation in test results
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'generateReferralCodeForUser',
        timestamp: new Date().toISOString(),
        details: { userId }
      });
    }
    
    // Use mock DB if available
    if (req.mockDb && req.mockDb.generateReferralCodeForUser) {
      return req.mockDb.generateReferralCodeForUser(userId, req);
    }
    
    // Default mock response
    return 'ABC123';
  }
  
  // Regular database operation
  const client = await pool.connect();
  try {
    // Check if user already has a referral code
    const existingCode = await client.query(
      `SELECT referral_code FROM users WHERE id = $1`,
      [userId]
    );
    
    if (existingCode.rows[0]?.referral_code) {
      return existingCode.rows[0].referral_code;
    }
    
    // Generate a unique referral code
    let isUnique = false;
    let newCode;
    
    while (!isUnique) {
      newCode = generateReferralCode();
      
      // Check if code already exists
      const codeCheck = await client.query(
        `SELECT COUNT(*) FROM users WHERE referral_code = $1`,
        [newCode]
      );
      
      isUnique = parseInt(codeCheck.rows[0].count) === 0;
    }
    
    // Save the new referral code
    await client.query(
      `UPDATE users SET referral_code = $1 WHERE id = $2`,
      [newCode, userId]
    );
    
    return newCode;
  } catch (error) {
    logDetails('Error in generateReferralCodeForUser:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Extract a potential referral code from a message using regex
 * 
 * @param {string} message - Message to check for referral code
 * @returns {string|null} Extracted referral code or null if not found
 */
function extractReferralCodeFromMessage(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }
  
  // Convert to uppercase and trim
  const cleanedMessage = message.trim().toUpperCase();
  
  // Using regex to extract a valid code (as per your friend's suggestion)
  const pattern = new RegExp(`[${ALLOWED_CHARS}]{6}`);
  const match = cleanedMessage.match(pattern);
  
  return match ? match[0] : null;
}

/**
 * Process a referral code submitted by a user
 * 
 * @param {string} referralCode - The referral code being used
 * @param {object} newUser - User object of the person using the code
 * @param {object} [req=null] - Express request object (for test mode)
 * @returns {Promise<object>} Result of the referral process
 */
async function processReferralCode(referralCode, newUser, req = null) {
  const REFERRAL_CREDIT_AMOUNT = 5; // Credits given for successful referral
  
  // Check for test mode
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Processing referral code:', { referralCode, newUserId: newUser.id });
    
    // Track operation in test results
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'processReferralCode',
        timestamp: new Date().toISOString(),
        details: { referralCode, newUserId: newUser.id }
      });
    }
    
    // Use mock DB if available
    if (req.mockDb && req.mockDb.processReferralCode) {
      return req.mockDb.processReferralCode(referralCode, newUser, req);
    }
    
    // Default mock response
    return { 
      success: true,
      referrer: { id: 1001, phone_number: 'whatsapp:+1234567890' },
      referee: newUser,
      creditsAdded: REFERRAL_CREDIT_AMOUNT
    };
  }
  
  // Regular database operation
  const client = await pool.connect();
  try {
    // Start transaction
    await client.query('BEGIN');
    
    // 1. Find the referrer (user who owns the code)
    const referrerResult = await client.query(
      `SELECT * FROM users WHERE referral_code = $1`,
      [referralCode]
    );
    
    if (referrerResult.rows.length === 0) {
      // Invalid referral code
      await client.query('ROLLBACK');
      return { 
        success: false, 
        error: 'INVALID_CODE',
        message: 'Invalid referral code' 
      };
    }
    
    const referrer = referrerResult.rows[0];
    
    // 2. Verify users aren't the same person
    if (referrer.id === newUser.id) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        error: 'SELF_REFERRAL',
        message: 'You cannot refer yourself' 
      };
    }
    
    // 3. Check if this referral already exists
    const existingReferralCheck = await client.query(
      `SELECT * FROM referrals 
       WHERE referrer_id = $1 AND referee_id = $2`,
      [referrer.id, newUser.id]
    );
    
    if (existingReferralCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        error: 'ALREADY_REFERRED',
        message: 'This referral has already been processed' 
      };
    }
    
    // 4. Check referral credit limits for both users
    const referrerLimitCheck = await creditManager.checkReferralCreditLimit(referrer.id);
    const refereeLimitCheck = await creditManager.checkReferralCreditLimit(newUser.id);
    
    // Calculate how many credits each can receive (up to 5)
    const referrerCredits = Math.min(
      REFERRAL_CREDIT_AMOUNT, 
      referrerLimitCheck.remainingReferralCredits
    );
    
    const refereeCredits = Math.min(
      REFERRAL_CREDIT_AMOUNT, 
      refereeLimitCheck.remainingReferralCredits
    );
    
    // 5. Create referral record
    await client.query(
      `INSERT INTO referrals
       (referrer_id, referee_id, referrer_credits, referee_credits)
       VALUES ($1, $2, $3, $4)`,
      [referrer.id, newUser.id, referrerCredits, refereeCredits]
    );
    
    // 6. Add credits to both users if they haven't reached their limits
    if (referrerCredits > 0) {
      await creditManager.addCreditsToUser(
        referrer.id, 
        referrerCredits,
        creditManager.CREDIT_OPERATIONS.REFERRAL_BONUS,
        { referredUser: newUser.id }
      );
    }
    
    if (refereeCredits > 0) {
      await creditManager.addCreditsToUser(
        newUser.id, 
        refereeCredits,
        creditManager.CREDIT_OPERATIONS.REFERRAL_RECEIVED,
        { referrerUser: referrer.id }
      );
    }
    
    await client.query('COMMIT');
    
    // Return success result with updated user info
    const updatedRefereeResult = await client.query(
      `SELECT * FROM users WHERE id = $1`,
      [newUser.id]
    );
    
    return {
      success: true,
      referrer,
      referee: updatedRefereeResult.rows[0],
      referrerCreditsAdded: referrerCredits,
      refereeCreditsAdded: refereeCredits
    };
  } catch (error) {
    await client.query('ROLLBACK');
    logDetails('Error in processReferralCode:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Send a referral success message to the user who entered the code
 * 
 * @param {object} twilioClient - Initialized Twilio client
 * @param {string} userPhone - Phone number to send message to
 * @param {string} fromPhone - Phone number to send from
 * @param {object} referralResult - Result from processReferralCode
 * @param {object} [req=null] - Express request object (for test mode)
 * @returns {Promise<void>}
 */
async function sendReferralSuccessMessage(twilioClient, userPhone, fromPhone, referralResult, req = null) {
  try {
    const userLang = getUserLanguage(userPhone);
    
    // Get localized message from languages.json
    const messageKey = referralResult.refereeCreditsAdded > 0 ? 'referralSuccess' : 'referralLimitReached';
    
    const messageData = {
      refereeCredits: referralResult.refereeCreditsAdded,
      referrerCredits: referralResult.referrerCreditsAdded,
      maxReached: referralResult.refereeCreditsAdded === 0
    };
    
    // Try to get localized version from language.json
    const message = await getLocalizedMessage(messageKey, userLang, messageData);
    
    // Send the message via Twilio
    if (twilioClient.isAvailable()) {
      await twilioClient.sendMessage({
        body: message,
        from: fromPhone,
        to: userPhone
      });
    }
  } catch (error) {
    logDetails('Error sending referral success message:', error);
    // We don't throw the error here to prevent affecting the main process
  }
}

/**
 * Send a low credits message with referral info
 * 
 * @param {object} twilioClient - Initialized Twilio client
 * @param {string} userPhone - Phone number to send message to
 * @param {string} fromPhone - Phone number to send from
 * @param {object} user - User object
 * @param {string} referralCode - User's referral code
 * @param {number} estimatedMonths - Estimated months for 50 credits
 * @param {object} [req=null] - Express request object (for test mode)
 * @returns {Promise<void>}
 */
async function sendLowCreditsWithReferralInfo(twilioClient, userPhone, fromPhone, user, referralCode, estimatedMonths, req = null) {
  try {
    const userLang = getUserLanguage(userPhone);
    
    // Get localized message from languages.json
    const messageData = {
      creditsRemaining: user.credits_remaining,
      referralCode,
      estimatedMonths,
      plural: user.credits_remaining !== 1
    };
    
    // Get the "lowCreditsReferral" message from languages.json
    const message = await getLocalizedMessage('lowCreditsReferral', userLang, messageData);
    
    // Send the message via Twilio
    if (twilioClient.isAvailable()) {
      await twilioClient.sendMessage({
        body: message,
        from: fromPhone,
        to: userPhone
      });
    }
  } catch (error) {
    logDetails('Error sending low credits referral message:', error);
    // We don't throw the error here to prevent affecting the main process
  }
}

// Set up database schema for referrals if needed
async function setupReferralSchema() {
  const client = await pool.connect();
  try {
    // Check if the referrals table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'referrals'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      // Create referrals table
      await client.query(`
        CREATE TABLE referrals (
          id SERIAL PRIMARY KEY,
          referrer_id INTEGER NOT NULL REFERENCES users(id),
          referee_id INTEGER NOT NULL REFERENCES users(id),
          referrer_credits INTEGER NOT NULL DEFAULT 0,
          referee_credits INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(referrer_id, referee_id)
        );
      `);
      
      logDetails('Created referrals table');
    }
    
    // Check for referral_code column in users table
    const columnCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'referral_code'
      );
    `);
    
    if (!columnCheck.rows[0].exists) {
      // Add referral_code column to users table
      await client.query(`
        ALTER TABLE users
        ADD COLUMN referral_code VARCHAR(10) UNIQUE;
      `);
      
      logDetails('Added referral_code column to users table');
    }
    
    // Check for credit_transactions table
    const creditTxTableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'credit_transactions'
      );
    `);
    
    if (!creditTxTableCheck.rows[0].exists) {
      // Create credit_transactions table
      await client.query(`
        CREATE TABLE credit_transactions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id),
          credits_amount INTEGER NOT NULL,
          operation_type VARCHAR(50) NOT NULL,
          metadata JSONB,
          created_at TIMESTAMP NOT NULL DEFAULT NOW()
        );
      `);
      
      logDetails('Created credit_transactions table');
    }
  } catch (error) {
    logDetails('Error setting up referral schema:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  generateReferralCode,
  generateReferralCodeForUser,
  extractReferralCodeFromMessage,
  processReferralCode,
  sendReferralSuccessMessage,
  sendLowCreditsWithReferralInfo,
  setupReferralSchema
};
