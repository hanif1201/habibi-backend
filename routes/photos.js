const express = require("express");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();

// Configure Cloudinary with better error handling
const configureCloudinary = () => {
  try {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      console.error("❌ Missing Cloudinary configuration");
      throw new Error("Cloudinary configuration missing");
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });

    console.log("✅ Cloudinary configured successfully");
    return true;
  } catch (error) {
    console.error("❌ Cloudinary configuration error:", error);
    return false;
  }
};

// Initialize Cloudinary
const cloudinaryConfigured = configureCloudinary();

// Fallback storage for when Cloudinary is not available
const localStorage = multer.memoryStorage();

// Configure Cloudinary storage with error handling
let storage;
if (cloudinaryConfigured) {
  try {
    storage = new CloudinaryStorage({
      cloudinary: cloudinary,
      params: {
        folder: "habibi/users",
        allowed_formats: ["jpg", "jpeg", "png", "webp"],
        transformation: [
          { width: 800, height: 800, crop: "fill", quality: "auto:good" },
          { flags: "progressive" },
        ],
        public_id: (req, file) => {
          return `user_${req.user._id}_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 15)}`;
        },
      },
    });
    console.log("✅ CloudinaryStorage configured");
  } catch (error) {
    console.error("❌ CloudinaryStorage error:", error);
    storage = localStorage;
  }
} else {
  storage = localStorage;
}

// File filter to validate image types
const fileFilter = (req, file, cb) => {
  console.log("🔍 File filter check:", file.mimetype);

  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed"), false);
  }
};

// Multer configuration with better error handling
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 1,
  },
  onError: (err, next) => {
    console.error("❌ Multer error:", err);
    next(err);
  },
});

// Alternative upload function for when Cloudinary is not available
const uploadToCloudinaryManually = async (buffer, filename, userId) => {
  try {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "habibi/users",
          public_id: `user_${userId}_${Date.now()}_${Math.random()
            .toString(36)
            .substring(2, 15)}`,
          transformation: [
            { width: 800, height: 800, crop: "fill", quality: "auto:good" },
            { flags: "progressive" },
          ],
          resource_type: "image",
        },
        (error, result) => {
          if (error) {
            console.error("❌ Cloudinary upload error:", error);
            reject(error);
          } else {
            console.log("✅ Cloudinary upload success:", result.public_id);
            resolve(result);
          }
        }
      );

      uploadStream.end(buffer);
    });
  } catch (error) {
    console.error("❌ Manual Cloudinary upload error:", error);
    throw error;
  }
};

