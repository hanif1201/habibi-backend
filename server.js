const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const compression = require("compression");

// Load environment variables
dotenv.config();

const app = express();

// Security middleware
app.use(helmet());
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later.",
  },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth requests per windowMs
  message: {
    success: false,
    message: "Too many login attempts, please try again later.",
  },
});

app.use("/api/auth", authLimiter);
app.use("/api/", limiter);

// Create HTTP server for Socket.io
const server = createServer(app);

// Initialize Socket.io with enhanced configuration
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  },
  transports: ["polling", "websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

console.log("✅ Socket.io initialized with enhanced config");

// Make io available to routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Enhanced CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL || "http://localhost:3000",
      "http://localhost:3000",
      "http://localhost:3001",
    ];

    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

console.log("✅ Enhanced middleware configured");

// MongoDB Connection with retry logic
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/habibi",
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        bufferCommands: false,
        bufferMaxEntries: 0,
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

connectDB();

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes with better error handling
console.log("📡 Loading routes...");

const routeFiles = [
  { path: "/api/auth", file: "./routes/auth", name: "Auth" },
  { path: "/api/profile", file: "./routes/profile", name: "Profile" },
  { path: "/api/photos", file: "./routes/photos", name: "Photos" },
  { path: "/api/matching", file: "./routes/matching", name: "Matching" },
  { path: "/api/chat", file: "./routes/chat", name: "Chat" },
  { path: "/api/debug", file: "./routes/debug", name: "Debug" },
];

routeFiles.forEach(({ path, file, name }) => {
  try {
    app.use(path, require(file));
    console.log(`✅ ${name} routes loaded`);
  } catch (err) {
    console.error(`❌ Failed to load ${name} routes:`, err.message);
  }
});

// Health check endpoints
app.get("/", (req, res) => {
  res.json({
    message: "Habibi Backend is running!",
    version: "1.0.0",
    socketio: "enabled",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

app.get("/api/health", (req, res) => {
  const health = {
    message: "Habibi Backend is healthy!",
    version: "1.0.0",
    socketio: "enabled",
    mongodb:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  };

  const status = mongoose.connection.readyState === 1 ? 200 : 503;
  res.status(status).json(health);
});

// Socket.io connection handler
try {
  const socketHandler = require("./socket/socketHandler");
  socketHandler(io);
  console.log("✅ Socket handler loaded");
} catch (err) {
  console.error("❌ Socket handler failed to load:", err.message);
}

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Server error:", err.stack);

  // Mongoose validation error
  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      message: "Validation Error",
      errors,
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`,
    });
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Token expired",
    });
  }

  // Multer errors
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      success: false,
      message: "File too large",
    });
  }

  // Default error
  res.status(err.status || 500).json({
    success: false,
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

const PORT = process.env.PORT || 5000;

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("👋 SIGTERM received, shutting down gracefully");
  server.close(() => {
    mongoose.connection.close();
  });
});

process.on("SIGINT", () => {
  console.log("👋 SIGINT received, shutting down gracefully");
  server.close(() => {
    mongoose.connection.close();
  });
});

// Start server
server.listen(PORT, () => {
  console.log("\n🎉 HABIBI BACKEND STARTED!");
  console.log("==========================");
  console.log(`📡 HTTP Server: http://localhost:${PORT}`);
  console.log(`💬 Socket.io: ws://localhost:${PORT}`);
  console.log(
    `🗄️  MongoDB: ${
      mongoose.connection.readyState === 1 ? "Connected" : "Connecting..."
    }`
  );
  console.log(
    `🌍 CORS: ${process.env.FRONTEND_URL || "http://localhost:3000"}`
  );
  console.log(`🔒 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log("\n🔗 Test these URLs:");
  console.log(`   http://localhost:${PORT}/`);
  console.log(`   http://localhost:${PORT}/api/health`);
  console.log("\n✅ Ready for connections!");
});

module.exports = app;
