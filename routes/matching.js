const express = require("express");
const { body, validationResult } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");
const Swipe = require("../models/Swipe");
const Match = require("../models/Match");
const Message = require("../models/Message");
const pushNotificationService = require("../services/pushNotificationService");
const { getConversationStarters } = require("../services/notificationService");

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
    // Temporarily disabled for testing - uncomment for production
    /*
    if (!currentUser.photos || currentUser.photos.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please add at least one photo to start discovering matches",
        requiresPhoto: true,
      });
    }
    */

    // Get users already swiped on
    const swipedUserIds = await Swipe.getSwipedUserIds(currentUser._id);

    // Get current user's matches to exclude them
    const matches = await Match.find({
      users: currentUser._id,
      status: "active",
    }).select("users");

    const matchedUserIds = [];
    matches.forEach((match) => {
      match.users.forEach((userId) => {
        if (userId.toString() !== currentUser._id.toString()) {
          matchedUserIds.push(userId);
        }
      });
    });

    // Build exclusion list
    const excludeIds = [
      currentUser._id,
      ...swipedUserIds,
      ...matchedUserIds,
      ...(currentUser.safety?.blockedUsers || []),
    ];

    // Build discovery query
    let discoveryQuery = {
      _id: { $nin: excludeIds },
      isActive: true,
      // Temporarily disabled photo requirement for testing
      // photos: { $exists: true, $not: { $size: 0 } },
      "safety.blockedUsers": { $nin: [currentUser._id] },
    };

    // Add preference filters
    if (
      currentUser.preferences?.interestedIn &&
      currentUser.preferences.interestedIn !== "both"
    ) {
      discoveryQuery.gender = currentUser.preferences.interestedIn;
    }

    // Age range filter
    if (currentUser.preferences?.ageRange) {
      const currentDate = new Date();
      const maxBirthDate = new Date(
        currentDate.getFullYear() - currentUser.preferences.ageRange.min,
        currentDate.getMonth(),
        currentDate.getDate()
      );
      const minBirthDate = new Date(
        currentDate.getFullYear() - currentUser.preferences.ageRange.max - 1,
        currentDate.getMonth(),
        currentDate.getDate()
      );

      discoveryQuery.dateOfBirth = {
        $gte: minBirthDate,
        $lte: maxBirthDate,
      };
    }

    // Find potential matches
    let potentialMatches = await User.find(discoveryQuery)
      .select(
        "firstName lastName bio dateOfBirth gender photos location preferences verification lastActive"
      )
      .limit(20);

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
    potentialMatches = potentialMatches.map((user) => {
      const userObj = user.toObject();
      return {
        ...userObj,
        age: calculateAge(user.dateOfBirth),
        distance: calculateUserDistance(currentUser, user),
        compatibilityScore: calculateCompatibilityScore(currentUser, user),
        primaryPhoto:
          user.photos?.find((photo) => photo.isPrimary) || user.photos?.[0],
        isOnline: isUserRecentlyActive(user.lastActive),
        verification: user.verification || { isVerified: false },
      };
    });

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
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Helper function to check mutual interest
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

// Helper function to calculate age
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

// Helper function to calculate distance between coordinates
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

// Helper function to calculate distance between users
function calculateUserDistance(user1, user2) {
  if (!user1.location?.coordinates || !user2.location?.coordinates) {
    return null;
  }
  return Math.round(
    calculateDistance(user1.location.coordinates, user2.location.coordinates)
  );
}

// Helper function to calculate compatibility score
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

// Helper function to check if user is recently active
function isUserRecentlyActive(lastActive) {
  if (!lastActive) return false;
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  return new Date(lastActive) > fifteenMinutesAgo;
}

// Updated swipe route section from routes/matching.js

