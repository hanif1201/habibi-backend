// models/Notification.js

const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "new_match",
        "new_message",
        "new_like",
        "super_like",
        "profile_view",
        "match_expiring",
        "welcome",
        "test",
        "system",
        "promotion",
      ],
      index: true,
    },
    title: {
      type: String,
      required: true,
      maxlength: 100,
    },
    body: {
      type: String,
      required: true,
      maxlength: 500,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Reference to related objects
    relatedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    relatedMatch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
    },
    relatedMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    // Status tracking
    sentAt: {
      type: Date,
      default: Date.now,
    },
    readAt: {
      type: Date,
      default: null,
    },
    clickedAt: {
      type: Date,
      default: null,
    },
    // Delivery tracking
    pushSent: {
      type: Boolean,
      default: false,
    },
    emailSent: {
      type: Boolean,
      default: false,
    },
    inAppShown: {
      type: Boolean,
      default: false,
    },
    // Error tracking
    deliveryErrors: [
      {
        type: {
          type: String,
          enum: ["push", "email", "in_app"],
        },
        error: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    // Priority and scheduling
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    scheduledFor: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: function () {
        // Notifications expire after 30 days by default
        return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, readAt: 1 });
NotificationSchema.index({ type: 1, createdAt: -1 });
NotificationSchema.index({ scheduledFor: 1 }, { sparse: true });
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for checking if notification is read
NotificationSchema.virtual("isRead").get(function () {
  return !!this.readAt;
});

// Virtual for checking if notification is clicked
NotificationSchema.virtual("isClicked").get(function () {
  return !!this.clickedAt;
});

// Virtual for time since creation
NotificationSchema.virtual("timeAgo").get(function () {
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

// Instance method to mark as read
NotificationSchema.methods.markAsRead = function () {
  if (!this.readAt) {
    this.readAt = new Date();
    return this.save();
  }
  return Promise.resolve(this);
};

// Instance method to mark as clicked
NotificationSchema.methods.markAsClicked = function () {
  if (!this.clickedAt) {
    this.clickedAt = new Date();
    if (!this.readAt) {
      this.readAt = new Date();
    }
    return this.save();
  }
  return Promise.resolve(this);
};

// Instance method to add delivery error
NotificationSchema.methods.addDeliveryError = function (type, error) {
  this.deliveryErrors.push({
    type,
    error: error.message || error,
    timestamp: new Date(),
  });
  return this.save();
};

// Static method to get unread count for user
NotificationSchema.statics.getUnreadCount = async function (userId) {
  return this.countDocuments({
    user: userId,
    readAt: null,
    sentAt: { $lte: new Date() },
  });
};

// Static method to mark all as read for user
NotificationSchema.statics.markAllAsRead = async function (userId) {
  return this.updateMany(
    { user: userId, readAt: null },
    { readAt: new Date() }
  );
};

// Static method to get notifications by type
NotificationSchema.statics.getByType = async function (
  userId,
  type,
  limit = 10
) {
  return this.find({
    user: userId,
    type: type,
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("relatedUser", "firstName lastName photos")
    .lean();
};

// Static method to get recent notifications
NotificationSchema.statics.getRecent = async function (
  userId,
  hours = 24,
  limit = 50
) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  return this.find({
    user: userId,
    createdAt: { $gte: since },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("relatedUser", "firstName lastName photos")
    .lean();
};

// Static method to clean up old notifications
NotificationSchema.statics.cleanupOld = async function (days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const result = await this.deleteMany({
    createdAt: { $lt: cutoff },
    priority: { $ne: "urgent" }, // Keep urgent notifications longer
  });

  return result.deletedCount;
};

// Static method to get notification statistics
NotificationSchema.statics.getStats = async function (userId, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const stats = await this.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: "$type",
        count: { $sum: 1 },
        read: { $sum: { $cond: [{ $ne: ["$readAt", null] }, 1, 0] } },
        clicked: { $sum: { $cond: [{ $ne: ["$clickedAt", null] }, 1, 0] } },
      },
    },
  ]);

  const totalStats = await this.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        totalRead: { $sum: { $cond: [{ $ne: ["$readAt", null] }, 1, 0] } },
        totalClicked: {
          $sum: { $cond: [{ $ne: ["$clickedAt", null] }, 1, 0] },
        },
      },
    },
  ]);

  return {
    byType: stats,
    overall: totalStats[0] || { total: 0, totalRead: 0, totalClicked: 0 },
  };
};

// Static method to schedule notifications
NotificationSchema.statics.getScheduledNotifications = async function () {
  return this.find({
    scheduledFor: { $lte: new Date() },
    sentAt: null,
  }).limit(100);
};

// Pre-save middleware to set delivery flags
NotificationSchema.pre("save", function (next) {
  if (this.isNew) {
    // Set initial delivery flags
    if (this.type !== "system" && this.type !== "test") {
      this.pushSent = false;
      this.emailSent = false;
      this.inAppShown = false;
    }
  }
  next();
});

// Virtual to include related user data in JSON
NotificationSchema.set("toJSON", { virtuals: true });
NotificationSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Notification", NotificationSchema);
