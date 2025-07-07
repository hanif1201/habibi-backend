// services/pushNotificationService.js - UPDATED VERSION

const User = require("../models/User");
const firebaseService = require("./firebaseAdmin");

class PushNotificationService {
  constructor() {
    this.supportedPlatforms = ["web", "android", "ios"];
  }

  /**
   * Send a message notification to a user
   */
  async sendMessageNotification(userId, notificationData) {
    try {
      const user = await User.findById(userId)
        .select("firstName lastName deviceTokens settings notificationStats")
        .lean();

      if (!user) {
        return { success: false, error: "User not found" };
      }

      // Check if user can receive notifications
      if (!user.settings?.notifications?.messages) {
        return { success: false, error: "Message notifications disabled" };
      }

      // Check quiet hours
      if (this.isInQuietHours(user.settings?.notifications?.quietHours)) {
        return { success: false, error: "User in quiet hours" };
      }

      const activeTokens =
        user.deviceTokens?.filter((token) => token.isActive) || [];

      if (activeTokens.length === 0) {
        return { success: false, error: "No active device tokens" };
      }

      // Extract just the token strings
      const tokens = activeTokens.map((device) => device.token);

      const notification = {
        title: `💕 ${notificationData.senderName}`,
        body:
          notificationData.content.length > 100
            ? notificationData.content.substring(0, 100) + "..."
            : notificationData.content,
        icon: notificationData.senderPhoto || "/icon-192x192.png",
        badge: notificationData.unreadCount || 1,
        tag: `message_${notificationData.matchId}`,
        data: {
          type: "message",
          messageId: notificationData.messageId,
          matchId: notificationData.matchId,
          senderId: notificationData.senderId,
          senderName: notificationData.senderName,
          url: `/chat/${notificationData.matchId}`,
        },
        actions: [
          {
            action: "reply",
            title: "Reply",
            icon: "/reply-icon.png",
          },
          {
            action: "view",
            title: "View",
            icon: "/view-icon.png",
          },
        ],
        requireInteraction: false,
        vibrate: user.settings?.notifications?.vibration
          ? [200, 100, 200]
          : null,
      };

      // Send via Firebase
      const result = await firebaseService.sendNotification(
        tokens,
        notification
      );

      // Update user's notification stats if successful
      if (result.success && result.successCount > 0) {
        await User.findByIdAndUpdate(userId, {
          $inc: { "notificationStats.sent": result.successCount },
          $set: { "notificationStats.lastNotificationSent": new Date() },
        });
      }

      // Clean up invalid tokens
      if (result.invalidTokens && result.invalidTokens.length > 0) {
        await this.cleanupInvalidTokens(userId, result.invalidTokens);
      }

      return {
        success: result.success,
        sentTo: result.successCount || 0,
        totalDevices: activeTokens.length,
        failed: result.failureCount || 0,
        error: result.error,
        simulated: result.simulated,
      };
    } catch (error) {
      console.error("Message notification service error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send a match notification to a user
   */
  async sendMatchNotification(userId, matchData) {
    try {
      const user = await User.findById(userId)
        .select("firstName lastName deviceTokens settings notificationStats")
        .lean();

      if (!user) {
        return { success: false, error: "User not found" };
      }

      // Check if user can receive match notifications
      if (!user.settings?.notifications?.matches) {
        return { success: false, error: "Match notifications disabled" };
      }

      // Check quiet hours
      if (this.isInQuietHours(user.settings?.notifications?.quietHours)) {
        return { success: false, error: "User in quiet hours" };
      }

      const activeTokens =
        user.deviceTokens?.filter((token) => token.isActive) || [];

      if (activeTokens.length === 0) {
        return { success: false, error: "No active device tokens" };
      }

      const tokens = activeTokens.map((device) => device.token);

      const notification = {
        title: "💕 It's a Match!",
        body: `You and ${matchData.matchedUserName} liked each other!`,
        icon: matchData.matchedUserPhoto || "/icon-192x192.png",
        badge: 1,
        tag: `match_${matchData.matchId}`,
        data: {
          type: "match",
          matchId: matchData.matchId,
          matchedUserId: matchData.matchedUserId,
          matchedUserName: matchData.matchedUserName,
          url: `/chat/${matchData.matchId}`,
        },
        actions: [
          {
            action: "message",
            title: "Send Message",
            icon: "/message-icon.png",
          },
          {
            action: "view",
            title: "View Profile",
            icon: "/profile-icon.png",
          },
        ],
        requireInteraction: true, // Make match notifications more prominent
        vibrate: user.settings?.notifications?.vibration
          ? [300, 100, 300, 100, 300]
          : null,
      };

      const result = await firebaseService.sendNotification(
        tokens,
        notification
      );

      // Update user's notification stats if successful
      if (result.success && result.successCount > 0) {
        await User.findByIdAndUpdate(userId, {
          $inc: { "notificationStats.sent": result.successCount },
          $set: { "notificationStats.lastNotificationSent": new Date() },
        });
      }

      // Clean up invalid tokens
      if (result.invalidTokens && result.invalidTokens.length > 0) {
        await this.cleanupInvalidTokens(userId, result.invalidTokens);
      }

      return {
        success: result.success,
        sentTo: result.successCount || 0,
        totalDevices: activeTokens.length,
        failed: result.failureCount || 0,
        error: result.error,
        simulated: result.simulated,
      };
    } catch (error) {
      console.error("Match notification error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send a like notification to a user
   */
  async sendLikeNotification(userId, likeData) {
    try {
      const user = await User.findById(userId)
        .select("firstName lastName deviceTokens settings notificationStats")
        .lean();

      if (!user) {
        return { success: false, error: "User not found" };
      }

      // Check if user can receive like notifications
      if (!user.settings?.notifications?.likes) {
        return { success: false, error: "Like notifications disabled" };
      }

      // Check quiet hours
      if (this.isInQuietHours(user.settings?.notifications?.quietHours)) {
        return { success: false, error: "User in quiet hours" };
      }

      const activeTokens =
        user.deviceTokens?.filter((token) => token.isActive) || [];

      if (activeTokens.length === 0) {
        return { success: false, error: "No active device tokens" };
      }

      const tokens = activeTokens.map((device) => device.token);

      const notification = {
        title: likeData.isSuper ? "⭐ Super Like!" : "❤️ New Like!",
        body: likeData.isSuper
          ? `${likeData.likerName} sent you a Super Like!`
          : `${likeData.likerName} liked your profile!`,
        icon: likeData.likerPhoto || "/icon-192x192.png",
        badge: 1,
        tag: `like_${likeData.likerId}`,
        data: {
          type: likeData.isSuper ? "super_like" : "like",
          likerId: likeData.likerId,
          likerName: likeData.likerName,
          url: `/profile/${likeData.likerId}`,
        },
        actions: [
          {
            action: "like",
            title: "Like Back",
            icon: "/like-icon.png",
          },
          {
            action: "view",
            title: "View Profile",
            icon: "/profile-icon.png",
          },
        ],
        requireInteraction: false,
        vibrate: user.settings?.notifications?.vibration
          ? [200, 100, 200]
          : null,
      };

      const result = await firebaseService.sendNotification(
        tokens,
        notification
      );

      // Update user's notification stats if successful
      if (result.success && result.successCount > 0) {
        await User.findByIdAndUpdate(userId, {
          $inc: { "notificationStats.sent": result.successCount },
          $set: { "notificationStats.lastNotificationSent": new Date() },
        });
      }

      // Clean up invalid tokens
      if (result.invalidTokens && result.invalidTokens.length > 0) {
        await this.cleanupInvalidTokens(userId, result.invalidTokens);
      }

      return {
        success: result.success,
        sentTo: result.successCount || 0,
        totalDevices: activeTokens.length,
        failed: result.failureCount || 0,
        error: result.error,
        simulated: result.simulated,
      };
    } catch (error) {
      console.error("Like notification error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send a generic notification to a user
   */
  async sendGenericNotification(userId, title, body, data = {}) {
    try {
      const user = await User.findById(userId)
        .select("firstName lastName deviceTokens settings notificationStats")
        .lean();

      if (!user) {
        return { success: false, error: "User not found" };
      }

      // Check if user can receive push notifications
      if (!user.settings?.notifications?.push) {
        return { success: false, error: "Push notifications disabled" };
      }

      const activeTokens =
        user.deviceTokens?.filter((token) => token.isActive) || [];

      if (activeTokens.length === 0) {
        return { success: false, error: "No active device tokens" };
      }

      const tokens = activeTokens.map((device) => device.token);

      const notification = {
        title,
        body,
        icon: "/icon-192x192.png",
        badge: 1,
        tag: data.type || "generic",
        data: {
          ...data,
          timestamp: new Date().toISOString(),
        },
        requireInteraction: false,
        vibrate: user.settings?.notifications?.vibration
          ? [200, 100, 200]
          : null,
      };

      const result = await firebaseService.sendNotification(
        tokens,
        notification
      );

      // Update user's notification stats if successful
      if (result.success && result.successCount > 0) {
        await User.findByIdAndUpdate(userId, {
          $inc: { "notificationStats.sent": result.successCount },
          $set: { "notificationStats.lastNotificationSent": new Date() },
        });
      }

      // Clean up invalid tokens
      if (result.invalidTokens && result.invalidTokens.length > 0) {
        await this.cleanupInvalidTokens(userId, result.invalidTokens);
      }

      return {
        success: result.success,
        sentTo: result.successCount || 0,
        totalDevices: activeTokens.length,
        failed: result.failureCount || 0,
        error: result.error,
        simulated: result.simulated,
      };
    } catch (error) {
      console.error("Generic notification error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Subscribe user to a topic
   */
  async subscribeToTopic(userId, topic) {
    try {
      const user = await User.findById(userId).select("deviceTokens").lean();

      if (!user) {
        return { success: false, error: "User not found" };
      }

      const activeTokens =
        user.deviceTokens?.filter((token) => token.isActive) || [];

      if (activeTokens.length === 0) {
        return { success: false, error: "No active device tokens" };
      }

      const tokens = activeTokens.map((device) => device.token);
      return await firebaseService.subscribeToTopic(tokens, topic);
    } catch (error) {
      console.error("Topic subscription error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send notification to a topic
   */
  async sendToTopic(topic, notification, data = {}) {
    try {
      return await firebaseService.sendToTopic(topic, notification, data);
    } catch (error) {
      console.error("Topic notification error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if current time is within quiet hours
   */
  isInQuietHours(quietHours) {
    if (!quietHours?.enabled) {
      return false;
    }

    const now = new Date();
    const currentTime =
      now.getHours().toString().padStart(2, "0") +
      ":" +
      now.getMinutes().toString().padStart(2, "0");

    const { start, end } = quietHours;

    if (start <= end) {
      // Same day range (e.g., 09:00 to 17:00)
      return currentTime >= start && currentTime <= end;
    } else {
      // Overnight range (e.g., 22:00 to 07:00)
      return currentTime >= start || currentTime <= end;
    }
  }

  /**
   * Clean up invalid device tokens
   */
  async cleanupInvalidTokens(userId, invalidTokens) {
    try {
      if (invalidTokens.length > 0) {
        await User.findByIdAndUpdate(userId, {
          $pull: {
            deviceTokens: { token: { $in: invalidTokens } },
          },
        });

        console.log(
          `🧹 Cleaned up ${invalidTokens.length} invalid device tokens for user ${userId}`
        );
      }
    } catch (error) {
      console.error("Error cleaning up invalid tokens:", error);
    }
  }

  /**
   * Get notification statistics for a user
   */
  async getNotificationStats(userId) {
    try {
      const user = await User.findById(userId)
        .select("notificationStats deviceTokens settings")
        .lean();

      if (!user) {
        return null;
      }

      const activeTokens =
        user.deviceTokens?.filter((token) => token.isActive) || [];

      return {
        stats: user.notificationStats || { sent: 0, delivered: 0, clicked: 0 },
        activeDevices: activeTokens.length,
        platforms: [...new Set(activeTokens.map((token) => token.platform))],
        settings: user.settings?.notifications || {},
      };
    } catch (error) {
      console.error("Error getting notification stats:", error);
      return null;
    }
  }

  /**
   * Health check for the notification service
   */
  async healthCheck() {
    try {
      const firebaseHealth = await firebaseService.healthCheck();

      return {
        healthy: firebaseHealth.healthy,
        firebase: firebaseHealth,
        supportedPlatforms: this.supportedPlatforms,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = new PushNotificationService();
