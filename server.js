// ===== server.js - Enhanced Security & Error Handling =====

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const compression = require("compression");
const validator = require("validator");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");

// Load environment variables
dotenv.config();

const app = express();

// ===== ENHANCED SECURITY MIDDLEWARE =====

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", "ws:", "wss:"],
      },
    },
    crossOriginEmbedderPolicy: false, // For socket.io compatibility
  })
);

app.use(compression());

// Data sanitization against NoSQL injection
app.use(mongoSanitize());

// Data sanitization against XSS
app.use(xss());

// Enhanced rate limiting
const createRateLimit = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    message: { success: false, message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      console.log(`Rate limit exceeded for IP: ${req.ip}, Path: ${req.path}`);
      res.status(429).json({
        success: false,
        message,
        retryAfter: Math.round(windowMs / 1000),
      });
    },
  });

// Different rate limits for different endpoints
const generalLimiter = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  100, // requests per window
  "Too many requests from this IP, please try again later."
);

const authLimiter = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  5, // requests per window
  "Too many authentication attempts, please try again later."
);

const uploadLimiter = createRateLimit(
  60 * 60 * 1000, // 1 hour
  10, // requests per window
  "Too many upload attempts, please try again later."
);

const messageLimiter = createRateLimit(
  1 * 60 * 1000, // 1 minute
  30, // requests per window
  "Too many messages sent, please slow down."
);

// Apply rate limiting
app.use("/api/auth", authLimiter);
app.use("/api/photos", uploadLimiter);
app.use("/api/chat", messageLimiter);
app.use("/api/", generalLimiter);

// ===== INPUT VALIDATION MIDDLEWARE =====

const validateInput = (req, res, next) => {
  // Sanitize all string inputs
  const sanitizeObject = (obj) => {
    for (let key in obj) {
      if (typeof obj[key] === "string") {
        // Basic XSS protection
        obj[key] = validator.escape(obj[key].trim());
        // Remove potential script tags
        obj[key] = obj[key].replace(
          /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
          ""
        );
      } else if (typeof obj[key] === "object" && obj[key] !== null) {
        sanitizeObject(obj[key]);
      }
    }
  };

  if (req.body && typeof req.body === "object") {
    sanitizeObject(req.body);
  }

  next();
};

// ===== PASSWORD STRENGTH VALIDATION =====

const validatePassword = (password) => {
  const errors = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (!/\d/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

// ===== ENHANCED ERROR HANDLING =====

class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const value = err.errmsg.match(/(["'])(\\?.)*?\1/)[0];
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 400);
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => el.message);
  const message = `Invalid input data. ${errors.join(". ")}`;
  return new AppError(message, 400);
};

const handleJWTError = () =>
  new AppError("Invalid token. Please log in again!", 401);

const handleJWTExpiredError = () =>
  new AppError("Your token has expired! Please log in again.", 401);

const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    success: false,
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

const sendErrorProd = (err, res) => {
  // Operational errors: send message to client
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  } else {
    // Programming errors: don't leak error details
    console.error("ERROR 💥", err);
    res.status(500).json({
      success: false,
      message: "Something went wrong!",
    });
  }
};

// ===== ENHANCED AUTH MIDDLEWARE =====

const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No valid token provided.",
      });
    }

    const token = authHeader.substring(7);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if user still exists
    const User = require("./models/User");
    const user = await User.findById(decoded.userId).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "The user belonging to this token no longer exists.",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: "Your account has been deactivated. Please contact support.",
      });
    }

    // Check if user changed password after the token was issued
    if (
      user.passwordChangedAt &&
      decoded.iat < user.passwordChangedAt.getTime() / 1000
    ) {
      return res.status(401).json({
        success: false,
        message: "User recently changed password. Please log in again.",
      });
    }

    // Grant access to protected route
    req.user = user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token. Please log in again.",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Your token has expired. Please log in again.",
      });
    }

    res.status(500).json({
      success: false,
      message: "Authentication error occurred.",
    });
  }
};

// ===== ENHANCED MATCHING ALGORITHM =====

