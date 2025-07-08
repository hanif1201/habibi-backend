#!/usr/bin/env node

// Script to restart the server and clear socket connections
// Run with: node restart-server.js

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("🔄 Server Restart Tool");
console.log("=====================");

// Check if server is running
const checkServer = () => {
  return new Promise((resolve) => {
    const http = require("http");
    const req = http.request(
      {
        hostname: "localhost",
        port: 5000,
        path: "/health",
        method: "GET",
        timeout: 2000,
      },
      (res) => {
        resolve(true);
      }
    );

    req.on("error", () => {
      resolve(false);
    });

    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
};

// Kill existing server process
const killServer = () => {
  return new Promise((resolve) => {
    const { exec } = require("child_process");

    // On Unix-like systems
    exec('pkill -f "node.*server.js"', (error) => {
      if (error) {
        console.log("   No existing server process found");
      } else {
        console.log("   ✅ Killed existing server process");
      }
      resolve();
    });
  });
};

// Start new server
const startServer = () => {
  return new Promise((resolve, reject) => {
    console.log("   🚀 Starting new server...");

    const serverProcess = spawn("node", ["server.js"], {
      stdio: "inherit",
      detached: false,
    });

    serverProcess.on("error", (error) => {
      console.error("   ❌ Failed to start server:", error.message);
      reject(error);
    });

    // Wait a bit for server to start
    setTimeout(() => {
      console.log("   ⏳ Waiting for server to initialize...");
    }, 2000);

    // Check if server started successfully
    setTimeout(async () => {
      const isRunning = await checkServer();
      if (isRunning) {
        console.log("   ✅ Server started successfully!");
        resolve();
      } else {
        console.log("   ⚠️ Server may still be starting...");
        resolve();
      }
    }, 5000);
  });
};

// Main restart function
const restartServer = async () => {
  try {
    console.log("1️⃣ Checking current server status...");
    const isRunning = await checkServer();

    if (isRunning) {
      console.log("   ✅ Server is currently running");
      console.log("2️⃣ Stopping existing server...");
      await killServer();

      // Wait a moment for cleanup
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } else {
      console.log("   ⚠️ Server is not currently running");
    }

    console.log("3️⃣ Starting fresh server...");
    await startServer();

    console.log("\n🎉 Server restart completed!");
    console.log("   📡 Server should be available at: http://localhost:5000");
    console.log("   💬 Socket.io should be available at: ws://localhost:5000");
    console.log("\n💡 The new server includes:");
    console.log(
      "   • Connection rate limiting (max 10 connections/minute per user)"
    );
    console.log("   • Maximum 5 concurrent connections per user");
    console.log("   • Automatic cleanup of old connections");
    console.log("   • Better error handling and logging");
  } catch (error) {
    console.error("❌ Restart failed:", error.message);
    process.exit(1);
  }
};

// Run the restart
restartServer();
