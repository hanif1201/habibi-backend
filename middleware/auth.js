const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Middleware to authenticate JWT token (ENHANCED)
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
        message: "Invalid token format. Expected 'Bearer <token>'",
        code: "INVALID_FORMAT",
      });
    }

    // Extract token
    const token = authHeader.substring(7);

    if (!token || token.trim() === "") {
      return res.status(401).json({
        success: false,
        message: "No token provided, authorization denied",
        code: "EMPTY_TOKEN",
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key");
    } catch (jwtError) {
      console.error("JWT verification error:", jwtError.message);

      if (jwtError.name === "JsonWebTokenError") {
        return res.status(401).json({
          success: false,
          message: "Invalid token",
          code: "INVALID_TOKEN",
        });
      }

      if (jwtError.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Token expired",
          code: "TOKEN_EXPIRED",
        });
      }

      return res.status(401).json({
        success: false,
        message: "Token verification failed",
        code: "VERIFICATION_FAILED",
      });
    }

    if (!decoded.userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
        code: "INVALID_PAYLOAD",
      });
    }

    // Get user from database
    const user = await User.findById(decoded.userId).select("-password");

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

    // Add user to request
    req.user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);

    // Handle specific error types
    if (error.name === "CastError" && error.path === "_id") {
      return res.status(401).json({
        success: false,
        message: "Invalid user ID in token",
        code: "INVALID_USER_ID",
      });
    }

    res.status(500).json({
      success: false,
      message: "Server error during authentication",
      code: "SERVER_ERROR",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Generate JWT token (ENHANCED)
const generateToken = (userId, expiresIn = "7d") => {
  if (!userId) {
    throw new Error("User ID is required to generate token");
  }

  const payload = {
    userId: userId.toString(),
    iat: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(payload, process.env.JWT_SECRET || "your-secret-key", {
    expiresIn,
  });
};

// Middleware to check if user is admin (for future use)
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    next();
  } catch (error) {
    console.error("Admin middleware error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during admin check",
    });
  }
};

// Optional authentication - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);

    if (!token || token.trim() === "") {
      req.user = null;
      return next();
    }

    try {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "your-secret-key"
      );
      const user = await User.findById(decoded.userId).select("-password");

      if (user && user.isActive) {
        req.user = user;
      } else {
        req.user = null;
      }
    } catch (jwtError) {
      req.user = null;
    }

    next();
  } catch (error) {
    console.error("Optional auth error:", error);
    req.user = null;
    next();
  }
};

module.exports = {
  authenticate,
  generateToken,
  requireAdmin,
  optionalAuth,
};
