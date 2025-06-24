// Simple test to check if server is working
// Run with: node debug-server.js

const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const app = express();
const server = createServer(app);

// Test Socket.io setup
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());

// Test routes
app.get("/", (req, res) => {
  res.json({
    message: "Test server is running!",
    socketio: "enabled",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/test", (req, res) => {
  res.json({
    message: "API routes working!",
    timestamp: new Date().toISOString(),
  });
});

// Test chat route
app.get("/api/chat/test", (req, res) => {
  res.json({
    message: "Chat routes working!",
    timestamp: new Date().toISOString(),
  });
});

// Socket.io test
io.on("connection", (socket) => {
  console.log("✅ Socket.io client connected:", socket.id);

  socket.emit("welcome", { message: "Socket.io is working!" });

  socket.on("disconnect", () => {
    console.log("👋 Socket.io client disconnected:", socket.id);
  });
});

const PORT = 5000;

server.listen(PORT, () => {
  console.log("🧪 TEST SERVER RUNNING:");
  console.log(`   📡 HTTP: http://localhost:${PORT}`);
  console.log(`   💬 Socket.io: ws://localhost:${PORT}`);
  console.log("   🧪 Test URLs:");
  console.log("      - http://localhost:5000/");
  console.log("      - http://localhost:5000/api/test");
  console.log("      - http://localhost:5000/api/chat/test");
  console.log("");
  console.log("If this works, your basic setup is correct!");
});
