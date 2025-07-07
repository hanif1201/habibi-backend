// routes/notifications.js - UPDATED WITH REAL FIREBASE INTEGRATION
const express = require("express");
const { body, validationResult } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");
const pushNotificationService = require("../services/pushNotificationService");

const router = express.Router();

// @route   POST /api/notifications/register-device
// @desc    Register device token for push notifications
// @access  Private
router.post(
  "/register-device",
  authenticate,
  [
    body("token")
      .notEmpty()
      .withMessage("Device token is required")
      .isLength({ min: 10 })
      .withMessage("Invalid device token format"),
    body("platform")
      .isIn(["web", "android", "ios"])
      .withMessage("Platform must be web, android, or ios"),
    body("deviceInfo")
      .optional()
      .isObject()
      .withMessage("Device info must be an object"),
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

      const { token, platform, deviceInfo = {} } = req.body;
      const userId = req.user._id;

      // Get user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if token already exists
      const existingTokenIndex = user.deviceTokens.findIndex(
        (device) => device.token === token
      );

      const deviceData = {
        token,
        platform,
        deviceInfo: {
          userAgent: deviceInfo.userAgent || req.get("User-Agent"),
          browser: getBrowserFromUserAgent(req.get("User-Agent")),
          os: getOSFromUserAgent(req.get("User-Agent")),
          ...deviceInfo,
        },
        registeredAt: new Date(),
        lastUsed: new Date(),
        isActive: true,
      };

      if (existingTokenIndex >= 0) {
        // Update existing token
        user.deviceTokens[existingTokenIndex] = deviceData;
        console.log(
          `🔄 Updated device token for user ${user.firstName} (${platform})`
        );
      } else {
        // Add new token
        user.deviceTokens.push(deviceData);
        console.log(
          `📱 Registered new ${platform} device for user ${user.firstName}`
        );
      }

      // Limit to 10 devices per user
      if (user.deviceTokens.length > 10) {
        user.deviceTokens = user.deviceTokens
          .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))
          .slice(0, 10);
      }

      await user.save();

      // Subscribe to general notifications topic
      await pushNotificationService.subscribeToTopic(
        userId,
        "general_notifications"
      );

      // Send welcome notification to verify setup
      const testResult = await pushNotificationService.sendGenericNotification(
        userId,
        "🎉 Notifications Enabled!",
        "You'll now receive push notifications from Habibi. Time to find love! 💕",
        {
          type: "setup_complete",
          url: "/dashboard",
        }
      );

      res.json({
        success: true,
        message: "Device registered successfully",
        deviceCount: user.deviceTokens.length,
        platform,
        testNotificationSent: testResult.success,
        testNotificationDetails: testResult.simulated
          ? "Notification simulated (Firebase not configured)"
          : `Sent to ${testResult.sentTo} device(s)`,
      });
    } catch (error) {
      console.error("Device registration error:", error);
      res.status(500).json({
        success: false,
        message: "Error registering device",
        error: error.message,
      });
    }
  }
);

// @route   DELETE /api/notifications/unregister-device
// @desc    Remove device token
// @access  Private
router.delete(
  "/unregister-device",
  authenticate,
  [body("token").notEmpty().withMessage("Device token is required")],
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

      const { token } = req.body;
      const userId = req.user._id;

      const user = await User.findByIdAndUpdate(
        userId,
        {
          $pull: { deviceTokens: { token } },
        },
        { new: true }
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      console.log(`📱 Removed device token for user ${user.firstName}`);

      res.json({
        success: true,
        message: "Device unregistered successfully",
        deviceCount: user.deviceTokens.length,
      });
    } catch (error) {
      console.error("Device unregistration error:", error);
      res.status(500).json({
        success: false,
        message: "Error unregistering device",
        error: error.message,
      });
    }
  }
);

