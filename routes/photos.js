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

// Test Cloudinary configuration
const testCloudinaryConnection = async () => {
  try {
    await cloudinary.api.ping();
    console.log("✅ Cloudinary connection successful");
    return true;
  } catch (error) {
    console.error("❌ Cloudinary connection failed:", error.message);
    return false;
  }
};

// Initialize Cloudinary connection test
testCloudinaryConnection();

// Configure Cloudinary storage for multer with error handling
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    try {
      // Validate file type
      const allowedFormats = ["jpg", "jpeg", "png", "webp"];
      const fileExtension = file.originalname.split(".").pop().toLowerCase();

      if (!allowedFormats.includes(fileExtension)) {
        throw new Error(
          `Invalid file format. Allowed: ${allowedFormats.join(", ")}`
        );
      }

      return {
        folder: "habibi/users",
        allowed_formats: allowedFormats,
        transformation: [
          { width: 800, height: 800, crop: "fill", quality: "auto:good" },
          { flags: "progressive" },
        ],
        public_id: `user_${req.user._id}_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 15)}`,
        resource_type: "image",
      };
    } catch (error) {
      console.error("Cloudinary storage params error:", error);
      throw error;
    }
  },
});

// File filter to validate image types
const fileFilter = (req, file, cb) => {
  console.log("File filter - MIME type:", file.mimetype);
  console.log("File filter - Original name:", file.originalname);

  // Check MIME type
  if (file.mimetype.startsWith("image/")) {
    // Additional check for allowed extensions
    const allowedExtensions = ["jpg", "jpeg", "png", "webp"];
    const fileExtension = file.originalname.split(".").pop().toLowerCase();

    if (allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `Invalid file extension. Allowed: ${allowedExtensions.join(", ")}`
        ),
        false
      );
    }
  } else {
    cb(new Error("Only image files are allowed"), false);
  }
};

// Multer configuration with enhanced error handling
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1, // Only allow 1 file at a time
  },
});

// @route   POST /api/photos/upload
// @desc    Upload a new photo with enhanced error handling
// @access  Private
router.post("/upload", authenticate, (req, res) => {
  // Check Cloudinary environment variables first
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    console.error("❌ Missing Cloudinary environment variables");
    return res.status(500).json({
      success: false,
      message: "Server configuration error: Missing Cloudinary credentials",
      error: "CLOUDINARY_CONFIG_MISSING",
    });
  }

  console.log("📸 Starting photo upload for user:", req.user._id);
  console.log("📋 Cloudinary config check:");
  console.log(
    "  - Cloud Name:",
    process.env.CLOUDINARY_CLOUD_NAME ? "✅ Set" : "❌ Missing"
  );
  console.log(
    "  - API Key:",
    process.env.CLOUDINARY_API_KEY ? "✅ Set" : "❌ Missing"
  );
  console.log(
    "  - API Secret:",
    process.env.CLOUDINARY_API_SECRET ? "✅ Set" : "❌ Missing"
  );

  // Use multer middleware with comprehensive error handling
  upload.single("photo")(req, res, async (err) => {
    try {
      // Handle multer-specific errors
      if (err) {
        console.error("❌ Multer error:", err);

        if (err instanceof multer.MulterError) {
          switch (err.code) {
            case "LIMIT_FILE_SIZE":
              return res.status(400).json({
                success: false,
                message: "File too large. Maximum size is 5MB.",
                error: "FILE_TOO_LARGE",
              });
            case "LIMIT_FILE_COUNT":
              return res.status(400).json({
                success: false,
                message: "Too many files. Only 1 file allowed.",
                error: "TOO_MANY_FILES",
              });
            case "LIMIT_UNEXPECTED_FILE":
              return res.status(400).json({
                success: false,
                message: "Unexpected field name. Use 'photo' as field name.",
                error: "UNEXPECTED_FIELD",
              });
            default:
              return res.status(400).json({
                success: false,
                message: `Upload error: ${err.message}`,
                error: "MULTER_ERROR",
              });
          }
        }

        // Handle custom file filter errors
        if (
          err.message.includes("Invalid file") ||
          err.message.includes("Only image files")
        ) {
          return res.status(400).json({
            success: false,
            message: err.message,
            error: "INVALID_FILE_TYPE",
          });
        }

        // Handle Cloudinary errors
        if (err.message.includes("Invalid file format")) {
          return res.status(400).json({
            success: false,
            message: err.message,
            error: "INVALID_FILE_FORMAT",
          });
        }

        // Handle other errors
        return res.status(500).json({
          success: false,
          message: `Upload failed: ${err.message}`,
          error: "UPLOAD_ERROR",
          details:
            process.env.NODE_ENV === "development" ? err.stack : undefined,
        });
      }

      // Check if file was uploaded
      if (!req.file) {
        console.log("❌ No file provided in request");
        return res.status(400).json({
          success: false,
          message: "No image file provided. Please select a file to upload.",
          error: "NO_FILE",
        });
      }

      console.log("📁 File received:", {
        filename: req.file.filename,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path,
        public_id: req.file.public_id,
      });

      // Get user from database
      const user = await User.findById(req.user._id);
      if (!user) {
        // Clean up uploaded file if user not found
        if (req.file.public_id) {
          try {
            await cloudinary.uploader.destroy(req.file.public_id);
          } catch (cleanupError) {
            console.error(
              "Error cleaning up file after user not found:",
              cleanupError
            );
          }
        }

        return res.status(404).json({
          success: false,
          message: "User not found",
          error: "USER_NOT_FOUND",
        });
      }

      // Check if user already has maximum photos (6)
      if (user.photos.length >= 6) {
        // Delete the uploaded file from Cloudinary since we're rejecting it
        if (req.file.public_id) {
          try {
            await cloudinary.uploader.destroy(req.file.public_id);
            console.log("🗑️ Cleaned up rejected file due to photo limit");
          } catch (cleanupError) {
            console.error("Error cleaning up rejected file:", cleanupError);
          }
        }

        return res.status(400).json({
          success: false,
          message:
            "Maximum of 6 photos allowed. Please delete some photos first.",
          error: "PHOTO_LIMIT_EXCEEDED",
        });
      }

      // Create photo object
      const newPhoto = {
        url: req.file.path,
        public_id: req.file.public_id,
        isPrimary: user.photos.length === 0, // First photo is automatically primary
      };

      console.log("💾 Adding photo to user profile:", newPhoto);

      // Add photo to user's photos array
      user.photos.push(newPhoto);
      await user.save();

      console.log("✅ Photo uploaded successfully");

      res.json({
        success: true,
        message: "Photo uploaded successfully",
        photo: newPhoto,
        user: user.toSafeObject(),
      });
    } catch (error) {
      console.error("❌ Photo upload error:", error);

      // Clean up uploaded file if there's an error
      if (req.file && req.file.public_id) {
        try {
          await cloudinary.uploader.destroy(req.file.public_id);
          console.log("🗑️ Cleaned up file after error");
        } catch (cleanupError) {
          console.error("Error cleaning up uploaded file:", cleanupError);
        }
      }

      // Send detailed error response
      res.status(500).json({
        success: false,
        message: "Internal server error during photo upload",
        error: "SERVER_ERROR",
        details:
          process.env.NODE_ENV === "development"
            ? {
                message: error.message,
                stack: error.stack,
                cloudinaryConfig: {
                  cloudName: !!process.env.CLOUDINARY_CLOUD_NAME,
                  apiKey: !!process.env.CLOUDINARY_API_KEY,
                  apiSecret: !!process.env.CLOUDINARY_API_SECRET,
                },
              }
            : undefined,
      });
    }
  });
});