// @route   POST /api/matching/swipe
// @desc    Enhanced swipe with analytics, premium features, and match emails
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
            "firstName lastName photos bio dateOfBirth gender verification email settings"
          );

          // Update match stats for both users
          await User.updateMany(
            { _id: { $in: [swiperId, swipedUserId] } },
            { $inc: { "stats.matches": 1 } }
          );

          isMatch = true;

          console.log(
            `💕 New match created: ${currentUser.firstName} + ${swipedUser.firstName}`
          );

          // *** NEW: Send Real-time Socket Match Notification ***
          try {
            // Prepare match data for socket notification
            const matchData = {
              _id: match._id,
              users: match.users.map((user) => ({
                _id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                photos: user.photos,
                primaryPhoto:
                  user.photos?.find((p) => p.isPrimary) || user.photos?.[0],
              })),
              matchType: match.matchType,
              createdAt: match.createdAt,
              initiatedBy: match.initiatedBy,
            };

            // Send real-time socket notification to both users
            const socketResult = req.io.sendMatchNotification(
              swiperId.toString(),
              swipedUserId.toString(),
              matchData
            );

            console.log(`💕 Socket match notification sent:`, {
              user1Online: socketResult.user1Online,
              user2Online: socketResult.user2Online,
              totalSent: socketResult.sent,
            });
          } catch (socketError) {
            console.error(
              "❌ Error sending socket match notification:",
              socketError
            );
            // Don't fail the match creation if socket notification fails
          }

          // *** NEW: Send Match Emails ***
          try {
            const emailService = require("../services/emailService");

            // Get full user data for email templates
            const [swiperUser, swipedUserFull] = await Promise.all([
              User.findById(swiperId).select(
                "firstName lastName email settings"
              ),
              User.findById(swipedUserId).select(
                "firstName lastName email settings"
              ),
            ]);

            // Send match emails to both users (if they have email notifications enabled)
            const emailPromises = [];

            // Email to swiper (current user)
            if (
              swiperUser.settings?.notifications?.email !== false &&
              swiperUser.settings?.notifications?.matches !== false
            ) {
              console.log(
                `📧 Sending match email to ${swiperUser.firstName} (${swiperUser.email})`
              );
              emailPromises.push(
                emailService
                  .sendNewMatchEmail(swiperUser, match, swipedUser)
                  .then((result) => {
                    if (result.success) {
                      console.log(
                        `✅ Match email sent to ${swiperUser.firstName}`
                      );
                    } else {
                      console.log(
                        `❌ Failed to send match email to ${swiperUser.firstName}: ${result.error}`
                      );
                    }
                    return {
                      user: swiperUser.firstName,
                      success: result.success,
                      error: result.error,
                    };
                  })
                  .catch((error) => {
                    console.error(
                      `❌ Match email error for ${swiperUser.firstName}:`,
                      error
                    );
                    return {
                      user: swiperUser.firstName,
                      success: false,
                      error: error.message,
                    };
                  })
              );
            } else {
              console.log(
                `📧 Skipping match email to ${swiperUser.firstName} (notifications disabled)`
              );
            }

            // Email to swiped user
            if (
              swipedUserFull.settings?.notifications?.email !== false &&
              swipedUserFull.settings?.notifications?.matches !== false
            ) {
              console.log(
                `📧 Sending match email to ${swipedUserFull.firstName} (${swipedUserFull.email})`
              );
              emailPromises.push(
                emailService
                  .sendNewMatchEmail(swipedUserFull, match, currentUser)
                  .then((result) => {
                    if (result.success) {
                      console.log(
                        `✅ Match email sent to ${swipedUserFull.firstName}`
                      );
                    } else {
                      console.log(
                        `❌ Failed to send match email to ${swipedUserFull.firstName}: ${result.error}`
                      );
                    }
                    return {
                      user: swipedUserFull.firstName,
                      success: result.success,
                      error: result.error,
                    };
                  })
                  .catch((error) => {
                    console.error(
                      `❌ Match email error for ${swipedUserFull.firstName}:`,
                      error
                    );
                    return {
                      user: swipedUserFull.firstName,
                      success: false,
                      error: error.message,
                    };
                  })
              );
            } else {
              console.log(
                `📧 Skipping match email to ${swipedUserFull.firstName} (notifications disabled)`
              );
            }

            // Send emails in parallel (don't block the response)
            if (emailPromises.length > 0) {
              Promise.all(emailPromises)
                .then((results) => {
                  const successful = results.filter((r) => r.success).length;
                  const failed = results.filter((r) => !r.success).length;
                  console.log(
                    `📊 Match email results: ${successful} sent, ${failed} failed`
                  );

                  if (failed > 0) {
                    console.log(
                      "❌ Failed emails:",
                      results.filter((r) => !r.success)
                    );
                  }
                })
                .catch((error) => {
                  console.error("❌ Error in match email batch:", error);
                });
            }
          } catch (emailError) {
            // Log email error but don't fail the match creation
            console.error("❌ Error setting up match emails:", emailError);
          }

          // Send push notifications to both users
          await Promise.all([
            pushNotificationService.sendMatchNotification(swiperId, {
              matchId: match._id.toString(),
              matchedUserId: swipedUserId.toString(),
              matchedUserName: swipedUser.firstName,
              matchedUserPhoto:
                swipedUser.photos?.find((p) => p.isPrimary)?.url ||
                swipedUser.photos?.[0]?.url,
            }),
            pushNotificationService.sendMatchNotification(swipedUserId, {
              matchId: match._id.toString(),
              matchedUserId: swiperId.toString(),
              matchedUserName: currentUser.firstName,
              matchedUserPhoto:
                currentUser.photos?.find((p) => p.isPrimary)?.url ||
                currentUser.photos?.[0]?.url,
            }),
          ]);
        } else {
          // Send like notification to swiped user
          if (action === "superlike") {
            await pushNotificationService.sendLikeNotification(swipedUserId, {
              likerId: swiperId.toString(),
              likerName: currentUser.firstName,
              likerPhoto:
                currentUser.photos?.find((p) => p.isPrimary)?.url ||
                currentUser.photos?.[0]?.url,
              isSuper: true,
            });
          } else {
            await pushNotificationService.sendLikeNotification(swipedUserId, {
              likerId: swiperId.toString(),
              likerName: currentUser.firstName,
              likerPhoto:
                currentUser.photos?.find((p) => p.isPrimary)?.url ||
                currentUser.photos?.[0]?.url,
              isSuper: false,
            });
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
        // Calculate compatibility score if available
        let compatibilityScore = null;
        if (typeof calculateCompatibilityScore === "function") {
          compatibilityScore = calculateCompatibilityScore(
            currentUser,
            otherUser
          );
        }
        // Conversation starters
        const conversationStarters = getConversationStarters(
          currentUser,
          otherUser
        );
        // Urgency level and time remaining
        const urgencyLevel =
          match.urgencyLevel ||
          (typeof match.get === "function" ? match.get("urgencyLevel") : null);
        const timeToExpiration =
          match.timeToExpiration ||
          (typeof match.get === "function"
            ? match.get("timeToExpiration")
            : null);
        // Celebration data
        const celebration = { confetti: true, animation: "match" };
        response.match = {
          _id: match._id,
          otherUser: {
            _id: otherUser._id,
            firstName: otherUser.firstName,
            lastName: otherUser.lastName,
            age: calculateAge(otherUser.dateOfBirth),
            bio: otherUser.bio,
            photos: otherUser.photos,
            primaryPhoto:
              otherUser.photos?.find((p) => p.isPrimary) ||
              otherUser.photos?.[0],
            verification: otherUser.verification,
            gender: otherUser.gender,
            // Add more profile fields as needed
          },
          matchedAt: match.matchedAt,
          matchType: match.matchType,
          expiresAt: match.expiresAt,
          timeToExpiration,
          urgencyLevel,
          compatibilityScore,
          conversationStarters,
          celebration,
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

    // Check for matches expiring soon and send notifications
    await sendExpiringMatchNotifications(req.user._id);

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

// Helper functions
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

// Helper function to send expiring match notifications
async function sendExpiringMatchNotifications(userId) {
  try {
    const expiringMatches = await Match.find({
      users: userId,
      status: "active",
      firstMessageSentAt: null,
      expiresAt: {
        $gt: new Date(),
        $lt: new Date(Date.now() + 12 * 60 * 60 * 1000), // Next 12 hours
      },
    }).populate("users", "firstName lastName");

    for (const match of expiringMatches) {
      const otherUser = match.users.find(
        (u) => u._id.toString() !== userId.toString()
      );
      const timeLeft = Math.ceil(
        (match.expiresAt - new Date()) / (1000 * 60 * 60)
      ); // Hours

      await pushNotificationService.sendGenericNotification(
        userId,
        "⏰ Match Expiring Soon",
        `Your match with ${otherUser.firstName} expires in ${timeLeft} hours`,
        {
          type: "match_expiring",
          userName: otherUser.firstName,
          timeLeft: `${timeLeft} hours`,
          url: "/chat",
          matchId: match._id,
          userId: otherUser._id,
        }
      );
    }
  } catch (error) {
    console.error("Error sending expiring match notifications:", error);
  }
}

// @route   GET /api/matching/who-liked-you
// @desc    Get users who liked you (premium feature)
// @access  Private
router.get("/who-liked-you", authenticate, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user has premium subscription
    if (!currentUser.hasPremiumFeature("priority_likes")) {
      return res.status(403).json({
        success: false,
        message: "This feature requires a premium subscription",
        requiresPremium: true,
        feature: "priority_likes",
      });
    }

    // Get users who liked the current user
    const likesReceived = await Swipe.getUsersWhoLiked(currentUser._id);

    // Filter out users the current user has already swiped on
    const swipedUserIds = await Swipe.getSwipedUserIds(currentUser._id);
    const filteredLikes = likesReceived.filter(
      (swipe) => !swipedUserIds.includes(swipe.swiper._id)
    );

    // Format the response with enhanced user data
    const formattedLikes = filteredLikes.map((swipe) => {
      const user = swipe.swiper;
      const userObj = user.toObject ? user.toObject() : user;

      return {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        age: calculateAge(user.dateOfBirth),
        bio: user.bio,
        photos: user.photos,
        primaryPhoto:
          user.photos?.find((photo) => photo.isPrimary) || user.photos?.[0],
        gender: user.gender,
        distance: calculateUserDistance(currentUser, user),
        compatibilityScore: calculateCompatibilityScore(currentUser, user),
        isOnline: isUserRecentlyActive(user.lastActive),
        verification: user.verification || { isVerified: false },
        likedAt: swipe.swipedAt,
        action: swipe.action, // "like" or "superlike"
        matchInsights: generateMatchInsights(currentUser, user),
        icebreakerSuggestions: generateIcebreakerSuggestions(currentUser, user),
      };
    });

    // Sort by superlikes first, then by compatibility score
    formattedLikes.sort((a, b) => {
      if (a.action === "superlike" && b.action !== "superlike") return -1;
      if (a.action !== "superlike" && b.action === "superlike") return 1;
      return b.compatibilityScore - a.compatibilityScore;
    });

    res.json({
      success: true,
      likes: formattedLikes,
      summary: {
        total: formattedLikes.length,
        superlikes: formattedLikes.filter((like) => like.action === "superlike")
          .length,
        regularLikes: formattedLikes.filter((like) => like.action === "like")
          .length,
        verifiedUsers: formattedLikes.filter(
          (user) => user.verification?.isVerified
        ).length,
        onlineNow: formattedLikes.filter((user) => user.isOnline).length,
      },
    });
  } catch (error) {
    console.error("Who liked you error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching likes received",
    });
  }
});

