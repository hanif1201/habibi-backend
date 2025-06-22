const express = require("express");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");
const Swipe = require("../models/Swipe");
const Match = require("../models/Match");

const router = express.Router();

// @route   GET /api/matching/discover
// @desc    Get potential matches for user
// @access  Private
router.get("/discover", authenticate, async (req, res) => {
  try {
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
    const matches = await Match.findForUser(currentUser._id);
    const matchedUserIds = matches.map((match) =>
      match.getOtherUser(currentUser._id)
    );

    // Build exclusion list (self, swiped users, matched users)
    const excludeIds = [currentUser._id, ...swipedUserIds, ...matchedUserIds];

    // Build discovery query based on user preferences
    const query = {
      _id: { $nin: excludeIds },
      isActive: true,
      photos: { $exists: true, $not: { $size: 0 } }, // Must have at least one photo
    };

    // Filter by age preference
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

      query.dateOfBirth = {
        $gte: minBirthDate,
        $lte: maxBirthDate,
      };
    }

    // Filter by gender preference
    if (
      currentUser.preferences?.interestedIn &&
      currentUser.preferences.interestedIn !== "both"
    ) {
      query.gender = currentUser.preferences.interestedIn;
    }

    // Find potential matches
    let potentialMatches = await User.find(query)
      .select(
        "firstName lastName bio dateOfBirth gender photos location preferences"
      )
      .limit(20) // Limit for performance
      .lean();

    // Filter by distance if location is available
    if (
      currentUser.location?.coordinates &&
      currentUser.preferences?.maxDistance
    ) {
      potentialMatches = potentialMatches.filter((user) => {
        if (!user.location?.coordinates) return true; // Include users without location

        const distance = calculateDistance(
          currentUser.location.coordinates,
          user.location.coordinates
        );

        return distance <= currentUser.preferences.maxDistance;
      });
    }

    // Filter by mutual interest (if other user would be interested in current user)
    potentialMatches = potentialMatches.filter((user) => {
      // Check if other user would be interested in current user
      if (
        user.preferences?.interestedIn &&
        user.preferences.interestedIn !== "both"
      ) {
        if (user.preferences.interestedIn !== currentUser.gender) {
          return false;
        }
      }

      // Check age preference of other user
      if (user.preferences?.ageRange) {
        const currentUserAge = calculateAge(currentUser.dateOfBirth);
        if (
          currentUserAge < user.preferences.ageRange.min ||
          currentUserAge > user.preferences.ageRange.max
        ) {
          return false;
        }
      }

      return true;
    });

    // Shuffle array for variety
    potentialMatches = shuffleArray(potentialMatches);

    // Add calculated age and distance
    potentialMatches = potentialMatches.map((user) => ({
      ...user,
      age: calculateAge(user.dateOfBirth),
      distance:
        currentUser.location?.coordinates && user.location?.coordinates
          ? Math.round(
              calculateDistance(
                currentUser.location.coordinates,
                user.location.coordinates
              )
            )
          : null,
      primaryPhoto:
        user.photos?.find((photo) => photo.isPrimary) || user.photos?.[0],
    }));

    res.json({
      success: true,
      users: potentialMatches.slice(0, 10), // Return max 10 users
      hasMore: potentialMatches.length > 10,
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
// @desc    Swipe on a user (like/pass/superlike)
// @access  Private
router.post("/swipe", authenticate, async (req, res) => {
  try {
    const { userId: swipedUserId, action } = req.body;
    const swiperId = req.user._id;

    // Validate input
    if (!swipedUserId || !action) {
      return res.status(400).json({
        success: false,
        message: "User ID and action are required",
      });
    }

    if (!["like", "pass", "superlike"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be like, pass, or superlike",
      });
    }

    // Check if user exists
    const swipedUser = await User.findById(swipedUserId);
    if (!swipedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
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

    // Create swipe record
    const swipe = new Swipe({
      swiper: swiperId,
      swiped: swipedUserId,
      action,
    });

    await swipe.save();

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
        });

        await match.save();

        // Populate match data for response
        await match.populate(
          "users",
          "firstName lastName photos bio dateOfBirth gender"
        );

        isMatch = true;
      }
    }

    res.json({
      success: true,
      message: isMatch ? "It's a match!" : "Swipe recorded",
      isMatch,
      match: isMatch
        ? {
            _id: match._id,
            otherUser: match.users.find(
              (user) => user._id.toString() !== swiperId.toString()
            ),
            matchedAt: match.matchedAt,
          }
        : null,
    });
  } catch (error) {
    console.error("Swipe error:", error);
    res.status(500).json({
      success: false,
      message: "Error processing swipe",
    });
  }
});

// @route   GET /api/matching/matches
// @desc    Get user's matches
// @access  Private
router.get("/matches", authenticate, async (req, res) => {
  try {
    const matches = await Match.findForUser(req.user._id);

    const formattedMatches = matches.map((match) => {
      const otherUser = match.getOtherUser(req.user._id);
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
        },
        matchedAt: match.matchedAt,
        lastActivity: match.lastActivity,
      };
    });

    res.json({
      success: true,
      matches: formattedMatches,
    });
  } catch (error) {
    console.error("Get matches error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching matches",
    });
  }
});

// @route   DELETE /api/matching/matches/:matchId
// @desc    Unmatch with a user
// @access  Private
router.delete("/matches/:matchId", authenticate, async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId);

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found",
      });
    }

    // Check if current user is part of this match
    if (!match.users.includes(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "You are not part of this match",
      });
    }

    await match.unmatch();

    res.json({
      success: true,
      message: "Successfully unmatched",
    });
  } catch (error) {
    console.error("Unmatch error:", error);
    res.status(500).json({
      success: false,
      message: "Error unmatching",
    });
  }
});

// @route   GET /api/matching/stats
// @desc    Get user's swipe statistics
// @access  Private
router.get("/stats", authenticate, async (req, res) => {
  try {
    // Get swipe stats with better error handling
    let swipeStats = {
      likes: 0,
      passes: 0,
      superlikes: 0,
      total: 0,
    };

    try {
      const stats = await Swipe.aggregate([
        { $match: { swiper: req.user._id } },
        {
          $group: {
            _id: "$action",
            count: { $sum: 1 },
          },
        },
      ]);

      stats.forEach((stat) => {
        if (stat._id === "like") swipeStats.likes = stat.count;
        if (stat._id === "pass") swipeStats.passes = stat.count;
        if (stat._id === "superlike") swipeStats.superlikes = stat.count;
        swipeStats.total += stat.count;
      });
    } catch (aggregateError) {
      console.error("Aggregate error, using fallback:", aggregateError);
      // Fallback to simple counting
      const likes = await Swipe.countDocuments({
        swiper: req.user._id,
        action: "like",
      });
      const passes = await Swipe.countDocuments({
        swiper: req.user._id,
        action: "pass",
      });
      const superlikes = await Swipe.countDocuments({
        swiper: req.user._id,
        action: "superlike",
      });

      swipeStats = {
        likes,
        passes,
        superlikes,
        total: likes + passes + superlikes,
      };
    }

    // Get match count
    const matchCount = await Match.countDocuments({
      users: req.user._id,
      status: "active",
    });

    // Get likes received count
    const likesReceived = await Swipe.countDocuments({
      swiped: req.user._id,
      action: { $in: ["like", "superlike"] },
    });

    res.json({
      success: true,
      stats: {
        ...swipeStats,
        matches: matchCount,
        likesReceived,
      },
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching stats: " + error.message,
    });
  }
});

// Helper functions
function calculateAge(dateOfBirth) {
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

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

module.exports = router;