// @route   POST /api/photos/upload
// @desc    Upload a new photo with enhanced error handling
// @access  Private
router.post("/upload", authenticate, (req, res) => {
  console.log("📤 Photo upload request received");
  console.log("👤 User ID:", req.user._id);
  console.log("🔧 Cloudinary configured:", cloudinaryConfigured);

  // Check if Cloudinary is configured
  if (!cloudinaryConfigured) {
    return res.status(500).json({
      success: false,
      message: "Photo upload service is not properly configured",
      error: "CLOUDINARY_NOT_CONFIGURED",
      details: {
        missingEnvVars: [
          !process.env.CLOUDINARY_CLOUD_NAME && "CLOUDINARY_CLOUD_NAME",
          !process.env.CLOUDINARY_API_KEY && "CLOUDINARY_API_KEY",
          !process.env.CLOUDINARY_API_SECRET && "CLOUDINARY_API_SECRET",
        ].filter(Boolean),
      },
    });
  }

  // Use multer middleware with error handling
  upload.single("photo")(req, res, async (err) => {
    try {
      console.log("📋 Processing upload...");

      // Handle multer errors
      if (err) {
        console.error("❌ Multer error:", err);

        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({
              success: false,
              message: "File too large. Maximum size is 5MB.",
              error: "FILE_TOO_LARGE",
            });
          }
          if (err.code === "LIMIT_FILE_COUNT") {
            return res.status(400).json({
              success: false,
              message: "Too many files. Only one file allowed.",
              error: "TOO_MANY_FILES",
            });
          }
        }

        if (err.message === "Only image files are allowed") {
          return res.status(400).json({
            success: false,
            message: "Only image files (JPG, JPEG, PNG, WEBP) are allowed.",
            error: "INVALID_FILE_TYPE",
          });
        }

        return res.status(500).json({
          success: false,
          message: "Error processing file upload",
          error: "UPLOAD_PROCESSING_ERROR",
          details: { message: err.message },
        });
      }

      // Check if file was uploaded
      if (!req.file) {
        console.log("❌ No file provided");
        return res.status(400).json({
          success: false,
          message: "No image file provided",
          error: "NO_FILE_PROVIDED",
        });
      }

      console.log("📁 File received:", {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        hasPath: !!req.file.path,
        hasBuffer: !!req.file.buffer,
      });

      // Get user from database
      const user = await User.findById(req.user._id);
      if (!user) {
        console.log("❌ User not found");
        return res.status(404).json({
          success: false,
          message: "User not found",
          error: "USER_NOT_FOUND",
        });
      }

      // Check if user already has maximum photos (6)
      if (user.photos.length >= 6) {
        console.log("❌ Photo limit reached");

        // Delete the uploaded file from Cloudinary if it was uploaded
        if (req.file.public_id) {
          try {
            await cloudinary.uploader.destroy(req.file.public_id);
            console.log("🗑️ Deleted rejected file from Cloudinary");
          } catch (deleteError) {
            console.error("❌ Error deleting rejected file:", deleteError);
          }
        }

        return res.status(400).json({
          success: false,
          message:
            "Maximum of 6 photos allowed. Please delete some photos first.",
          error: "PHOTO_LIMIT_EXCEEDED",
        });
      }

      let uploadResult;

      // Debug: Log the entire file object
      console.log("🔍 Full file object:", JSON.stringify(req.file, null, 2));

      // Handle upload result - check multiple possible properties
      if (req.file.path && req.file.filename) {
        // Cloudinary storage was used successfully (path + filename as public_id)
        console.log(
          "✅ Cloudinary storage upload successful (path + filename)"
        );
        uploadResult = {
          url: req.file.path,
          public_id: req.file.filename,
        };
      } else if (req.file.path && req.file.public_id) {
        // Alternative format with explicit public_id
        console.log(
          "✅ Cloudinary storage upload successful (path + public_id)"
        );
        uploadResult = {
          url: req.file.path,
          public_id: req.file.public_id,
        };
      } else if (req.file.secure_url && req.file.public_id) {
        // Alternative Cloudinary storage format
        console.log(
          "✅ Cloudinary storage upload successful (secure_url + public_id)"
        );
        uploadResult = {
          url: req.file.secure_url,
          public_id: req.file.public_id,
        };
      } else if (req.file.url && req.file.public_id) {
        // Another possible Cloudinary format
        console.log(
          "✅ Cloudinary storage upload successful (url + public_id)"
        );
        uploadResult = {
          url: req.file.url,
          public_id: req.file.public_id,
        };
      } else if (req.file.buffer) {
        // Manual Cloudinary upload needed
        console.log("🔄 Attempting manual Cloudinary upload");
        try {
          const cloudinaryResult = await uploadToCloudinaryManually(
            req.file.buffer,
            req.file.originalname,
            req.user._id
          );
          uploadResult = {
            url: cloudinaryResult.secure_url,
            public_id: cloudinaryResult.public_id,
          };
          console.log("✅ Manual Cloudinary upload successful");
        } catch (cloudinaryError) {
          console.error("❌ Manual Cloudinary upload failed:", cloudinaryError);
          return res.status(500).json({
            success: false,
            message: "Failed to upload image to cloud storage",
            error: "CLOUDINARY_UPLOAD_FAILED",
            details: { message: cloudinaryError.message },
          });
        }
      } else {
        console.error("❌ No valid upload result");
        console.error("File object keys:", Object.keys(req.file));
        return res.status(500).json({
          success: false,
          message: "Upload processing failed - no result data",
          error: "NO_UPLOAD_RESULT",
          debug: {
            fileKeys: Object.keys(req.file),
            hasPath: !!req.file.path,
            hasPublicId: !!req.file.public_id,
            hasSecureUrl: !!req.file.secure_url,
            hasUrl: !!req.file.url,
            hasBuffer: !!req.file.buffer,
          },
        });
      }

      // Create photo object
      const newPhoto = {
        url: uploadResult.url,
        public_id: uploadResult.public_id,
        isPrimary: user.photos.length === 0, // First photo is automatically primary
        uploadedAt: new Date(),
      };

      console.log("📷 Creating photo object:", {
        url: newPhoto.url ? "✅" : "❌",
        public_id: newPhoto.public_id ? "✅" : "❌",
        isPrimary: newPhoto.isPrimary,
      });

      // Add photo to user's photos array
      user.photos.push(newPhoto);
      await user.save();

      console.log("✅ Photo saved to user profile");
      console.log("📊 User now has", user.photos.length, "photos");

      res.json({
        success: true,
        message: "Photo uploaded successfully",
        photo: newPhoto,
        user: user.toSafeObject(),
      });
    } catch (error) {
      console.error("❌ Photo upload error:", error);

      // Clean up uploaded file if there's an error
      if (req.file) {
        if (req.file.public_id) {
          try {
            await cloudinary.uploader.destroy(req.file.public_id);
            console.log("🗑️ Cleaned up uploaded file after error");
          } catch (cleanupError) {
            console.error("❌ Error cleaning up uploaded file:", cleanupError);
          }
        }
      }

      // Send detailed error response
      res.status(500).json({
        success: false,
        message: "Internal server error during photo upload",
        error: "SERVER_ERROR",
        details: {
          message: error.message,
          stack:
            process.env.NODE_ENV === "development" ? error.stack : undefined,
        },
      });
    }
  });
});

