// models/User.js - ENHANCED FIXED VERSION
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
      index: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false, // Don't include password in queries by default
    },
    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
      maxlength: [50, "First name cannot exceed 50 characters"],
      validate: {
        validator: function (v) {
          return /^[a-zA-Z\s]+$/.test(v);
        },
        message: "First name can only contain letters and spaces",
      },
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      maxlength: [50, "Last name cannot exceed 50 characters"],
      validate: {
        validator: function (v) {
          return /^[a-zA-Z\s]+$/.test(v);
        },
        message: "Last name can only contain letters and spaces",
      },
    },
    dateOfBirth: {
      type: Date,
      required: [true, "Date of birth is required"],
      validate: {
        validator: function (date) {
          const today = new Date();
          const birthDate = new Date(date);
          const age = today.getFullYear() - birthDate.getFullYear();
          const monthDiff = today.getMonth() - birthDate.getMonth();

          if (
            monthDiff < 0 ||
            (monthDiff === 0 && today.getDate() < birthDate.getDate())
          ) {
            age--;
          }

          return age >= 18 && age <= 120;
        },
        message: "User must be between 18 and 120 years old",
      },
    },
    gender: {
      type: String,
      required: [true, "Gender is required"],
      enum: {
        values: ["male", "female", "other"],
        message: "Gender must be male, female, or other",
      },
    },
    bio: {
      type: String,
      maxlength: [500, "Bio cannot exceed 500 characters"],
      default: "",
      trim: true,
    },
    photos: [
      {
        url: {
          type: String,
          required: true,
          validate: {
            validator: function (v) {
              return /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(v);
            },
            message: "Photo URL must be a valid image URL",
          },
        },
        public_id: {
          type: String,
          required: true,
        },
        isPrimary: {
          type: Boolean,
          default: false,
        },
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
        _id: {
          type: mongoose.Schema.Types.ObjectId,
          default: () => new mongoose.Types.ObjectId(),
        },
      },
    ],
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
        validate: {
          validator: function (coords) {
            return (
              coords.length === 2 &&
              coords[0] >= -180 &&
              coords[0] <= 180 && // longitude
              coords[1] >= -90 &&
              coords[1] <= 90
            ); // latitude
          },
          message: "Invalid coordinates format",
        },
      },
      address: {
        type: String,
        default: "",
        maxlength: [200, "Address cannot exceed 200 characters"],
      },
      city: {
        type: String,
        default: "",
        maxlength: [100, "City cannot exceed 100 characters"],
      },
      country: {
        type: String,
        default: "",
        maxlength: [100, "Country cannot exceed 100 characters"],
      },
    },
    preferences: {
      ageRange: {
        min: {
          type: Number,
          default: 18,
          min: [18, "Minimum age must be at least 18"],
          max: [100, "Minimum age cannot exceed 100"],
        },
        max: {
          type: Number,
          default: 50,
          min: [18, "Maximum age must be at least 18"],
          max: [100, "Maximum age cannot exceed 100"],
        },
      },
      maxDistance: {
        type: Number,
        default: 50,
        min: [1, "Distance must be at least 1 km"],
        max: [500, "Distance cannot exceed 500 km"],
      },
      interestedIn: {
        type: String,
        enum: {
          values: ["male", "female", "both"],
          message: "Interested in must be male, female, or both",
        },
        default: "both",
      },
      showMe: {
        type: Boolean,
        default: true,
      },
    },
    settings: {
      notifications: {
        matches: {
          type: Boolean,
          default: true,
        },
        messages: {
          type: Boolean,
          default: true,
        },
        likes: {
          type: Boolean,
          default: true,
        },
        email: {
          type: Boolean,
          default: true,
        },
        push: {
          type: Boolean,
          default: true,
        },
        sound: {
          type: Boolean,
          default: true,
        },
        vibration: {
          type: Boolean,
          default: true,
        },
        // Time-based preferences
        quietHours: {
          enabled: {
            type: Boolean,
            default: false,
          },
          start: {
            type: String, // "22:00"
            default: "22:00",
          },
          end: {
            type: String, // "07:00"
            default: "07:00",
          },
        },
        // Frequency controls
        frequency: {
          instant: {
            type: Boolean,
            default: true,
          },
          batched: {
            type: Boolean,
            default: false,
          },
          daily: {
            type: Boolean,
            default: false,
          },
        },
      },
      privacy: {
        showAge: {
          type: Boolean,
          default: true,
        },
        showDistance: {
          type: Boolean,
          default: true,
        },
        onlineStatus: {
          type: Boolean,
          default: true,
        },
        readReceipts: {
          type: Boolean,
          default: true,
        },
      },
    },
    verification: {
      isVerified: {
        type: Boolean,
        default: false,
      },
      verificationDate: {
        type: Date,
      },
      phoneVerified: {
        type: Boolean,
        default: false,
      },
      emailVerified: {
        type: Boolean,
        default: false,
      },
      photoVerified: {
        type: Boolean,
        default: false,
      },
    },
    subscription: {
      type: {
        type: String,
        enum: {
          values: ["free", "premium", "gold"],
          message: "Subscription type must be free, premium, or gold",
        },
        default: "free",
      },
      expiresAt: {
        type: Date,
      },
      features: [
        {
          type: String,
          enum: {
            values: [
              "unlimited_likes",
              "super_likes",
              "boosts",
              "rewinds",
              "passport",
              "read_receipts",
              "priority_likes",
            ],
            message: "Invalid subscription feature",
          },
        },
      ],
      autoRenew: {
        type: Boolean,
        default: false,
      },
    },
    safety: {
      blockedUsers: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
      ],
      reportedUsers: [
        {
          user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
          },
          reason: {
            type: String,
            enum: {
              values: [
                "inappropriate_content",
                "fake_profile",
                "harassment",
                "spam",
                "underage",
                "other",
              ],
              message: "Invalid report reason",
            },
            required: true,
          },
          details: {
            type: String,
            maxlength: [500, "Report details cannot exceed 500 characters"],
          },
          reportedAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
    },
    stats: {
      profileViews: {
        type: Number,
        default: 0,
        min: 0,
      },
      likes: {
        type: Number,
        default: 0,
        min: 0,
      },
      matches: {
        type: Number,
        default: 0,
        min: 0,
      },
      superLikes: {
        type: Number,
        default: 0,
        min: 0,
      },
      swipes: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastActive: {
      type: Date,
      default: Date.now,
      index: true,
    },
    loginAttempts: {
      type: Number,
      default: 0,
      min: 0,
      max: 10,
    },
    lockUntil: {
      type: Date,
    },
    // New security fields
    emailVerificationToken: {
      type: String,
      select: false,
    },
    emailVerificationExpires: {
      type: Date,
      select: false,
    },
    passwordResetToken: {
      type: String,
      select: false,
    },
    passwordResetExpires: {
      type: Date,
      select: false,
    },
    // Enhanced tracking
    registrationIP: {
      type: String,
    },
    lastLoginIP: {
      type: String,
    },
    deviceInfo: {
      type: String,
    },
    notificationSettings: {
      pushSubscription: mongoose.Schema.Types.Mixed,
      userAgent: String,
      subscribedAt: Date,
      preferences: {
        matches: { type: Boolean, default: true },
        messages: { type: Boolean, default: true },
        likes: { type: Boolean, default: true },
        superLikes: { type: Boolean, default: true },
        profileViews: { type: Boolean, default: false },
        matchExpiring: { type: Boolean, default: true },
        email: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
        sound: { type: Boolean, default: true },
        vibration: { type: Boolean, default: true },
      },
    },
    // Device tokens for push notifications
    deviceTokens: [
      {
        token: {
          type: String,
          required: true,
        },
        platform: {
          type: String,
          enum: ["web", "android", "ios"],
          required: true,
        },
        deviceInfo: {
          userAgent: String,
          browser: String,
          os: String,
          deviceModel: String,
          appVersion: String,
        },
        registeredAt: {
          type: Date,
          default: Date.now,
        },
        lastUsed: {
          type: Date,
          default: Date.now,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
        _id: {
          type: mongoose.Schema.Types.ObjectId,
          default: () => new mongoose.Types.ObjectId(),
        },
      },
    ],
    // Add notification statistics tracking
    notificationStats: {
      sent: {
        type: Number,
        default: 0,
      },
      delivered: {
        type: Number,
        default: 0,
      },
      clicked: {
        type: Number,
        default: 0,
      },
      lastNotificationSent: {
        type: Date,
      },
      lastNotificationClicked: {
        type: Date,
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Enhanced indexes for better performance
UserSchema.index({ location: "2dsphere" });
UserSchema.index({ isActive: 1, lastActive: -1 });
UserSchema.index({ "preferences.interestedIn": 1, gender: 1 });
UserSchema.index({ dateOfBirth: 1 });
UserSchema.index({ createdAt: -1 });
UserSchema.index({ "verification.isVerified": 1 });
UserSchema.index({ "subscription.type": 1 });
UserSchema.index({ email: 1, isActive: 1 });

// Device token indexes
UserSchema.index({ "deviceTokens.token": 1 });
UserSchema.index({ "deviceTokens.platform": 1 });
UserSchema.index({ "deviceTokens.lastUsed": 1 });

// Compound indexes for discovery
UserSchema.index({
  isActive: 1,
  "preferences.showMe": 1,
  gender: 1,
  dateOfBirth: 1,
});

// Virtual for age
UserSchema.virtual("age").get(function () {
  return this.getAge(this.dateOfBirth);
});

// Virtual for account locked
UserSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Enhanced validation for age range preferences
UserSchema.pre("save", function (next) {
  // Validate age range
  if (this.preferences?.ageRange?.min > this.preferences?.ageRange?.max) {
    return next(new Error("Minimum age cannot be greater than maximum age"));
  }

  // Ensure only one primary photo
  if (this.photos && this.photos.length > 0) {
    const primaryPhotos = this.photos.filter((photo) => photo.isPrimary);
    if (primaryPhotos.length > 1) {
      // Set only the first one as primary
      this.photos.forEach((photo, index) => {
        photo.isPrimary = index === 0;
      });
    } else if (primaryPhotos.length === 0 && this.photos.length > 0) {
      // Set first photo as primary if none is set
      this.photos[0].isPrimary = true;
    }
  }

  // Validate subscription features
  if (this.subscription?.features?.length > 0) {
    const allowedFeatures = {
      free: [],
      premium: ["super_likes", "boosts", "rewinds", "read_receipts"],
      gold: [
        "unlimited_likes",
        "super_likes",
        "boosts",
        "rewinds",
        "passport",
        "read_receipts",
        "priority_likes",
      ],
    };

    const userType = this.subscription.type || "free";
    const validFeatures = allowedFeatures[userType];

    this.subscription.features = this.subscription.features.filter((feature) =>
      validFeatures.includes(feature)
    );
  }

  // Clean up expired verification tokens
  if (
    this.emailVerificationExpires &&
    this.emailVerificationExpires < new Date()
  ) {
    this.emailVerificationToken = undefined;
    this.emailVerificationExpires = undefined;
  }

  if (this.passwordResetExpires && this.passwordResetExpires < new Date()) {
    this.passwordResetToken = undefined;
    this.passwordResetExpires = undefined;
  }

  // Remove duplicate device tokens
  if (this.deviceTokens && this.deviceTokens.length > 0) {
    const uniqueTokens = [];
    const seenTokens = new Set();

    this.deviceTokens.forEach((device) => {
      if (!seenTokens.has(device.token)) {
        seenTokens.add(device.token);
        uniqueTokens.push(device);
      }
    });

    this.deviceTokens = uniqueTokens;
  }

  next();
});

// Enhanced pre-save middleware to hash password
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    // Enhanced password hashing with higher cost
    const hashedPassword = await bcrypt.hash(this.password, 12);
    this.password = hashedPassword;
    next();
  } catch (error) {
    next(error);
  }
});

// Enhanced method to check password with timing attack protection
UserSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword) return false;

  try {
    if (!this.password) {
      // If password is not selected, fetch it
      const user = await this.constructor
        .findById(this._id)
        .select("+password");
      if (!user?.password) return false;
      return await bcrypt.compare(candidatePassword, user.password);
    }
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    console.error("Password comparison error:", error);
    return false;
  }
};