// @route   PUT /api/notifications/preferences
// @desc    Update notification preferences
// @access  Private
router.put(
  "/preferences",
  authenticate,
  [
    body("notifications")
      .isObject()
      .withMessage("Notifications must be an object"),
    body("notifications.matches")
      .optional()
      .isBoolean()
      .withMessage("Matches preference must be boolean"),
    body("notifications.messages")
      .optional()
      .isBoolean()
      .withMessage("Messages preference must be boolean"),
    body("notifications.likes")
      .optional()
      .isBoolean()
      .withMessage("Likes preference must be boolean"),
    body("notifications.push")
      .optional()
      .isBoolean()
      .withMessage("Push preference must be boolean"),
    body("notifications.email")
      .optional()
      .isBoolean()
      .withMessage("Email preference must be boolean"),
    body("notifications.sound")
      .optional()
      .isBoolean()
      .withMessage("Sound preference must be boolean"),
    body("notifications.vibration")
      .optional()
      .isBoolean()
      .withMessage("Vibration preference must be boolean"),
    body("notifications.quietHours.enabled")
      .optional()
      .isBoolean()
      .withMessage("Quiet hours enabled must be boolean"),
    body("notifications.quietHours.start")
      .optional()
      .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .withMessage("Invalid start time format (HH:MM)"),
    body("notifications.quietHours.end")
      .optional()
      .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .withMessage("Invalid end time format (HH:MM)"),
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
          "settings.notifications": notifications,
        },
        { new: true, runValidators: true }
      );

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      console.log(
        `🔔 Updated notification preferences for user ${user.firstName}`
      );

      res.json({
        success: true,
        message: "Notification preferences updated",
        preferences: user.settings.notifications,
      });
    } catch (error) {
      console.error("Preferences update error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating preferences",
        error: error.message,
      });
    }
  }
);

// @route   GET /api/notifications/preferences
// @desc    Get notification preferences
// @access  Private
router.get("/preferences", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "settings deviceTokens"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const activeDevices = user.deviceTokens?.filter((d) => d.isActive) || [];

    res.json({
      success: true,
      preferences: user.settings?.notifications || {
        matches: true,
        messages: true,
        likes: true,
        push: true,
        email: true,
        sound: true,
        vibration: true,
        quietHours: {
          enabled: false,
          start: "22:00",
          end: "07:00",
        },
      },
      deviceCount: activeDevices.length,
      devices: activeDevices.map((device) => ({
        platform: device.platform,
        registeredAt: device.registeredAt,
        lastUsed: device.lastUsed,
        isActive: device.isActive,
        deviceInfo: {
          browser: device.deviceInfo?.browser || "Unknown",
          os: device.deviceInfo?.os || "Unknown",
        },
      })),
    });
  } catch (error) {
    console.error("Get preferences error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching preferences",
      error: error.message,
    });
  }
});

// @route   POST /api/notifications/test
// @desc    Send test notification
// @access  Private
router.post("/test", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await pushNotificationService.sendGenericNotification(
      userId,
      "🧪 Test Notification",
      "This is a test notification from Habibi. If you can see this, push notifications are working perfectly! 💕",
      {
        type: "test",
        timestamp: new Date().toISOString(),
        url: "/dashboard",
      }
    );

    res.json({
      success: result.success,
      message: result.success
        ? `Test notification sent to ${result.sentTo} device(s)`
        : "Failed to send test notification",
      details: {
        sentTo: result.sentTo,
        totalDevices: result.totalDevices,
        failed: result.failed,
        simulated: result.simulated,
        error: result.error,
      },
    });
  } catch (error) {
    console.error("Test notification error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending test notification",
      error: error.message,
    });
  }
});

