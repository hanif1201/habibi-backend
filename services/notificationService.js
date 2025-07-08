const Notification = require("../models/Notification");
const User = require("../models/User");

class NotificationService {
  // Send a new match notification
  static async sendMatchNotification(user1Id, user2Id, matchId) {
    try {
      const [user1, user2] = await Promise.all([
        User.findById(user1Id).select("firstName lastName settings"),
        User.findById(user2Id).select("firstName lastName settings"),
      ]);

      if (!user1 || !user2) {
        throw new Error("Users not found");
      }

      // Create notifications for both users
      const notifications = await Promise.all([
        Notification.createMatchNotification(user1Id, user2, matchId),
        Notification.createMatchNotification(user2Id, user1, matchId),
      ]);

      // Send push notifications if enabled
      if (user1.settings?.notifications?.matches) {
        await this.sendPushNotification(user1Id, {
          title: "New Match! 🎉",
          body: `You and ${user2.firstName} liked each other!`,
          data: { type: "match", matchId, otherUserId: user2Id },
        });
      }

      if (user2.settings?.notifications?.matches) {
        await this.sendPushNotification(user2Id, {
          title: "New Match! 🎉",
          body: `You and ${user1.firstName} liked each other!`,
          data: { type: "match", matchId, otherUserId: user1Id },
        });
      }

      return notifications;
    } catch (error) {
      console.error("Error sending match notification:", error);
      throw error;
    }
  }

  // Send a new message notification
  static async sendMessageNotification(receiverId, sender, message, matchId) {
    try {
      const receiver = await User.findById(receiverId).select(
        "firstName lastName settings"
      );

      if (!receiver) {
        throw new Error("Receiver not found");
      }

      // Create notification
      const notification = await Notification.createMessageNotification(
        receiverId,
        sender,
        message,
        matchId
      );

      // Send push notification if enabled and user is not currently online
      if (receiver.settings?.notifications?.messages) {
        await this.sendPushNotification(receiverId, {
          title: `New message from ${sender.firstName}`,
          body:
            message.content.length > 100
              ? message.content.substring(0, 100) + "..."
              : message.content,
          data: {
            type: "message",
            matchId,
            messageId: message._id,
            senderId: sender._id,
          },
        });
      }

      return notification;
    } catch (error) {
      console.error("Error sending message notification:", error);
      throw error;
    }
  }

  // Send a like notification
  static async sendLikeNotification(receiverId, liker, isSuper = false) {
    try {
      const receiver = await User.findById(receiverId).select(
        "firstName lastName settings"
      );

      if (!receiver) {
        throw new Error("Receiver not found");
      }

      // Create notification
      const notification = await Notification.createLikeNotification(
        receiverId,
        liker,
        isSuper
      );

      // Send push notification if enabled
      if (receiver.settings?.notifications?.likes) {
        const title = isSuper
          ? "Someone Super Liked you! ⭐"
          : "Someone Liked you! ❤️";
        const body = isSuper
          ? `${liker.firstName} sent you a Super Like!`
          : `${liker.firstName} likes you!`;

        await this.sendPushNotification(receiverId, {
          title,
          body,
          data: {
            type: isSuper ? "super_like" : "like",
            likerId: liker._id,
          },
        });
      }

      return notification;
    } catch (error) {
      console.error("Error sending like notification:", error);
      throw error;
    }
  }

  // Send a profile view notification
  static async sendProfileViewNotification(profileOwnerId, viewer) {
    try {
      const profileOwner = await User.findById(profileOwnerId).select(
        "firstName lastName settings"
      );

      if (!profileOwner) {
        throw new Error("Profile owner not found");
      }

      // Only send if notifications are enabled for profile views
      if (profileOwner.settings?.notifications?.profileViews) {
        const notification = await Notification.createProfileViewNotification(
          profileOwnerId,
          viewer
        );

        return notification;
      }

      return null;
    } catch (error) {
      console.error("Error sending profile view notification:", error);
      throw error;
    }
  }