// Enhanced method to get user's age
UserSchema.methods.getAge = function (dateOfBirth = this.dateOfBirth) {
  if (!dateOfBirth) return 0;

  const today = new Date();
  const birthDate = new Date(dateOfBirth);

  if (birthDate > today) return 0; // Future date

  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }

  return Math.max(0, age);
};

// Enhanced method to get safe user data (without sensitive info)
UserSchema.methods.toSafeObject = function () {
  const userObject = this.toObject();

  // Remove sensitive fields
  delete userObject.password;
  delete userObject.loginAttempts;
  delete userObject.lockUntil;
  delete userObject.emailVerificationToken;
  delete userObject.emailVerificationExpires;
  delete userObject.passwordResetToken;
  delete userObject.passwordResetExpires;
  delete userObject.registrationIP;
  delete userObject.lastLoginIP;
  delete userObject.deviceInfo;
  delete userObject.safety.reportedUsers;

  return userObject;
};

// Enhanced method to get public profile (for matching)
UserSchema.methods.toPublicProfile = function () {
  return {
    _id: this._id,
    firstName: this.firstName,
    age: this.age,
    bio: this.bio,
    photos: this.photos,
    gender: this.gender,
    location: this.settings?.privacy?.showDistance
      ? {
          city: this.location?.city,
          country: this.location?.country,
          // Don't show exact coordinates for privacy
        }
      : undefined,
    verification: {
      isVerified: this.verification?.isVerified || false,
      photoVerified: this.verification?.photoVerified || false,
    },
    lastActive: this.settings?.privacy?.onlineStatus
      ? this.lastActive
      : undefined,
    subscription: {
      type: this.subscription?.type || "free",
      // Don't expose other subscription details
    },
    stats: {
      profileViews: this.stats?.profileViews || 0,
      // Only show public stats
    },
  };
};