// Fix age calculation with timezone handling
const calculateAge = (dateOfBirth) => {
  if (!dateOfBirth) return 0;

  const today = new Date();
  const birth = new Date(dateOfBirth);

  // Use UTC to avoid timezone issues
  const todayUTC = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const birthUTC = new Date(
    birth.getFullYear(),
    birth.getMonth(),
    birth.getDate()
  );

  let age = todayUTC.getFullYear() - birthUTC.getFullYear();
  const monthDiff = todayUTC.getMonth() - birthUTC.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && todayUTC.getDate() < birthUTC.getDate())
  ) {
    age--;
  }
  return age;
};

// Enhanced distance calculation with better precision
const calculateDistance = (coords1, coords2) => {
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;

  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100; // Round to 2 decimal places
};

// ===== ENHANCED SOCKET HANDLER =====

const socketHandler = (io) => {
  console.log("🔌 Enhanced Socket.io handler initialized");

  // Store active connections with better tracking
  const activeConnections = new Map();
  const userSockets = new Map(); // userId -> Set of socketIds
  const typingUsers = new Map(); // matchId -> { userId, userName, timestamp }
  const userRooms = new Map(); // userId -> Set of room names

  // Enhanced middleware for socket authentication
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        console.log("❌ Socket auth failed: No token provided");
        return next(new Error("Authentication error: No token provided"));
      }

      // Verify JWT token with enhanced validation
      const jwt = require("jsonwebtoken");
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user from database
      const User = require("../models/User");
      const user = await User.findById(decoded.userId).select("+safety");

      if (!user || !user.isActive) {
        console.log(
          "❌ Socket auth failed: User not found or inactive:",
          decoded.userId
        );
        return next(new Error("User not found or inactive"));
      }

      // Check for account lockout
      if (user.isLocked) {
        return next(new Error("Account is temporarily locked"));
      }

      // Attach user data to socket
      socket.userId = user._id.toString();
      socket.user = {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        photos: user.photos,
        safety: user.safety,
        settings: user.settings,
      };

      console.log(`✅ Socket authenticated: ${user.firstName} (${user._id})`);
      next();
    } catch (error) {
      console.log("❌ Socket auth error:", error.message);

      if (error.name === "JsonWebTokenError") {
        next(new Error("Invalid token"));
      } else if (error.name === "TokenExpiredError") {
        next(new Error("Token expired"));
      } else {
        next(new Error("Authentication failed"));
      }
    }
  });

  // Connection handling with better cleanup
  io.on("connection", async (socket) => {
    const userId = socket.userId;
    const user = socket.user;

    console.log(`👤 User ${user.firstName} connected: ${socket.id}`);

    try {
      // Track connection
      activeConnections.set(socket.id, {
        userId,
        user,
        connectedAt: new Date(),
        lastActivity: new Date(),
      });

      // Track user sockets (handle multiple tabs/devices)
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(socket.id);

      // Initialize user rooms tracking
      userRooms.set(userId, new Set());

      // Update user's last active timestamp
      const User = require("../models/User");
      await User.findByIdAndUpdate(userId, {
        lastActive: new Date(),
        $inc: { "stats.profileViews": 1 },
      });

      // Join user to their match rooms
      const Match = require("../models/Match");
      const userMatches = await Match.findForUser(userId);

      for (const match of userMatches) {
        const roomName = `match_${match._id}`;
        socket.join(roomName);
        userRooms.get(userId).add(roomName);

        console.log(`🏠 User ${user.firstName} joined room: ${roomName}`);

        // Notify other user in the match that this user is online
        const otherUserId = match.getOtherUser(userId);
        socket.to(roomName).emit("user_online", {
          userId,
          user: { _id: userId, firstName: user.firstName },
          matchId: match._id,
          timestamp: new Date(),
        });
      }

      // Send connection confirmation
      socket.emit("connection_confirmed", {
        message: "Successfully connected to Habibi chat",
        userId,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error("❌ Error during socket connection setup:", error);
      socket.emit("error", { message: "Connection setup failed" });
    }

    // Enhanced message sending with validation and rate limiting
    socket.on("send_message", async (data) => {
      try {
        const { matchId, content, messageType = "text", tempId } = data;

        // Input validation
        if (!matchId || !content?.trim()) {
          socket.emit("error", {
            message: "Match ID and content are required",
            tempId,
          });
          return;
        }

        // Content length validation
        if (content.trim().length > 1000) {
          socket.emit("error", {
            message: "Message too long (max 1000 characters)",
            tempId,
          });
          return;
        }

        // Rate limiting check
        const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
        const Message = require("../models/Message");
        const recentMessageCount = await Message.countDocuments({
          sender: userId,
          match: matchId,
          createdAt: { $gte: oneMinuteAgo },
        });

        if (recentMessageCount >= 10) {
          socket.emit("error", {
            message: "Too many messages sent. Please slow down.",
            code: "RATE_LIMIT_EXCEEDED",
            tempId,
          });
          return;
        }

        // Verify match and user permissions
        const Match = require("../models/Match");
        const match = await Match.findById(matchId).populate(
          "users",
          "firstName lastName safety"
        );

        if (!match || !match.users.find((u) => u._id.toString() === userId)) {
          socket.emit("error", {
            message: "Access denied to this conversation",
            tempId,
          });
          return;
        }

        const otherUser = match.users.find((u) => u._id.toString() !== userId);

        // Check if users have blocked each other
        if (
          user.safety.blockedUsers.includes(otherUser._id) ||
          otherUser.safety.blockedUsers.includes(userId)
        ) {
          socket.emit("error", {
            message: "Cannot send message to this user",
            tempId,
          });
          return;
        }

        // Content filtering
        const filteredContent = content
          .trim()
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/javascript:/gi, "")
          .replace(/on\w+\s*=/gi, "");

        // Create and save message
        const message = new Message({
          match: matchId,
          sender: userId,
          receiver: otherUser._id,
          content: filteredContent,
          messageType,
        });

        await message.save();

        // Update match activity
        const isFirstMessage = !match.firstMessageSentAt;
        if (isFirstMessage) {
          await match.markFirstMessageSent(userId);
        } else {
          match.lastActivity = new Date();
          await match.save();
        }

        // Populate sender info for response
        await message.populate("sender", "firstName lastName photos");

        const formattedMessage = {
          _id: message._id,
          content: message.content,
          sender: {
            _id: message.sender._id,
            firstName: message.sender.firstName,
            lastName: message.sender.lastName,
          },
          createdAt: message.createdAt,
          messageType: message.messageType,
          matchId,
          receiverId: otherUser._id,
          isFirstMessage,
        };

        // Send to all users in the match room
        const roomName = `match_${matchId}`;
        io.to(roomName).emit("new_message", formattedMessage);

        // Clear typing indicator
        if (
          typingUsers.has(matchId) &&
          typingUsers.get(matchId).userId === userId
        ) {
          typingUsers.delete(matchId);
          socket.to(roomName).emit("user_typing", {
            userId,
            userName: user.firstName,
            matchId,
            isTyping: false,
          });
        }

        // Update last activity
        if (activeConnections.has(socket.id)) {
          activeConnections.get(socket.id).lastActivity = new Date();
        }

        // Confirm message sent
        socket.emit("message_sent", {
          tempId,
          messageId: message._id,
          sentAt: message.createdAt,
        });
      } catch (error) {
        console.error("❌ Socket message send error:", error);
        socket.emit("error", {
          message: "Error sending message",
          tempId: data.tempId,
        });
      }
    });

    // Enhanced disconnect handler with proper cleanup
    socket.on("disconnect", async (reason) => {
      console.log(`👋 User ${user.firstName} disconnected: ${reason}`);

      try {
        // Update user's last active timestamp
        await User.findByIdAndUpdate(userId, { lastActive: new Date() });

        // Clean up connection tracking
        activeConnections.delete(socket.id);

        // Remove socket from user's socket set
        if (userSockets.has(userId)) {
          userSockets.get(userId).delete(socket.id);

          // If no more sockets for this user, clean up completely
          if (userSockets.get(userId).size === 0) {
            userSockets.delete(userId);

            // Clean up typing indicators
            for (const [matchId, typingData] of typingUsers.entries()) {
              if (typingData.userId === userId) {
                typingUsers.delete(matchId);
                const roomName = `match_${matchId}`;
                socket.to(roomName).emit("user_typing", {
                  userId,
                  userName: user.firstName,
                  matchId,
                  isTyping: false,
                });
              }
            }

            // Notify matches that user went offline
            const userRoomsList = userRooms.get(userId) || new Set();
            userRoomsList.forEach((roomName) => {
              socket.to(roomName).emit("user_offline", {
                userId,
                user: { _id: userId, firstName: user.firstName },
                lastSeen: new Date(),
                timestamp: new Date(),
              });
            });

            userRooms.delete(userId);
          }
        }
      } catch (error) {
        console.error("❌ Error during disconnect cleanup:", error);
      }
    });

    // Error handling
    socket.on("error", (error) => {
      console.error(`❌ Socket error for user ${user.firstName}:`, error);

      // Log error for monitoring
      if (process.env.NODE_ENV === "production") {
        // Send to error monitoring service (Sentry, etc.)
        console.error("Socket Error:", {
          userId,
          socketId: socket.id,
          error: error.message,
          timestamp: new Date(),
        });
      }
    });

    // Enhanced typing indicators with cleanup
    socket.on("typing_start", (data) => {
      try {
        const { matchId } = data;

        if (!matchId) {
          socket.emit("error", { message: "Match ID is required" });
          return;
        }

        const roomName = `match_${matchId}`;

        // Clear any existing typing timeout for this match
        if (typingUsers.has(matchId)) {
          clearTimeout(typingUsers.get(matchId).timeout);
        }

        // Set new typing status with auto-cleanup
        const typingTimeout = setTimeout(() => {
          typingUsers.delete(matchId);
          socket.to(roomName).emit("user_typing", {
            userId,
            userName: user.firstName,
            matchId,
            isTyping: false,
          });
        }, 3000);

        typingUsers.set(matchId, {
          userId,
          userName: user.firstName,
          timeout: typingTimeout,
          startedAt: new Date(),
        });

        socket.to(roomName).emit("user_typing", {
          userId,
          userName: user.firstName,
          matchId,
          isTyping: true,
        });

        // Update last activity
        if (activeConnections.has(socket.id)) {
          activeConnections.get(socket.id).lastActivity = new Date();
        }
      } catch (error) {
        console.error("❌ Error handling typing start:", error);
      }
    });

    socket.on("typing_stop", (data) => {
      try {
        const { matchId } = data;
        const roomName = `match_${matchId}`;

        // Clear typing status
        if (
          typingUsers.has(matchId) &&
          typingUsers.get(matchId).userId === userId
        ) {
          clearTimeout(typingUsers.get(matchId).timeout);
          typingUsers.delete(matchId);

          socket.to(roomName).emit("user_typing", {
            userId,
            userName: user.firstName,
            matchId,
            isTyping: false,
          });
        }
      } catch (error) {
        console.error("❌ Error handling typing stop:", error);
      }
    });
  });

  // Utility functions for external use with enhanced functionality
  io.getOnlineUsers = () => {
    const onlineUsers = [];
    for (const [socketId, connection] of activeConnections.entries()) {
      onlineUsers.push({
        userId: connection.userId,
        user: connection.user,
        connectedAt: connection.connectedAt,
        lastActivity: connection.lastActivity,
      });
    }
    return onlineUsers;
  };

  io.getOnlineUserCount = () => {
    return new Set(
      Array.from(activeConnections.values()).map((conn) => conn.userId)
    ).size;
  };

  io.isUserOnline = (userId) => {
    return userSockets.has(userId) && userSockets.get(userId).size > 0;
  };

  io.getUserConnectionCount = (userId) => {
    return userSockets.has(userId) ? userSockets.get(userId).size : 0;
  };

  io.sendToUser = (userId, event, data) => {
    if (userSockets.has(userId)) {
      const socketIds = userSockets.get(userId);
      let sent = 0;
      for (const socketId of socketIds) {
        io.to(socketId).emit(event, data);
        sent++;
      }
      return sent > 0;
    }
    return false;
  };

  io.sendToMatch = (matchId, event, data) => {
    io.to(`match_${matchId}`).emit(event, data);
  };

  io.broadcastToAllUsers = (event, data) => {
    io.emit(event, data);
  };

  // Enhanced periodic cleanup with better monitoring
  setInterval(() => {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const thirtySecondsAgo = now - 30 * 1000;

    // Clean up old typing indicators
    for (const [matchId, typingData] of typingUsers.entries()) {
      if (now - typingData.startedAt.getTime() > 10000) {
        clearTimeout(typingData.timeout);
        typingUsers.delete(matchId);
      }
    }

    // Clean up stale connections
    for (const [socketId, connection] of activeConnections.entries()) {
      if (connection.lastActivity.getTime() < fiveMinutesAgo) {
        console.log(
          `🧹 Cleaning up stale connection for user ${connection.userId}`
        );
        activeConnections.delete(socketId);

        // Clean up user socket tracking
        if (userSockets.has(connection.userId)) {
          userSockets.get(connection.userId).delete(socketId);
          if (userSockets.get(connection.userId).size === 0) {
            userSockets.delete(connection.userId);
            userRooms.delete(connection.userId);
          }
        }
      }
    }

    // Log statistics
    const uniqueUsers = new Set(
      Array.from(activeConnections.values()).map((conn) => conn.userId)
    ).size;
    console.log(
      `📊 Socket Stats - Active Connections: ${activeConnections.size}, Unique Users: ${uniqueUsers}, Typing: ${typingUsers.size}`
    );
  }, 60000); // Run every minute

  console.log("✅ Enhanced Socket.io handler setup complete");
};

