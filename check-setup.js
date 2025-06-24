// Run this script to check if your backend setup is correct
// Usage: node check-setup.js

const fs = require("fs");
const path = require("path");

console.log("🔍 Checking Habibi Backend Setup...\n");

// Check if all required files exist
const requiredFiles = [
  "models/User.js",
  "models/Match.js",
  "models/Swipe.js",
  "models/Message.js",
  "routes/auth.js",
  "routes/profile.js",
  "routes/photos.js",
  "routes/matching.js",
  "routes/chat.js",
  "socket/socketHandler.js",
  "server.js",
  "package.json",
  ".env",
];

console.log("📁 Checking required files:");
let missingFiles = [];

requiredFiles.forEach((file) => {
  if (fs.existsSync(file)) {
    console.log(`   ✅ ${file}`);
  } else {
    console.log(`   ❌ ${file} - MISSING!`);
    missingFiles.push(file);
  }
});

if (missingFiles.length > 0) {
  console.log("\n🚨 Missing files found! Please create these files:");
  missingFiles.forEach((file) => console.log(`   - ${file}`));
  console.log("\n💡 Tip: Make sure you have all the Phase 4 files created.");
  return;
}

// Check package.json dependencies
console.log("\n📦 Checking package.json dependencies:");
try {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const requiredDeps = [
    "express",
    "mongoose",
    "socket.io",
    "jsonwebtoken",
    "bcryptjs",
    "cors",
    "dotenv",
    "cloudinary",
    "multer",
    "multer-storage-cloudinary",
  ];

  let missingDeps = [];
  requiredDeps.forEach((dep) => {
    if (packageJson.dependencies && packageJson.dependencies[dep]) {
      console.log(`   ✅ ${dep}: ${packageJson.dependencies[dep]}`);
    } else {
      console.log(`   ❌ ${dep} - MISSING!`);
      missingDeps.push(dep);
    }
  });

  if (missingDeps.length > 0) {
    console.log("\n🚨 Missing dependencies! Run this command:");
    console.log(`   npm install ${missingDeps.join(" ")}`);
    return;
  }
} catch (error) {
  console.log("   ❌ Error reading package.json:", error.message);
  return;
}

// Check .env file
console.log("\n🔐 Checking .env configuration:");
require("dotenv").config();

const envVars = [
  "MONGODB_URI",
  "JWT_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

envVars.forEach((envVar) => {
  if (process.env[envVar]) {
    console.log(`   ✅ ${envVar}: Set`);
  } else {
    console.log(`   ❌ ${envVar}: Missing`);
  }
});

// Check if we can require main modules
console.log("\n🧪 Testing module imports:");
try {
  const express = require("express");
  console.log("   ✅ express");
} catch (e) {
  console.log("   ❌ express:", e.message);
}

try {
  const mongoose = require("mongoose");
  console.log("   ✅ mongoose");
} catch (e) {
  console.log("   ❌ mongoose:", e.message);
}

try {
  const { Server } = require("socket.io");
  console.log("   ✅ socket.io");
} catch (e) {
  console.log("   ❌ socket.io:", e.message);
}

// Test if models can be imported
console.log("\n🗄️  Testing models:");
try {
  require("./models/User");
  console.log("   ✅ User model");
} catch (e) {
  console.log("   ❌ User model:", e.message);
}

try {
  require("./models/Match");
  console.log("   ✅ Match model");
} catch (e) {
  console.log("   ❌ Match model:", e.message);
}

try {
  require("./models/Message");
  console.log("   ✅ Message model");
} catch (e) {
  console.log("   ❌ Message model:", e.message);
}

// Test if routes can be imported
console.log("\n🛣️  Testing routes:");
try {
  require("./routes/auth");
  console.log("   ✅ auth routes");
} catch (e) {
  console.log("   ❌ auth routes:", e.message);
}

try {
  require("./routes/chat");
  console.log("   ✅ chat routes");
} catch (e) {
  console.log("   ❌ chat routes:", e.message);
}

try {
  require("./socket/socketHandler");
  console.log("   ✅ socket handler");
} catch (e) {
  console.log("   ❌ socket handler:", e.message);
}

console.log("\n🎯 Setup check complete!");
console.log("\nIf all items show ✅, your setup should work.");
console.log("If you see ❌, fix those issues first.");
console.log("\nNext steps:");
console.log("1. Run: npm install (if dependencies are missing)");
console.log("2. Run: npm start");
console.log("3. Check if server starts without errors");
