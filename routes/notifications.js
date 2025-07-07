const express = require("express");
const { body, validationResult } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();

// @route   GET /api/notifications/preferences
// @desc    Get user's notification preferences
// @access  Private
router.get("/preferences", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("settings");

    const defaultPreferences = {
      matches: true,
      messages: true,
      likes: true,
      email: true,
      push: true,
      sound: true,
      vibration: true,
    };

    const preferences = user?.settings?.notifications || defaultPreferences;

    res.json({
      success: true,
      preferences,
    });
  } catch (error) {
    console.error("Get notification preferences error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching notification preferences",
    });
  }
});

// @route   PUT /api/notifications/preferences
// @desc    Update user's notification preferences
// @access  Private
router.put(
  "/preferences",
  authenticate,
  [
    body("preferences.matches")
      .optional()
      .isBoolean()
      .withMessage("Matches preference must be a boolean"),
    body("preferences.messages")
      .optional()
      .isBoolean()
      .withMessage("Messages preference must be a boolean"),
    body("preferences.likes")
      .optional()
      .isBoolean()
      .withMessage("Likes preference must be a boolean"),
    body("preferences.email")
      .optional()
      .isBoolean()
      .withMessage("Email preference must be a boolean"),
    body("preferences.push")
      .optional()
      .isBoolean()
      .withMessage("Push preference must be a boolean"),
    body("preferences.sound")
      .optional()
      .isBoolean()
      .withMessage("Sound preference must be a boolean"),
    body("preferences.vibration")
      .optional()
      .isBoolean()
      .withMessage("Vibration preference must be a boolean"),
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

      const { preferences } = req.body;

      if (!preferences || typeof preferences !== "object") {
        return res.status(400).json({
          success: false,
          message: "Preferences object is required",
        });
      }

      // Update user's notification preferences
      const user = await User.findByIdAndUpdate(
        req.user._id,
        {
          $set: {
            "settings.notifications": preferences,
          },
        },
        { new: true, upsert: false }
      ).select("settings");

      res.json({
        success: true,
        message: "Notification preferences updated successfully",
        preferences: user.settings.notifications,
      });
    } catch (error) {
      console.error("Update notification preferences error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating notification preferences",
      });
    }
  }
);

// @route   GET /api/notifications
// @desc    Get user's notifications
// @access  Private
router.get("/", authenticate, async (req, res) => {
  try {
    const { limit = 50, skip = 0, unreadOnly = false } = req.query;

    // For now, return mock notifications since we don't have a Notification model
    // In a real app, you'd query from a notifications collection
    const mockNotifications = [
      {
        id: 1,
        type: "match",
        title: "New Match!",
        message: "You have a new match with Sarah!",
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        read: false,
        data: {
          matchId: "mock_match_id",
          userId: "mock_user_id",
        },
      },
      {
        id: 2,
        type: "message",
        title: "New Message",
        message: "Emma sent you a message",
        timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
        read: true,
        data: {
          matchId: "mock_match_id_2",
          userId: "mock_user_id_2",
        },
      },
      {
        id: 3,
        type: "like",
        title: "Someone Liked You!",
        message: "You received a new like",
        timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        read: false,
        data: {
          userId: "mock_user_id_3",
        },
      },
    ];

    // Filter for unread only if requested
    let notifications = unreadOnly
      ? mockNotifications.filter((n) => !n.read)
      : mockNotifications;

    // Apply pagination
    const startIndex = parseInt(skip);
    const endIndex = startIndex + parseInt(limit);
    notifications = notifications.slice(startIndex, endIndex);

    const unreadCount = mockNotifications.filter((n) => !n.read).length;

    res.json({
      success: true,
      notifications,
      unreadCount,
      total: mockNotifications.length,
    });
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching notifications",
    });
  }
});

// @route   PUT /api/notifications/:id/read
// @desc    Mark a notification as read
// @access  Private
router.put("/:id/read", authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    // In a real app, you'd update the notification in the database
    // For now, just return success since we're using mock data

    res.json({
      success: true,
      message: "Notification marked as read",
      notificationId: id,
    });
  } catch (error) {
    console.error("Mark notification as read error:", error);
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
    // In a real app, you'd update all unread notifications for the user
    // For now, just return success

    res.json({
      success: true,
      message: "All notifications marked as read",
      markedCount: 0, // Would be the actual count from database
    });
  } catch (error) {
    console.error("Mark all notifications as read error:", error);
    res.status(500).json({
      success: false,
      message: "Error marking all notifications as read",
    });
  }
});

// @route   DELETE /api/notifications/clear
// @desc    Clear all notifications for the user
// @access  Private
router.delete("/clear", authenticate, async (req, res) => {
  try {
    // In a real app, you'd delete all notifications for the user
    // For now, just return success

    res.json({
      success: true,
      message: "All notifications cleared",
      deletedCount: 0, // Would be the actual count from database
    });
  } catch (error) {
    console.error("Clear notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Error clearing notifications",
    });
  }
});

// @route   POST /api/notifications/test
// @desc    Send a test notification (for development)
// @access  Private
router.post("/test", authenticate, async (req, res) => {
  try {
    const { type = "test", title, message } = req.body;

    // In a real app, this would create a notification and potentially send a push notification
    console.log(`📱 Test notification for user ${req.user._id}:`, {
      type,
      title: title || "Test Notification",
      message: message || "This is a test notification",
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: "Test notification sent",
      notification: {
        type,
        title: title || "Test Notification",
        message: message || "This is a test notification",
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error("Send test notification error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending test notification",
    });
  }
});

module.exports = router;
