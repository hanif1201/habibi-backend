const mongoose = require("mongoose");

const SwipeSchema = new mongoose.Schema(
  {
    swiper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    swiped: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    action: {
      type: String,
      enum: ["like", "pass", "superlike"],
      required: true,
    },
    swipedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to ensure a user can only swipe on another user once
SwipeSchema.index({ swiper: 1, swiped: 1 }, { unique: true });

// Index for efficient querying
SwipeSchema.index({ swiper: 1, action: 1, swipedAt: -1 });
SwipeSchema.index({ swiped: 1, action: 1, swipedAt: -1 });

// Pre-save validation
SwipeSchema.pre("save", function (next) {
  // Ensure user doesn't swipe on themselves
  if (this.swiper.toString() === this.swiped.toString()) {
    return next(new Error("User cannot swipe on themselves"));
  }
  next();
});

// Static method to check if user has already swiped on someone
SwipeSchema.statics.hasUserSwiped = async function (swiperId, swipedId) {
  const swipe = await this.findOne({
    swiper: swiperId,
    swiped: swipedId,
  });
  return !!swipe;
};

// Static method to get users a user has already swiped on
SwipeSchema.statics.getSwipedUserIds = async function (userId) {
  const swipes = await this.find({ swiper: userId }).select("swiped");
  return swipes.map((swipe) => swipe.swiped);
};

// Static method to check for mutual likes (potential match)
SwipeSchema.statics.checkMutualLike = async function (user1Id, user2Id) {
  const like1 = await this.findOne({
    swiper: user1Id,
    swiped: user2Id,
    action: { $in: ["like", "superlike"] },
  });

  const like2 = await this.findOne({
    swiper: user2Id,
    swiped: user1Id,
    action: { $in: ["like", "superlike"] },
  });

  return !!(like1 && like2);
};

// Static method to get swipe statistics for a user
SwipeSchema.statics.getSwipeStats = async function (userId) {
  try {
    const stats = await this.aggregate([
      { $match: { swiper: userId } },
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 },
        },
      },
    ]);

    const result = {
      likes: 0,
      passes: 0,
      superlikes: 0,
      total: 0,
    };

    stats.forEach((stat) => {
      if (stat._id === "like") result.likes = stat.count;
      else if (stat._id === "pass") result.passes = stat.count;
      else if (stat._id === "superlike") result.superlikes = stat.count;
      result.total += stat.count;
    });

    return result;
  } catch (error) {
    console.error("Error in getSwipeStats:", error);
    // Return default stats if aggregation fails
    return {
      likes: 0,
      passes: 0,
      superlikes: 0,
      total: 0,
    };
  }
};

// Static method to get users who liked a specific user
SwipeSchema.statics.getUsersWhoLiked = async function (userId) {
  return this.find({
    swiped: userId,
    action: { $in: ["like", "superlike"] },
  })
    .populate("swiper", "firstName lastName photos bio dateOfBirth gender")
    .sort({ swipedAt: -1 });
};

module.exports = mongoose.model("Swipe", SwipeSchema);
