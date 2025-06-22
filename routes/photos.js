const express = require("express");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Cloudinary storage for multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "habibi/users",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      { width: 800, height: 800, crop: "fill", quality: "auto:good" },
      { flags: "progressive" },
    ],
    public_id: (req, file) => {
      // Generate unique filename
      return `user_${req.user._id}_${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 15)}`;
    },
  },
});

// File filter to validate image types
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed"), false);
  }
};

// Multer configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// @route   POST /api/photos/upload
// @desc    Upload a new photo
// @access  Private
router.post("/upload", authenticate, (req, res) => {
  // Use multer middleware
  upload.single("photo")(req, res, async (err) => {
    try {
      // Handle multer errors
      if (err) {
        console.error("Multer error:", err);

        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
              success: false,
              message: "File too large. Maximum size is 5MB.",
            });
          }
        }

        if (err.message === "Only image files are allowed") {
          return res.status(400).json({
            success: false,
            message: "Only image files (JPG, JPEG, PNG, WEBP) are allowed.",
          });
        }

        return res.status(500).json({
          success: false,
          message: "Error uploading file: " + err.message,
        });
      }

      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No image file provided",
        });
      }

      // Get user from database
      const user = await User.findById(req.user._id);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if user already has maximum photos (6)
      if (user.photos.length >= 6) {
        // Delete the uploaded file from Cloudinary since we're rejecting it
        try {
          await cloudinary.uploader.destroy(req.file.public_id);
        } catch (deleteError) {
          console.error("Error deleting rejected file:", deleteError);
        }

        return res.status(400).json({
          success: false,
          message:
            "Maximum of 6 photos allowed. Please delete some photos first.",
        });
      }

      // Create photo object
      const newPhoto = {
        url: req.file.path,
        public_id: req.file.public_id,
        isPrimary: user.photos.length === 0, // First photo is automatically primary
      };

      // Add photo to user's photos array
      user.photos.push(newPhoto);
      await user.save();

      res.json({
        success: true,
        message: "Photo uploaded successfully",
        photo: newPhoto,
        user: user.toSafeObject(),
      });
    } catch (error) {
      console.error("Photo upload error:", error);

      // Clean up uploaded file if there's an error
      if (req.file && req.file.public_id) {
        try {
          await cloudinary.uploader.destroy(req.file.public_id);
        } catch (cleanupError) {
          console.error("Error cleaning up uploaded file:", cleanupError);
        }
      }

      res.status(500).json({
        success: false,
        message: "Error uploading photo: " + error.message,
      });
    }
  });
});

// @route   DELETE /api/photos/:photoId
// @desc    Delete a photo
// @access  Private
router.delete("/:photoId", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const photoId = req.params.photoId;

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Find the photo
    const photoIndex = user.photos.findIndex(
      (photo) => photo._id.toString() === photoId
    );

    if (photoIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Photo not found",
      });
    }

    const photo = user.photos[photoIndex];

    // Delete from Cloudinary
    try {
      await cloudinary.uploader.destroy(photo.public_id);
    } catch (cloudinaryError) {
      console.error("Error deleting from Cloudinary:", cloudinaryError);
      // Continue with database deletion even if Cloudinary deletion fails
    }

    // If this was the primary photo, set a new primary
    const wasPrimary = photo.isPrimary;

    // Remove photo from array
    user.photos.splice(photoIndex, 1);

    // If deleted photo was primary and there are other photos, set first one as primary
    if (wasPrimary && user.photos.length > 0) {
      user.photos[0].isPrimary = true;
    }

    await user.save();

    res.json({
      success: true,
      message: "Photo deleted successfully",
      user: user.toSafeObject(),
    });
  } catch (error) {
    console.error("Photo deletion error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting photo: " + error.message,
    });
  }
});

// @route   PUT /api/photos/:photoId/primary
// @desc    Set a photo as primary
// @access  Private
router.put("/:photoId/primary", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const photoId = req.params.photoId;

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Find the photo
    const photo = user.photos.find((photo) => photo._id.toString() === photoId);

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: "Photo not found",
      });
    }

    // Remove primary status from all photos
    user.photos.forEach((p) => (p.isPrimary = false));

    // Set the selected photo as primary
    photo.isPrimary = true;

    await user.save();

    res.json({
      success: true,
      message: "Primary photo updated successfully",
      user: user.toSafeObject(),
    });
  } catch (error) {
    console.error("Set primary photo error:", error);
    res.status(500).json({
      success: false,
      message: "Error setting primary photo: " + error.message,
    });
  }
});

// @route   GET /api/photos
// @desc    Get user's photos
// @access  Private
router.get("/", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("photos");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      photos: user.photos,
    });
  } catch (error) {
    console.error("Get photos error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching photos: " + error.message,
    });
  }
});

module.exports = router;
