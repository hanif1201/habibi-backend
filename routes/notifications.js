// routes/notifications.js
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
          ...deviceInfo,
        },
        registeredAt: new Date(),
        lastUsed: new Date(),
        isActive: true,
      };

      if (existingTokenIndex >= 0) {
        // Update existing token
        user.deviceTokens[existingTokenIndex] = deviceData;
        console.log(`🔄 Updated device token for user ${user.firstName}`);
      } else {
        // Add new token
        user.deviceTokens.push(deviceData);
        console.log(
          `📱 Registered new device token for user ${user.firstName}`
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

      // Send test notification to verify setup
      const testResult = await pushNotificationService.sendGenericNotification(
        userId,
        "🎉 Notifications Enabled!",
        "You'll now receive push notifications from Habibi",
        { type: "setup_complete" }
      );

      res.json({
        success: true,
        message: "Device registered successfully",
        deviceCount: user.deviceTokens.length,
        testNotificationSent: testResult.success,
      });
    } catch (error) {
      console.error("Device registration error:", error);
      res.status(500).json({
        success: false,
        message: "Error registering device",
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
      },
      deviceCount: user.deviceTokens?.length || 0,
      devices:
        user.deviceTokens?.map((device) => ({
          platform: device.platform,
          registeredAt: device.registeredAt,
          lastUsed: device.lastUsed,
          isActive: device.isActive,
          deviceInfo: {
            browser: device.deviceInfo?.userAgent?.includes("Chrome")
              ? "Chrome"
              : device.deviceInfo?.userAgent?.includes("Firefox")
              ? "Firefox"
              : device.deviceInfo?.userAgent?.includes("Safari")
              ? "Safari"
              : "Unknown",
          },
        })) || [],
    });
  } catch (error) {
    console.error("Get preferences error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching preferences",
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
      "This is a test notification from Habibi. If you can see this, push notifications are working!",
      {
        type: "test",
        timestamp: new Date().toISOString(),
      }
    );

    res.json({
      success: result.success,
      message: result.success
        ? `Test notification sent to ${result.sentTo} device(s)`
        : "Failed to send test notification",
      details: result,
    });
  } catch (error) {
    console.error("Test notification error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending test notification",
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
      // Check if user is admin (implement your admin check logic)
      if (!req.user.isAdmin) {
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
          { title, body, type: "admin_broadcast" },
          data
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
      firebase: {
        initialized: health.healthy,
        projectId: process.env.FIREBASE_PROJECT_ID ? "configured" : "missing",
        credentials: process.env.FIREBASE_PRIVATE_KEY
          ? "configured"
          : "missing",
      },
    });
  } catch (error) {
    console.error("Health check error:", error);
    res.status(500).json({
      success: false,
      message: "Error checking health",
    });
  }
});

// @route   GET /api/notifications/stats
// @desc    Get notification statistics
// @access  Private
router.get("/stats", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("deviceTokens settings");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const stats = {
      totalDevices: user.deviceTokens?.length || 0,
      activeDevices: user.deviceTokens?.filter((d) => d.isActive)?.length || 0,
      platforms: {
        web:
          user.deviceTokens?.filter((d) => d.platform === "web")?.length || 0,
        android:
          user.deviceTokens?.filter((d) => d.platform === "android")?.length ||
          0,
        ios:
          user.deviceTokens?.filter((d) => d.platform === "ios")?.length || 0,
      },
      preferences: user.settings?.notifications || {},
      lastRegistration:
        user.deviceTokens?.length > 0
          ? Math.max(...user.deviceTokens.map((d) => new Date(d.registeredAt)))
          : null,
    };

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching stats",
    });
  }
});

module.exports = router;
