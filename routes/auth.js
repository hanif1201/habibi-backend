// routes/auth.js - Enhanced with Email Features (UPDATED VERSION)
const express = require("express");
const { body, validationResult } = require("express-validator");
const crypto = require("crypto");
const User = require("../models/User");
const { authenticate, generateToken } = require("../middleware/auth");
const emailService = require("../services/emailService");

const router = express.Router();

// @route   POST /api/auth/register
// @desc    Register a new user with email verification
// @access  Public
router.post(
  "/register",
  [
    // Validation middleware
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please enter a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters long"),
    body("firstName")
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage(
        "First name is required and must be less than 50 characters"
      ),
    body("lastName")
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("Last name is required and must be less than 50 characters"),
    body("dateOfBirth")
      .isISO8601()
      .withMessage("Please enter a valid date of birth"),
    body("gender")
      .isIn(["male", "female", "other"])
      .withMessage("Gender must be male, female, or other"),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { email, password, firstName, lastName, dateOfBirth, gender } =
        req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "User already exists with this email",
        });
      }

      // Validate age (must be 18 or older)
      const birthDate = new Date(dateOfBirth);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < birthDate.getDate())
      ) {
        age--;
      }

      if (age < 18) {
        return res.status(400).json({
          success: false,
          message: "You must be at least 18 years old to register",
        });
      }

      // Generate email verification token
      const emailVerificationToken = emailService.generateVerificationToken();
      const emailVerificationExpires = new Date(
        Date.now() + 24 * 60 * 60 * 1000
      ); // 24 hours

      // Create new user
      const user = new User({
        email,
        password,
        firstName,
        lastName,
        dateOfBirth: birthDate,
        gender,
        emailVerificationToken,
        emailVerificationExpires,
        verification: {
          emailVerified: false,
        },
      });

      // Save user to database
      await user.save();

      // Send welcome email with verification
      try {
        await emailService.sendWelcomeEmail(user, emailVerificationToken);
        console.log(`📧 Welcome email sent to ${user.email}`);
      } catch (emailError) {
        console.error("Failed to send welcome email:", emailError);
        // Don't fail registration if email fails
      }

      // Generate JWT token
      const token = generateToken(user._id);

      // Return success response
      res.status(201).json({
        success: true,
        message:
          "User registered successfully. Please check your email to verify your account.",
        token,
        user: user.toSafeObject(),
        emailSent: true,
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during registration",
      });
    }
  }
);

// @route   POST /api/auth/verify-email
// @desc    Verify user's email address
// @access  Public
router.post(
  "/verify-email",
  [body("token").notEmpty().withMessage("Verification token is required")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { token } = req.body;

      // Find user with valid token
      const user = await User.findOne({
        emailVerificationToken: token,
        emailVerificationExpires: { $gt: new Date() },
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired verification token",
        });
      }

      // Update user verification status
      user.verification.emailVerified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;

      await user.save();

      console.log(`✅ Email verified for user: ${user.email}`);

      res.json({
        success: true,
        message: "Email verified successfully",
        user: user.toSafeObject(),
      });
    } catch (error) {
      console.error("Email verification error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during email verification",
      });
    }
  }
);

// @route   POST /api/auth/resend-verification
// @desc    Resend email verification
// @access  Private
router.post("/resend-verification", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (user.verification?.emailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified",
      });
    }

    // Generate new verification token
    const emailVerificationToken = emailService.generateVerificationToken();
    const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    user.emailVerificationToken = emailVerificationToken;
    user.emailVerificationExpires = emailVerificationExpires;

    await user.save();

    // Send verification email
    try {
      await emailService.sendEmailVerification(user, emailVerificationToken);

      res.json({
        success: true,
        message: "Verification email sent successfully",
      });
    } catch (emailError) {
      console.error("Failed to send verification email:", emailError);
      res.status(500).json({
        success: false,
        message: "Failed to send verification email",
      });
    }
  } catch (error) {
    console.error("Resend verification error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email
// @access  Public
router.post(
  "/forgot-password",
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please enter a valid email"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { email } = req.body;

      // Find user by email
      const user = await User.findOne({ email });

      // Always return success for security (don't reveal if email exists)
      if (!user) {
        return res.json({
          success: true,
          message:
            "If an account with that email exists, we've sent a password reset link",
        });
      }

      // Check for recent password reset attempts (rate limiting)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (
        user.passwordResetExpires &&
        user.passwordResetExpires > fiveMinutesAgo
      ) {
        return res.status(429).json({
          success: false,
          message:
            "Password reset was already requested recently. Please check your email or try again later.",
        });
      }

      // Generate password reset token
      const resetToken = emailService.generatePasswordResetToken();
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      user.passwordResetToken = resetToken;
      user.passwordResetExpires = resetExpires;

      await user.save();

      // Send password reset email
      try {
        await emailService.sendPasswordResetEmail(user, resetToken);

        console.log(`📧 Password reset email sent to ${user.email}`);

        res.json({
          success: true,
          message:
            "If an account with that email exists, we've sent a password reset link",
        });
      } catch (emailError) {
        console.error("Failed to send password reset email:", emailError);

        // Clear the reset token if email fails
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();

        res.status(500).json({
          success: false,
          message: "Failed to send password reset email",
        });
      }
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);

// @route   POST /api/auth/reset-password
// @desc    Reset user password with token
// @access  Public
router.post(
  "/reset-password",
  [
    body("token").notEmpty().withMessage("Reset token is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters long"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { token, password } = req.body;

      // Find user with valid reset token
      const user = await User.findOne({
        passwordResetToken: token,
        passwordResetExpires: { $gt: new Date() },
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired reset token",
        });
      }

      // Update password
      user.password = password; // Will be hashed by pre-save middleware
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;

      // Reset login attempts on successful password reset
      user.loginAttempts = 0;
      user.lockUntil = undefined;

      await user.save();

      console.log(`🔐 Password reset successful for user: ${user.email}`);

      res.json({
        success: true,
        message: "Password reset successfully",
      });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during password reset",
      });
    }
  }
);

