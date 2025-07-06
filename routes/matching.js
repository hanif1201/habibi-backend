const express = require("express");
const { body, validationResult } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");
const Swipe = require("../models/Swipe");
const Match = require("../models/Match");
const Message = require("../models/Message");

const router = express.Router();

// @route   GET /api/matching/discover
// @desc    Get potential matches with enhanced algorithm
// @access  Private
router.get("/discover", authenticate, async (req, res) => {
  try {
    const { boost, rewind } = req.query;
    const currentUser = await User.findById(req.user._id);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if profile is complete enough for discovery
    if (!currentUser.photos || currentUser.photos.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please add at least one photo to start discovering matches",
        requiresPhoto: true,
      });
    }

    // Get users already swiped on
    const swipedUserIds = await Swipe.getSwipedUserIds(currentUser._id);

    // Get current user's matches to exclude them
    const matches = await Match.findForUser(currentUser._id);
    const matchedUserIds = matches.map((match) =>
      match.getOtherUser(currentUser._id)
    );

    // Build exclusion list
    const excludeIds = [...swipedUserIds, ...matchedUserIds];

    // Find potential matches using the User model method
    let potentialMatches = await User.findForDiscovery(currentUser, excludeIds);

    // Filter by mutual interest
    potentialMatches = potentialMatches.filter((user) => {
      return isMutualInterest(currentUser, user);
    });

    // Filter by distance if location is available
    if (
      currentUser.location?.coordinates &&
      currentUser.preferences?.maxDistance
    ) {
      potentialMatches = potentialMatches.filter((user) => {
        if (!user.location?.coordinates) return true;

        const distance = calculateDistance(
          currentUser.location.coordinates,
          user.location.coordinates
        );

        return distance <= currentUser.preferences.maxDistance;
      });
    }

    // Calculate compatibility scores and enhance user data
    potentialMatches = potentialMatches.map((user) => ({
      ...user.toObject(),
      age: calculateAge(user.dateOfBirth),
      distance: calculateUserDistance(currentUser, user),
      compatibilityScore: calculateCompatibilityScore(currentUser, user),
      primaryPhoto:
        user.photos?.find((photo) => photo.isPrimary) || user.photos?.[0],
      isOnline: isUserRecentlyActive(user.lastActive),
      verification: user.verification || { isVerified: false },
    }));

    // Sort by compatibility score and activity
    potentialMatches.sort((a, b) => {
      // Prioritize verified users
      if (a.verification.isVerified && !b.verification.isVerified) return -1;
      if (!a.verification.isVerified && b.verification.isVerified) return 1;

      // Then by online status
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;

      // Then by compatibility score
      return b.compatibilityScore - a.compatibilityScore;
    });

    // Apply boost logic (show more/better matches)
    const limit =
      boost && currentUser.subscription?.features?.includes("boosts") ? 20 : 10;
    potentialMatches = potentialMatches.slice(0, limit);

    // Clean up user data for client
    const formattedMatches = potentialMatches.map((user) => ({
      _id: user._id,
      firstName: user.firstName,
      age: user.age,
      bio: user.bio,
      photos: user.photos,
      primaryPhoto: user.primaryPhoto,
      distance: user.distance,
      isOnline: user.isOnline,
      verification: user.verification,
      compatibilityScore: user.compatibilityScore,
      lastActive: user.lastActive,
    }));

    // Track discovery for analytics
    await User.findByIdAndUpdate(currentUser._id, {
      $inc: { "stats.profileViews": formattedMatches.length },
    });

    res.json({
      success: true,
      users: formattedMatches,
      hasMore: potentialMatches.length === limit,
      boost: !!boost,
      summary: {
        total: formattedMatches.length,
        verified: formattedMatches.filter((u) => u.verification?.isVerified)
          .length,
        online: formattedMatches.filter((u) => u.isOnline).length,
        nearbyCount: formattedMatches.filter(
          (u) => u.distance && u.distance <= 25
        ).length,
      },
    });
  } catch (error) {
    console.error("Discovery error:", error);
    res.status(500).json({
      success: false,
      message: "Error finding potential matches",
    });
  }
});

