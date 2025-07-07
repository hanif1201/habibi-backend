const express = require("express");
const { body, validationResult } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");
const Match = require("../models/Match");
const Message = require("../models/Message");

const router = express.Router();

// @route   GET /api/safety/blocked-users
// @desc    Get user's blocked users list
// @access  Private
router.get("/blocked-users", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate("safety.blockedUsers", "firstName lastName photos")
      .select("safety.blockedUsers");

    const blockedUsers = user.safety?.blockedUsers || [];

    res.json({
      success: true,
      blockedUsers: blockedUsers.map((user) => ({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        primaryPhoto: user.photos?.find((p) => p.isPrimary) || user.photos?.[0],
        blockedAt: new Date(), // You might want to track this separately
      })),
    });
  } catch (error) {
    console.error("Get blocked users error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching blocked users",
    });
  }
});

// @route   POST /api/safety/block
// @desc    Block a user
// @access  Private
router.post(
  "/block",
  authenticate,
  [
    body("userId").isMongoId().withMessage("Valid user ID is required"),
    body("reason")
      .optional()
      .isIn([
        "inappropriate_behavior",
        "fake_profile",
        "harassment",
        "spam",
        "other",
      ])
      .withMessage("Invalid block reason"),
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

      const { userId, reason = "other" } = req.body;
      const currentUserId = req.user._id;

      if (userId === currentUserId.toString()) {
        return res.status(400).json({
          success: false,
          message: "You cannot block yourself",
        });
      }

      // Check if user exists
      const userToBlock = await User.findById(userId);
      if (!userToBlock) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Get current user
      const currentUser = await User.findById(currentUserId);

      // Block the user
      await currentUser.blockUser(userId);

      // Update any existing matches
      await Match.updateMany(
        {
          users: { $all: [currentUserId, userId] },
          status: "active",
        },
        {
          status: "blocked",
          blockedBy: currentUserId,
          blockedAt: new Date(),
        }
      );

      // Soft delete messages between users
      await Message.updateMany(
        {
          $or: [
            { sender: currentUserId, receiver: userId },
            { sender: userId, receiver: currentUserId },
          ],
          isDeleted: false,
        },
        {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: currentUserId,
        }
      );

      console.log(
        `🚫 User ${currentUser.firstName} blocked user ${userToBlock.firstName} for: ${reason}`
      );

      res.json({
        success: true,
        message: "User blocked successfully",
        blockedUser: {
          _id: userToBlock._id,
          firstName: userToBlock.firstName,
          lastName: userToBlock.lastName,
        },
      });
    } catch (error) {
      console.error("Block user error:", error);
      res.status(500).json({
        success: false,
        message: "Error blocking user",
      });
    }
  }
);

// @route   POST /api/safety/unblock
// @desc    Unblock a user
// @access  Private
router.post(
  "/unblock",
  authenticate,
  [body("userId").isMongoId().withMessage("Valid user ID is required")],
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

      const { userId } = req.body;
      const currentUserId = req.user._id;

      // Check if user exists
      const userToUnblock = await User.findById(userId);
      if (!userToUnblock) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Get current user
      const currentUser = await User.findById(currentUserId);

      // Check if user is actually blocked
      if (!currentUser.safety.blockedUsers.includes(userId)) {
        return res.status(400).json({
          success: false,
          message: "User is not blocked",
        });
      }

      // Unblock the user
      await currentUser.unblockUser(userId);

      // Note: We don't restore matches or messages - those remain deleted for safety

      console.log(
        `✅ User ${currentUser.firstName} unblocked user ${userToUnblock.firstName}`
      );

      res.json({
        success: true,
        message: "User unblocked successfully",
        unblockedUser: {
          _id: userToUnblock._id,
          firstName: userToUnblock.firstName,
          lastName: userToUnblock.lastName,
        },
      });
    } catch (error) {
      console.error("Unblock user error:", error);
      res.status(500).json({
        success: false,
        message: "Error unblocking user",
      });
    }
  }
);

// @route   POST /api/safety/report
// @desc    Report a user for inappropriate behavior
// @access  Private
router.post(
  "/report",
  authenticate,
  [
    body("userId").isMongoId().withMessage("Valid user ID is required"),
    body("reason")
      .isIn([
        "inappropriate_content",
        "fake_profile",
        "harassment",
        "spam",
        "underage",
        "violence",
        "hate_speech",
        "scam",
        "other",
      ])
      .withMessage("Invalid report reason"),
    body("details")
      .optional()
      .isLength({ max: 500 })
      .withMessage("Details cannot exceed 500 characters"),
    body("evidence")
      .optional()
      .isArray()
      .withMessage("Evidence must be an array"),
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

      const { userId, reason, details, evidence = [] } = req.body;
      const reporterId = req.user._id;

      if (userId === reporterId.toString()) {
        return res.status(400).json({
          success: false,
          message: "You cannot report yourself",
        });
      }

      // Check if reported user exists
      const reportedUser = await User.findById(userId);
      if (!reportedUser) {
        return res.status(404).json({
          success: false,
          message: "Reported user not found",
        });
      }

      // Get reporter
      const reporter = await User.findById(reporterId);

      // Check if user has already reported this person
      const existingReport = reporter.safety.reportedUsers.find(
        (report) => report.user.toString() === userId
      );

      if (existingReport) {
        return res.status(400).json({
          success: false,
          message: "You have already reported this user",
        });
      }

      // Add to reporter's reported users list
      await reporter.reportUser(userId, reason, details);

      // TODO: In a production app, you'd want to:
      // 1. Create a separate Report model for admin review
      // 2. Implement admin dashboard for reviewing reports
      // 3. Set up automatic actions for multiple reports
      // 4. Send notifications to admins for serious reports

      console.log(
        `🚨 REPORT: ${reporter.firstName} reported ${reportedUser.firstName}`
      );
      console.log(`   Reason: ${reason}`);
      if (details) console.log(`   Details: ${details}`);
      if (evidence.length > 0)
        console.log(`   Evidence: ${evidence.length} items`);

      res.json({
        success: true,
        message:
          "Report submitted successfully. Thank you for helping keep Habibi safe.",
        reportId: new Date().toISOString(), // In production, use actual report ID
      });
    } catch (error) {
      console.error("Report user error:", error);
      res.status(500).json({
        success: false,
        message: "Error submitting report",
      });
    }
  }
);

