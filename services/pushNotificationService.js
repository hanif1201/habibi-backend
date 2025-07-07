// services/pushNotificationService.js

const User = require("../models/User");

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

      const notification = {
        title: `New message from ${notificationData.senderName}`,
        body:
          notificationData.content.length > 100
            ? notificationData.content.substring(0, 100) + "..."
            : notificationData.content,
        icon: notificationData.senderPhoto || "/default-avatar.png",
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
        silent: false,
        vibrate: user.settings?.notifications?.vibration
          ? [200, 100, 200]
          : null,
      };

      const results = await Promise.allSettled(
        activeTokens.map((token) => this.sendToDevice(token, notification))
      );

      const successful = results.filter(
        (result) => result.status === "fulfilled" && result.value.success
      );
      const failed = results.filter(
        (result) => result.status === "rejected" || !result.value.success
      );

      // Update user's notification stats
      if (successful.length > 0) {
        await User.findByIdAndUpdate(userId, {
          $inc: { "notificationStats.sent": successful.length },
          $set: { "notificationStats.lastNotificationSent": new Date() },
        });
      }

      // Clean up failed tokens
      if (failed.length > 0) {
        await this.cleanupFailedTokens(userId, failed);
      }

      return {
        success: successful.length > 0,
        sentTo: successful.length,
        totalDevices: activeTokens.length,
        failed: failed.length,
        error:
          failed.length === activeTokens.length
            ? "All notifications failed"
            : null,
      };
    } catch (error) {
      console.error("Push notification service error:", error);
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

      const notification = {
        title: "New Match! 💕",
        body: `You and ${matchData.matchedUserName} liked each other!`,
        icon: matchData.matchedUserPhoto || "/default-avatar.png",
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
        requireInteraction: false,
        silent: false,
        vibrate: user.settings?.notifications?.vibration
          ? [300, 100, 300]
          : null,
      };

      const results = await Promise.allSettled(
        activeTokens.map((token) => this.sendToDevice(token, notification))
      );

      const successful = results.filter(
        (result) => result.status === "fulfilled" && result.value.success
      );
      const failed = results.filter(
        (result) => result.status === "rejected" || !result.value.success
      );

      // Update user's notification stats
      if (successful.length > 0) {
        await User.findByIdAndUpdate(userId, {
          $inc: { "notificationStats.sent": successful.length },
          $set: { "notificationStats.lastNotificationSent": new Date() },
        });
      }

      return {
        success: successful.length > 0,
        sentTo: successful.length,
        totalDevices: activeTokens.length,
        failed: failed.length,
        error:
          failed.length === activeTokens.length
            ? "All notifications failed"
            : null,
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

      const notification = {
        title: "New Like! ❤️",
        body: `${likeData.likerName} liked your profile!`,
        icon: likeData.likerPhoto || "/default-avatar.png",
        badge: 1,
        tag: `like_${likeData.likerId}`,
        data: {
          type: "like",
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
        silent: false,
        vibrate: user.settings?.notifications?.vibration
          ? [200, 100, 200]
          : null,
      };

      const results = await Promise.allSettled(
        activeTokens.map((token) => this.sendToDevice(token, notification))
      );

      const successful = results.filter(
        (result) => result.status === "fulfilled" && result.value.success
      );
      const failed = results.filter(
        (result) => result.status === "rejected" || !result.value.success
      );

      // Update user's notification stats
      if (successful.length > 0) {
        await User.findByIdAndUpdate(userId, {
          $inc: { "notificationStats.sent": successful.length },
          $set: { "notificationStats.lastNotificationSent": new Date() },
        });
      }

      return {
        success: successful.length > 0,
        sentTo: successful.length,
        totalDevices: activeTokens.length,
        failed: failed.length,
        error:
          failed.length === activeTokens.length
            ? "All notifications failed"
            : null,
      };
    } catch (error) {
      console.error("Like notification error:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send notification to a specific device
   */
  async sendToDevice(deviceToken, notification) {
    try {
      // This is where you would integrate with actual push notification services
      // For now, we'll simulate the notification sending

      switch (deviceToken.platform) {
        case "web":
          return await this.sendWebPush(deviceToken.token, notification);
        case "android":
          return await this.sendFCM(deviceToken.token, notification);
        case "ios":
          return await this.sendAPNS(deviceToken.token, notification);
        default:
          return { success: false, error: "Unsupported platform" };
      }
    } catch (error) {
      console.error(`Error sending to device ${deviceToken.token}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send web push notification
   */
  async sendWebPush(token, notification) {
    // TODO: Implement actual web push notification
    // You would use libraries like web-push or similar
    console.log("📱 Web push notification:", {
      token: token.substring(0, 20) + "...",
      notification: notification.title,
    });

    return { success: true };
  }

  /**
   * Send Firebase Cloud Messaging notification
   */
  async sendFCM(token, notification) {
    // TODO: Implement FCM notification
    // You would use firebase-admin SDK
    console.log("📱 FCM notification:", {
      token: token.substring(0, 20) + "...",
      notification: notification.title,
    });

    return { success: true };
  }

  /**
   * Send Apple Push Notification Service notification
   */
  async sendAPNS(token, notification) {
    // TODO: Implement APNS notification
    // You would use node-apn or similar library
    console.log("📱 APNS notification:", {
      token: token.substring(0, 20) + "...",
      notification: notification.title,
    });

    return { success: true };
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
   * Clean up failed device tokens
   */
  async cleanupFailedTokens(userId, failedResults) {
    try {
      const failedTokens = failedResults
        .map((result) => result.value?.token || result.reason?.token)
        .filter(Boolean);

      if (failedTokens.length > 0) {
        await User.findByIdAndUpdate(userId, {
          $pull: {
            deviceTokens: { token: { $in: failedTokens } },
          },
        });

        console.log(
          `🧹 Cleaned up ${failedTokens.length} failed device tokens for user ${userId}`
        );
      }
    } catch (error) {
      console.error("Error cleaning up failed tokens:", error);
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
}

module.exports = new PushNotificationService();
