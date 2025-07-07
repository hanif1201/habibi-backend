// server.js - ENHANCED FIXED VERSION
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const helmet = require("helmet");
const compression = require("compression");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const cron = require("node-cron");

// Import enhanced error handling
const {
  AppError,
  asyncHandler,
  globalErrorHandler,
  notFoundHandler,
  createRateLimit,
  handleDBConnection,
  handleSecurityErrors,
  requestTimeout,
  healthCheck,
} = require("./middleware/errorHandler");

// Load environment variables
dotenv.config();

const app = express();

// Handle database connection errors
handleDBConnection();

// ===== SECURITY MIDDLEWARE =====
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
    crossOriginEmbedderPolicy: false,
  })
);

app.use(compression());
app.use(mongoSanitize());
app.use(xss());

// Enhanced rate limiting with different limits for different endpoints
const authLimiter = createRateLimit(
  15 * 60 * 1000,
  5,
  "Too many authentication attempts, please try again later.",
  "AUTH_RATE_LIMIT"
);

const uploadLimiter = createRateLimit(
  60 * 60 * 1000,
  10,
  "Too many upload attempts, please try again later.",
  "UPLOAD_RATE_LIMIT"
);

const messageLimiter = createRateLimit(
  1 * 60 * 1000,
  30,
  "Too many messages sent, please slow down.",
  "MESSAGE_RATE_LIMIT"
);

const generalLimiter = createRateLimit(
  15 * 60 * 1000,
  100,
  "Too many requests from this IP, please try again later.",
  "GENERAL_RATE_LIMIT"
);

const swipeLimiter = createRateLimit(
  60 * 60 * 1000,
  200,
  "Too many swipes, please try again later.",
  "SWIPE_RATE_LIMIT"
);

// Apply rate limiting to specific routes
app.use("/api/auth", authLimiter);
app.use("/api/photos", uploadLimiter);
app.use("/api/chat", messageLimiter);
app.use("/api/matching/swipe", swipeLimiter);
app.use("/api/", generalLimiter);

// ===== REQUEST TIMEOUT =====
app.use(requestTimeout(30000)); // 30 second timeout

// ===== BODY PARSING WITH ENHANCED LIMITS =====
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      try {
        JSON.parse(buf);
      } catch (e) {
        throw new AppError("Invalid JSON format", 400, "INVALID_JSON");
      }
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ===== CORS =====
app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = [
        process.env.FRONTEND_URL || "http://localhost:3000",
        "http://localhost:3000",
        "http://localhost:3001",
        "https://habibi-dating.com", // Add your production domain
      ];

      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new AppError("Not allowed by CORS", 403, "CORS_ERROR"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
    maxAge: 86400, // 24 hours
  })
);

// ===== ENHANCED DATABASE CONNECTION =====
const connectDB = async () => {
  try {
    const mongoOptions = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
    };

    const conn = await mongoose.connect(process.env.MONGODB_URI, mongoOptions);

    console.log(`✅ MongoDB connected: ${conn.connection.host}`);

    // Enhanced connection event handling
    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.log("⚠️ MongoDB disconnected. Attempting to reconnect...");
    });

    mongoose.connection.on("reconnected", () => {
      console.log("✅ MongoDB reconnected");
    });

    // Graceful shutdown
    process.on("SIGINT", async () => {
      await mongoose.connection.close();
      console.log("MongoDB connection closed through app termination");
      process.exit(0);
    });
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
};

