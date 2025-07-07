const express = require("express");
const { body, validationResult } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");
const Notification = require("../models/Notification");

const router = express.Router();

// @route   GET /api/notifications/history
// @desc    Get user's notification history with pagination
// @access  Private
router.get("/history", authenticate, async (req, res) => {
  try {
    const {
      limit = 10,
      page = 1,
      filter = "all", // all, unread, read
      type = "all", // all, match, message, like, super_like, profile_view, system
    } = req.query;

    const userId = req.user._id;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    let query = { user: userId };

    // Apply filters
    if (filter === "unread") {
      query.isRead = false;
    } else if (filter === "read") {
      query.isRead = true;
    }

    if (type !== "all") {
      query.type = type;
    }

    // Get notifications with pagination
    const [notifications, totalCount] = await Promise.all([
      Notification.find(query)
        .populate("relatedUser", "firstName lastName photos")
        .populate("relatedMatch", "users matchedAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Notification.countDocuments(query),
    ]);

    // Get unread count
    const unreadCount = await Notification.countDocuments({
      user: userId,
      isRead: false,
    });

    // Format notifications
    const formattedNotifications = notifications.map((notification) => ({
      _id: notification._id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
      data: notification.data,
      relatedUser: notification.relatedUser
        ? {
            _id: notification.relatedUser._id,
            firstName: notification.relatedUser.firstName,
            lastName: notification.relatedUser.lastName,
            primaryPhoto:
              notification.relatedUser.photos?.find((p) => p.isPrimary) ||
              notification.relatedUser.photos?.[0],
          }
        : null,
      relatedMatch: notification.relatedMatch
        ? {
            _id: notification.relatedMatch._id,
            matchedAt: notification.relatedMatch.matchedAt,
          }
        : null,
    }));

    res.json({
      success: true,
      notifications: formattedNotifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasMore: skip + formattedNotifications.length < totalCount,
      },
      summary: {
        unreadCount,
        totalCount,
      },
    });
  } catch (error) {
    console.error("Get notifications history error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching notifications",
    });
  }
});

// @route   POST /api/notifications/subscribe
// @desc    Subscribe to push notifications
// @access  Private
router.post(
  "/subscribe",
  authenticate,
  [
    body("subscription")
      .isObject()
      .withMessage("Subscription object is required"),
    body("subscription.endpoint")
      .isURL()
      .withMessage("Valid endpoint URL is required"),
    body("subscription.keys")
      .isObject()
      .withMessage("Subscription keys are required"),
    body("subscription.keys.p256dh")
      .isString()
      .withMessage("p256dh key is required"),
    body("subscription.keys.auth")
      .isString()
      .withMessage("auth key is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { subscription, deviceInfo } = req.body;
      const userId = req.user._id;

      // Update user's push subscription
      const user = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            "settings.pushSubscription": {
              ...subscription,
              subscribedAt: new Date(),
              deviceInfo: deviceInfo || {},
            },
          },
        },
        { new: true }
      );

      // Create a welcome notification
      await createNotification({
        user: userId,
        type: "system",
        title: "Push notifications enabled",
        message:
          "You'll now receive push notifications for matches and messages!",
        data: {
          type: "push_subscription",
          enabled: true,
        },
      });

      res.json({
        success: true,
        message: "Push notifications subscription successful",
        subscription: {
          endpoint: subscription.endpoint,
          subscribedAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Push subscription error:", error);
      res.status(500).json({
        success: false,
        message: "Error subscribing to push notifications",
      });
    }
  }
);

// @route   DELETE /api/notifications/subscribe
// @desc    Unsubscribe from push notifications
// @access  Private
router.delete("/subscribe", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    // Remove push subscription
    await User.findByIdAndUpdate(userId, {
      $unset: { "settings.pushSubscription": 1 },
    });

    res.json({
      success: true,
      message: "Successfully unsubscribed from push notifications",
    });
  } catch (error) {
    console.error("Push unsubscribe error:", error);
    res.status(500).json({
      success: false,
      message: "Error unsubscribing from push notifications",
    });
  }
});

