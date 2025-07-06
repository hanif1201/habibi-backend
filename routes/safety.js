// routes/safety.js - NEW FILE
const express = require("express");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");

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
      blockedUsers: blockedUsers.map(user => ({
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        primaryPhoto: user.photos?.find(p => p.isPrimary) || user.photos?.[0],
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

// @route   POST /api/safety/unblock
// @desc    Unblock a user
// @access  Private
router.post("/unblock", authenticate, async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const user = await User.findById(req.user._id);
    await user.unblockUser(userId);

    res.json({
      success: true,
      message: "User unblocked successfully",
    });
  } catch (error) {
    console.error("Unblock user error:", error);
    res.status(500).json({
      success: false,
      message: "Error unblocking user",
    });
  }
});

module.exports = router;

// ===== UPDATES TO routes/profile.js =====

// Add these new routes to your existing routes/profile.js file:

// @route   PUT /api/profile/notifications
// @desc    Update notification settings
// @access  Private
router.put("/notifications", authenticate, async (req, res) => {
  try {
    const { notifications } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { "settings.notifications": notifications },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: "Notification settings updated successfully",
      user: user.toSafeObject(),
    });
  } catch (error) {
    console.error("Update notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating notification settings",
    });
  }
});

// @route   PUT /api/profile/privacy
// @desc    Update privacy settings
// @access  Private
router.put("/privacy", authenticate, async (req, res) => {
  try {
    const { privacy } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { "settings.privacy": privacy },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: "Privacy settings updated successfully",
      user: user.toSafeObject(),
    });
  } catch (error) {
    console.error("Update privacy error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating privacy settings",
    });
  }
});

// ===== UPDATES TO routes/matching.js =====

// Add this route to handle match deletion:

// @route   DELETE /api/matching/matches/:matchId
// @desc    Unmatch/delete a match
// @access  Private
router.delete("/matches/:matchId", authenticate, async (req, res) => {
  try {
    const { matchId } = req.params;

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found",
      });
    }

    if (!match.users.includes(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Delete the match
    await match.unmatch();

    // Optionally delete associated messages
    const Message = require("../models/Message");
    await Message.updateMany(
      { match: matchId },
      { isDeleted: true, deletedAt: new Date() }
    );

    res.json({
      success: true,
      message: "Match deleted successfully",
    });
  } catch (error) {
    console.error("Delete match error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting match",
    });
  }
});