// @route   DELETE /api/photos/:photoId
// @desc    Delete a photo with enhanced error handling
// @access  Private
router.delete("/:photoId", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const photoId = req.params.photoId;

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        error: "USER_NOT_FOUND",
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
        error: "PHOTO_NOT_FOUND",
      });
    }

    const photo = user.photos[photoIndex];
    console.log("🗑️ Deleting photo:", photo.public_id);

    // Delete from Cloudinary
    if (photo.public_id) {
      try {
        const deleteResult = await cloudinary.uploader.destroy(photo.public_id);
        console.log("Cloudinary delete result:", deleteResult);

        if (
          deleteResult.result !== "ok" &&
          deleteResult.result !== "not found"
        ) {
          console.warn("Cloudinary delete warning:", deleteResult);
        }
      } catch (cloudinaryError) {
        console.error("Error deleting from Cloudinary:", cloudinaryError);
        // Continue with database deletion even if Cloudinary deletion fails
      }
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
      message: "Error deleting photo",
      error: "SERVER_ERROR",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// @route   PUT /api/photos/:photoId/primary
// @desc    Set a photo as primary with enhanced error handling
// @access  Private
router.put("/:photoId/primary", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const photoId = req.params.photoId;

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        error: "USER_NOT_FOUND",
      });
    }

    // Find the photo
    const photo = user.photos.find((photo) => photo._id.toString() === photoId);

    if (!photo) {
      return res.status(404).json({
        success: false,
        message: "Photo not found",
        error: "PHOTO_NOT_FOUND",
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
      message: "Error setting primary photo",
      error: "SERVER_ERROR",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
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
        error: "USER_NOT_FOUND",
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
      message: "Error fetching photos",
      error: "SERVER_ERROR",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// @route   GET /api/photos/test-cloudinary
// @desc    Test Cloudinary connection
// @access  Private
router.get("/test-cloudinary", authenticate, async (req, res) => {
  try {
    const pingResult = await cloudinary.api.ping();

    res.json({
      success: true,
      message: "Cloudinary connection successful",
      result: pingResult,
      config: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME || "NOT_SET",
        apiKey: process.env.CLOUDINARY_API_KEY ? "SET" : "NOT_SET",
        apiSecret: process.env.CLOUDINARY_API_SECRET ? "SET" : "NOT_SET",
      },
    });
  } catch (error) {
    console.error("Cloudinary test error:", error);
    res.status(500).json({
      success: false,
      message: "Cloudinary connection failed",
      error: error.message,
      config: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME || "NOT_SET",
        apiKey: process.env.CLOUDINARY_API_KEY ? "SET" : "NOT_SET",
        apiSecret: process.env.CLOUDINARY_API_SECRET ? "SET" : "NOT_SET",
      },
    });
  }
});

module.exports = router;
