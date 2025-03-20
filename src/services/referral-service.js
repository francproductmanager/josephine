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
  ssl: { rejectUnauthorized: false }
});

// All valid characters for referral codes - using characters that are less likely to be confused
const ALLOWED_CHARS = "ABCDEFGHJKMNPRTUVWXY01258";

// Special test code constants - these MUST follow the same pattern rules as real codes
const TEST_CODES = {
  VALID: "TEST123",
  SELF_REFERRAL: "SELF123",
  ALREADY_USED: "USED123",
  MAXED_OUT: "FULL123",
  LIMIT_REACHED: "LIMIT123"
};

/**
 * Generate a random 6-character referral code
 * Using only valid characters (uppercase letters except I, L, O, Q, S, Z and numbers except 3,4,6,7,9)
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
 * Extract a potential referral code from a message using regex
 * @param {string} message - Message to check for referral code
 * @returns {string|null} Extracted referral code or null if not found
 */
function extractReferralCodeFromMessage(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }
  
  const cleanedMessage = message.trim().toUpperCase();
  logDetails(`[REFERRAL DEBUG] Checking message: "${cleanedMessage}"`);
  
  if (cleanedMessage === TEST_CODES.VALID ||
      cleanedMessage === TEST_CODES.SELF_REFERRAL ||
      cleanedMessage === TEST_CODES.ALREADY_USED ||
      cleanedMessage === TEST_CODES.MAXED_OUT ||
      cleanedMessage === TEST_CODES.LIMIT_REACHED) {
    logDetails(`[REFERRAL DEBUG] Found exact match with test code: ${cleanedMessage}`);
    return cleanedMessage;
  }
  
  const pattern = new RegExp(`[${ALLOWED_CHARS}]{6}`);
  const match = cleanedMessage.match(pattern);
  if (!match) {
    logDetails(`[REFERRAL DEBUG] No valid code pattern found in message: "${cleanedMessage}"`);
    return null;
  }
  
  const extractedCode = match[0];
  logDetails(`[REFERRAL DEBUG] Found pattern-matched code: ${extractedCode}`);
  return extractedCode;
}

/**
 * Send a referral success message to the user who entered the code.
 * This function uses getLocalizedMessage with a context object to replace placeholders.
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
    // Choose message key based on whether the referee received any credits
    const messageKey = referralResult.refereeCreditsAdded > 0 ? 'referralSuccess' : 'referralLimitReached';
    
    // Prepare a context object with actual values to replace the placeholders
    const messageData = {
      refereeCredits: referralResult.refereeCreditsAdded,
      referrerCredits: referralResult.referrerCreditsAdded,
      codeUsesRemaining: referralResult.codeUsesRemaining
    };
    
    logDetails('[REFERRAL] Message data for template:', messageData);
    
    // Retrieve the localized message with placeholder replacement
    const message = await getLocalizedMessage(messageKey, userLang, messageData);
    
    // As a fallback, if placeholders remain, perform manual replacement
    if (message.includes('{refereeCredits}') || message.includes('{referrerCredits}')) {
      const finalMessage = message
        .replace(/{refereeCredits}/g, referralResult.refereeCreditsAdded)
        .replace(/{referrerCredits}/g, referralResult.referrerCreditsAdded);
      logDetails('[REFERRAL] Using manually fixed message template');
      
      if (twilioClient.isAvailable()) {
        await twilioClient.sendMessage({
          body: finalMessage,
          from: fromPhone,
          to: userPhone
        });
      }
    } else {
      if (twilioClient.isAvailable()) {
        await twilioClient.sendMessage({
          body: message,
          from: fromPhone,
          to: userPhone
        });
      }
    }
  } catch (error) {
    logDetails('Error sending referral success message:', error);
  }
}

/**
 * Process a referral code submitted by a user.
 * @param {string} referralCode - The referral code being used
 * @param {object} newUser - User object of the person using the code
 * @param {object} [req=null] - Express request object (for test mode)
 * @returns {Promise<object>} Result of the referral process
 */
