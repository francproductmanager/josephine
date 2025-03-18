// src/services/user-service.js
const db = require('../helpers/database');
const { logDetails } = require('../utils/logging-utils');

/**
 * User-related business logic
 */
class UserService {
  /**
   * Find or create a user by phone number
   */
  async findOrCreateUser(phoneNumber, req = null) {
    try {
      return await db.findOrCreateUser(phoneNumber, req);
    } catch (error) {
      logDetails('Error in user service findOrCreateUser:', error);
      throw error;
    }
  }
  
  /**
   * Check if user has available credits
   */
  async checkUserCredits(phoneNumber, req = null) {
    try {
      return await db.checkUserCredits(phoneNumber, req);
    } catch (error) {
      logDetails('Error in user service checkUserCredits:', error);
      throw error;
    }
  }
  
  /**
   * Get complete user stats
   */
  async getUserStats(phoneNumber, req = null) {
    try {
      return await db.getUserStats(phoneNumber, req);
    } catch (error) {
      logDetails('Error in user service getUserStats:', error);
      throw error;
    }
  }
  
  /**
   * Record a transcription and update user stats
   */
  async recordTranscription(phoneNumber, audioLengthSeconds, wordCount, openAICost, twilioCost, req = null) {
    try {
      return await db.recordTranscription(
        phoneNumber, 
        audioLengthSeconds, 
        wordCount, 
        openAICost, 
        twilioCost, 
        req
      );
    } catch (error) {
      logDetails('Error in user service recordTranscription:', error);
      throw error;
    }
  }
  
  /**
   * Add credits after payment
   */
  async addCredits(phoneNumber, credits, amount, paymentMethod, transactionId, req = null) {
    try {
      return await db.addCredits(
        phoneNumber,
        credits,
        amount,
        paymentMethod,
        transactionId,
        req
      );
    } catch (error) {
      logDetails('Error in user service addCredits:', error);
      throw error;
    }
  }
  
  /**
   * Mark user intro as seen
   */
  async markUserIntroAsSeen(userId, req = null) {
    try {
      return await db.markUserIntroAsSeen(userId, req);
    } catch (error) {
      logDetails('Error in user service markUserIntroAsSeen:', error);
      throw error;
    }
  }
}

// Export a singleton instance
module.exports = new UserService();