// @route   GET /api/matching/match-queue
// @desc    Get match queue with enhanced sorting and insights
// @access  Private
router.get("/match-queue", authenticate, async (req, res) => {
  try {
    const { sort = "compatibility", limit = 20 } = req.query;
    const currentUser = await User.findById(req.user._id);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get users already swiped on
    const swipedUserIds = await Swipe.getSwipedUserIds(currentUser._id);

    // Get current user's matches to exclude them
    const matches = await Match.find({
      users: currentUser._id,
      status: "active",
    }).select("users");

    const matchedUserIds = matches.map((match) =>
      match.users.find(
        (userId) => userId.toString() !== currentUser._id.toString()
      )
    );

    // Build exclusion list
    const excludeIds = [
      currentUser._id,
      ...swipedUserIds,
      ...matchedUserIds,
      ...(currentUser.safety?.blockedUsers || []),
    ];

    // Build discovery query
    let discoveryQuery = {
      _id: { $nin: excludeIds },
      isActive: true,
      "safety.blockedUsers": { $nin: [currentUser._id] },
    };

    // Add preference filters
    if (
      currentUser.preferences?.interestedIn &&
      currentUser.preferences.interestedIn !== "both"
    ) {
      discoveryQuery.gender = currentUser.preferences.interestedIn;
    }

    // Age range filter
    if (currentUser.preferences?.ageRange) {
      const currentDate = new Date();
      const maxBirthDate = new Date(
        currentDate.getFullYear() - currentUser.preferences.ageRange.min,
        currentDate.getMonth(),
        currentDate.getDate()
      );
      const minBirthDate = new Date(
        currentDate.getFullYear() - currentUser.preferences.ageRange.max - 1,
        currentDate.getMonth(),
        currentDate.getDate()
      );

      discoveryQuery.dateOfBirth = {
        $gte: minBirthDate,
        $lte: maxBirthDate,
      };
    }

    // Find potential matches
    let potentialMatches = await User.find(discoveryQuery)
      .select(
        "firstName lastName bio dateOfBirth gender photos location preferences verification lastActive interests"
      )
      .limit(parseInt(limit) * 2); // Get more to filter and sort

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
    potentialMatches = potentialMatches.map((user) => {
      const userObj = user.toObject();
      const compatibilityScore = calculateCompatibilityScore(currentUser, user);

      return {
        ...userObj,
        age: calculateAge(user.dateOfBirth),
        distance: calculateUserDistance(currentUser, user),
        compatibilityScore,
        primaryPhoto:
          user.photos?.find((photo) => photo.isPrimary) || user.photos?.[0],
        isOnline: isUserRecentlyActive(user.lastActive),
        verification: user.verification || { isVerified: false },
        matchInsights: generateMatchInsights(currentUser, user),
        icebreakerSuggestions: generateIcebreakerSuggestions(currentUser, user),
        matchReason: generateMatchReason(currentUser, user, compatibilityScore),
      };
    });

    // Apply sorting
    switch (sort) {
      case "compatibility":
        potentialMatches.sort(
          (a, b) => b.compatibilityScore - a.compatibilityScore
        );
        break;
      case "distance":
        potentialMatches.sort(
          (a, b) => (a.distance || Infinity) - (b.distance || Infinity)
        );
        break;
      case "recent":
        potentialMatches.sort(
          (a, b) => new Date(b.lastActive) - new Date(a.lastActive)
        );
        break;
      case "verified":
        potentialMatches.sort((a, b) => {
          if (a.verification.isVerified && !b.verification.isVerified)
            return -1;
          if (!a.verification.isVerified && b.verification.isVerified) return 1;
          return b.compatibilityScore - a.compatibilityScore;
        });
        break;
      case "online":
        potentialMatches.sort((a, b) => {
          if (a.isOnline && !b.isOnline) return -1;
          if (!a.isOnline && b.isOnline) return 1;
          return b.compatibilityScore - a.compatibilityScore;
        });
        break;
      default:
        potentialMatches.sort(
          (a, b) => b.compatibilityScore - a.compatibilityScore
        );
    }

    // Limit results
    potentialMatches = potentialMatches.slice(0, parseInt(limit));

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
      matchInsights: user.matchInsights,
      icebreakerSuggestions: user.icebreakerSuggestions,
      matchReason: user.matchReason,
    }));

    res.json({
      success: true,
      matches: formattedMatches,
      sort,
      summary: {
        total: formattedMatches.length,
        verified: formattedMatches.filter((u) => u.verification?.isVerified)
          .length,
        online: formattedMatches.filter((u) => u.isOnline).length,
        nearbyCount: formattedMatches.filter(
          (u) => u.distance && u.distance <= 25
        ).length,
        highCompatibility: formattedMatches.filter(
          (u) => u.compatibilityScore >= 80
        ).length,
      },
    });
  } catch (error) {
    console.error("Match queue error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching match queue",
    });
  }
});