async function processReferralCode(referralCode, newUser, req = null) {
  const REFERRAL_CREDIT_AMOUNT = 5;
  const MAX_USES_PER_CODE = 5;
  
  logDetails(`Processing referral code: ${referralCode} for user: ${newUser.phone_number}`);
  
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Processing referral code:', { referralCode, newUserId: newUser.id });
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'processReferralCode',
        timestamp: new Date().toISOString(),
        details: { referralCode, newUserId: newUser.id }
      });
    }
    
    if (referralCode === TEST_CODES.VALID) {
      return {
        success: true,
        flow: 'referral_success',
        referrer: { 
          id: 1001, 
          phone_number: 'whatsapp:+44123456789', 
          referral_code_uses: 1,
          referral_code: TEST_CODES.VALID
        },
        referee: newUser,
        referrerCreditsAdded: REFERRAL_CREDIT_AMOUNT,
        refereeCreditsAdded: REFERRAL_CREDIT_AMOUNT,
        codeUsesRemaining: MAX_USES_PER_CODE - 1,
        testMode: true
      };
    }
    
    if (referralCode === TEST_CODES.SELF_REFERRAL) {
      return { 
        success: false, 
        flow: 'referral_self_use',
        error: 'SELF_REFERRAL',
        message: 'You cannot use your own referral code. Please share it with friends instead.',
        testMode: true
      };
    }
    
    if (referralCode === TEST_CODES.ALREADY_USED) {
      return { 
        success: false, 
        flow: 'referral_already_used',
        error: 'ALREADY_REFERRED',
        message: "You've already used this referral code.",
        testMode: true
      };
    }
    
    if (referralCode === TEST_CODES.MAXED_OUT) {
      return { 
        success: false, 
        flow: 'referral_code_maxed_out',
        error: 'CODE_MAXED_OUT',
        message: 'Sorry, this referral code has already been used 5 times and has expired.',
        testMode: true
      };
    }
    
    if (referralCode === TEST_CODES.LIMIT_REACHED) {
      return {
        success: false,
        flow: 'referral_limit_reached',
        error: 'REFERRAL_LIMIT_REACHED',
        message: "Thanks for using the referral code! However, you've reached the maximum bonus credits from referrals (25). Your friend still received 5 credits for referring you.",
        referrerCreditsAdded: REFERRAL_CREDIT_AMOUNT,
        refereeCreditsAdded: 0,
        testMode: true
      };
    }
    
    return { 
      success: false, 
      flow: 'referral_invalid',
      error: 'INVALID_CODE',
      message: 'Sorry, that referral code is invalid. Please check the code and try again.',
      testMode: true
    };
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const referrerResult = await client.query(
      `SELECT * FROM users WHERE referral_code = $1`,
      [referralCode]
    );
    
    if (referrerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        error: 'INVALID_CODE',
        message: 'Invalid referral code' 
      };
    }
    
    const referrer = referrerResult.rows[0];
    
    if (referrer.referral_code_uses >= MAX_USES_PER_CODE) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        error: 'CODE_MAXED_OUT',
        message: `This referral code has been used the maximum number of times (${MAX_USES_PER_CODE})` 
      };
    }
    
    if (referrer.id === newUser.id) {
      await client.query('ROLLBACK');
      return { 
        success: false, 
        error: 'SELF_REFERRAL',
        message: 'You cannot refer yourself' 
      };
    }
    
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
    
    const referrerLimitCheck = await creditManager.checkReferralCreditLimit(referrer.id);
    const refereeLimitCheck = await creditManager.checkReferralCreditLimit(newUser.id);
    
    const referrerCredits = Math.min(
      REFERRAL_CREDIT_AMOUNT, 
      referrerLimitCheck.remainingReferralCredits
    );
    
    const refereeCredits = Math.min(
      REFERRAL_CREDIT_AMOUNT, 
      refereeLimitCheck.remainingReferralCredits
    );
    
    await client.query(
      `INSERT INTO referrals
       (referrer_id, referee_id, referrer_credits, referee_credits)
       VALUES ($1, $2, $3, $4)`,
      [referrer.id, newUser.id, referrerCredits, refereeCredits]
    );
    
    await client.query(
      `UPDATE users SET referral_code_uses = referral_code_uses + 1 WHERE id = $1`,
      [referrer.id]
    );
    
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
    
    const updatedRefereeResult = await client.query(
      `SELECT * FROM users WHERE id = $1`,
      [newUser.id]
    );
    
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

module.exports = {
  generateReferralCode,
  extractReferralCodeFromMessage,
  sendReferralSuccessMessage,
  processReferralCode
};
