const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const compression = require("compression");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const cron = require("node-cron");

// Load environment variables
dotenv.config();

const app = express();

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

// Rate limiting
const createRateLimit = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    message: { success: false, message },
    standardHeaders: true,
    legacyHeaders: false,
  });

const generalLimiter = createRateLimit(
  15 * 60 * 1000,
  100,
  "Too many requests from this IP, please try again later."
);

const authLimiter = createRateLimit(
  15 * 60 * 1000,
  5,
  "Too many authentication attempts, please try again later."
);

const uploadLimiter = createRateLimit(
  60 * 60 * 1000,
  10,
  "Too many upload attempts, please try again later."
);

const messageLimiter = createRateLimit(
  1 * 60 * 1000,
  30,
  "Too many messages sent, please slow down."
);

// Apply rate limiting
app.use("/api/auth", authLimiter);
app.use("/api/photos", uploadLimiter);
app.use("/api/chat", messageLimiter);
app.use("/api/", generalLimiter);

// ===== BODY PARSING =====
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ===== CORS =====
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

// ===== DATABASE CONNECTION =====
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      bufferCommands: false,
    });

    console.log(`✅ MongoDB connected: ${conn.connection.host}`);

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

// ===== SOCKET.IO HANDLER =====
const socketHandler = (io) => {
  const activeConnections = new Map();
  const userSockets = new Map();
  const typingUsers = new Map();
  const userRooms = new Map();

  // Socket authentication middleware
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

    // Track connection
    activeConnections.set(socket.id, {
      userId,
      user,
      connectedAt: new Date(),
      lastActivity: new Date(),
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
      userRooms.get(userId).add(roomName);

      const otherUserId = match.users.find((u) => u.toString() !== userId);
      socket.to(roomName).emit("user_online", {
        userId,
        user: { _id: userId, firstName: user.firstName },
        matchId: match._id,
      });
    }

    // Message sending
    socket.on("send_message", async (data) => {
      try {
        const { matchId, content, messageType = "text" } = data;

        if (!matchId || !content?.trim()) {
          socket.emit("error", {
            message: "Match ID and content are required",
          });
          return;
        }

        // Verify match
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

        // Create message
        const Message = require("./models/Message");
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

    // Typing indicators
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

    // Join/Leave conversation
    socket.on("join_conversation", async (data) => {
      const { matchId } = data;
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

    // Disconnect handler
    socket.on("disconnect", async (reason) => {
      console.log(`👋 User ${user.firstName} disconnected: ${reason}`);

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

      await User.findByIdAndUpdate(userId, { lastActive: new Date() });
    });
  });

  // Utility functions
  io.isUserOnline = (userId) => userSockets.has(userId);
  io.getOnlineUserCount = () => userSockets.size;

  return io;
};

// ===== ROUTES =====
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Middleware to attach io to requests
app.use((req, res, next) => {
  req.io = io;
  next();
});

// API routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/photos", require("./routes/photos"));
app.use("/api/profile", require("./routes/profile"));
app.use("/api/matching", require("./routes/matching"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api/debug", require("./routes/debug"));
app.use("/api/safety", require("./routes/safety"));

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
  console.error("Error:", err);

  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      errors: Object.values(err.errors).map((e) => e.message),
    });
  }

  if (err.code === 11000) {
    return res.status(400).json({
      success: false,
      message: "Duplicate field value",
    });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

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
const socketIO = socketHandler(io);

// ===== CLEANUP JOBS =====
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

  console.log("✅ Cleanup jobs scheduled");
};

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
      console.log("✅ Server is ready!");
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

// Handle unhandled rejections
process.on("unhandledRejection", (err) => {
  console.error("❌ UNHANDLED REJECTION! 💥 Shutting down...");
  console.error(err);
  server.close(() => {
    process.exit(1);
  });
});

process.on("uncaughtException", (err) => {
  console.error("❌ UNCAUGHT EXCEPTION! 💥 Shutting down...");
  console.error(err);
  process.exit(1);
});

startServer();
