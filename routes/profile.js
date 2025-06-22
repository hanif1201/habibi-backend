const express = require("express");
const { body, validationResult } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();

// @route   GET /api/profile
// @desc    Get current user's detailed profile
// @access  Private
router.get("/", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    // Calculate profile completion
    const completionData = calculateProfileCompletion(user);

    res.json({
      success: true,
      user: user.toSafeObject(),
      profileCompletion: completionData,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching profile",
    });
  }
});

// @route   PUT /api/profile/basic
// @desc    Update basic profile information
// @access  Private
router.put(
  "/basic",
  authenticate,
  [
    body("firstName")
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("First name must be between 1 and 50 characters"),
    body("lastName")
      .optional()
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage("Last name must be between 1 and 50 characters"),
    body("bio")
      .optional()
      .isLength({ max: 500 })
      .withMessage("Bio must be less than 500 characters"),
    body("dateOfBirth")
      .optional()
      .isISO8601()
      .withMessage("Please enter a valid date of birth"),
    body("gender")
      .optional()
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

      const allowedUpdates = [
        "firstName",
        "lastName",
        "bio",
        "dateOfBirth",
        "gender",
      ];
      const updates = {};

      // Only include allowed fields
      Object.keys(req.body).forEach((key) => {
        if (allowedUpdates.includes(key) && req.body[key] !== undefined) {
          updates[key] = req.body[key];
        }
      });

      // Age validation if dateOfBirth is being updated
      if (updates.dateOfBirth) {
        const birthDate = new Date(updates.dateOfBirth);
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
            message: "You must be at least 18 years old",
          });
        }
      }

      // Update user
      const user = await User.findByIdAndUpdate(req.user._id, updates, {
        new: true,
        runValidators: true,
      });

      // Calculate profile completion
      const completionData = calculateProfileCompletion(user);

      res.json({
        success: true,
        message: "Profile updated successfully",
        user: user.toSafeObject(),
        profileCompletion: completionData,
      });
    } catch (error) {
      console.error("Profile update error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating profile",
      });
    }
  }
);

// @route   PUT /api/profile/preferences
// @desc    Update user preferences
// @access  Private
router.put(
  "/preferences",
  authenticate,
  [
    body("preferences.ageRange.min")
      .optional()
      .isInt({ min: 18, max: 100 })
      .withMessage("Minimum age must be between 18 and 100"),
    body("preferences.ageRange.max")
      .optional()
      .isInt({ min: 18, max: 100 })
      .withMessage("Maximum age must be between 18 and 100"),
    body("preferences.maxDistance")
      .optional()
      .isInt({ min: 1, max: 500 })
      .withMessage("Maximum distance must be between 1 and 500 km"),
    body("preferences.interestedIn")
      .optional()
      .isIn(["male", "female", "both"])
      .withMessage("Interested in must be male, female, or both"),
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

      const { preferences } = req.body;

      // Validate age range
      if (
        preferences.ageRange &&
        preferences.ageRange.min &&
        preferences.ageRange.max &&
        preferences.ageRange.min > preferences.ageRange.max
      ) {
        return res.status(400).json({
          success: false,
          message: "Minimum age cannot be greater than maximum age",
        });
      }

      // Update user preferences
      const user = await User.findByIdAndUpdate(
        req.user._id,
        { preferences },
        { new: true, runValidators: true }
      );

      res.json({
        success: true,
        message: "Preferences updated successfully",
        user: user.toSafeObject(),
      });
    } catch (error) {
      console.error("Preferences update error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating preferences",
      });
    }
  }
);

// @route   PUT /api/profile/location
// @desc    Update user location
// @access  Private
router.put(
  "/location",
  authenticate,
  [
    body("latitude")
      .isFloat({ min: -90, max: 90 })
      .withMessage("Latitude must be between -90 and 90"),
    body("longitude")
      .isFloat({ min: -180, max: 180 })
      .withMessage("Longitude must be between -180 and 180"),
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

      const { latitude, longitude } = req.body;

      // Update user location
      const user = await User.findByIdAndUpdate(
        req.user._id,
        {
          location: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
        },
        { new: true, runValidators: true }
      );

      res.json({
        success: true,
        message: "Location updated successfully",
        user: user.toSafeObject(),
      });
    } catch (error) {
      console.error("Location update error:", error);
      res.status(500).json({
        success: false,
        message: "Error updating location",
      });
    }
  }
);

// @route   DELETE /api/profile
// @desc    Deactivate user account
// @access  Private
router.delete("/", authenticate, async (req, res) => {
  try {
    await User.findByIdAndUpdate(
      req.user._id,
      { isActive: false },
      { new: true }
    );

    res.json({
      success: true,
      message: "Account deactivated successfully",
    });
  } catch (error) {
    console.error("Account deactivation error:", error);
    res.status(500).json({
      success: false,
      message: "Error deactivating account",
    });
  }
});

// Helper function to calculate profile completion
function calculateProfileCompletion(user) {
  const fields = [
    { name: "firstName", weight: 10, completed: !!user.firstName },
    { name: "lastName", weight: 10, completed: !!user.lastName },
    { name: "dateOfBirth", weight: 15, completed: !!user.dateOfBirth },
    { name: "gender", weight: 15, completed: !!user.gender },
    { name: "bio", weight: 20, completed: !!user.bio && user.bio.length > 10 },
    {
      name: "photos",
      weight: 30,
      completed: user.photos && user.photos.length > 0,
    },
  ];

  let completedWeight = 0;
  let totalWeight = 0;
  const missing = [];

  fields.forEach((field) => {
    totalWeight += field.weight;
    if (field.completed) {
      completedWeight += field.weight;
    } else {
      missing.push(field.name);
    }
  });

  const percentage = Math.round((completedWeight / totalWeight) * 100);

  return {
    percentage,
    completed: percentage === 100,
    missing,
    fields: fields.map((f) => ({
      name: f.name,
      completed: f.completed,
      weight: f.weight,
    })),
  };
}

module.exports = router;
