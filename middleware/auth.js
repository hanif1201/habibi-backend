// middleware/auth.js - FIXED VERSION
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Enhanced middleware to authenticate JWT token
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.header("Authorization");

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No token provided, authorization denied",
        code: "NO_TOKEN",
      });
    }

    // Check if token starts with 'Bearer '
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Invalid token format",
        code: "INVALID_FORMAT",
      });
    }

    // Extract token
    const token = authHeader.substring(7);

    if (!token || token === "null" || token === "undefined") {
      return res.status(401).json({
        success: false,
        message: "No token provided, authorization denied",
        code: "NO_TOKEN",
      });
    }

    // Verify token with enhanced error handling
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key");
    } catch (jwtError) {
      console.error("JWT verification error:", jwtError.message);

      if (jwtError.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Token expired",
          code: "TOKEN_EXPIRED",
          expiredAt: jwtError.expiredAt,
        });
      }

      if (jwtError.name === "JsonWebTokenError") {
        return res.status(401).json({
          success: false,
          message: "Invalid token",
          code: "INVALID_TOKEN",
        });
      }

      return res.status(401).json({
        success: false,
        message: "Token verification failed",
        code: "VERIFICATION_FAILED",
      });
    }

    // Get user from database with error handling
    let user;
    try {
      user = await User.findById(decoded.userId).select("-password");
    } catch (dbError) {
      console.error("Database error in auth middleware:", dbError);
      return res.status(500).json({
        success: false,
        message: "Database error during authentication",
        code: "DATABASE_ERROR",
      });
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Token is not valid - user not found",
        code: "USER_NOT_FOUND",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Account is deactivated",
        code: "ACCOUNT_DEACTIVATED",
      });
    }

    // Check if account is locked
    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: "Account is temporarily locked",
        code: "ACCOUNT_LOCKED",
        lockUntil: user.lockUntil,
      });
    }

    // Add user to request and update last active
    req.user = user;

    // Update last active timestamp (non-blocking)
    User.findByIdAndUpdate(user._id, {
      lastActive: new Date(),
    }).catch((err) => {
      console.error("Error updating lastActive:", err);
    });

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during authentication",
      code: "SERVER_ERROR",
    });
  }
};

// Generate JWT token with enhanced options
const generateToken = (userId, options = {}) => {
  const payload = { userId };
  const defaultOptions = {
    expiresIn: "7d",
    issuer: "habibi-app",
    audience: "habibi-users",
  };

  const tokenOptions = { ...defaultOptions, ...options };

  return jwt.sign(
    payload,
    process.env.JWT_SECRET || "your-secret-key",
    tokenOptions
  );
};

// Refresh token functionality
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId, type: "refresh" },
    process.env.JWT_REFRESH_SECRET || "your-refresh-secret",
    { expiresIn: "30d" }
  );
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET || "your-refresh-secret"
    );
    if (decoded.type !== "refresh") {
      throw new Error("Invalid token type");
    }
    return decoded;
  } catch (error) {
    throw error;
  }
};

// Optional middleware for routes that work with or without auth
const optionalAuth = async (req, res, next) => {
  const authHeader = req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    );
    const user = await User.findById(decoded.userId).select("-password");

    if (user && user.isActive && !user.isLocked) {
      req.user = user;
    } else {
      req.user = null;
    }
  } catch (error) {
    req.user = null;
  }

  next();
};

module.exports = {
  authenticate,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken,
  optionalAuth,
};