// Enhanced method to handle failed login attempts with progressive delays
UserSchema.methods.incLoginAttempts = function () {
  const maxAttempts = 5;
  const lockTimes = [
    30 * 60 * 1000, // 30 minutes
    60 * 60 * 1000, // 1 hour
    2 * 60 * 60 * 1000, // 2 hours
    6 * 60 * 60 * 1000, // 6 hours
    24 * 60 * 60 * 1000, // 24 hours
  ];

  // If we have a previous lock that has expired, restart
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  // If we have reached max attempts and there is no lock, lock account
  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked) {
    const lockTimeIndex = Math.min(
      this.loginAttempts - maxAttempts + 1,
      lockTimes.length - 1
    );
    updates.$set = { lockUntil: Date.now() + lockTimes[lockTimeIndex] };
  }

  return this.updateOne(updates);
};

// Method to reset login attempts
UserSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 },
  });
};

// Enhanced method to block a user with validation
UserSchema.methods.blockUser = function (userId) {
  if (!userId || userId.toString() === this._id.toString()) {
    throw new Error("Cannot block yourself");
  }

  if (!this.safety.blockedUsers.includes(userId)) {
    this.safety.blockedUsers.push(userId);
    return this.save();
  }
  return Promise.resolve(this);
};

// Method to unblock a user
UserSchema.methods.unblockUser = function (userId) {
  if (!userId) {
    throw new Error("User ID is required");
  }

  this.safety.blockedUsers = this.safety.blockedUsers.filter(
    (id) => id.toString() !== userId.toString()
  );
  return this.save();
};