// @route   POST /api/auth/login
// @desc    Login user (enhanced with email verification check)
// @access  Public
router.post(
  "/login",
  [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Please enter a valid email"),
    body("password").exists().withMessage("Password is required"),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { email, password } = req.body;

      // Find user by email and include password for comparison
      const user = await User.findOne({ email }).select("+password");
      if (!user) {
        return res.status(400).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      // Check if account is active
      if (!user.isActive) {
        return res.status(400).json({
          success: false,
          message: "Account is deactivated. Please contact support.",
        });
      }

      // Check if account is locked
      if (user.isLocked) {
        return res.status(423).json({
          success: false,
          message:
            "Account is temporarily locked due to too many failed login attempts",
          lockUntil: user.lockUntil,
        });
      }

      // Verify password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        // Increment login attempts
        await user.incLoginAttempts();

        return res.status(400).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      // Reset login attempts on successful login
      if (user.loginAttempts > 0) {
        await user.resetLoginAttempts();
      }

      // Update last active timestamp
      user.lastActive = new Date();
      await user.save();

      // Generate JWT token
      const token = generateToken(user._id);

      // Check if email is verified
      const emailVerified = user.verification?.emailVerified || false;

      // Return success response
      res.json({
        success: true,
        message: "Login successful",
        token,
        user: user.toSafeObject(),
        emailVerified,
        ...(emailVerified
          ? {}
          : {
              warning:
                "Please verify your email address for the best experience",
            }),
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during login",
      });
    }
  }
);

// @route   GET /api/auth/profile
// @desc    Get current user profile
// @access  Private
router.get("/profile", authenticate, async (req, res) => {
  try {
    res.json({
      success: true,
      user: req.user.toSafeObject(),
    });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching profile",
    });
  }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put(
  "/profile",
  authenticate,
  [
    body("firstName")
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("First name must be less than 50 characters"),
    body("lastName")
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("Last name must be less than 50 characters"),
    body("bio")
      .optional()
      .isLength({ max: 500 })
      .withMessage("Bio must be less than 500 characters"),
  ],
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const allowedUpdates = ["firstName", "lastName", "bio"];
      const updates = {};

      // Only include allowed fields
      Object.keys(req.body).forEach((key) => {
        if (allowedUpdates.includes(key)) {
          updates[key] = req.body[key];
        }
      });

      // Update user
      const user = await User.findByIdAndUpdate(req.user._id, updates, {
        new: true,
        runValidators: true,
      });

      res.json({
        success: true,
        message: "Profile updated successfully",
        user: user.toSafeObject(),
      });
    } catch (error) {
      console.error("Profile update error:", error);
      res.status(500).json({
        success: false,
        message: "Server error updating profile",
      });
    }
  }
);

// @route   POST /api/auth/change-password
// @desc    Change user password
// @access  Private
router.post(
  "/change-password",
  authenticate,
  [
    body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    body("newPassword")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters long"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { currentPassword, newPassword } = req.body;

      // Get user with password
      const user = await User.findById(req.user._id).select("+password");

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Verify current password
      const isCurrentPasswordValid = await user.comparePassword(
        currentPassword
      );
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          success: false,
          message: "Current password is incorrect",
        });
      }

      // Update password
      user.password = newPassword; // Will be hashed by pre-save middleware
      await user.save();

      console.log(`🔐 Password changed for user: ${user.email}`);

      res.json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({
        success: false,
        message: "Server error changing password",
      });
    }
  }
);

// @route   POST /api/auth/logout
// @desc    Logout user (clear device tokens)
// @access  Private
router.post("/logout", authenticate, async (req, res) => {
  try {
    const { deviceToken } = req.body;

    if (deviceToken) {
      // Remove specific device token
      await User.findByIdAndUpdate(req.user._id, {
        $pull: { deviceTokens: { token: deviceToken } },
      });
    }

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during logout",
    });
  }
});

// @route   GET /api/auth/email-status
// @desc    Get email verification status
// @access  Private
router.get("/email-status", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "email verification emailVerificationExpires"
    );

    res.json({
      success: true,
      email: user.email,
      verified: user.verification?.emailVerified || false,
      canResend:
        !user.emailVerificationExpires ||
        user.emailVerificationExpires < new Date(),
    });
  } catch (error) {
    console.error("Email status error:", error);
    res.status(500).json({
      success: false,
      message: "Server error checking email status",
    });
  }
});

module.exports = router;
