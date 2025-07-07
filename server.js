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

// Initialize Firebase on startup
const initializeFirebase = async () => {
  try {
    const firebaseService = require("./services/firebaseAdmin");
    await firebaseService.initialize();
    console.log("🔥 Firebase services initialized");
  } catch (error) {
    console.log(
      "⚠️  Firebase initialization failed - notifications will be simulated"
    );
    console.log(
      "   Configure Firebase credentials in .env to enable real push notifications"
    );
  }
};

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

// ===== RATE LIMITING =====
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

// ===== DATABASE CONNECTION =====
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
const socketHandler = require("./socket/socketHandler");

// ===== ERROR HANDLING =====
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
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  } else {
    console.error("ERROR 💥", err);
    res.status(500).json({
      success: false,
      message: "Something went wrong!",
    });
  }
};

const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "error";

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

// ===== CLEANUP JOBS =====
const startCleanupJobs = () => {
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

  // Clean up old messages every day at 2 AM
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

  // Clean up old device tokens every week
  cron.schedule("0 0 * * 0", async () => {
    try {
      const User = require("./models/User");
      await User.cleanupAllDeviceTokens(30); // Remove tokens older than 30 days
    } catch (error) {
      console.error("❌ Error in device token cleanup job:", error);
    }
  });

  console.log("✅ Cleanup jobs scheduled");
};

// ===== EXPRESS CONFIGURATION =====

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

// ===== MIDDLEWARE TO ATTACH IO TO REQUESTS =====
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ===== RATE LIMITING =====
app.use("/api/auth", authLimiter);
app.use("/api/photos", uploadLimiter);
app.use("/api/chat", messageLimiter);
app.use("/api/", generalLimiter);

// ===== ROUTES =====

// Health check route
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Habibi Server is healthy! 💖",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    onlineUsers: io.getOnlineUserCount ? io.getOnlineUserCount() : 0,
    version: "1.0.0",
    features: {
      pushNotifications: !!process.env.FIREBASE_PROJECT_ID,
      fileUpload: !!process.env.CLOUDINARY_CLOUD_NAME,
      realTimeChat: true,
      matching: true,
    },
  });
});

// API routes - ALL YOUR ROUTES INTEGRATED
app.use("/api/auth", require("./routes/auth"));
app.use("/api/photos", require("./routes/photos"));
app.use("/api/profile", require("./routes/profile"));
app.use("/api/matching", require("./routes/matching"));
app.use("/api/chat", require("./routes/chat"));
app.use("/api/notifications", require("./routes/notifications").router);
app.use("/api/safety", require("./routes/safety"));
app.use("/api/debug", require("./routes/debug"));

// ===== ERROR HANDLERS =====

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
    availableRoutes: [
      "/health",
      "/api/auth/*",
      "/api/photos/*",
      "/api/profile/*",
      "/api/matching/*",
      "/api/chat/*",
      "/api/notifications/*",
      "/api/safety/*",
      "/api/debug/*",
    ],
  });
});

// Global error handler
app.use(globalErrorHandler);

// ===== SERVER STARTUP =====
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Initialize Firebase for push notifications
    await initializeFirebase();

    // Start cleanup jobs
    startCleanupJobs();

    // Start server
    server.listen(PORT, () => {
      console.log("🚀 HABIBI DATING PLATFORM");
      console.log("==========================");
      console.log(`📡 HTTP Server: http://localhost:${PORT}`);
      console.log(`💬 Socket.io: ws://localhost:${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
      console.log(
        `🔗 Frontend: ${process.env.FRONTEND_URL || "http://localhost:3000"}`
      );
      console.log("");
      console.log("🎯 Available Endpoints:");
      console.log("  • GET /health - Server health check");
      console.log("  • /api/auth/* - Authentication (login, register)");
      console.log("  • /api/profile/* - User profiles");
      console.log("  • /api/photos/* - Photo management");
      console.log("  • /api/matching/* - Discover, swipe, matches");
      console.log("  • /api/chat/* - Real-time messaging");
      console.log("  • /api/notifications/* - Push notifications");
      console.log("  • /api/safety/* - Safety & blocking features");
      console.log("  • /api/debug/* - Debug endpoints");
      console.log("");
      console.log("🔥 Features Status:");
      console.log(
        `  • Push Notifications: ${
          process.env.FIREBASE_PROJECT_ID ? "✅ Enabled" : "⚠️  Simulated"
        }`
      );
      console.log(
        `  • File Upload: ${
          process.env.CLOUDINARY_CLOUD_NAME ? "✅ Enabled" : "❌ Disabled"
        }`
      );
      console.log(`  • Real-time Chat: ✅ Enabled`);
      console.log(`  • User Matching: ✅ Enabled`);
      console.log("");
      console.log("✅ Server is ready! Time to find love! 💕");
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

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("👋 SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    console.log("💤 Process terminated");
  });
});

process.on("SIGINT", () => {
  console.log("👋 SIGINT received. Shutting down gracefully...");
  server.close(() => {
    console.log("💤 Process terminated");
  });
});

// Start the server
startServer();
