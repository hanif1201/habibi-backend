// Simple test script to check if Socket.io server is working
// Run with: node test-socket.js

const { io } = require("socket.io-client");

console.log("🧪 Testing Socket.io server connection...");

// Test connection to your server
const socket = io("http://localhost:5000", {
  transports: ["polling", "websocket"],
  timeout: 5000,
});

socket.on("connect", () => {
  console.log("✅ Successfully connected to Socket.io server!");
  console.log("   Socket ID:", socket.id);
  console.log("   Transport:", socket.io.engine.transport.name);

  // Test a simple message
  socket.emit("test_message", { message: "Hello from test client!" });

  setTimeout(() => {
    console.log("✅ Test completed successfully");
    socket.disconnect();
    process.exit(0);
  }, 2000);
});

socket.on("connect_error", (error) => {
  console.error("❌ Connection failed:", error.message);
  console.log("\n🔍 Troubleshooting steps:");
  console.log("1. Make sure your backend server is running (npm start)");
  console.log("2. Check if port 5000 is available");
  console.log("3. Verify your .env file has correct configuration");
  console.log("4. Try: npm install socket.io");
  process.exit(1);
});

socket.on("disconnect", (reason) => {
  console.log("👋 Disconnected:", reason);
});

// Timeout after 10 seconds
setTimeout(() => {
  console.error("⏰ Connection timeout - server might not be running");
  socket.disconnect();
  process.exit(1);
}, 10000);