// @route   GET /api/photos/test-cloudinary
// @desc    Test Cloudinary configuration
// @access  Private
router.get("/test-cloudinary", authenticate, async (req, res) => {
  try {
    console.log("🧪 Testing Cloudinary configuration...");

    // Test configuration
    const config = {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME ? "✅ Set" : "❌ Missing",
      api_key: process.env.CLOUDINARY_API_KEY ? "✅ Set" : "❌ Missing",
      api_secret: process.env.CLOUDINARY_API_SECRET ? "✅ Set" : "❌ Missing",
    };

    // Test connection
    if (cloudinaryConfigured) {
      try {
        const result = await cloudinary.api.ping();
        res.json({
          success: true,
          message: "Cloudinary is properly configured and accessible",
          config,
          ping: result,
          status: "READY",
        });
      } catch (pingError) {
        res.status(500).json({
          success: false,
          message: "Cloudinary configuration found but connection failed",
          config,
          error: pingError.message,
          status: "CONFIG_ERROR",
        });
      }
    } else {
      res.status(500).json({
        success: false,
        message: "Cloudinary is not properly configured",
        config,
        status: "NOT_CONFIGURED",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error testing Cloudinary configuration",
      error: error.message,
      status: "TEST_ERROR",
    });
  }
});

// @route   DELETE /api/photos/:photoId
// @desc    Delete a photo with enhanced error handling
// @access  Private
router.delete("/:photoId", authenticate, async (req, res) => {
  try {
    console.log("🗑️ Photo deletion request:", req.params.photoId);

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
    console.log("📷 Found photo to delete:", photo.public_id);

    // Delete from Cloudinary if configured
    if (cloudinaryConfigured && photo.public_id) {
      try {
        const result = await cloudinary.uploader.destroy(photo.public_id);
        console.log("☁️ Cloudinary deletion result:", result);
      } catch (cloudinaryError) {
        console.error("❌ Error deleting from Cloudinary:", cloudinaryError);
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

    console.log("✅ Photo deleted successfully");

    res.json({
      success: true,
      message: "Photo deleted successfully",
      user: user.toSafeObject(),
    });
  } catch (error) {
    console.error("❌ Photo deletion error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting photo",
      error: "DELETE_ERROR",
      details: { message: error.message },
    });
  }
});

// @route   PUT /api/photos/:photoId/primary
// @desc    Set a photo as primary with enhanced error handling
// @access  Private
router.put("/:photoId/primary", authenticate, async (req, res) => {
  try {
    console.log("⭐ Set primary photo request:", req.params.photoId);

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

    console.log("✅ Primary photo updated successfully");

    res.json({
      success: true,
      message: "Primary photo updated successfully",
      user: user.toSafeObject(),
    });
  } catch (error) {
    console.error("❌ Set primary photo error:", error);
    res.status(500).json({
      success: false,
      message: "Error setting primary photo",
      error: "SET_PRIMARY_ERROR",
      details: { message: error.message },
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
      cloudinaryConfigured: cloudinaryConfigured,
    });
  } catch (error) {
    console.error("❌ Get photos error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching photos",
      error: "FETCH_ERROR",
      details: { message: error.message },
    });
  }
});

module.exports = router;
