// routes/notifications.js

const express = require("express");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();

// Send push notification to a user
async function sendPushNotification(userId, notification) {
  try {
    // Get user's notification preferences
    const user = await User.findById(userId);
    if (!user || !user.isActive) {
      console.log(
        `User ${userId} not found or inactive, skipping notification`
      );
      return false;
    }

    // Check if user has notifications enabled
    if (!user.settings?.notifications?.push) {
      console.log(`Push notifications disabled for user ${userId}`);
      return false;
    }

    // Check notification type preferences
    const notificationType = notification.type;
    if (
      notificationType === "new_match" &&
      !user.settings?.notifications?.matches
    ) {
      console.log(`Match notifications disabled for user ${userId}`);
      return false;
    }
    if (
      notificationType === "new_like" &&
      !user.settings?.notifications?.likes
    ) {
      console.log(`Like notifications disabled for user ${userId}`);
      return false;
    }
    if (
      notificationType === "new_message" &&
      !user.settings?.notifications?.messages
    ) {
      console.log(`Message notifications disabled for user ${userId}`);
      return false;
    }

    // TODO: Implement actual push notification service
    // This is a placeholder for the actual push notification implementation
    // You would integrate with services like:
    // - Firebase Cloud Messaging (FCM)
    // - Apple Push Notification Service (APNS)
    // - Expo Push Notifications
    // - OneSignal
    // - Pusher

    console.log(`📱 Push notification sent to user ${userId}:`, {
      title: notification.title,
      body: notification.body,
      type: notification.type,
      data: notification.data,
    });

    // For now, we'll just log the notification
    // In a real implementation, you would:
    // 1. Get the user's device tokens
    // 2. Send to push notification service
    // 3. Handle delivery status
    // 4. Store notification history

    return true;
  } catch (error) {
    console.error(`Error sending push notification to user ${userId}:`, error);
    return false;
  }
}

// @route   POST /api/notifications/register-device
// @desc    Register a device for push notifications
// @access  Private
router.post("/register-device", authenticate, async (req, res) => {
  try {
    const { deviceToken, platform, appVersion } = req.body;

    if (!deviceToken) {
      return res.status(400).json({
        success: false,
        message: "Device token is required",
      });
    }

    // Update user's device information
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: {
        "settings.devices": {
          token: deviceToken,
          platform: platform || "unknown",
          appVersion: appVersion || "1.0.0",
          registeredAt: new Date(),
          lastUsed: new Date(),
        },
      },
    });

    res.json({
      success: true,
      message: "Device registered successfully",
    });
  } catch (error) {
    console.error("Device registration error:", error);
    res.status(500).json({
      success: false,
      message: "Error registering device",
    });
  }
});

// @route   POST /api/notifications/unregister-device
// @desc    Unregister a device from push notifications
// @access  Private
router.post("/unregister-device", authenticate, async (req, res) => {
  try {
    const { deviceToken } = req.body;

    if (!deviceToken) {
      return res.status(400).json({
        success: false,
        message: "Device token is required",
      });
    }

    // Remove device from user's devices
    await User.findByIdAndUpdate(req.user._id, {
      $pull: {
        "settings.devices": { token: deviceToken },
      },
    });

    res.json({
      success: true,
      message: "Device unregistered successfully",
    });
  } catch (error) {
    console.error("Device unregistration error:", error);
    res.status(500).json({
      success: false,
      message: "Error unregistering device",
    });
  }
});

// @route   PUT /api/notifications/settings
// @desc    Update notification settings
// @access  Private
router.put("/settings", authenticate, async (req, res) => {
  try {
    const { notifications } = req.body;

    if (!notifications || typeof notifications !== "object") {
      return res.status(400).json({
        success: false,
        message: "Notification settings are required",
      });
    }

    // Update user's notification settings
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { "settings.notifications": notifications },
      { new: true }
    );

    res.json({
      success: true,
      message: "Notification settings updated successfully",
      settings: user.settings.notifications,
    });
  } catch (error) {
    console.error("Notification settings update error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating notification settings",
    });
  }
});

// @route   GET /api/notifications/settings
// @desc    Get user's notification settings
// @access  Private
router.get("/settings", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "settings.notifications"
    );

    res.json({
      success: true,
      settings: user.settings?.notifications || {},
    });
  } catch (error) {
    console.error("Get notification settings error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching notification settings",
    });
  }
});

// @route   POST /api/notifications/test
// @desc    Send a test notification to the current user
// @access  Private
router.post("/test", authenticate, async (req, res) => {
  try {
    const {
      title = "Test Notification",
      body = "This is a test notification",
    } = req.body;

    const success = await sendPushNotification(req.user._id, {
      title,
      body,
      type: "test",
      data: { url: "/dashboard" },
    });

    if (success) {
      res.json({
        success: true,
        message: "Test notification sent successfully",
      });
    } else {
      res.status(400).json({
        success: false,
        message: "Failed to send test notification",
      });
    }
  } catch (error) {
    console.error("Test notification error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending test notification",
    });
  }
});

module.exports = {
  router,
  sendPushNotification,
};