  // Send a system notification
  static async sendSystemNotification(
    userId,
    title,
    message,
    data = {},
    priority = "normal"
  ) {
    try {
      const notification = await Notification.createSystemNotification(
        userId,
        title,
        message,
        data,
        priority
      );

      // Send push notification for high priority system notifications
      if (priority === "high" || priority === "urgent") {
        await this.sendPushNotification(userId, {
          title,
          body: message,
          data: { type: "system", ...data },
        });
      }

      return notification;
    } catch (error) {
      console.error("Error sending system notification:", error);
      throw error;
    }
  }

  // Send a reminder notification
  static async sendReminderNotification(
    userId,
    title,
    message,
    scheduledFor = null,
    data = {}
  ) {
    try {
      const notification = await Notification.createReminderNotification(
        userId,
        title,
        message,
        scheduledFor,
        data
      );

      return notification;
    } catch (error) {
      console.error("Error sending reminder notification:", error);
      throw error;
    }
  }

  // Send push notification (placeholder - implement with your push service)
  static async sendPushNotification(userId, payload) {
    try {
      const user = await User.findById(userId).select("settings");

      if (!user?.settings?.pushSubscription) {
        console.log(`No push subscription for user ${userId}`);
        return false;
      }

      // TODO: Implement actual push notification sending
      // This would use a service like Firebase Cloud Messaging, OneSignal, etc.
      console.log(
        `📱 Would send push notification to user ${userId}:`,
        payload
      );

      // For now, just log what would be sent
      return true;
    } catch (error) {
      console.error("Error sending push notification:", error);
      return false;
    }
  }

  // Get user's notification summary
  static async getUserNotificationSummary(userId) {
    try {
      const [unreadCount, recentNotifications] = await Promise.all([
        Notification.getUnreadCount(userId),
        Notification.getUserNotifications(userId, { limit: 5, isRead: false }),
      ]);

      return {
        unreadCount,
        recentNotifications: recentNotifications.notifications,
      };
    } catch (error) {
      console.error("Error getting notification summary:", error);
      throw error;
    }
  }

  // Cleanup expired notifications (call this periodically)
  static async cleanupExpiredNotifications() {
    try {
      const deletedCount = await Notification.cleanupExpired();
      console.log(`🧹 Cleaned up ${deletedCount} expired notifications`);
      return deletedCount;
    } catch (error) {
      console.error("Error cleaning up notifications:", error);
      throw error;
    }
  }

  // Process pending notification deliveries
  static async processPendingDeliveries() {
    try {
      const pendingNotifications = await Notification.getPendingDeliveries(
        "push",
        50
      );

      for (const notification of pendingNotifications) {
        try {
          const success = await this.sendPushNotification(
            notification.user._id,
            {
              title: notification.title,
              body: notification.message,
              data: notification.data,
            }
          );

          if (success) {
            await notification.markDelivered("push");
          } else {
            await notification.markDeliveryFailed();
          }
        } catch (error) {
          console.error(
            `Error delivering notification ${notification._id}:`,
            error
          );
          await notification.markDeliveryFailed();
        }
      }

      return pendingNotifications.length;
    } catch (error) {
      console.error("Error processing pending deliveries:", error);
      throw error;
    }
  }
}

// Utility: Generate conversation starters for a match
function getConversationStarters(userA, userB) {
  // Simple static starters, can be enhanced with shared interests, etc.
  const starters = [
    `Hi ${userB.firstName}! How's your day going?`,
    `I love your photos! Where was that photo taken?`,
    `We seem to have something in common. Tell me more about [shared interest]`,
    `${userB.firstName}, your bio made me smile! Tell me more about [specific detail]`,
  ];
  // Optionally, add more dynamic starters based on userA/userB
  return starters;
}

module.exports = NotificationService;
module.exports.getConversationStarters = getConversationStarters;
