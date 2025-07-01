const mongoose = require("mongoose");

const MatchSchema = new mongoose.Schema(
  {
    users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "unmatched", "blocked", "expired"],
      default: "active",
    },
    lastActivity: {
      type: Date,
      default: Date.now,
    },
    matchedAt: {
      type: Date,
      default: Date.now,
    },
    firstMessageSentAt: {
      type: Date,
      default: null,
    },
    firstMessageSentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    expiresAt: {
      type: Date,
      default: function () {
        // Matches expire after 72 hours (3 days) if no message is sent
        return new Date(Date.now() + 72 * 60 * 60 * 1000);
      },
    },
    matchType: {
      type: String,
      enum: ["regular", "superlike"],
      default: "regular",
    },
    // Track who made the first move for analytics
    conversationStarter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient querying
MatchSchema.index({ users: 1 });
MatchSchema.index({ status: 1, matchedAt: -1 });
MatchSchema.index({ expiresAt: 1 }); // For expiration cleanup
MatchSchema.index({ firstMessageSentAt: 1 });

// Ensure users array always has exactly 2 users
MatchSchema.pre("save", function (next) {
  if (this.users.length !== 2) {
    return next(new Error("A match must have exactly 2 users"));
  }

  // Ensure users are unique
  if (this.users[0].toString() === this.users[1].toString()) {
    return next(new Error("A user cannot match with themselves"));
  }

  // Sort users array for consistent ordering
  this.users.sort();

  next();
});

// Virtual to check if match is expired
MatchSchema.virtual("isExpired").get(function () {
  return (
    this.status === "active" &&
    !this.firstMessageSentAt &&
    new Date() > this.expiresAt
  );
});

// Virtual to get time remaining before expiration
MatchSchema.virtual("timeToExpiration").get(function () {
  if (this.firstMessageSentAt || this.status !== "active") {
    return null; // No expiration if conversation started or match inactive
  }

  const now = new Date();
  const timeLeft = this.expiresAt - now;

  if (timeLeft <= 0) {
    return 0;
  }

  return Math.floor(timeLeft / (1000 * 60 * 60)); // Hours remaining
});

// Virtual to get match urgency level
MatchSchema.virtual("urgencyLevel").get(function () {
  const hoursLeft = this.timeToExpiration;

  if (hoursLeft === null) return "none"; // Conversation started
  if (hoursLeft <= 0) return "expired";
  if (hoursLeft <= 12) return "critical"; // Less than 12 hours
  if (hoursLeft <= 24) return "warning"; // Less than 24 hours
  return "normal";
});

// Static method to find match between two users
MatchSchema.statics.findBetweenUsers = function (userId1, userId2) {
  const sortedIds = [userId1, userId2].sort();
  return this.findOne({
    users: { $all: sortedIds },
    status: "active",
  });
};

// Static method to get all active matches for a user
MatchSchema.statics.findForUser = function (userId) {
  return this.find({
    users: userId,
    status: "active",
  })
    .populate("users", "firstName lastName photos bio dateOfBirth gender")
    .sort({ lastActivity: -1 });
};

// Static method to get matches that need first message (with expiration info)
MatchSchema.statics.findPendingForUser = function (userId) {
  return this.find({
    users: userId,
    status: "active",
    firstMessageSentAt: null,
    expiresAt: { $gt: new Date() }, // Not yet expired
  })
    .populate("users", "firstName lastName photos bio dateOfBirth gender")
    .sort({ expiresAt: 1 }); // Sort by expiration time (most urgent first)
};

// Static method to expire old matches
MatchSchema.statics.expireOldMatches = async function () {
  const now = new Date();

  const result = await this.updateMany(
    {
      status: "active",
      firstMessageSentAt: null,
      expiresAt: { $lt: now },
    },
    {
      status: "expired",
    }
  );

  return result.modifiedCount;
};

// Instance method to get the other user in the match
MatchSchema.methods.getOtherUser = function (currentUserId) {
  return this.users.find(
    (userId) => userId.toString() !== currentUserId.toString()
  );
};

// Instance method to mark first message sent
MatchSchema.methods.markFirstMessageSent = function (senderId) {
  this.firstMessageSentAt = new Date();
  this.firstMessageSentBy = senderId;
  this.conversationStarter = senderId;
  this.lastActivity = new Date();
  // Clear expiration since conversation has started
  this.expiresAt = null;
  return this.save();
};

// Instance method to unmatch
MatchSchema.methods.unmatch = function () {
  this.status = "unmatched";
  return this.save();
};

// Instance method to extend expiration (for premium features)
MatchSchema.methods.extendExpiration = function (hours = 24) {
  if (this.firstMessageSentAt) {
    throw new Error("Cannot extend expiration after conversation has started");
  }

  const newExpiration = new Date(Date.now() + hours * 60 * 60 * 1000);
  this.expiresAt = newExpiration;
  return this.save();
};

// Instance method to check if user can send first message
MatchSchema.methods.canSendFirstMessage = function (userId) {
  if (this.status !== "active") return false;
  if (this.firstMessageSentAt) return true; // Conversation already started
  if (this.isExpired) return false;
  return this.users.includes(userId);
};

// Static method to get match statistics for analytics
MatchSchema.statics.getMatchStats = async function () {
  const stats = await this.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const conversationStats = await this.aggregate([
    {
      $match: { status: "active" },
    },
    {
      $group: {
        _id: {
          hasConversation: { $ne: ["$firstMessageSentAt", null] },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  return {
    statusBreakdown: stats,
    conversationBreakdown: conversationStats,
  };
};

// Static method to get matches expiring soon for notifications
MatchSchema.statics.getExpiringMatches = function (hoursThreshold = 12) {
  const thresholdTime = new Date(Date.now() + hoursThreshold * 60 * 60 * 1000);

  return this.find({
    status: "active",
    firstMessageSentAt: null,
    expiresAt: {
      $gt: new Date(), // Not yet expired
      $lt: thresholdTime, // But expiring soon
    },
  })
    .populate("users", "firstName lastName email")
    .sort({ expiresAt: 1 });
};

module.exports = mongoose.model("Match", MatchSchema);