// Enhanced method to report a user with validation
UserSchema.methods.reportUser = function (userId, reason, details = "") {
  if (!userId || userId.toString() === this._id.toString()) {
    throw new Error("Cannot report yourself");
  }

  const validReasons = [
    "inappropriate_content",
    "fake_profile",
    "harassment",
    "spam",
    "underage",
    "other",
  ];

  if (!validReasons.includes(reason)) {
    throw new Error("Invalid report reason");
  }

  const existingReport = this.safety.reportedUsers.find(
    (report) => report.user.toString() === userId.toString()
  );

  if (!existingReport) {
    this.safety.reportedUsers.push({
      user: userId,
      reason,
      details: details.substring(0, 500), // Ensure max length
    });
    return this.save();
  }

  return Promise.resolve(this);
};

// Enhanced static method to find users for discovery with better performance
UserSchema.statics.findForDiscovery = function (
  currentUser,
  excludeIds = [],
  limit = 10
) {
  const query = {
    _id: {
      $nin: [
        currentUser._id,
        ...excludeIds,
        ...(currentUser.safety?.blockedUsers || []),
      ],
    },
    isActive: true,
    "preferences.showMe": true,
    photos: { $exists: true, $not: { $size: 0 } },
    "safety.blockedUsers": { $nin: [currentUser._id] },
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

  // Filter by mutual interest (the other user must also be interested in current user)
  const mutualInterestQuery = [];

  if (currentUser.gender) {
    mutualInterestQuery.push(
      { "preferences.interestedIn": currentUser.gender },
      { "preferences.interestedIn": "both" }
    );
  }

  if (mutualInterestQuery.length > 0) {
    query.$or = mutualInterestQuery;
  }

  return this.find(query)
    .select(
      "firstName lastName bio dateOfBirth gender photos location preferences verification lastActive stats"
    )
    .sort({
      "verification.isVerified": -1, // Verified users first
      lastActive: -1, // Recently active users
      "stats.profileViews": -1, // Popular users
    })
    .limit(limit)
    .lean(); // Use lean for better performance
};

// Enhanced static method for location-based discovery
UserSchema.statics.findNearbyUsers = function (
  currentUser,
  maxDistance = 50,
  limit = 10
) {
  if (!currentUser.location?.coordinates) {
    return this.findForDiscovery(currentUser, [], limit);
  }

  const baseQuery = this.findForDiscovery(currentUser, [], limit * 2); // Get more to filter by location

  return baseQuery.aggregate([
    {
      $geoNear: {
        near: {
          type: "Point",
          coordinates: currentUser.location.coordinates,
        },
        distanceField: "distance",
        maxDistance: maxDistance * 1000, // Convert km to meters
        spherical: true,
        query: baseQuery.getQuery(),
      },
    },
    { $limit: limit },
  ]);
};

// Method to update user stats safely
UserSchema.methods.updateStats = function (statsUpdate) {
  const allowedStats = [
    "profileViews",
    "likes",
    "matches",
    "superLikes",
    "swipes",
  ];
  const updates = {};

  Object.keys(statsUpdate).forEach((key) => {
    if (allowedStats.includes(key) && typeof statsUpdate[key] === "number") {
      updates[`stats.${key}`] = Math.max(
        0,
        (this.stats[key] || 0) + statsUpdate[key]
      );
    }
  });

  if (Object.keys(updates).length > 0) {
    return this.updateOne({ $set: updates });
  }

  return Promise.resolve();
};

// Method to check if user has premium features
UserSchema.methods.hasPremiumFeature = function (feature) {
  if (this.subscription?.type === "free") return false;

  const subscriptionFeatures = this.subscription?.features || [];
  return subscriptionFeatures.includes(feature);
};

// Method to check if subscription is active
UserSchema.methods.hasActiveSubscription = function () {
  if (this.subscription?.type === "free") return false;
  if (!this.subscription?.expiresAt) return true; // Lifetime subscription

  return new Date(this.subscription.expiresAt) > new Date();
};

// Static method for admin/moderation purposes
UserSchema.statics.findSuspiciousUsers = function () {
  return this.find({
    $or: [
      { "safety.reportedUsers.10": { $exists: true } }, // Users with 10+ reports
      { loginAttempts: { $gte: 3 } }, // Users with failed login attempts
      { photos: { $size: 0 } }, // Users without photos
      {
        $and: [
          { createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          { "stats.matches": { $gte: 20 } },
        ],
      }, // New users with too many matches (potential bots)
    ],
  }).select("firstName lastName email createdAt stats safety");
};

// Device token methods
UserSchema.methods.addDeviceToken = function (tokenData) {
  const existingIndex = this.deviceTokens.findIndex(
    (device) => device.token === tokenData.token
  );

  const deviceInfo = {
    token: tokenData.token,
    platform: tokenData.platform,
    deviceInfo: tokenData.deviceInfo || {},
    registeredAt:
      existingIndex >= 0
        ? this.deviceTokens[existingIndex].registeredAt
        : new Date(),
    lastUsed: new Date(),
    isActive: true,
  };

  if (existingIndex >= 0) {
    this.deviceTokens[existingIndex] = deviceInfo;
  } else {
    this.deviceTokens.push(deviceInfo);
  }

  // Limit to 10 devices per user
  if (this.deviceTokens.length > 10) {
    this.deviceTokens = this.deviceTokens
      .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))
      .slice(0, 10);
  }

  return this.save();
};

