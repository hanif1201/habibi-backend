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
      enum: ["active", "unmatched", "blocked"],
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
  },
  {
    timestamps: true,
  }
);

// Index for efficient querying
MatchSchema.index({ users: 1 });
MatchSchema.index({ status: 1, matchedAt: -1 });

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

// Static method to find match between two users
MatchSchema.statics.findBetweenUsers = function (userId1, userId2) {
  const sortedIds = [userId1, userId2].sort();
  return this.findOne({
    users: { $all: sortedIds },
    status: "active",
  });
};

// Static method to get all matches for a user
MatchSchema.statics.findForUser = function (userId) {
  return this.find({
    users: userId,
    status: "active",
  })
    .populate("users", "firstName lastName photos bio dateOfBirth gender")
    .sort({ lastActivity: -1 });
};

// Instance method to get the other user in the match
MatchSchema.methods.getOtherUser = function (currentUserId) {
  return this.users.find(
    (userId) => userId.toString() !== currentUserId.toString()
  );
};

// Instance method to unmatch
MatchSchema.methods.unmatch = function () {
  this.status = "unmatched";
  return this.save();
};

module.exports = mongoose.model("Match", MatchSchema);
