const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    match: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      required: true,
      maxlength: 1000,
    },
    messageType: {
      type: String,
      enum: ["text", "image", "gif"],
      default: "text",
    },
    readAt: {
      type: Date,
      default: null,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient querying
MessageSchema.index({ match: 1, createdAt: -1 });
MessageSchema.index({ sender: 1, createdAt: -1 });
MessageSchema.index({ receiver: 1, readAt: 1 });

// Virtual for time ago
MessageSchema.virtual("timeAgo").get(function () {
  const now = new Date();
  const diff = now - this.createdAt;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return this.createdAt.toLocaleDateString();
});

// Method to mark message as read
MessageSchema.methods.markAsRead = function () {
  if (!this.readAt) {
    this.readAt = new Date();
    return this.save();
  }
  return Promise.resolve(this);
};

// Method to edit message
MessageSchema.methods.editContent = function (newContent) {
  this.content = newContent;
  this.isEdited = true;
  this.editedAt = new Date();
  return this.save();
};

// Method to soft delete message
MessageSchema.methods.softDelete = function () {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.content = "This message was deleted";
  return this.save();
};

// Static method to get conversation between two users
MessageSchema.statics.getConversation = async function (
  matchId,
  page = 1,
  limit = 50
) {
  const skip = (page - 1) * limit;

  return this.find({
    match: matchId,
    isDeleted: false,
  })
    .populate("sender", "firstName lastName photos")
    .populate("receiver", "firstName lastName photos")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// Static method to get unread message count
MessageSchema.statics.getUnreadCount = async function (userId) {
  return this.countDocuments({
    receiver: userId,
    readAt: null,
    isDeleted: false,
  });
};

// Static method to mark all messages in a conversation as read
MessageSchema.statics.markConversationAsRead = async function (
  matchId,
  userId
) {
  return this.updateMany(
    {
      match: matchId,
      receiver: userId,
      readAt: null,
      isDeleted: false,
    },
    {
      readAt: new Date(),
    }
  );
};

// Static method to get last message for each match
MessageSchema.statics.getLastMessages = async function (matchIds) {
  return this.aggregate([
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
        lastMessage: { $first: "$$ROOT" },
      },
    },
    {
      $replaceRoot: { newRoot: "$lastMessage" },
    },
    {
      $populate: {
        path: "sender",
        select: "firstName lastName",
      },
    },
  ]);
};

module.exports = mongoose.model("Message", MessageSchema);