// @route   POST /api/matching/swipe
// @desc    Enhanced swipe with analytics and premium features
// @access  Private
router.post(
  "/swipe",
  authenticate,
  [
    body("userId").isMongoId().withMessage("Valid user ID is required"),
    body("action")
      .isIn(["like", "pass", "superlike"])
      .withMessage("Invalid action"),
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

      const { userId: swipedUserId, action } = req.body;
      const swiperId = req.user._id;

      // Check if user exists and is active
      const swipedUser = await User.findById(swipedUserId);
      if (!swipedUser || !swipedUser.isActive) {
        return res.status(404).json({
          success: false,
          message: "User not found or inactive",
        });
      }

      // Check if users have blocked each other
      const currentUser = await User.findById(swiperId);
      if (
        currentUser.safety?.blockedUsers?.includes(swipedUserId) ||
        swipedUser.safety?.blockedUsers?.includes(swiperId)
      ) {
        return res.status(403).json({
          success: false,
          message: "Cannot swipe on this user",
        });
      }

      // Check if already swiped
      const existingSwipe = await Swipe.findOne({
        swiper: swiperId,
        swiped: swipedUserId,
      });

      if (existingSwipe) {
        return res.status(400).json({
          success: false,
          message: "You have already swiped on this user",
        });
      }

      // Check super like limits for free users
      if (action === "superlike") {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const todaySuperlikes = await Swipe.countDocuments({
          swiper: swiperId,
          action: "superlike",
          swipedAt: { $gte: todayStart },
        });

        const superlikeLimit =
          currentUser.subscription?.type === "free" ? 1 : 5;
        if (todaySuperlikes >= superlikeLimit) {
          return res.status(400).json({
            success: false,
            message: `Daily super like limit reached (${superlikeLimit})`,
            requiresPremium: currentUser.subscription?.type === "free",
          });
        }
      }

      // Create swipe record
      const swipe = new Swipe({
        swiper: swiperId,
        swiped: swipedUserId,
        action,
      });

      await swipe.save();

      // Update user stats
      const statField = action === "superlike" ? "superLikes" : action + "s";
      await User.findByIdAndUpdate(swiperId, {
        $inc: { [`stats.${statField}`]: 1 },
      });

      let isMatch = false;
      let match = null;

      // Check for match if it's a like or superlike
      if (action === "like" || action === "superlike") {
        const mutualLike = await Swipe.checkMutualLike(swiperId, swipedUserId);

        if (mutualLike) {
          // Create match
          match = new Match({
            users: [swiperId, swipedUserId],
            initiatedBy: swiperId,
            matchType: action === "superlike" ? "superlike" : "regular",
          });

          await match.save();
          await match.populate(
            "users",
            "firstName lastName photos bio dateOfBirth gender verification"
          );

          // Update match stats for both users
          await User.updateMany(
            { _id: { $in: [swiperId, swipedUserId] } },
            { $inc: { "stats.matches": 1 } }
          );

          isMatch = true;

          // Send push notification to matched user if enabled
          if (swipedUser.settings?.notifications?.matches) {
            // TODO: Implement push notification
            console.log(`📱 Match notification for ${swipedUser.firstName}`);
          }
        } else {
          // Send like notification to swiped user
          if (swipedUser.settings?.notifications?.likes) {
            // TODO: Implement push notification
            console.log(`❤️ Like notification for ${swipedUser.firstName}`);
          }
        }
      }

      const response = {
        success: true,
        message: isMatch ? "It's a match! 🎉" : "Swipe recorded",
        isMatch,
        action,
        swipeId: swipe._id,
      };

      if (isMatch && match) {
        const otherUser = match.users.find(
          (user) => user._id.toString() !== swiperId.toString()
        );
        response.match = {
          _id: match._id,
          otherUser: {
            _id: otherUser._id,
            firstName: otherUser.firstName,
            lastName: otherUser.lastName,
            age: calculateAge(otherUser.dateOfBirth),
            photos: otherUser.photos,
            primaryPhoto:
              otherUser.photos?.find((p) => p.isPrimary) ||
              otherUser.photos?.[0],
            verification: otherUser.verification,
          },
          matchedAt: match.matchedAt,
          matchType: match.matchType,
          expiresAt: match.expiresAt,
          timeToExpiration: match.timeToExpiration,
        };
      }

      res.json(response);
    } catch (error) {
      console.error("Swipe error:", error);
      res.status(500).json({
        success: false,
        message: "Error processing swipe",
      });
    }
  }
);

