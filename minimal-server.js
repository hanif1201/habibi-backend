// Minimal server to test if Socket.io and basic routes work
// Run with: node minimal-server.js

const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const app = express();
const server = createServer(app);

// Initialize Socket.io with CORS
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["polling", "websocket"],
});

// Middleware
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

// Test routes
app.get("/", (req, res) => {
  res.json({
    message: "Habibi Backend is running!",
    socketio: "enabled",
    timestamp: new Date().toISOString(),
    env: {
      mongodb: process.env.MONGODB_URI ? "configured" : "missing",
      jwt: process.env.JWT_SECRET ? "configured" : "missing",
      cloudinary: process.env.CLOUDINARY_CLOUD_NAME ? "configured" : "missing",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    socketio: "active",
    timestamp: new Date().toISOString(),
  });
});

// Test chat routes
app.get("/api/chat/conversations", (req, res) => {
  res.json({
    success: true,
    conversations: [],
    message: "Chat API is working! (No auth required for this test)",
  });
});

app.get("/api/chat/test", (req, res) => {
  res.json({
    success: true,
    message: "Chat routes are working!",
    timestamp: new Date().toISOString(),
  });
});

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log("✅ Socket.io client connected:", socket.id);

  // Send welcome message
  socket.emit("welcome", {
    message: "Socket.io connection successful!",
    socketId: socket.id,
    timestamp: new Date().toISOString(),
  });

  // Test events
  socket.on("test_message", (data) => {
    console.log("📧 Received test message:", data);
    socket.emit("test_response", {
      message: "Test message received!",
      original: data,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("disconnect", (reason) => {
    console.log("👋 Socket.io client disconnected:", socket.id, "-", reason);
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log("🧪 MINIMAL TEST SERVER");
  console.log("=====================");
  console.log(`📡 HTTP Server: http://localhost:${PORT}`);
  console.log(`💬 Socket.io: ws://localhost:${PORT}`);
  console.log(`🌍 CORS: http://localhost:3000`);
  console.log("");
  console.log("🔗 Test URLs:");
  console.log(`   http://localhost:${PORT}/`);
  console.log(`   http://localhost:${PORT}/health`);
  console.log(`   http://localhost:${PORT}/api/chat/conversations`);
  console.log(`   http://localhost:${PORT}/api/chat/test`);
  console.log("");
  console.log("✅ Server is ready! Try visiting the URLs above.");
});