// ===== ENHANCED SOCKET.IO HANDLER =====
const socketHandler = (io) => {
  const activeConnections = new Map();
  const userSockets = new Map();
  const typingUsers = new Map();
  const userRooms = new Map();

  // Enhanced socket authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("Authentication error: No token provided"));
      }

      const jwt = require("jsonwebtoken");
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const User = require("./models/User");
      const user = await User.findById(decoded.userId).select("+safety");

      if (!user || !user.isActive) {
        return next(new Error("User not found or inactive"));
      }

      socket.userId = user._id.toString();
      socket.user = {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        photos: user.photos,
        safety: user.safety,
        settings: user.settings,
      };

      next();
    } catch (error) {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.userId;
    const user = socket.user;

    console.log(`👤 User ${user.firstName} connected: ${socket.id}`);

    try {
      // Enhanced connection tracking
      activeConnections.set(socket.id, {
        userId,
        user,
        connectedAt: new Date(),
        lastActivity: new Date(),
        rooms: new Set(),
      });

      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(socket.id);
      userRooms.set(userId, new Set());

      // Update user's last active
      const User = require("./models/User");
      await User.findByIdAndUpdate(userId, { lastActive: new Date() });

      // Join user to their match rooms
      const Match = require("./models/Match");
      const userMatches = await Match.find({ users: userId, status: "active" });

      for (const match of userMatches) {
        const roomName = `match_${match._id}`;
        socket.join(roomName);
        activeConnections.get(socket.id).rooms.add(roomName);
        userRooms.get(userId).add(roomName);

        const otherUserId = match.users.find((u) => u.toString() !== userId);
        socket.to(roomName).emit("user_online", {
          userId,
          user: { _id: userId, firstName: user.firstName },
          matchId: match._id,
        });
      }
    } catch (error) {
      console.error("❌ Error during socket connection setup:", error);
    }

    // Enhanced message sending with validation
    socket.on("send_message", async (data) => {
      try {
        const { matchId, content, messageType = "text" } = data;

        if (!matchId || !content?.trim()) {
          socket.emit("error", {
            message: "Match ID and content are required",
          });
          return;
        }

        // Validate message length
        if (content.trim().length > 1000) {
          socket.emit("error", {
            message: "Message too long. Maximum 1000 characters.",
          });
          return;
        }

        // Verify match and permissions
        const Match = require("./models/Match");
        const match = await Match.findById(matchId).populate(
          "users",
          "firstName lastName safety"
        );

        if (!match || !match.users.find((u) => u._id.toString() === userId)) {
          socket.emit("error", {
            message: "Access denied to this conversation",
          });
          return;
        }

        const otherUser = match.users.find((u) => u._id.toString() !== userId);

        // Check for blocks
        if (
          user.safety?.blockedUsers?.includes(otherUser._id) ||
          otherUser.safety?.blockedUsers?.includes(userId)
        ) {
          socket.emit("error", { message: "Cannot send message to this user" });
          return;
        }

        // Enhanced rate limiting
        const Message = require("./models/Message");
        const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
        const recentMessages = await Message.countDocuments({
          sender: userId,
          match: matchId,
          createdAt: { $gte: oneMinuteAgo },
        });

        if (recentMessages >= 15) {
          socket.emit("error", {
            message: "Too many messages sent. Please slow down.",
            code: "RATE_LIMIT_EXCEEDED",
          });
          return;
        }

        // Create message
        const message = new Message({
          match: matchId,
          sender: userId,
          receiver: otherUser._id,
          content: content.trim(),
          messageType,
        });

        await message.save();

        // Update match
        const isFirstMessage = !match.firstMessageSentAt;
        if (isFirstMessage) {
          match.firstMessageSentAt = new Date();
          match.firstMessageSentBy = userId;
          match.expiresAt = null;
        }
        match.lastActivity = new Date();
        await match.save();

        await message.populate("sender", "firstName lastName photos");

        const formattedMessage = {
          _id: message._id,
          content: message.content,
          sender: {
            _id: message.sender._id,
            firstName: message.sender.firstName,
          },
          createdAt: message.createdAt,
          messageType: message.messageType,
          matchId,
        };

        io.to(`match_${matchId}`).emit("new_message", formattedMessage);

        socket.emit("message_sent", {
          messageId: message._id,
          sentAt: message.createdAt,
        });
      } catch (error) {
        console.error("Message send error:", error);
        socket.emit("error", { message: "Error sending message" });
      }
    });

    // Enhanced typing indicators
    socket.on("typing_start", (data) => {
      const { matchId } = data;
      if (!matchId) return;

      if (typingUsers.has(matchId)) {
        clearTimeout(typingUsers.get(matchId).timeout);
      }

      const timeout = setTimeout(() => {
        typingUsers.delete(matchId);
        socket.to(`match_${matchId}`).emit("user_typing", {
          userId,
          userName: user.firstName,
          matchId,
          isTyping: false,
        });
      }, 3000);

      typingUsers.set(matchId, { userId, userName: user.firstName, timeout });

      socket.to(`match_${matchId}`).emit("user_typing", {
        userId,
        userName: user.firstName,
        matchId,
        isTyping: true,
      });
    });

    socket.on("typing_stop", (data) => {
      const { matchId } = data;
      if (
        typingUsers.has(matchId) &&
        typingUsers.get(matchId).userId === userId
      ) {
        clearTimeout(typingUsers.get(matchId).timeout);
        typingUsers.delete(matchId);
        socket.to(`match_${matchId}`).emit("user_typing", {
          userId,
          userName: user.firstName,
          matchId,
          isTyping: false,
        });
      }
    });

    // Enhanced join/leave conversation
    socket.on("join_conversation", async (data) => {
      try {
        const { matchId } = data;
        const Match = require("./models/Match");
        const match = await Match.findById(matchId);
        if (match && match.users.includes(userId)) {
          socket.join(`match_${matchId}`);

          // Mark messages as read
          const Message = require("./models/Message");
          await Message.updateMany(
            { match: matchId, receiver: userId, readAt: null },
            { readAt: new Date() }
          );
        }
      } catch (error) {
        console.error("Error joining conversation:", error);
      }
    });

    socket.on("leave_conversation", (data) => {
      const { matchId } = data;
      socket.leave(`match_${matchId}`);
    });

    socket.on("mark_messages_read", async (data) => {
      try {
        const { matchId } = data;
        const Message = require("./models/Message");

        await Message.updateMany(
          { match: matchId, receiver: userId, readAt: null },
          { readAt: new Date() }
        );

        socket.to(`match_${matchId}`).emit("messages_read", {
          matchId,
          readBy: userId,
          readAt: new Date(),
        });
      } catch (error) {
        console.error("Mark messages read error:", error);
      }
    });

    // Enhanced disconnect handler
    socket.on("disconnect", async (reason) => {
      console.log(`👋 User ${user.firstName} disconnected: ${reason}`);

      try {
        activeConnections.delete(socket.id);

        if (userSockets.has(userId)) {
          userSockets.get(userId).delete(socket.id);
          if (userSockets.get(userId).size === 0) {
            userSockets.delete(userId);

            // Clean up typing
            for (const [matchId, typingData] of typingUsers.entries()) {
              if (typingData.userId === userId) {
                clearTimeout(typingData.timeout);
                typingUsers.delete(matchId);
              }
            }

            // Notify offline
            const userRoomsList = userRooms.get(userId) || new Set();
            userRoomsList.forEach((roomName) => {
              socket.to(roomName).emit("user_offline", {
                userId,
                lastSeen: new Date(),
              });
            });

            userRooms.delete(userId);
          }
        }

        const User = require("./models/User");
        await User.findByIdAndUpdate(userId, { lastActive: new Date() });
      } catch (error) {
        console.error("Disconnect cleanup error:", error);
      }
    });
  });

  // Utility functions
  io.isUserOnline = (userId) => userSockets.has(userId);
  io.getOnlineUserCount = () => userSockets.size;

  return io;
};