// ===== ENHANCED DATABASE CONNECTION =====

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/habibi",
      {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        bufferCommands: false,
      }
    );

    console.log(`✅ MongoDB connected: ${conn.connection.host}`);

    // Create indexes for better performance
    await createDatabaseIndexes();

    // Handle connection events
    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.log("⚠️ MongoDB disconnected. Attempting to reconnect...");
    });

    mongoose.connection.on("reconnected", () => {
      console.log("✅ MongoDB reconnected");
    });
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
};

// Create database indexes for performance
const createDatabaseIndexes = async () => {
  try {
    const User = require("./models/User");
    const Match = require("./models/Match");
    const Message = require("./models/Message");
    const Swipe = require("./models/Swipe");

    // User indexes
    await User.collection.createIndex({ email: 1 }, { unique: true });
    await User.collection.createIndex({ location: "2dsphere" });
    await User.collection.createIndex({ isActive: 1, lastActive: -1 });
    await User.collection.createIndex({
      "preferences.interestedIn": 1,
      gender: 1,
    });
    await User.collection.createIndex({ dateOfBirth: 1 });

    // Match indexes
    await Match.collection.createIndex({ users: 1 });
    await Match.collection.createIndex({ status: 1, matchedAt: -1 });
    await Match.collection.createIndex({ expiresAt: 1 });

    // Message indexes
    await Message.collection.createIndex({ match: 1, createdAt: -1 });
    await Message.collection.createIndex({ sender: 1, createdAt: -1 });
    await Message.collection.createIndex({ receiver: 1, readAt: 1 });

    // Swipe indexes
    await Swipe.collection.createIndex(
      { swiper: 1, swiped: 1 },
      { unique: true }
    );
    await Swipe.collection.createIndex({ swiper: 1, action: 1, swipedAt: -1 });

    console.log("✅ Database indexes created successfully");
  } catch (error) {
    console.error("❌ Error creating database indexes:", error);
  }
};