// Method to remove device token
UserSchema.methods.removeDeviceToken = function (token) {
  this.deviceTokens = this.deviceTokens.filter(
    (device) => device.token !== token
  );
  return this.save();
};

// Method to get active device tokens
UserSchema.methods.getActiveDeviceTokens = function () {
  return this.deviceTokens.filter((device) => device.isActive);
};

// Method to clean up old device tokens
UserSchema.methods.cleanupDeviceTokens = function (daysOld = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  const originalLength = this.deviceTokens.length;

  this.deviceTokens = this.deviceTokens.filter(
    (device) => new Date(device.lastUsed) > cutoffDate
  );

  if (this.deviceTokens.length !== originalLength) {
    console.log(
      `🧹 Cleaned up ${
        originalLength - this.deviceTokens.length
      } old device tokens for user ${this._id}`
    );
    return this.save();
  }

  return Promise.resolve(this);
};

// Method to check if notifications are enabled for a type
UserSchema.methods.canReceiveNotification = function (type) {
  if (!this.settings?.notifications) {
    return true; // Default to enabled
  }

  const settings = this.settings.notifications;

  // Check if push notifications are globally disabled
  if (!settings.push) {
    return false;
  }

  // Check specific notification type
  switch (type) {
    case "match":
      return settings.matches !== false;
    case "message":
      return settings.messages !== false;
    case "like":
    case "superlike":
      return settings.likes !== false;
    default:
      return true;
  }
};