// ===== SECURITY ERROR HANDLING =====
handleSecurityErrors(app);

// ===== HEALTH CHECK =====
app.get("/health", healthCheck);

// ===== ROUTES =====
// Middleware to attach io to requests
app.use((req, res, next) => {
  req.io = io;
  next();
});

// API routes with enhanced error handling
app.use("/api/auth", asyncHandler(require("./routes/auth")));
app.use("/api/photos", asyncHandler(require("./routes/photos")));
app.use("/api/profile", asyncHandler(require("./routes/profile")));
app.use("/api/matching", asyncHandler(require("./routes/matching")));
app.use("/api/chat", asyncHandler(require("./routes/chat")));
app.use("/api/debug", asyncHandler(require("./routes/debug")));
app.use("/api/safety", asyncHandler(require("./routes/safety")));
app.use("/api/notifications", asyncHandler(require("./routes/notifications")));

// ===== 404 HANDLER =====
app.all("*", notFoundHandler);

// ===== GLOBAL ERROR HANDLER =====
app.use(globalErrorHandler);

// ===== SOCKET.IO SETUP =====
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["polling", "websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Initialize socket handler
const socketIO = socketHandler(io);

// ===== ENHANCED CLEANUP JOBS =====
const startCleanupJobs = () => {
  // Clean up expired matches every hour
  cron.schedule("0 * * * *", async () => {
    try {
      const Match = require("./models/Match");
      const now = new Date();

      const result = await Match.updateMany(
        {
          status: "active",
          firstMessageSentAt: null,
          expiresAt: { $lt: now },
        },
        { status: "expired" }
      );

      console.log(`🧹 Expired ${result.modifiedCount} old matches`);
    } catch (error) {
      console.error("❌ Error in match cleanup job:", error);
    }
  });

  // Clean up old login attempts every day
  cron.schedule("0 0 * * *", async () => {
    try {
      const User = require("./models/User");
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const result = await User.updateMany(
        {
          lockUntil: { $lt: oneDayAgo },
        },
        {
          $unset: { lockUntil: 1, loginAttempts: 1 },
        }
      );

      console.log(`🧹 Cleaned up ${result.modifiedCount} locked accounts`);
    } catch (error) {
      console.error("❌ Error in account cleanup job:", error);
    }
  });

  // Update user activity status every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    try {
      const User = require("./models/User");
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

      // This would typically update online status or similar
      // For now, just log activity
      const activeUsers = await User.countDocuments({
        lastActive: { $gte: fifteenMinutesAgo },
        isActive: true,
      });

      console.log(`📊 ${activeUsers} users active in last 15 minutes`);
    } catch (error) {
      console.error("❌ Error in activity update job:", error);
    }
  });

  console.log("✅ Cleanup jobs scheduled");
};

// ===== GRACEFUL SHUTDOWN =====
const gracefulShutdown = (signal) => {
  console.log(`\n🔴 Received ${signal}. Starting graceful shutdown...`);

  server.close(() => {
    console.log("📡 HTTP server closed");

    mongoose.connection.close(false, () => {
      console.log("💾 MongoDB connection closed");
      console.log("✅ Graceful shutdown complete");
      process.exit(0);
    });
  });

  // Force close after 30 seconds
  setTimeout(() => {
    console.error(
      "⚠️ Could not close connections in time, forcefully shutting down"
    );
    process.exit(1);
  }, 30000);
};

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ===== START SERVER =====
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    startCleanupJobs();

    server.listen(PORT, () => {
      console.log("🚀 HABIBI BACKEND SERVER");
      console.log("========================");
      console.log(`📡 HTTP Server: http://localhost:${PORT}`);
      console.log(`💬 Socket.io: ws://localhost:${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(
        `🗃️ Database: ${process.env.MONGODB_URI ? "Connected" : "Local"}`
      );
      console.log("✅ Server is ready!");
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