// @route   POST /api/matching/rewind
// @desc    Undo last swipe (premium feature)
// @access  Private
router.post("/rewind", authenticate, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);

    // Check if user has rewind feature
    if (!currentUser.subscription?.features?.includes("rewinds")) {
      return res.status(403).json({
        success: false,
        message: "Rewind feature requires premium subscription",
        requiresPremium: true,
      });
    }

    // Get last swipe
    const lastSwipe = await Swipe.findOne({
      swiper: req.user._id,
    }).sort({ swipedAt: -1 });

    if (!lastSwipe) {
      return res.status(400).json({
        success: false,
        message: "No recent swipe to undo",
      });
    }

    // Check if swipe is recent enough (within 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (lastSwipe.swipedAt < oneHourAgo) {
      return res.status(400).json({
        success: false,
        message: "Cannot rewind swipes older than 1 hour",
      });
    }

    // Check if there's a match to undo
    let matchDeleted = false;
    if (lastSwipe.action === "like" || lastSwipe.action === "superlike") {
      const match = await Match.findOne({
        users: { $all: [req.user._id, lastSwipe.swiped] },
        status: "active",
      });

      if (match && !match.firstMessageSentAt) {
        // Only delete match if no messages have been sent
        await match.deleteOne();
        matchDeleted = true;

        // Update match stats
        await User.updateMany(
          { _id: { $in: [req.user._id, lastSwipe.swiped] } },
          { $inc: { "stats.matches": -1 } }
        );
      }
    }

    // Delete the swipe
    await lastSwipe.deleteOne();

    // Update user stats
    const statField =
      lastSwipe.action === "superlike" ? "superLikes" : lastSwipe.action + "s";
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { [`stats.${statField}`]: -1 },
    });

    res.json({
      success: true,
      message: "Last swipe has been undone",
      swipeUndone: {
        action: lastSwipe.action,
        userId: lastSwipe.swiped,
      },
      matchDeleted,
    });
  } catch (error) {
    console.error("Rewind error:", error);
    res.status(500).json({
      success: false,
      message: "Error undoing swipe",
    });
  }
});

// @route   POST /api/matching/boost
// @desc    Boost profile for better visibility (premium feature)
// @access  Private
router.post("/boost", authenticate, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);

    // Check if user has boost feature
    if (!currentUser.subscription?.features?.includes("boosts")) {
      return res.status(403).json({
        success: false,
        message: "Boost feature requires premium subscription",
        requiresPremium: true,
      });
    }

    // Check daily boost limit
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // TODO: Track boosts in a separate collection for analytics
    const boostLimit = currentUser.subscription?.type === "gold" ? 5 : 1;

    // For now, we'll simulate boost by updating user stats
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { "stats.profileViews": 10 }, // Simulate increased visibility
      lastActive: new Date(), // Update activity to appear in more feeds
    });

    res.json({
      success: true,
      message: "Profile boosted successfully! You'll be shown to more people.",
      boost: {
        activatedAt: new Date(),
        duration: 30, // 30 minutes
        estimatedExtraViews: 10,
      },
    });
  } catch (error) {
    console.error("Boost error:", error);
    res.status(500).json({
      success: false,
      message: "Error boosting profile",
    });
  }
});