// ===== AUTOMATED CLEANUP JOBS =====

const startCleanupJobs = () => {
  const cron = require("node-cron");

  // Clean up expired matches every hour
  cron.schedule("0 * * * *", async () => {
    try {
      const Match = require("./models/Match");
      const expiredCount = await Match.expireOldMatches();
      console.log(`🧹 Expired ${expiredCount} old matches`);
    } catch (error) {
      console.error("❌ Error in match cleanup job:", error);
    }
  });

  // Clean up old messages (older than 1 year) every day at 2 AM
  cron.schedule("0 2 * * *", async () => {
    try {
      const Message = require("./models/Message");
      const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

      const result = await Message.deleteMany({
        createdAt: { $lt: oneYearAgo },
        isDeleted: true,
      });

      console.log(`🧹 Cleaned up ${result.deletedCount} old deleted messages`);
    } catch (error) {
      console.error("❌ Error in message cleanup job:", error);
    }
  });

  // Update user activity status every 15 minutes
  cron.schedule("*/15 * * * *", async () => {
    try {
      const User = require("./models/User");
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

      // Mark users as inactive if they haven't been active recently
      await User.updateMany(
        {
          lastActive: { $lt: fifteenMinutesAgo },
          isActive: true,
        },
        {
          $set: { "status.isOnline": false },
        }
      );
    } catch (error) {
      console.error("❌ Error in user activity update job:", error);
    }
  });

  console.log("✅ Cleanup jobs scheduled");
};

