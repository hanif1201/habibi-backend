const express = require("express");
const { v2: cloudinary } = require("cloudinary");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// @route   GET /api/debug/cloudinary
// @desc    Test Cloudinary configuration
// @access  Private
router.get("/cloudinary", authenticate, async (req, res) => {
  try {
    // Check environment variables
    const config = {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET ? "SET" : "NOT SET",
    };

    // Test Cloudinary connection
    try {
      const result = await cloudinary.api.ping();
      res.json({
        success: true,
        config: config,
        cloudinary_test: result,
        message: "Cloudinary configuration is working",
      });
    } catch (cloudinaryError) {
      res.status(500).json({
        success: false,
        config: config,
        cloudinary_error: cloudinaryError.message,
        message: "Cloudinary configuration failed",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error testing configuration",
      error: error.message,
    });
  }
});

// @route   GET /api/debug/env
// @desc    Check environment variables (without exposing secrets)
// @access  Private
router.get("/env", authenticate, (req, res) => {
  const envCheck = {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    MONGODB_URI: process.env.MONGODB_URI ? "SET" : "NOT SET",
    JWT_SECRET: process.env.JWT_SECRET ? "SET" : "NOT SET",
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME
      ? "SET"
      : "NOT SET",
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ? "SET" : "NOT SET",
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET
      ? "SET"
      : "NOT SET",
  };

  res.json({
    success: true,
    environment: envCheck,
  });
});

module.exports = router;