// @route   GET /api/matching/insights/:userId
// @desc    Get detailed match insights for a specific user
// @access  Private
router.get("/insights/:userId", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUser = await User.findById(req.user._id);

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: "Target user not found",
      });
    }

    const compatibilityScore = calculateCompatibilityScore(
      currentUser,
      targetUser
    );
    const matchInsights = generateMatchInsights(currentUser, targetUser);
    const icebreakerSuggestions = generateIcebreakerSuggestions(
      currentUser,
      targetUser
    );
    const matchReason = generateMatchReason(
      currentUser,
      targetUser,
      compatibilityScore
    );

    res.json({
      success: true,
      insights: {
        compatibilityScore,
        matchInsights,
        icebreakerSuggestions,
        matchReason,
        sharedInterests: findSharedInterests(currentUser, targetUser),
        proximityInfo: generateProximityInfo(currentUser, targetUser),
        activityCompatibility: generateActivityCompatibility(
          currentUser,
          targetUser
        ),
      },
    });
  } catch (error) {
    console.error("Match insights error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching match insights",
    });
  }
});

// Helper functions for match discovery improvements

function generateMatchInsights(user1, user2) {
  const insights = {
    sharedInterests: findSharedInterests(user1, user2),
    proximity: generateProximityInfo(user1, user2),
    activityLevel: generateActivityCompatibility(user1, user2),
    communicationStyle: generateCommunicationInsights(user1, user2),
    lifestyleCompatibility: generateLifestyleCompatibility(user1, user2),
  };

  return insights;
}