// ===== ENHANCED GLOBAL ERROR HANDLER =====

const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

  // Log error
  console.error("ERROR 💥", {
    error: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get("User-Agent"),
    timestamp: new Date().toISOString(),
  });

  if (process.env.NODE_ENV === "development") {
    sendErrorDev(err, res);
  } else {
    let error = { ...err };
    error.message = err.message;

    if (error.name === "CastError") error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === "ValidationError")
      error = handleValidationErrorDB(error);
    if (error.name === "JsonWebTokenError") error = handleJWTError();
    if (error.name === "TokenExpiredError") error = handleJWTExpiredError();

    sendErrorProd(error, res);
  }
};

// ===== EXPORT ENHANCED MODULES =====

module.exports = {
  // Security middleware
  validateInput,
  validatePassword,
  authenticate,

  // Utility functions
  calculateAge,
  calculateDistance,

  // Error handling
  AppError,
  globalErrorHandler,

  // Socket handler
  socketHandler,

  // Database functions
  connectDB,
  createDatabaseIndexes,

  // Cleanup
  startCleanupJobs,

  // Rate limiters
  generalLimiter,
  authLimiter,
  uploadLimiter,
  messageLimiter,
};

// ===== SERVER STARTUP =====

// Parse JSON bodies
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
  })
);