// @route   PUT /api/notifications/:notificationId/read
// @desc    Mark a notification as read
// @access  Private
router.put("/:notificationId/read", authenticate, async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, user: userId },
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    // Get updated unread count
    const unreadCount = await Notification.countDocuments({
      user: userId,
      isRead: false,
    });

    res.json({
      success: true,
      message: "Notification marked as read",
      unreadCount,
    });
  } catch (error) {
    console.error("Mark notification read error:", error);
    res.status(500).json({
      success: false,
      message: "Error marking notification as read",
    });
  }
});

// @route   PUT /api/notifications/read-all
// @desc    Mark all notifications as read
// @access  Private
router.put("/read-all", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await Notification.updateMany(
      { user: userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.json({
      success: true,
      message: `Marked ${result.modifiedCount} notifications as read`,
      markedCount: result.modifiedCount,
      unreadCount: 0,
    });
  } catch (error) {
    console.error("Mark all notifications read error:", error);
    res.status(500).json({
      success: false,
      message: "Error marking all notifications as read",
    });
  }
});

// @route   DELETE /api/notifications/:notificationId
// @desc    Delete a notification
// @access  Private
router.delete("/:notificationId", authenticate, async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      user: userId,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    res.json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    console.error("Delete notification error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting notification",
    });
  }
});

// @route   DELETE /api/notifications/clear-all
// @desc    Clear all notifications
// @access  Private
router.delete("/clear-all", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await Notification.deleteMany({ user: userId });

    res.json({
      success: true,
      message: `Cleared ${result.deletedCount} notifications`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Clear all notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Error clearing notifications",
    });
  }
});

// @route   GET /api/notifications/settings
// @desc    Get notification settings
// @access  Private
router.get("/settings", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("settings");

    const settings = user.settings?.notifications || {
      matches: true,
      messages: true,
      likes: true,
      email: true,
      push: true,
      sound: true,
      vibration: true,
    };

    res.json({
      success: true,
      settings,
      pushSubscribed: !!user.settings?.pushSubscription,
    });
  } catch (error) {
    console.error("Get notification settings error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching notification settings",
    });
  }
});

// @route   PUT /api/notifications/settings
// @desc    Update notification settings
// @access  Private
router.put(
  "/settings",
  authenticate,
  [
    body("notifications")
      .isObject()
      .withMessage("Notifications settings object is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { notifications } = req.body;
      const userId = req.user._id;

      const user = await User.findByIdAndUpdate(
        userId,
        {
          $set: {
            "settings.notifications": notifications,
          },
        },
        { new: true }
      ).select("settings");

      res.json({
        success: true,
        message: "Notification settings updated successfully",
        settings: user.settings.notifications,
      });
    } catch (error) {
      console.error("Update notification settings error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating notification settings",
      });
    }
  }
);

// @route   GET /api/notifications/summary
// @desc    Get notification summary
// @access  Private
router.get("/summary", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get notification counts by type
    const summary = await Notification.aggregate([
      { $match: { user: userId } },
      {
        $group: {
          _id: "$type",
          total: { $sum: 1 },
          unread: {
            $sum: { $cond: [{ $eq: ["$isRead", false] }, 1, 0] },
          },
        },
      },
    ]);

    // Get overall counts
    const [totalUnread, totalNotifications] = await Promise.all([
      Notification.countDocuments({ user: userId, isRead: false }),
      Notification.countDocuments({ user: userId }),
    ]);

    // Format summary
    const formattedSummary = {
      total: totalNotifications,
      unread: totalUnread,
      byType: {},
    };

    summary.forEach((item) => {
      formattedSummary.byType[item._id] = {
        total: item.total,
        unread: item.unread,
      };
    });

    res.json({
      success: true,
      summary: formattedSummary,
    });
  } catch (error) {
    console.error("Get notification summary error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching notification summary",
    });
  }
});

// Helper function to create notifications
const createNotification = async (notificationData) => {
  try {
    const notification = new Notification(notificationData);
    await notification.save();
    return notification;
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
};

// Export the createNotification function for use in other parts of the app
router.createNotification = createNotification;

module.exports = router;