// @route   POST /api/notifications/send-custom
// @desc    Send custom notification (admin only)
// @access  Private
router.post(
  "/send-custom",
  authenticate,
  [
    body("title").notEmpty().withMessage("Title is required"),
    body("body").notEmpty().withMessage("Body is required"),
    body("userId").optional().isMongoId().withMessage("Invalid user ID"),
    body("topic").optional().isString().withMessage("Topic must be string"),
  ],
  async (req, res) => {
    try {
      // TODO: Implement proper admin check
      const isAdmin = req.user.email === "admin@habibi.com"; // Replace with your admin logic

      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          message: "Admin access required",
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { title, body, userId, topic, data = {} } = req.body;

      let result;

      if (userId) {
        // Send to specific user
        result = await pushNotificationService.sendGenericNotification(
          userId,
          title,
          body,
          { ...data, type: "admin_custom" }
        );
      } else if (topic) {
        // Send to topic
        result = await pushNotificationService.sendToTopic(
          topic,
          { title, body },
          { ...data, type: "admin_broadcast" }
        );
      } else {
        return res.status(400).json({
          success: false,
          message: "Either userId or topic is required",
        });
      }

      res.json({
        success: result.success,
        message: result.success
          ? "Custom notification sent successfully"
          : "Failed to send notification",
        details: result,
      });
    } catch (error) {
      console.error("Custom notification error:", error);
      res.status(500).json({
        success: false,
        message: "Error sending custom notification",
        error: error.message,
      });
    }
  }
);

// @route   GET /api/notifications/health
// @desc    Check notification service health
// @access  Private
router.get("/health", authenticate, async (req, res) => {
  try {
    const health = await pushNotificationService.healthCheck();

    res.json({
      success: true,
      health,
      environment: {
        nodeEnv: process.env.NODE_ENV || "development",
        firebaseProjectId: process.env.FIREBASE_PROJECT_ID
          ? "configured"
          : "missing",
        firebaseCredentials: process.env.FIREBASE_PRIVATE_KEY
          ? "configured"
          : "missing",
      },
    });
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      success: false,
      message: "Error checking health",
      error: error.message,
    });
  }
});

// @route   GET /api/notifications/stats
// @desc    Get notification statistics
// @access  Private
router.get("/stats", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    const stats = await pushNotificationService.getNotificationStats(userId);

    if (!stats) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching stats",
      error: error.message,
    });
  }
});

// Export sendPushNotification function for backward compatibility
const sendPushNotification = async (userId, notificationData) => {
  try {
    // Check notification type and route accordingly
    if (notificationData.type === "message") {
      return await pushNotificationService.sendMessageNotification(userId, {
        messageId: notificationData.data?.messageId,
        matchId: notificationData.data?.matchId,
        senderId: notificationData.data?.senderId,
        senderName: notificationData.data?.senderName || "Someone",
        senderPhoto: notificationData.icon,
        content: notificationData.body,
        unreadCount: notificationData.badge || 1,
      });
    } else if (notificationData.type === "match") {
      return await pushNotificationService.sendMatchNotification(userId, {
        matchId: notificationData.data?.matchId,
        matchedUserId: notificationData.data?.userId,
        matchedUserName: notificationData.data?.userName || "Someone",
        matchedUserPhoto: notificationData.icon,
      });
    } else if (
      notificationData.type === "like" ||
      notificationData.type === "super_like"
    ) {
      return await pushNotificationService.sendLikeNotification(userId, {
        likerId: notificationData.data?.likerId,
        likerName: notificationData.data?.likerName || "Someone",
        likerPhoto: notificationData.icon,
        isSuper: notificationData.type === "super_like",
      });
    } else {
      // Generic notification
      return await pushNotificationService.sendGenericNotification(
        userId,
        notificationData.title,
        notificationData.body,
        notificationData.data || {}
      );
    }
  } catch (error) {
    console.error("Send push notification error:", error);
    return { success: false, error: error.message };
  }
};

// Helper functions
function getBrowserFromUserAgent(userAgent) {
  if (!userAgent) return "Unknown";

  if (userAgent.includes("Chrome")) return "Chrome";
  if (userAgent.includes("Firefox")) return "Firefox";
  if (userAgent.includes("Safari")) return "Safari";
  if (userAgent.includes("Edge")) return "Edge";
  if (userAgent.includes("Opera")) return "Opera";

  return "Unknown";
}

function getOSFromUserAgent(userAgent) {
  if (!userAgent) return "Unknown";

  if (userAgent.includes("Windows")) return "Windows";
  if (userAgent.includes("Mac OS")) return "macOS";
  if (userAgent.includes("Linux")) return "Linux";
  if (userAgent.includes("Android")) return "Android";
  if (userAgent.includes("iOS")) return "iOS";

  return "Unknown";
}

module.exports = { router, sendPushNotification };