// @route   GET /api/matching/matches
// @desc    Get user's matches with enhanced sorting
// @access  Private
router.get("/matches", authenticate, async (req, res) => {
  try {
    const { filter = "all", sort = "recent" } = req.query;

    // First, expire old matches
    await Match.expireOldMatches();

    let matchQuery = {
      users: req.user._id,
      status: "active",
    };

    // Apply filters
    if (filter === "new") {
      matchQuery.firstMessageSentAt = null;
    } else if (filter === "messaged") {
      matchQuery.firstMessageSentAt = { $ne: null };
    }

    const matches = await Match.find(matchQuery)
      .populate(
        "users",
        "firstName lastName photos bio dateOfBirth gender verification lastActive"
      )
      .lean();

    // Get message information for each match
    const matchIds = matches.map((match) => match._id);

    // Get last messages and unread counts
    const messageData = await Message.aggregate([
      {
        $match: {
          match: { $in: matchIds },
          isDeleted: false,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: "$match",
          lastMessage: { $first: "$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiver", req.user._id] },
                    { $eq: ["$readAt", null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const formattedMatches = matches.map((match) => {
      const otherUser = match.users.find(
        (user) => user._id.toString() !== req.user._id.toString()
      );
      const msgData = messageData.find(
        (msg) => msg._id.toString() === match._id.toString()
      );

      return {
        _id: match._id,
        user: {
          _id: otherUser._id,
          firstName: otherUser.firstName,
          lastName: otherUser.lastName,
          age: calculateAge(otherUser.dateOfBirth),
          bio: otherUser.bio,
          photos: otherUser.photos,
          primaryPhoto:
            otherUser.photos?.find((photo) => photo.isPrimary) ||
            otherUser.photos?.[0],
          verification: otherUser.verification || { isVerified: false },
          isOnline: isUserRecentlyActive(otherUser.lastActive),
          lastActive: otherUser.lastActive,
        },
        matchedAt: match.matchedAt,
        lastActivity: match.lastActivity,
        matchType: match.matchType,
        status: match.status,
        firstMessageSentAt: match.firstMessageSentAt,
        firstMessageSentBy: match.firstMessageSentBy,
        expiresAt: match.expiresAt,
        timeToExpiration: match.timeToExpiration,
        urgencyLevel: match.urgencyLevel,
        conversationStarted: !!match.firstMessageSentAt,
        lastMessage: msgData?.lastMessage
          ? {
              content: msgData.lastMessage.content,
              createdAt: msgData.lastMessage.createdAt,
              senderId: msgData.lastMessage.sender,
              isFromMe:
                msgData.lastMessage.sender.toString() ===
                req.user._id.toString(),
            }
          : null,
        unreadCount: msgData?.unreadCount || 0,
      };
    });

    // Apply sorting
    formattedMatches.sort((a, b) => {
      switch (sort) {
        case "recent":
          return new Date(b.lastActivity) - new Date(a.lastActivity);
        case "unread":
          if (a.unreadCount !== b.unreadCount) {
            return b.unreadCount - a.unreadCount;
          }
          return new Date(b.lastActivity) - new Date(a.lastActivity);
        case "new":
          if (a.conversationStarted !== b.conversationStarted) {
            return a.conversationStarted ? 1 : -1;
          }
          return new Date(b.matchedAt) - new Date(a.matchedAt);
        case "online":
          if (a.user.isOnline !== b.user.isOnline) {
            return a.user.isOnline ? -1 : 1;
          }
          return new Date(b.lastActivity) - new Date(a.lastActivity);
        default:
          return new Date(b.matchedAt) - new Date(a.matchedAt);
      }
    });

    const summary = {
      total: formattedMatches.length,
      newMatches: formattedMatches.filter((m) => !m.conversationStarted).length,
      activeConversations: formattedMatches.filter((m) => m.conversationStarted)
        .length,
      unreadMessages: formattedMatches.reduce(
        (sum, m) => sum + m.unreadCount,
        0
      ),
      expiringSoon: formattedMatches.filter(
        (m) => m.urgencyLevel === "critical"
      ).length,
      onlineNow: formattedMatches.filter((m) => m.user.isOnline).length,
    };

    res.json({
      success: true,
      matches: formattedMatches,
      summary,
      filter,
      sort,
    });
  } catch (error) {
    console.error("Get matches error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching matches",
    });
  }
});

// @route   POST /api/matching/report
// @desc    Report a user
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
        "other",
      ])
      .withMessage("Invalid report reason"),
    body("details")
      .optional()
      .isLength({ max: 500 })
      .withMessage("Details too long"),
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

      const { userId, reason, details } = req.body;
      const currentUser = await User.findById(req.user._id);

      // Check if user exists
      const reportedUser = await User.findById(userId);
      if (!reportedUser) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Add to current user's reported users
      await currentUser.reportUser(userId, reason);

      // TODO: Create a separate Report model for admin review
      // For now, we'll log the report
      console.log(
        `🚨 User ${req.user._id} reported user ${userId} for: ${reason}`
      );
      if (details) {
        console.log(`Details: ${details}`);
      }

      res.json({
        success: true,
        message:
          "User reported successfully. Thank you for helping keep our community safe.",
      });
    } catch (error) {
      console.error("Report user error:", error);
      res.status(500).json({
        success: false,
        message: "Error reporting user",
      });
    }
  }
);