// Apply input validation to all routes
app.use(validateInput);

// ===== ROUTES =====

// Health check route
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/photos", require("./routes/photos"));
app.use("/api/profile", require("./routes/profile"));

// ===== SOCKET.IO SETUP =====

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["polling", "websocket"],
});

// Initialize socket handler
socketHandler(io);

// ===== GLOBAL ERROR HANDLER =====

app.use(globalErrorHandler);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// ===== START SERVER =====

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start cleanup jobs
    startCleanupJobs();

    // Start server
    server.listen(PORT, () => {
      console.log("🚀 HABIBI BACKEND SERVER");
      console.log("========================");
      console.log(`📡 HTTP Server: http://localhost:${PORT}`);
      console.log(`💬 Socket.io: ws://localhost:${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(
        `🔗 Frontend URL: ${
          process.env.FRONTEND_URL || "http://localhost:3000"
        }`
      );
      console.log("");
      console.log("✅ Server is ready!");
      console.log("📊 Health check: http://localhost:" + PORT + "/health");
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Handle unhandled promise rejections
process.on("unhandledRejection", (err) => {
  console.error("❌ UNHANDLED REJECTION! 💥 Shutting down...");
  console.error(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on("uncaughtException", (err) => {
  console.error("❌ UNCAUGHT EXCEPTION! 💥 Shutting down...");
  console.error(err.name, err.message);
  process.exit(1);
});

// Start the server
startServer();
