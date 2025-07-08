// Debug script to monitor and clean up socket connections
// Run with: node debug-server.js

const { io } = require("socket.io-client");

console.log("🔍 Socket Connection Debug Tool");
console.log("================================");

// Connect to your server
const socket = io("http://localhost:5000", {
  transports: ["polling", "websocket"],
  timeout: 5000,
  auth: {
    token: "your-jwt-token-here", // Replace with actual token for testing
  },
});

socket.on("connect", () => {
  console.log("✅ Connected to server");
  console.log("   Socket ID:", socket.id);
  console.log("   Transport:", socket.io.engine.transport.name);

  // Request server stats
  socket.emit("get_server_stats");
});

socket.on("server_stats", (stats) => {
  console.log("\n📊 Server Statistics:");
  console.log("   Online Users:", stats.onlineUsers);
  console.log("   Active Sockets:", stats.activeSockets);
  console.log("   Typing Users:", stats.typingUsers);
  console.log("   Memory Usage:", stats.memoryUsage);

  if (stats.usersWithMultipleConnections) {
    console.log("\n⚠️ Users with multiple connections:");
    stats.usersWithMultipleConnections.forEach((user) => {
      console.log(
        `   - ${user.firstName}: ${user.connectionCount} connections`
      );
    });
  }
});

socket.on("connect_error", (error) => {
  console.error("❌ Connection failed:", error.message);

  if (error.message.includes("Too many connection attempts")) {
    console.log(
      "\n🚫 Rate limit hit - server is protecting against connection storms"
    );
    console.log("   This is expected behavior to prevent server overload");
  }
});

socket.on("disconnect", (reason) => {
  console.log("👋 Disconnected:", reason);
});

// Cleanup function
const cleanup = () => {
  console.log("\n🧹 Cleaning up...");
  socket.disconnect();
  process.exit(0);
};

// Handle Ctrl+C
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Auto-disconnect after 10 seconds
setTimeout(() => {
  console.log("\n⏰ Debug session completed");
  cleanup();
}, 10000);

console.log("\n💡 Tips to prevent connection storms:");
console.log(
  "1. Ensure your frontend properly disconnects sockets on page unload"
);
console.log("2. Don't create new socket connections on every component mount");
console.log("3. Use a single socket instance per user session");
console.log("4. Implement proper error handling and reconnection logic");
console.log("5. Monitor connection counts in your frontend");