function findSharedInterests(user1, user2) {
  const interests1 = user1.interests || [];
  const interests2 = user2.interests || [];

  const shared = interests1.filter((interest) =>
    interests2.some(
      (interest2) =>
        interest2.toLowerCase().includes(interest.toLowerCase()) ||
        interest.toLowerCase().includes(interest2.toLowerCase())
    )
  );

  return {
    count: shared.length,
    interests: shared,
    percentage:
      interests1.length > 0
        ? Math.round(
            (shared.length / Math.max(interests1.length, interests2.length)) *
              100
          )
        : 0,
  };
}

function generateProximityInfo(user1, user2) {
  if (!user1.location?.coordinates || !user2.location?.coordinates) {
    return {
      distance: null,
      proximity: "unknown",
      description: "Location not available",
    };
  }

  const distance = calculateDistance(
    user1.location.coordinates,
    user2.location.coordinates
  );

  let proximity = "far";
  let description = "More than 50km away";

  if (distance <= 5) {
    proximity = "very_near";
    description = "Less than 5km away";
  } else if (distance <= 25) {
    proximity = "near";
    description = "Within 25km";
  } else if (distance <= 50) {
    proximity = "moderate";
    description = "Within 50km";
  }

  return {
    distance,
    proximity,
    description,
  };
}

