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
      enum: [
        "match",
        "message",
        "like",
        "super_like",
        "profile_view",
        "system",
        "promotion",
        "reminder",
        "warning",
      ],
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      maxlength: 100,
    },
    message: {
      type: String,
      required: true,
      maxlength: 500,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    // Reference to related entities
    relatedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    relatedMatch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      default: null,
    },
    relatedMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    // For system notifications
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    // For scheduling future notifications
    scheduledFor: {
      type: Date,
      default: null,
    },
    // Track if notification was sent via push/email
    sentVia: {
      push: {
        type: Boolean,
        default: false,
      },
      email: {
        type: Boolean,
        default: false,
      },
      inApp: {
        type: Boolean,
        default: true,
      },
    },
    // For tracking notification delivery
    deliveryStatus: {
      type: String,
      enum: ["pending", "delivered", "failed", "expired"],
      default: "pending",
    },
    deliveryAttempts: {
      type: Number,
      default: 0,
    },
    lastDeliveryAttempt: {
      type: Date,
      default: null,
    },
    // Expiration for temporary notifications
    expiresAt: {
      type: Date,
      default: null,
      index: { expireAfterSeconds: 0 }, // MongoDB TTL index
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for efficient querying
NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, type: 1, createdAt: -1 });
NotificationSchema.index({ scheduledFor: 1 }); // For scheduled notifications
NotificationSchema.index({ deliveryStatus: 1, deliveryAttempts: 1 }); // For retry logic

// Virtual for time ago
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

// Virtual to check if notification is expired
NotificationSchema.virtual("isExpired").get(function () {
  return this.expiresAt && new Date() > this.expiresAt;
});

// Method to mark as read
NotificationSchema.methods.markAsRead = function () {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

// Method to mark delivery status
NotificationSchema.methods.markDelivered = function (channel = "inApp") {
  this.deliveryStatus = "delivered";
  this.sentVia[channel] = true;
  this.lastDeliveryAttempt = new Date();
  return this.save();
};

// Method to mark delivery failed
NotificationSchema.methods.markDeliveryFailed = function () {
  this.deliveryStatus = "failed";
  this.deliveryAttempts += 1;
  this.lastDeliveryAttempt = new Date();
  return this.save();
};

// Static method to create a match notification
NotificationSchema.statics.createMatchNotification = async function (
  userId,
  matchedUser,
  matchId
) {
  return this.create({
    user: userId,
    type: "match",
    title: "New Match! 🎉",
    message: `You and ${matchedUser.firstName} liked each other!`,
    relatedUser: matchedUser._id,
    relatedMatch: matchId,
    data: {
      matchId,
      otherUserId: matchedUser._id,
      otherUserName: matchedUser.firstName,
    },
    priority: "high",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  });
};

// Static method to create a message notification
NotificationSchema.statics.createMessageNotification = async function (
  userId,
  sender,
  message,
  matchId
) {
  return this.create({
    user: userId,
    type: "message",
    title: `New message from ${sender.firstName}`,
    message:
      message.content.length > 100
        ? message.content.substring(0, 100) + "..."
        : message.content,
    relatedUser: sender._id,
    relatedMatch: matchId,
    relatedMessage: message._id,
    data: {
      messageId: message._id,
      senderId: sender._id,
      senderName: sender.firstName,
      matchId,
    },
    priority: "normal",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });
};

// Static method to create a like notification
NotificationSchema.statics.createLikeNotification = async function (
  userId,
  liker,
  isSuper = false
) {
  const type = isSuper ? "super_like" : "like";
  const title = isSuper
    ? "Someone Super Liked you! ⭐"
    : "Someone Liked you! ❤️";
  const message = isSuper
    ? `${liker.firstName} sent you a Super Like!`
    : `${liker.firstName} likes you!`;

  return this.create({
    user: userId,
    type,
    title,
    message,
    relatedUser: liker._id,
    data: {
      likerId: liker._id,
      likerName: liker.firstName,
      isSuper,
    },
    priority: isSuper ? "high" : "normal",
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
  });
};

// Static method to create a profile view notification
NotificationSchema.statics.createProfileViewNotification = async function (
  userId,
  viewer
) {
  return this.create({
    user: userId,
    type: "profile_view",
    title: "Profile View",
    message: `${viewer.firstName} viewed your profile`,
    relatedUser: viewer._id,
    data: {
      viewerId: viewer._id,
      viewerName: viewer.firstName,
    },
    priority: "low",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });
};

// Static method to create a system notification
NotificationSchema.statics.createSystemNotification = async function (
  userId,
  title,
  message,
  data = {},
  priority = "normal"
) {
  return this.create({
    user: userId,
    type: "system",
    title,
    message,
    data,
    priority,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  });
};

// Static method to create a reminder notification
NotificationSchema.statics.createReminderNotification = async function (
  userId,
  title,
  message,
  scheduledFor = null,
  data = {}
) {
  return this.create({
    user: userId,
    type: "reminder",
    title,
    message,
    data,
    priority: "normal",
    scheduledFor,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
  });
};

// Static method to get user's unread count
NotificationSchema.statics.getUnreadCount = async function (userId) {
  return this.countDocuments({
    user: userId,
    isRead: false,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  });
};

// Static method to get user's notifications with pagination
NotificationSchema.statics.getUserNotifications = async function (
  userId,
  options = {}
) {
  const {
    page = 1,
    limit = 20,
    type = null,
    isRead = null,
    includeExpired = false,
  } = options;

  const skip = (page - 1) * limit;

  let query = { user: userId };

  if (type) query.type = type;
  if (isRead !== null) query.isRead = isRead;

  if (!includeExpired) {
    query.$or = [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }];
  }

  const [notifications, total] = await Promise.all([
    this.find(query)
      .populate("relatedUser", "firstName lastName photos")
      .populate("relatedMatch", "users matchedAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    this.countDocuments(query),
  ]);

  return {
    notifications,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      total,
      hasMore: skip + notifications.length < total,
    },
  };
};

// Static method to mark user's notifications as read
NotificationSchema.statics.markUserNotificationsAsRead = async function (
  userId,
  notificationIds = null
) {
  let query = { user: userId, isRead: false };

  if (notificationIds) {
    query._id = { $in: notificationIds };
  }

  return this.updateMany(query, {
    isRead: true,
    readAt: new Date(),
  });
};

// Static method to cleanup expired notifications
NotificationSchema.statics.cleanupExpired = async function () {
  const result = await this.deleteMany({
    expiresAt: { $lt: new Date() },
  });

  return result.deletedCount;
};

// Static method to get notifications for push/email delivery
NotificationSchema.statics.getPendingDeliveries = async function (
  channel = "push",
  limit = 100
) {
  const query = {
    deliveryStatus: { $in: ["pending", "failed"] },
    deliveryAttempts: { $lt: 3 }, // Max 3 retry attempts
    [`sentVia.${channel}`]: false,
    $or: [{ scheduledFor: null }, { scheduledFor: { $lte: new Date() } }],
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  };

  return this.find(query)
    .populate("user", "firstName lastName email settings")
    .populate("relatedUser", "firstName lastName photos")
    .sort({ priority: -1, createdAt: 1 })
    .limit(limit);
};

module.exports = mongoose.model("Notification", NotificationSchema);
