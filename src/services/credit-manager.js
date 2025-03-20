// src/services/credit-manager.js
/**
 * Central service for managing user credits across different sources
 * (payments, referrals, etc.)
 */

const { Pool } = require('pg');
const { logDetails } = require('../utils/logging-utils');

// Use the same pool configuration as in database.js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { 
    rejectUnauthorized: false 
  },
  statement_timeout: 5000, // 5 second timeout for queries
  connectionTimeoutMillis: 10000, // 10 second timeout for connecting
  max: 20, // Maximum 20 clients in pool
  idleTimeoutMillis: 30000 // Close idle clients after 30 seconds
});

// Add pool error handler
pool.on('error', (err, client) => {
  logDetails('Unexpected error on idle database client in credit manager:', err);
  // Don't crash on connection errors
});

/**
 * Credit operation types
 */
const CREDIT_OPERATIONS = {
  PAYMENT: 'payment',
  REFERRAL_BONUS: 'referral_bonus',
  REFERRAL_RECEIVED: 'referral_received',
  INITIAL_FREE: 'initial_free',
  PROMOTIONAL: 'promotional'
};

/**
 * Add credits to a user account with transaction tracking
 * 
 * @param {number} userId - The user ID to add credits to
 * @param {number} creditAmount - Number of credits to add
 * @param {string} operationType - Type of credit operation (see CREDIT_OPERATIONS)
 * @param {object} metadata - Additional info about the operation
 * @param {object} [req=null] - Express request object (for test mode)
 * @returns {Promise<object>} Updated user and credit transaction data
 */