// Method to check quiet hours
UserSchema.methods.isInQuietHours = function () {
  if (!this.settings?.notifications?.quietHours?.enabled) {
    return false;
  }

  const now = new Date();
  const currentTime =
    now.getHours().toString().padStart(2, "0") +
    ":" +
    now.getMinutes().toString().padStart(2, "0");

  const { start, end } = this.settings.notifications.quietHours;

  if (start <= end) {
    // Same day range (e.g., 09:00 to 17:00)
    return currentTime >= start && currentTime <= end;
  } else {
    // Overnight range (e.g., 22:00 to 07:00)
    return currentTime >= start || currentTime <= end;
  }
};

// Method to increment notification stats
UserSchema.methods.incrementNotificationStat = function (type) {
  if (!this.notificationStats) {
    this.notificationStats = { sent: 0, delivered: 0, clicked: 0 };
  }

  switch (type) {
    case "sent":
      this.notificationStats.sent++;
      this.notificationStats.lastNotificationSent = new Date();
      break;
    case "delivered":
      this.notificationStats.delivered++;
      break;
    case "clicked":
      this.notificationStats.clicked++;
      this.notificationStats.lastNotificationClicked = new Date();
      break;
  }

  return this.save();
};

// Static method to find users with device tokens
UserSchema.statics.findUsersWithDeviceTokens = function (platform = null) {
  const query = {
    isActive: true,
    deviceTokens: { $exists: true, $not: { $size: 0 } },
  };

  if (platform) {
    query["deviceTokens.platform"] = platform;
  }

  return this.find(query).select("_id firstName deviceTokens settings");
};

// Static method to cleanup all old device tokens
UserSchema.statics.cleanupAllDeviceTokens = async function (daysOld = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

  const result = await this.updateMany(
    {
      "deviceTokens.lastUsed": { $lt: cutoffDate },
    },
    {
      $pull: {
        deviceTokens: { lastUsed: { $lt: cutoffDate } },
      },
    }
  );

  console.log(`🧹 Cleaned up device tokens from ${result.modifiedCount} users`);
  return result;
};

// Virtual for notification preferences summary
UserSchema.virtual("notificationSummary").get(function () {
  const settings = this.settings?.notifications || {};
  const enabledCount = Object.values(settings).filter(Boolean).length;
  const totalSettings = Object.keys(settings).length;

  return {
    enabledCount,
    totalSettings,
    percentage:
      totalSettings > 0
        ? Math.round((enabledCount / totalSettings) * 100)
        : 100,
    allEnabled: enabledCount === totalSettings,
    noneEnabled: enabledCount === 0,
  };
});

module.exports = mongoose.model("User", UserSchema);
