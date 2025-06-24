const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

const app = express();

// Create HTTP server for Socket.io
const server = createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["polling", "websocket"],
});

console.log("✅ Socket.io initialized");

// Make io available to routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

console.log("✅ Middleware configured");

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/habibi", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// Routes
console.log("📡 Loading routes...");

try {
  app.use("/api/auth", require("./routes/auth"));
  console.log("✅ Auth routes loaded");
} catch (err) {
  console.log("⚠️  Auth routes not found");
}

try {
  app.use("/api/profile", require("./routes/profile"));
  console.log("✅ Profile routes loaded");
} catch (err) {
  console.log("⚠️  Profile routes not found");
}

try {
  app.use("/api/photos", require("./routes/photos"));
  console.log("✅ Photos routes loaded");
} catch (err) {
  console.log("⚠️  Photos routes not found");
}

try {
  app.use("/api/matching", require("./routes/matching"));
  console.log("✅ Matching routes loaded");
} catch (err) {
  console.log("⚠️  Matching routes not found");
}

// CRITICAL: Add chat routes
try {
  app.use("/api/chat", require("./routes/chat"));
  console.log("✅ Chat routes loaded");
} catch (err) {
  console.log("❌ Chat routes not found - creating basic endpoints");

  // Create basic chat endpoints since file doesn't exist
  app.get("/api/chat/conversations", (req, res) => {
    res.json({
      success: true,
      conversations: [],
      message:
        "Chat routes working! (Basic endpoint - no auth required for testing)",
    });
  });

  app.get("/api/chat/test", (req, res) => {
    res.json({
      success: true,
      message: "Chat API is working!",
      timestamp: new Date().toISOString(),
    });
  });

  console.log("✅ Basic chat endpoints created");
}

try {
  app.use("/api/debug", require("./routes/debug"));
  console.log("✅ Debug routes loaded");
} catch (err) {
  console.log("⚠️  Debug routes not found");
}

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Habibi Backend is running!",
    socketio: "enabled",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    message: "Habibi Backend is running!",
    socketio: "enabled",
    mongodb:
      mongoose.connection.readyState === 1 ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

// Socket.io connection handler
try {
  const socketHandler = require("./socket/socketHandler");
  socketHandler(io);
  console.log("✅ Socket handler loaded");
} catch (err) {
  console.log("❌ Socket handler not found - creating basic one");

  // Basic socket handler
  io.on("connection", (socket) => {
    console.log("👤 User connected:", socket.id);

    socket.emit("welcome", {
      message: "Connected to Habibi Chat!",
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });

    socket.on("test_message", (data) => {
      console.log("📧 Test message:", data);
      socket.emit("test_response", {
        message: "Test message received!",
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("disconnect", (reason) => {
      console.log("👋 User disconnected:", socket.id, "-", reason);
    });
  });

  console.log("✅ Basic socket handler created");
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Server error:", err.stack);
  res.status(500).json({
    success: false,
    message: "Something went wrong!",
    error:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
  });
});

// 404 handler
app.use("*", (req, res) => {
  console.log("❌ 404 - Route not found:", req.originalUrl);
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

const PORT = process.env.PORT || 5000;

// Use server.listen instead of app.listen for Socket.io
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
  console.log("\n🔗 Test these URLs:");
  console.log(`   http://localhost:${PORT}/`);
  console.log(`   http://localhost:${PORT}/api/health`);
  console.log(`   http://localhost:${PORT}/api/chat/conversations`);
  console.log(`   http://localhost:${PORT}/api/chat/test`);
  console.log("\n✅ Ready for connections!");
});