// @route   POST /api/matching/block
// @desc    Block a user
// @access  Private
router.post(
  "/block",
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
      const currentUser = await User.findById(req.user._id);

      // Check if user exists
      const userToBlock = await User.findById(userId);
      if (!userToBlock) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Block the user
      await currentUser.blockUser(userId);

      // Remove any existing match
      await Match.updateMany(
        { users: { $all: [req.user._id, userId] } },
        { status: "blocked" }
      );

      res.json({
        success: true,
        message: "User blocked successfully",
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

// @route   GET /api/matching/stats
// @desc    Enhanced user statistics
// @access  Private
router.get("/stats", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    // Get swipe stats with time periods
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalStats,
      todayStats,
      weekStats,
      monthStats,
      matchCount,
      conversationCount,
      pendingMatches,
      likesReceived,
    ] = await Promise.all([
      Swipe.getSwipeStats(userId),
      getSwipeStatsForPeriod(userId, today),
      getSwipeStatsForPeriod(userId, thisWeek),
      getSwipeStatsForPeriod(userId, thisMonth),
      Match.countDocuments({ users: userId, status: "active" }),
      Match.countDocuments({
        users: userId,
        status: "active",
        firstMessageSentAt: { $ne: null },
      }),
      Match.countDocuments({
        users: userId,
        status: "active",
        firstMessageSentAt: null,
        expiresAt: { $gt: new Date() },
      }),
      Swipe.countDocuments({
        swiped: userId,
        action: { $in: ["like", "superlike"] },
      }),
    ]);

    const stats = {
      profile: {
        views: user.stats?.profileViews || 0,
        completionScore: calculateProfileCompletionScore(user),
      },
      swipes: {
        total: totalStats,
        today: todayStats,
        thisWeek: weekStats,
        thisMonth: monthStats,
      },
      matches: {
        total: matchCount,
        conversations: conversationCount,
        pending: pendingMatches,
        conversionRate:
          totalStats.likes > 0
            ? Math.round((matchCount / totalStats.likes) * 100)
            : 0,
        messageRate:
          matchCount > 0
            ? Math.round((conversationCount / matchCount) * 100)
            : 0,
      },
      social: {
        likesReceived,
        popularity: calculatePopularityScore(user, likesReceived),
      },
      subscription: {
        type: user.subscription?.type || "free",
        features: user.subscription?.features || [],
        expiresAt: user.subscription?.expiresAt,
      },
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

// @route   POST /api/matching/cleanup-expired
// @desc    Manually trigger cleanup of expired matches (admin/cron job)
// @access  Private
router.post("/cleanup-expired", authenticate, async (req, res) => {
  try {
    const expiredCount = await Match.expireOldMatches();

    res.json({
      success: true,
      message: `Expired ${expiredCount} old matches`,
      expiredCount,
    });
  } catch (error) {
    console.error("Cleanup error:", error);
    res.status(500).json({
      success: false,
      message: "Error cleaning up expired matches",
    });
  }
});

// Helper functions
function isMutualInterest(user1, user2) {
  // Check if user2 would be interested in user1
  if (
    user2.preferences?.interestedIn &&
    user2.preferences.interestedIn !== "both"
  ) {
    if (user2.preferences.interestedIn !== user1.gender) {
      return false;
    }
  }

  // Check age preference of user2
  if (user2.preferences?.ageRange) {
    const user1Age = calculateAge(user1.dateOfBirth);
    if (
      user1Age < user2.preferences.ageRange.min ||
      user1Age > user2.preferences.ageRange.max
    ) {
      return false;
    }
  }

  return true;
}

function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return 0;
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }
  return age;
}

function calculateDistance(coords1, coords2) {
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;

  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateUserDistance(user1, user2) {
  if (!user1.location?.coordinates || !user2.location?.coordinates) {
    return null;
  }
  return Math.round(
    calculateDistance(user1.location.coordinates, user2.location.coordinates)
  );
}

function calculateCompatibilityScore(user1, user2) {
  let score = 50; // Base score

  // Age compatibility (closer ages = higher score)
  const ageDiff = Math.abs(
    calculateAge(user1.dateOfBirth) - calculateAge(user2.dateOfBirth)
  );
  if (ageDiff <= 3) score += 20;
  else if (ageDiff <= 5) score += 15;
  else if (ageDiff <= 10) score += 10;

  // Bio similarity (if both have bios)
  if (
    user1.bio &&
    user2.bio &&
    user1.bio.length > 20 &&
    user2.bio.length > 20
  ) {
    score += 15;
  }

  // Photo count (more photos = more serious)
  if (user2.photos && user2.photos.length >= 3) {
    score += 10;
  }

  // Verification status
  if (user2.verification?.isVerified) {
    score += 15;
  }

  // Recent activity
  if (isUserRecentlyActive(user2.lastActive)) {
    score += 10;
  }

  return Math.min(100, score);
}

function isUserRecentlyActive(lastActive) {
  if (!lastActive) return false;
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  return new Date(lastActive) > fifteenMinutesAgo;
}

function calculateProfileCompletionScore(user) {
  let score = 0;
  const maxScore = 100;

  // Basic info (30 points)
  if (user.firstName && user.lastName) score += 10;
  if (user.bio && user.bio.length >= 50) score += 10;
  if (user.dateOfBirth && user.gender) score += 10;

  // Photos (40 points)
  if (user.photos && user.photos.length >= 1) score += 10;
  if (user.photos && user.photos.length >= 3) score += 15;
  if (user.photos && user.photos.length >= 5) score += 15;

  // Verification (20 points)
  if (user.verification?.emailVerified) score += 10;
  if (user.verification?.isVerified) score += 10;

  // Preferences (10 points)
  if (user.preferences?.ageRange && user.preferences?.interestedIn) score += 10;

  return Math.round((score / maxScore) * 100);
}

function calculatePopularityScore(user, likesReceived) {
  const daysActive = Math.max(
    1,
    Math.floor((Date.now() - user.createdAt) / (1000 * 60 * 60 * 24))
  );
  const dailyLikes = likesReceived / daysActive;

  if (dailyLikes >= 10) return "Very High";
  if (dailyLikes >= 5) return "High";
  if (dailyLikes >= 2) return "Medium";
  if (dailyLikes >= 0.5) return "Low";
  return "New";
}

async function getSwipeStatsForPeriod(userId, fromDate) {
  try {
    const stats = await Swipe.aggregate([
      {
        $match: {
          swiper: userId,
          swipedAt: { $gte: fromDate },
        },
      },
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 },
        },
      },
    ]);

    const result = { likes: 0, passes: 0, superlikes: 0, total: 0 };
    stats.forEach((stat) => {
      if (stat._id === "like") result.likes = stat.count;
      else if (stat._id === "pass") result.passes = stat.count;
      else if (stat._id === "superlike") result.superlikes = stat.count;
      result.total += stat.count;
    });

    return result;
  } catch (error) {
    return { likes: 0, passes: 0, superlikes: 0, total: 0 };
  }
}

module.exports = router;
