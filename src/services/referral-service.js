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

// Special test code constants
const TEST_VALID_CODE = "TEST123";
const TEST_SELF_REFERRAL_CODE = "SELF123";
const TEST_ALREADY_USED_CODE = "USED123";
const TEST_MAXED_OUT_CODE = "FULL123";
const TEST_LIMIT_REACHED_CODE = "LIMIT123";

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
    
    // In test mode, return a predictable code for testing
    if (req.body && req.body.testGenerateCode === 'true') {
      return TEST_VALID_CODE;
    }
    
    // Default mock response
    return 'ABC125';
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
    
    // Save the new referral code with usage counter at 0
    await client.query(
      `UPDATE users SET referral_code = $1, referral_code_uses = 0 WHERE id = $2`,
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
  
  // Check for special test codes first (for easier testing)
  const testCodes = [TEST_VALID_CODE, TEST_SELF_REFERRAL_CODE, 
                    TEST_ALREADY_USED_CODE, TEST_MAXED_OUT_CODE,
                    TEST_LIMIT_REACHED_CODE];
  
  // Log the check for test codes in test mode
  console.log(`Checking for test codes in message: "${cleanedMessage}"`);
  
  for (const code of testCodes) {
    if (cleanedMessage === code) {
      console.log(`Found test code: ${code}`);
      return code;
    }
  }
  
  // Using regex to extract a valid code
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
  const MAX_USES_PER_CODE = 5; // Maximum number of times a code can be used
  
  // Special test mode handling for predictable testing
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
    
    // Special test codes that trigger specific behaviors in test mode
    if (referralCode === TEST_VALID_CODE) {
      // Success case with a valid code
      return {
        success: true,
        flow: 'referral_success',
        referrer: { 
          id: 1001, 
          phone_number: 'whatsapp:+44123456789', 
          referral_code_uses: 1,
          referral_code: TEST_VALID_CODE
        },
        referee: newUser,
        referrerCreditsAdded: REFERRAL_CREDIT_AMOUNT,
        refereeCreditsAdded: REFERRAL_CREDIT_AMOUNT,
        codeUsesRemaining: MAX_USES_PER_CODE - 1,
        testMode: true
      };
    }
    
    if (referralCode === TEST_SELF_REFERRAL_CODE) {
      // Self-referral error case
      return { 
        success: false, 
        flow: 'referral_self_use',
        error: 'SELF_REFERRAL',
        message: 'You cannot use your own referral code. Please share it with friends instead.',
        testMode: true
      };
    }
    
    if (referralCode === TEST_ALREADY_USED_CODE) {
      // Already used error case
      return { 
        success: false, 
        flow: 'referral_already_used',
        error: 'ALREADY_REFERRED',
        message: 'You\'ve already used this referral code.',
        testMode: true
      };
    }
    
    if (referralCode === TEST_MAXED_OUT_CODE) {
      // Maxed out error case
      return { 
        success: false, 
        flow: 'referral_code_maxed_out',
        error: 'CODE_MAXED_OUT',
        message: 'Sorry, this referral code has already been used 5 times and has expired.',
        testMode: true
      };
    }
    
    if (referralCode === TEST_LIMIT_REACHED_CODE) {
      // Referee limit reached case
      return {
        success: false,
        flow: 'referral_limit_reached',
        error: 'REFERRAL_LIMIT_REACHED',
        message: 'Thanks for using the referral code! However, you\'ve reached the maximum bonus credits from referrals (25). Your friend still received 5 credits for referring you.',
        referrerCreditsAdded: 5,
        refereeCreditsAdded: 0,
        testMode: true
      };
    }
    
    // Use mock DB if available
    if (req.mockDb && req.mockDb.processReferralCode) {
      return req.mockDb.processReferralCode(referralCode, newUser, req);
    }
    
    // For any other code in test mode, treat as invalid
    return { 
      success: false, 
      flow: 'referral_invalid',
      error: 'INVALID_CODE',
      message: 'Sorry, that referral code is invalid. Please check the code and try again.',
      testMode: true
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
    
    // 2. Check if code has reached maximum usage limit
    if (referrer.referral_code_uses >= MAX_USES_PER_CODE) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        error: 'CODE_MAXED_OUT',
        message: `This referral code has been used the maximum number of times (${MAX_USES_PER_CODE})` 
      };
    }
    
    // 3. Verify users aren't the same person
    if (referrer.id === newUser.id) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        error: 'SELF_REFERRAL',
        message: 'You cannot refer yourself' 
      };
    }
    
    // 4. Check if this referral already exists
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
    
    // 5. Check referral credit limits for both users
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
    
    // 6. Create referral record
    await client.query(
      `INSERT INTO referrals
       (referrer_id, referee_id, referrer_credits, referee_credits)
       VALUES ($1, $2, $3, $4)`,
      [referrer.id, newUser.id, referrerCredits, refereeCredits]
    );
    
    // 7. Increment the referral code usage counter
    await client.query(
      `UPDATE users SET referral_code_uses = referral_code_uses + 1 WHERE id = $1`,
      [referrer.id]
    );
    
    // 8. Add credits to both users if they haven't reached their limits
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
    
    // Get updated referrer info for use counter
    const updatedReferrerResult = await client.query(
      `SELECT id, phone_number, referral_code, referral_code_uses FROM users WHERE id = $1`,
      [referrer.id]
    );
    
    const updatedReferrer = updatedReferrerResult.rows[0];
    
    return {
      success: true,
      referrer: updatedReferrer,
      referee: updatedRefereeResult.rows[0],
      referrerCreditsAdded: referrerCredits,
      refereeCreditsAdded: refereeCredits,
      codeUsesRemaining: MAX_USES_PER_CODE - updatedReferrer.referral_code_uses
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
      maxReached: referralResult.refereeCreditsAdded === 0,
      codeUsesRemaining: referralResult.codeUsesRemaining
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
 * Send sequential low credits messages with referral info
 * 
 * @param {object} twilioClient - Initialized Twilio client
 * @param {string} userPhone - Phone number to send message to
 * @param {string} fromPhone - Phone number to send from
 * @param {object} user - User object
 * @param {string} referralCode - User's referral code
 * @param {number} estimatedMonths - Estimated months for 50 credits
 * @param {object} userStats - User usage statistics object
 * @param {object} [req=null] - Express request object (for test mode)
 * @returns {Promise<void>}
 */
async function sendSequentialLowCreditsMessages(twilioClient, userPhone, fromPhone, user, referralCode, estimatedMonths, userStats, req = null) {
  try {
    const userLang = getUserLanguage(userPhone);
    
    // Prepare context data for message templates
    const contextData = {
      totalTranscriptions: userStats.totalTranscriptions,
      totalWords: userStats.totalWords,
      totalSeconds: userStats.totalSeconds,
      referralCode: referralCode,
      estimatedMonths: estimatedMonths,
      plural: estimatedMonths !== 1,
      creditsRemaining: user.credits_remaining,
      codeUsesRemaining: user.referral_code_uses ? 5 - user.referral_code_uses : 5
    };
    
    logDetails('Sending sequential messages with data:', {
      userPhone,
      referralCode,
      totalTranscriptions: userStats.totalTranscriptions
    });
    
    // 1. Get and send heads-up message
    const headsUpMessage = await getLocalizedMessage('lowCreditsHeadsUp', userLang, contextData);
    
    if (twilioClient.isAvailable()) {
      // Send first message - heading
      logDetails('Sending first sequential message: heads-up');
      await twilioClient.sendMessage({
        body: headsUpMessage,
        from: fromPhone,
        to: userPhone
      });
      
      // Add delay between messages
      if (!req || !req.isTestMode) {
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        logDetails('In test mode - skipping delay between messages');
      }
      
      // 2. Get and send Option A (referral)
      const optionAMessage = await getLocalizedMessage('lowCreditsOptionA', userLang, contextData);
      
      logDetails('Sending second sequential message: option A (referral)');
      await twilioClient.sendMessage({
        body: optionAMessage,
        from: fromPhone,
        to: userPhone
      });
      
      // Add delay between messages
      if (!req || !req.isTestMode) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // 3. Get and send Option B (payment)
      const optionBMessage = await getLocalizedMessage('lowCreditsOptionB', userLang, contextData);
      
      logDetails('Sending third sequential message: option B (payment)');
      await twilioClient.sendMessage({
        body: optionBMessage,
        from: fromPhone,
        to: userPhone
      });
      
      logDetails('Completed sending all three sequential messages');
    } else {
      logDetails('Twilio client not available - unable to send sequential messages');
    }
  } catch (error) {
    logDetails('Error sending sequential low credits messages:', error);
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
      plural: user.credits_remaining !== 1,
      codeUsesRemaining: user.referral_code_uses ? 5 - user.referral_code_uses : 5
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

/**
 * Generate a new referral code when the old one reaches its usage limit
 * 
 * @param {number} userId - User ID to regenerate code for
 * @param {object} [req=null] - Express request object (for test mode)
 * @returns {Promise<string>} The new referral code
 */
async function regenerateReferralCode(userId, req = null) {
  // Check for test mode
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Regenerating referral code for user:', userId);
    
    // Track operation in test results
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'regenerateReferralCode',
        timestamp: new Date().toISOString(),
        details: { userId }
      });
    }
    
    // Default mock response
    return 'NEW123';
  }
  
  // Regular database operation
  const client = await pool.connect();
  try {
    // Generate a new unique referral code
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
    
    // Update the user with new code and reset usage counter
    await client.query(
      `UPDATE users SET referral_code = $1, referral_code_uses = 0 WHERE id = $2`,
      [newCode, userId]
    );
    
    return newCode;
  } catch (error) {
    logDetails('Error in regenerateReferralCode:', error);
    throw error;
  } finally {
    client.release();
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
    
    // Check for referral_code_uses column in users table
    const usesColumnCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'referral_code_uses'
      );
    `);
    
    if (!usesColumnCheck.rows[0].exists) {
      // Add referral_code_uses column to users table
      await client.query(`
        ALTER TABLE users
        ADD COLUMN referral_code_uses INTEGER NOT NULL DEFAULT 0;
      `);
      
      logDetails('Added referral_code_uses column to users table');
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
    
    // Create index for referral code usage lookups if not exists
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_referral_code_uses'
        ) THEN
          CREATE INDEX idx_users_referral_code_uses ON users(referral_code, referral_code_uses);
        END IF;
      END$$;
    `);
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
  sendSequentialLowCreditsMessages, // New function for sequential messages
  regenerateReferralCode,
  setupReferralSchema,
  // Export test codes for use in tests
  TEST_CODES: {
    VALID: TEST_VALID_CODE,
    SELF_REFERRAL: TEST_SELF_REFERRAL_CODE,
    ALREADY_USED: TEST_ALREADY_USED_CODE,
    MAXED_OUT: TEST_MAXED_OUT_CODE,
    LIMIT_REACHED: TEST_LIMIT_REACHED_CODE
  }
};
