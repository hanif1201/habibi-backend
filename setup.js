#!/usr/bin/env node

// setup.js - Habibi Platform Setup Script

const fs = require("fs");
const path = require("path");

console.log("🚀 HABIBI PLATFORM SETUP");
console.log("=========================\n");

// Check environment file
function checkEnvironmentFile() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) {
    console.log("❌ .env file not found!");
    console.log("📝 Creating a sample .env file...\n");

    const sampleEnv = `# MongoDB Connection String
MONGODB_URI=mongodb+srv://adeyemihanif:p7XUMWlDZb1KDVnY@cluster0.zp5zqxb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0

# JWT Secret Key (CHANGE THIS IN PRODUCTION!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# Server Configuration
PORT=5000
NODE_ENV=development

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000

# Cloudinary Configuration (for photo uploads)
CLOUDINARY_CLOUD_NAME=dsgpg1jlt
CLOUDINARY_API_KEY=214173481152156
CLOUDINARY_API_SECRET=hSS4q0Xz8f_3Jdoak2qXAS3Pm7s
`;

    fs.writeFileSync(envPath, sampleEnv);
    console.log("✅ Sample .env file created!");
    console.log(
      "⚠️  Please update the values in .env file before running the server.\n"
    );
  } else {
    console.log("✅ .env file found!");
  }
}

// Check package.json dependencies
function checkDependencies() {
  const packagePath = path.join(__dirname, "package.json");

  if (!fs.existsSync(packagePath)) {
    console.log("❌ package.json not found!");
    console.log(
      "📝 Make sure you run this script from the project root directory.\n"
    );
    return false;
  }

  console.log("✅ package.json found!");

  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
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
  ];

  const missingDeps = requiredDeps.filter(
    (dep) =>
      !packageJson.dependencies?.[dep] && !packageJson.devDependencies?.[dep]
  );

  if (missingDeps.length > 0) {
    console.log("❌ Missing dependencies:", missingDeps.join(", "));
    console.log("📦 Run: npm install to install missing dependencies\n");
    return false;
  }

  console.log("✅ All required dependencies found!");
  return true;
}

// Check if required directories exist
function checkDirectories() {
  const requiredDirs = ["models", "routes", "middleware", "socket"];

  const missingDirs = requiredDirs.filter(
    (dir) => !fs.existsSync(path.join(__dirname, dir))
  );

  if (missingDirs.length > 0) {
    console.log("❌ Missing directories:", missingDirs.join(", "));
    return false;
  }

  console.log("✅ All required directories found!");
  return true;
}

// Check if key files exist
function checkKeyFiles() {
  const requiredFiles = [
    "server.js",
    "models/User.js",
    "models/Match.js",
    "models/Message.js",
    "models/Swipe.js",
    "routes/auth.js",
    "routes/matching.js",
    "routes/chat.js",
    "middleware/auth.js",
    "socket/socketHandler.js",
  ];

  const missingFiles = requiredFiles.filter(
    (file) => !fs.existsSync(path.join(__dirname, file))
  );

  if (missingFiles.length > 0) {
    console.log("❌ Missing files:", missingFiles.join(", "));
    return false;
  }

  console.log("✅ All required files found!");
  return true;
}

// Display startup instructions
function displayInstructions() {
  console.log("\n🎯 NEXT STEPS:");
  console.log("==============");
  console.log("1. Update your .env file with correct values");
  console.log("2. Make sure MongoDB is running (or use MongoDB Atlas)");
  console.log("3. Start the backend server:");
  console.log("   npm run dev  (or npm start)");
  console.log("");
  console.log("4. In another terminal, start the frontend:");
  console.log("   cd frontend  (if separate)");
  console.log("   npm start");
  console.log("");
  console.log("5. Test the integration:");
  console.log("   node test/integration.js");
  console.log("");
  console.log("📡 Server will run on: http://localhost:5000");
  console.log("🌐 Frontend will run on: http://localhost:3000");
  console.log("💬 Socket.io will run on: ws://localhost:5000");
  console.log("");
  console.log("🧪 Available endpoints:");
  console.log("  • GET /health - Server health check");
  console.log("  • POST /api/auth/register - User registration");
  console.log("  • POST /api/auth/login - User login");
  console.log("  • GET /api/matching/discover - Find matches");
  console.log("  • POST /api/matching/swipe - Swipe on users");
  console.log("  • GET /api/chat/conversations - Get conversations");
  console.log("  • POST /api/chat/:matchId/messages - Send messages");
  console.log("");
}

// Display troubleshooting tips
function displayTroubleshooting() {
  console.log("🔧 TROUBLESHOOTING TIPS:");
  console.log("========================");
  console.log("");
  console.log('❌ If you get "Module not found" errors:');
  console.log("   npm install");
  console.log("");
  console.log('❌ If you get "Connection refused" errors:');
  console.log("   • Check if MongoDB is running");
  console.log("   • Verify MONGODB_URI in .env file");
  console.log("   • Check if port 5000 is available");
  console.log("");
  console.log("❌ If Socket.io connection fails:");
  console.log("   • Check CORS settings in server.js");
  console.log("   • Verify FRONTEND_URL in .env file");
  console.log("   • Check browser console for errors");
  console.log("");
  console.log("❌ If photo uploads fail:");
  console.log("   • Check Cloudinary credentials in .env");
  console.log("   • Verify file size limits");
  console.log("");
  console.log("📚 For more help:");
  console.log("   • Check server logs for detailed errors");
  console.log("   • Use /api/debug endpoints for diagnostics");
  console.log("   • Test individual endpoints with Postman/curl");
  console.log("");
}

// Main setup function
function runSetup() {
  try {
    checkEnvironmentFile();

    const depsOk = checkDependencies();
    const dirsOk = checkDirectories();
    const filesOk = checkKeyFiles();

    if (depsOk && dirsOk && filesOk) {
      console.log("\n🎉 SETUP COMPLETE!");
      console.log("===================");
      console.log("Your Habibi platform is ready to run!\n");

      displayInstructions();
      displayTroubleshooting();
    } else {
      console.log("\n❌ SETUP INCOMPLETE");
      console.log("===================");
      console.log("Please fix the issues above before running the server.\n");
    }
  } catch (error) {
    console.error("❌ Setup failed:", error.message);
    process.exit(1);
  }
}

// Run setup
runSetup();