// @route   GET /api/safety/reports
// @desc    Get user's submitted reports
// @access  Private
router.get("/reports", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate("safety.reportedUsers.user", "firstName lastName photos")
      .select("safety.reportedUsers");

    const reports = user.safety?.reportedUsers || [];

    res.json({
      success: true,
      reports: reports.map((report) => ({
        _id: report._id,
        user: {
          _id: report.user._id,
          firstName: report.user.firstName,
          lastName: report.user.lastName,
          primaryPhoto:
            report.user.photos?.find((p) => p.isPrimary) ||
            report.user.photos?.[0],
        },
        reason: report.reason,
        details: report.details,
        reportedAt: report.reportedAt,
      })),
    });
  } catch (error) {
    console.error("Get reports error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching reports",
    });
  }
});

// @route   GET /api/safety/settings
// @desc    Get user's safety settings
// @access  Private
router.get("/settings", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "settings.privacy settings.notifications"
    );

    res.json({
      success: true,
      settings: {
        privacy: user.settings?.privacy || {
          showAge: true,
          showDistance: true,
          onlineStatus: true,
          readReceipts: true,
        },
        notifications: user.settings?.notifications || {
          matches: true,
          messages: true,
          likes: true,
          email: true,
          push: true,
        },
      },
    });
  } catch (error) {
    console.error("Get safety settings error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching safety settings",
    });
  }
});

// @route   PUT /api/safety/settings
// @desc    Update user's safety and privacy settings
// @access  Private
router.put(
  "/settings",
  authenticate,
  [
    body("privacy")
      .optional()
      .isObject()
      .withMessage("Privacy settings must be an object"),
    body("privacy.showAge")
      .optional()
      .isBoolean()
      .withMessage("Show age must be boolean"),
    body("privacy.showDistance")
      .optional()
      .isBoolean()
      .withMessage("Show distance must be boolean"),
    body("privacy.onlineStatus")
      .optional()
      .isBoolean()
      .withMessage("Online status must be boolean"),
    body("privacy.readReceipts")
      .optional()
      .isBoolean()
      .withMessage("Read receipts must be boolean"),
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

      const { privacy } = req.body;
      const userId = req.user._id;

      const updateData = {};
      if (privacy) {
        updateData["settings.privacy"] = privacy;
      }

      const user = await User.findByIdAndUpdate(userId, updateData, {
        new: true,
        runValidators: true,
      }).select("settings");

      res.json({
        success: true,
        message: "Safety settings updated successfully",
        settings: user.settings,
      });
    } catch (error) {
      console.error("Update safety settings error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating safety settings",
      });
    }
  }
);

// @route   POST /api/safety/emergency-logout
// @desc    Emergency logout from all devices
// @access  Private
router.post("/emergency-logout", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    // Clear all device tokens
    await User.findByIdAndUpdate(userId, {
      $set: {
        deviceTokens: [],
        lastLogout: new Date(),
      },
    });

    // TODO: In a production app with session management:
    // - Invalidate all JWT tokens by updating user secret
    // - Clear all Redis sessions
    // - Log security event

    console.log(`🚨 Emergency logout performed for user ${userId}`);

    res.json({
      success: true,
      message:
        "Emergency logout completed. Please log in again on all devices.",
    });
  } catch (error) {
    console.error("Emergency logout error:", error);
    res.status(500).json({
      success: false,
      message: "Error performing emergency logout",
    });
  }
});

// @route   GET /api/safety/activity-log
// @desc    Get user's recent activity log (simplified version)
// @access  Private
router.get("/activity-log", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    const { limit = 50 } = req.query;

    // In a production app, you'd have a separate ActivityLog model
    // For now, we'll return basic info from existing data
    const user = await User.findById(userId).select(
      "lastActive createdAt deviceTokens"
    );

    const activities = [
      {
        type: "account_created",
        description: "Account created",
        timestamp: user.createdAt,
        details: "Welcome to Habibi!",
      },
      {
        type: "last_active",
        description: "Last active",
        timestamp: user.lastActive,
        details: "App usage",
      },
    ];

    // Add device registrations
    user.deviceTokens?.forEach((device) => {
      activities.push({
        type: "device_registered",
        description: `${device.platform} device registered`,
        timestamp: device.registeredAt,
        details: `${device.deviceInfo?.browser || "Unknown"} on ${
          device.deviceInfo?.os || "Unknown"
        }`,
      });
    });

    // Sort by timestamp
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      activities: activities.slice(0, parseInt(limit)),
    });
  } catch (error) {
    console.error("Get activity log error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching activity log",
    });
  }
});

module.exports = router;
