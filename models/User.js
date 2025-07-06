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
    },
    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      maxlength: [50, "Last name cannot exceed 50 characters"],
    },
    dateOfBirth: {
      type: Date,
      required: [true, "Date of birth is required"],
    },
    gender: {
      type: String,
      required: [true, "Gender is required"],
      enum: ["male", "female", "other"],
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
      },
      address: {
        type: String,
        default: "",
      },
      city: {
        type: String,
        default: "",
      },
      country: {
        type: String,
        default: "",
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
        enum: ["male", "female", "both"],
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
    },
    subscription: {
      type: {
        type: String,
        enum: ["free", "premium", "gold"],
        default: "free",
      },
      expiresAt: {
        type: Date,
      },
      features: [
        {
          type: String,
          enum: [
            "unlimited_likes",
            "super_likes",
            "boosts",
            "rewinds",
            "passport",
          ],
        },
      ],
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
          },
          reason: {
            type: String,
            enum: [
              "inappropriate_content",
              "fake_profile",
              "harassment",
              "spam",
              "other",
            ],
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
      },
      likes: {
        type: Number,
        default: 0,
      },
      matches: {
        type: Number,
        default: 0,
      },
      superLikes: {
        type: Number,
        default: 0,
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
    },
    lockUntil: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for performance
UserSchema.index({ location: "2dsphere" });
UserSchema.index({ isActive: 1, lastActive: -1 });
UserSchema.index({ "preferences.interestedIn": 1, gender: 1 });
UserSchema.index({ dateOfBirth: 1 });
UserSchema.index({ createdAt: -1 });

// Virtual for age
UserSchema.virtual("age").get(function () {
  return this.getAge(this.dateOfBirth);
});

// Virtual for account locked
UserSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Validation for age range preferences
UserSchema.pre("save", function (next) {
  if (this.preferences.ageRange.min > this.preferences.ageRange.max) {
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

  next();
});

// Pre-save middleware to hash password
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const hashedPassword = await bcrypt.hash(this.password, 12);
    this.password = hashedPassword;
    next();
  } catch (error) {
    next(error);
  }
});

// Method to check password
UserSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) {
    // If password is not selected, fetch it
    const user = await this.constructor.findById(this._id).select("+password");
    return await bcrypt.compare(candidatePassword, user.password);
  }
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to get user's age
UserSchema.methods.getAge = function (dateOfBirth = this.dateOfBirth) {
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
};

// Method to get safe user data (without sensitive info)
UserSchema.methods.toSafeObject = function () {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.loginAttempts;
  delete userObject.lockUntil;
  delete userObject.safety.reportedUsers;
  return userObject;
};

// Method to get public profile (for matching)
UserSchema.methods.toPublicProfile = function () {
  return {
    _id: this._id,
    firstName: this.firstName,
    age: this.age,
    bio: this.bio,
    photos: this.photos,
    gender: this.gender,
    location: this.settings.privacy.showDistance ? this.location : undefined,
    verification: {
      isVerified: this.verification.isVerified,
    },
    lastActive: this.settings.privacy.onlineStatus
      ? this.lastActive
      : undefined,
  };
};

// Method to handle failed login attempts
UserSchema.methods.incLoginAttempts = function () {
  const maxAttempts = 5;
  const lockTime = 2 * 60 * 60 * 1000; // 2 hours

  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  if (this.loginAttempts + 1 >= maxAttempts && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + lockTime };
  }

  return this.updateOne(updates);
};

// Method to reset login attempts
UserSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 },
  });
};

// Method to block a user
UserSchema.methods.blockUser = function (userId) {
  if (!this.safety.blockedUsers.includes(userId)) {
    this.safety.blockedUsers.push(userId);
    return this.save();
  }
  return Promise.resolve(this);
};

// Method to unblock a user
UserSchema.methods.unblockUser = function (userId) {
  this.safety.blockedUsers = this.safety.blockedUsers.filter(
    (id) => id.toString() !== userId.toString()
  );
  return this.save();
};

// Method to report a user
UserSchema.methods.reportUser = function (userId, reason) {
  const existingReport = this.safety.reportedUsers.find(
    (report) => report.user.toString() === userId.toString()
  );

  if (!existingReport) {
    this.safety.reportedUsers.push({
      user: userId,
      reason,
    });
    return this.save();
  }

  return Promise.resolve(this);
};

// Static method to find users for discovery
UserSchema.statics.findForDiscovery = function (currentUser, excludeIds = []) {
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

  return this.find(query).select(
    "firstName lastName bio dateOfBirth gender photos location preferences verification lastActive"
  );
};

module.exports = mongoose.model("User", UserSchema);