async function addCreditsToUser(userId, creditAmount, operationType, metadata = {}, req = null) {
  // Check for test mode
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Adding credits to user:', { userId, creditAmount, operationType });
    
    // Track the operation if we're tracking test results
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'addCreditsToUser',
        timestamp: new Date().toISOString(),
        details: { userId, creditAmount, operationType, metadata }
      });
    }
    
    // Use mock DB if available
    if (req.mockDb && req.mockDb.addCreditsToUser) {
      return req.mockDb.addCreditsToUser(userId, creditAmount, operationType, metadata, req);
    }
    
    // Default mock response
    return { 
      user: {
        id: userId,
        credits_remaining: 50 + creditAmount
      },
      transaction: {
        id: Math.floor(10000 + Math.random() * 90000),
        user_id: userId,
        credits_amount: creditAmount,
        operation_type: operationType,
        metadata: metadata,
        created_at: new Date().toISOString()
      }
    };
  }
  
  // Regular database operation
  let client = null;
  try {
    logDetails(`DB operation: Adding ${creditAmount} credits to user ID: ${userId}, operation: ${operationType}`);
    client = await pool.connect();
    
    // Start transaction
    logDetails(`Credit manager: Starting transaction for adding credits`);
    await client.query('BEGIN');
    
    // 1. Record the credit transaction
    logDetails(`Credit manager: Recording credit transaction`);
    const creditTxResult = await client.query(
      `INSERT INTO credit_transactions
       (user_id, credits_amount, operation_type, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, creditAmount, operationType, JSON.stringify(metadata)]
    );
    
    // 2. Update user credits
    logDetails(`Credit manager: Updating user credits`);
    const userUpdateResult = await client.query(
      `UPDATE users
       SET credits_remaining = credits_remaining + $1
       WHERE id = $2
       RETURNING *`,
      [creditAmount, userId]
    );
    
    // Check if update was successful
    if (userUpdateResult.rows.length === 0) {
      throw new Error(`User with ID ${userId} not found`);
    }
    
    logDetails(`Credit manager: Committing transaction`);
    await client.query('COMMIT');
    
    logDetails(`Credit manager: Successfully added ${creditAmount} credits to user ${userId}`);
    return {
      user: userUpdateResult.rows[0],
      transaction: creditTxResult.rows[0]
    };
  } catch (error) {
    // Rollback transaction on error
    if (client) {
      try {
        await client.query('ROLLBACK');
        logDetails('Credit manager: Transaction rolled back due to error');
      } catch (rollbackError) {
        logDetails('Credit manager: Error during rollback:', rollbackError);
      }
    }
    logDetails('Error in addCreditsToUser:', error);
    throw error;
  } finally {
    if (client) {
      try {
        logDetails('Credit manager: Releasing database client');
        client.release();
      } catch (releaseError) {
        logDetails('Credit manager: Error releasing client:', releaseError);
      }
    }
  }
}

/**
 * Check if a user has reached their referral credit limit
 * 
 * @param {number} userId - User ID to check
 * @param {object} [req=null] - Express request object (for test mode)
 * @returns {Promise<object>} Object with hasReachedLimit and totalReferralCredits
 */
async function checkReferralCreditLimit(userId, req = null) {
  const LIFETIME_REFERRAL_LIMIT = 25; // Maximum credits from referrals
  
  // Check for test mode
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Checking referral credit limit for user:', userId);
    
    // Track operation in test results
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'checkReferralCreditLimit',
        timestamp: new Date().toISOString(),
        details: { userId }
      });
    }
    
    // Use mock DB if available
    if (req.mockDb && req.mockDb.checkReferralCreditLimit) {
      return req.mockDb.checkReferralCreditLimit(userId, req);
    }
    
    // Default mock response - simulate user has received 15 referral credits
    const mockReferralCredits = 15;
    return {
      hasReachedLimit: mockReferralCredits >= LIFETIME_REFERRAL_LIMIT,
      totalReferralCredits: mockReferralCredits,
      remainingReferralCredits: LIFETIME_REFERRAL_LIMIT - mockReferralCredits
    };
  }
  
  // Regular database operation
  let client = null;
  try {
    logDetails(`DB operation: Checking referral credit limit for user: ${userId}`);
    client = await pool.connect();
    
    // Get all credits from referrals (both giving and receiving)
    const result = await client.query(
      `SELECT COALESCE(SUM(credits_amount), 0) as total_referral_credits
       FROM credit_transactions
       WHERE user_id = $1 
       AND (operation_type = $2 OR operation_type = $3)`,
      [userId, CREDIT_OPERATIONS.REFERRAL_BONUS, CREDIT_OPERATIONS.REFERRAL_RECEIVED]
    );
    
    const totalReferralCredits = parseInt(result.rows[0]?.total_referral_credits || 0);
    
    return {
      hasReachedLimit: totalReferralCredits >= LIFETIME_REFERRAL_LIMIT,
      totalReferralCredits,
      remainingReferralCredits: Math.max(0, LIFETIME_REFERRAL_LIMIT - totalReferralCredits)
    };
  } catch (error) {
    logDetails('Error in checkReferralCreditLimit:', error);
    throw error;
  } finally {
    if (client) {
      try {
        logDetails('Credit manager: Releasing database client from checkReferralCreditLimit');
        client.release();
      } catch (releaseError) {
        logDetails('Credit manager: Error releasing client:', releaseError);
      }
    }
  }
}

/**
 * Check if a user is eligible to receive a referral code
 * 
 * @param {object} user - User object 
 * @returns {boolean} True if user should receive a referral code
 */
function shouldGenerateReferralCode(user) {
  // Generate code when user has 4 credits left and is still in free trial
  return user.credits_remaining <= 4 && !user.free_trial_used;
}

/**
 * Calculate estimated months of usage based on user history
 * 
 * @param {number} userId - User ID to check
 * @param {object} [req=null] - Express request object (for test mode)
 * @returns {Promise<number>} Estimated months that 50 credits will last
 */
async function calculateUsageEstimate(userId, req = null) {
  // Check for test mode
  if (req && req.isTestMode) {
    logDetails('[TEST MODE] Calculating usage estimate for user:', userId);
    
    // Track operation in test results
    if (req.testResults) {
      req.testResults.dbOperations.push({
        type: 'calculateUsageEstimate',
        timestamp: new Date().toISOString(),
        details: { userId }
      });
    }
    
    // Use mock DB if available
    if (req.mockDb && req.mockDb.calculateUsageEstimate) {
      return req.mockDb.calculateUsageEstimate(userId, req);
    }
    
    // Default mock response
    return 3; // 3 months estimate
  }
  
  // Regular database operation
  let client = null;
  try {
    logDetails(`DB operation: Calculating usage estimate for user: ${userId}`);
    client = await pool.connect();
    
    // Get user's first usage date and total usage
    const result = await client.query(
      `SELECT 
         MIN(created_at) as first_usage,
         COUNT(*) as total_transcriptions,
         MAX(created_at) as last_usage
       FROM Transcriptions
       WHERE user_id = $1`,
      [userId]
    );
    
    if (!result.rows[0] || !result.rows[0].first_usage) {
      return 3; // Default estimate if no usage history
    }
    
    const firstUsage = new Date(result.rows[0].first_usage);
    const lastUsage = new Date(result.rows[0].last_usage);
    const totalTranscriptions = parseInt(result.rows[0].total_transcriptions);
    
    // Calculate usage rate (transcriptions per day)
    const usageDays = Math.max(1, Math.round((lastUsage - firstUsage) / (1000 * 60 * 60 * 24)));
    const dailyRate = totalTranscriptions / usageDays;
    
    // Estimate how long 50 credits will last in months
    const daysFor50Credits = dailyRate > 0 ? 50 / dailyRate : 90; // Default to 3 months if no usage
    const monthsEstimate = Math.round(daysFor50Credits / 30);
    
    // Return at least 1 month, at most 12 months
    return Math.max(1, Math.min(12, monthsEstimate));
  } catch (error) {
    logDetails('Error in calculateUsageEstimate:', error);
    return 3; // Default fallback on error
  } finally {
    if (client) {
      try {
        logDetails('Credit manager: Releasing database client from calculateUsageEstimate');
        client.release();
      } catch (releaseError) {
        logDetails('Credit manager: Error releasing client:', releaseError);
      }
    }
  }
}

module.exports = {
  CREDIT_OPERATIONS,
  addCreditsToUser,
  checkReferralCreditLimit,
  shouldGenerateReferralCode,
  calculateUsageEstimate
};