function generateActivityCompatibility(user1, user2) {
  const lastActive1 = user1.lastActive || new Date();
  const lastActive2 = user2.lastActive || new Date();

  const hoursSinceActive1 = (new Date() - lastActive1) / (1000 * 60 * 60);
  const hoursSinceActive2 = (new Date() - lastActive2) / (1000 * 60 * 60);

  let activityLevel = "moderate";
  let description = "Moderate activity level";

  if (hoursSinceActive1 <= 1 && hoursSinceActive2 <= 1) {
    activityLevel = "very_active";
    description = "Both users are very active";
  } else if (hoursSinceActive1 <= 24 && hoursSinceActive2 <= 24) {
    activityLevel = "active";
    description = "Both users are active";
  } else if (hoursSinceActive1 > 168 || hoursSinceActive2 > 168) {
    activityLevel = "inactive";
    description = "One or both users haven't been active recently";
  }

  return {
    activityLevel,
    description,
    user1LastActive: hoursSinceActive1,
    user2LastActive: hoursSinceActive2,
  };
}

function generateCommunicationInsights(user1, user2) {
  // This would be enhanced with actual messaging data
  // For now, we'll provide basic insights based on profile completeness
  const profileCompleteness1 = calculateProfileCompleteness(user1);
  const profileCompleteness2 = calculateProfileCompleteness(user2);

  let communicationStyle = "balanced";
  let description = "Both users have complete profiles";

  if (profileCompleteness1 < 50 || profileCompleteness2 < 50) {
    communicationStyle = "minimal";
    description = "One or both users have minimal profile information";
  } else if (profileCompleteness1 > 80 && profileCompleteness2 > 80) {
    communicationStyle = "detailed";
    description = "Both users have detailed profiles";
  }

  return {
    communicationStyle,
    description,
    user1ProfileCompleteness: profileCompleteness1,
    user2ProfileCompleteness: profileCompleteness2,
  };
}

