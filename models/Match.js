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
        return new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours
      },
    },
    matchType: {
      type: String,
      enum: ["regular", "superlike"],
      default: "regular",
    },
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

// Indexes
MatchSchema.index({ users: 1 });
MatchSchema.index({ status: 1, matchedAt: -1 });
MatchSchema.index({ expiresAt: 1 });
MatchSchema.index({ firstMessageSentAt: 1 });

// Ensure users array has exactly 2 users
MatchSchema.pre("save", function (next) {
  if (this.users.length !== 2) {
    return next(new Error("A match must have exactly 2 users"));
  }

  if (this.users[0].toString() === this.users[1].toString()) {
    return next(new Error("A user cannot match with themselves"));
  }

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
    return null;
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

  if (hoursLeft === null) return "none";
  if (hoursLeft <= 0) return "expired";
  if (hoursLeft <= 12) return "critical";
  if (hoursLeft <= 24) return "warning";
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
    .populate(
      "users",
      "firstName lastName photos bio dateOfBirth gender verification lastActive"
    )
    .sort({ lastActivity: -1 });
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
  this.expiresAt = null; // Clear expiration
  return this.save();
};

// Instance method to unmatch
MatchSchema.methods.unmatch = function () {
  this.status = "unmatched";
  return this.save();
};

// Instance method to check if user can send first message
MatchSchema.methods.canSendFirstMessage = function (userId) {
  if (this.status !== "active") return false;
  if (this.firstMessageSentAt) return true;
  if (this.isExpired) return false;
  return this.users.includes(userId);
};

module.exports = mongoose.model("Match", MatchSchema);