function generateLifestyleCompatibility(user1, user2) {
  // This would be enhanced with more lifestyle data
  // For now, we'll provide basic insights
  const ageDiff = Math.abs(
    calculateAge(user1.dateOfBirth) - calculateAge(user2.dateOfBirth)
  );

  let lifestyleCompatibility = "moderate";
  let description = "Moderate lifestyle compatibility";

  if (ageDiff <= 5) {
    lifestyleCompatibility = "high";
    description = "Similar age range suggests lifestyle compatibility";
  } else if (ageDiff > 15) {
    lifestyleCompatibility = "low";
    description =
      "Significant age difference may affect lifestyle compatibility";
  }

  return {
    lifestyleCompatibility,
    description,
    ageDifference: ageDiff,
  };
}

function generateIcebreakerSuggestions(user1, user2) {
  const suggestions = [];

  // Based on shared interests
  const sharedInterests = findSharedInterests(user1, user2);
  if (sharedInterests.interests.length > 0) {
    suggestions.push({
      type: "shared_interest",
      text: `I see you're into ${sharedInterests.interests[0]}! What's your favorite thing about it?`,
      confidence: "high",
    });
  }

  // Based on location
  const proximity = generateProximityInfo(user1, user2);
  if (proximity.proximity === "very_near" || proximity.proximity === "near") {
    suggestions.push({
      type: "location",
      text: `We're pretty close to each other! Have you been to any good places around here lately?`,
      confidence: "high",
    });
  }

  // Based on bio content
  if (user2.bio && user2.bio.length > 20) {
    const bioKeywords = extractKeywords(user2.bio);
    if (bioKeywords.length > 0) {
      suggestions.push({
        type: "bio",
        text: `I loved reading your bio! ${bioKeywords[0]} sounds really interesting. Tell me more!`,
        confidence: "medium",
      });
    }
  }

  // Generic suggestions
  suggestions.push({
    type: "generic",
    text: "Hey! I'd love to get to know you better. What's the most exciting thing you've done recently?",
    confidence: "low",
  });

  return suggestions.sort((a, b) => {
    const confidenceOrder = { high: 3, medium: 2, low: 1 };
    return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
  });
}

function generateMatchReason(user1, user2, compatibilityScore) {
  const reasons = [];

  if (compatibilityScore >= 90) {
    reasons.push("Exceptional compatibility based on your preferences");
  } else if (compatibilityScore >= 80) {
    reasons.push("High compatibility score");
  } else if (compatibilityScore >= 70) {
    reasons.push("Good compatibility match");
  }

  const sharedInterests = findSharedInterests(user1, user2);
  if (sharedInterests.count > 0) {
    reasons.push(`${sharedInterests.count} shared interests`);
  }

  const proximity = generateProximityInfo(user1, user2);
  if (proximity.proximity === "very_near" || proximity.proximity === "near") {
    reasons.push("Located nearby");
  }

  if (user2.verification?.isVerified) {
    reasons.push("Verified profile");
  }

  return reasons.length > 0 ? reasons.join(", ") : "Based on your preferences";
}

function calculateProfileCompleteness(user) {
  let score = 0;
  let total = 0;

  // Basic info
  total += 4;
  if (user.firstName) score += 1;
  if (user.lastName) score += 1;
  if (user.dateOfBirth) score += 1;
  if (user.gender) score += 1;

  // Photos
  total += 2;
  if (user.photos && user.photos.length > 0) score += 1;
  if (user.photos && user.photos.length >= 3) score += 1;

  // Bio
  total += 2;
  if (user.bio && user.bio.length > 0) score += 1;
  if (user.bio && user.bio.length > 100) score += 1;

  // Location
  total += 1;
  if (user.location?.coordinates) score += 1;

  // Interests
  total += 1;
  if (user.interests && user.interests.length > 0) score += 1;

  return Math.round((score / total) * 100);
}

function extractKeywords(text) {
  // Simple keyword extraction - in production, you might use NLP libraries
  const commonWords = [
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "can",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "me",
    "him",
    "her",
    "us",
    "them",
  ];

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !commonWords.includes(word));

  return [...new Set(words)].slice(0, 5);
}

module.exports = router;
