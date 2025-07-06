// checkConfig.js - Run this script to validate your environment configuration
const { v2: cloudinary } = require("cloudinary");
const mongoose = require("mongoose");
require("dotenv").config();

console.log("🔍 HABIBI CONFIGURATION CHECKER");
console.log("================================\n");

// Configuration checks
const checks = [
  {
    name: "Environment Variables",
    check: () => {
      const required = [
        "NODE_ENV",
        "PORT",
        "MONGODB_URI",
        "JWT_SECRET",
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET",
      ];

      const missing = required.filter((env) => !process.env[env]);

      if (missing.length > 0) {
        throw new Error(
          `Missing required environment variables: ${missing.join(", ")}`
        );
      }

      // Check if using default/example values
      const warnings = [];
      if (
        process.env.JWT_SECRET === "your-secret-key" ||
        process.env.JWT_SECRET.length < 32
      ) {
        warnings.push(
          "JWT_SECRET should be a long, random string (32+ characters)"
        );
      }

      if (process.env.CLOUDINARY_CLOUD_NAME === "your-cloudinary-cloud-name") {
        warnings.push(
          "CLOUDINARY_CLOUD_NAME appears to be a placeholder value"
        );
      }

      return {
        status: "PASS",
        details: `All ${required.length} required variables found`,
        warnings,
      };
    },
  },

  {
    name: "Cloudinary Connection",
    check: async () => {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });

      try {
        const result = await cloudinary.api.ping();
        return {
          status: "PASS",
          details: `Connected to Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME}`,
          data: result,
        };
      } catch (error) {
        throw new Error(`Cloudinary connection failed: ${error.message}`);
      }
    },
  },

  {
    name: "MongoDB Connection",
    check: async () => {
      try {
        await mongoose.connect(process.env.MONGODB_URI, {
          serverSelectionTimeoutMS: 5000,
        });

        const dbName = mongoose.connection.db.databaseName;
        await mongoose.disconnect();

        return {
          status: "PASS",
          details: `Connected to MongoDB database: ${dbName}`,
        };
      } catch (error) {
        throw new Error(`MongoDB connection failed: ${error.message}`);
      }
    },
  },

  {
    name: "File System Permissions",
    check: () => {
      const fs = require("fs");
      const path = require("path");

      try {
        // Check if we can write to uploads directory
        const uploadsDir = path.join(__dirname, "uploads");
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        // Test write permission
        const testFile = path.join(uploadsDir, ".test");
        fs.writeFileSync(testFile, "test");
        fs.unlinkSync(testFile);

        return {
          status: "PASS",
          details: "File system permissions OK",
        };
      } catch (error) {
        throw new Error(`File system check failed: ${error.message}`);
      }
    },
  },

  {
    name: "Port Availability",
    check: () => {
      const net = require("net");
      const port = process.env.PORT || 5000;

      return new Promise((resolve, reject) => {
        const server = net.createServer();

        server.listen(port, () => {
          server.close(() => {
            resolve({
              status: "PASS",
              details: `Port ${port} is available`,
            });
          });
        });

        server.on("error", (err) => {
          if (err.code === "EADDRINUSE") {
            reject(new Error(`Port ${port} is already in use`));
          } else {
            reject(new Error(`Port check failed: ${err.message}`));
          }
        });
      });
    },
  },
];

// Run all checks
async function runChecks() {
  let allPassed = true;
  const results = [];

  for (const check of checks) {
    process.stdout.write(`Checking ${check.name}... `);

    try {
      const result = await check.check();
      console.log(`✅ ${result.status}`);
      console.log(`   ${result.details}`);

      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach((warning) => {
          console.log(`   ⚠️  ${warning}`);
        });
      }

      if (result.data && process.env.NODE_ENV === "development") {
        console.log(`   📊 ${JSON.stringify(result.data, null, 2)}`);
      }

      results.push({ name: check.name, ...result });
    } catch (error) {
      console.log(`❌ FAIL`);
      console.log(`   ${error.message}`);
      allPassed = false;
      results.push({ name: check.name, status: "FAIL", error: error.message });
    }

    console.log("");
  }

  // Summary
  console.log("SUMMARY");
  console.log("=======");

  if (allPassed) {
    console.log("✅ All checks passed! Your configuration looks good.");
    console.log("");
    console.log("🚀 You can now start the server with: npm start");
  } else {
    console.log(
      "❌ Some checks failed. Please fix the issues above before starting the server."
    );
    console.log("");
    console.log("📋 Common fixes:");
    console.log("  • Copy .env.example to .env and fill in your values");
    console.log("  • Create a Cloudinary account at https://cloudinary.com");
    console.log("  • Make sure MongoDB is running");
    console.log(
      "  • Check that no other services are using the specified port"
    );
  }

  console.log("");
  console.log(
    "📖 For help, check the README.md file or create an issue on GitHub."
  );

  return allPassed;
}

// Additional helper functions
function generateJWTSecret() {
  const crypto = require("crypto");
  return crypto.randomBytes(64).toString("hex");
}

function showCloudinarySetup() {
  console.log("🔧 CLOUDINARY SETUP GUIDE");
  console.log("=========================");
  console.log("1. Go to https://cloudinary.com and create a free account");
  console.log("2. After signing up, go to your Dashboard");
  console.log("3. Copy the following values to your .env file:");
  console.log("   - Cloud Name (CLOUDINARY_CLOUD_NAME)");
  console.log("   - API Key (CLOUDINARY_API_KEY)");
  console.log("   - API Secret (CLOUDINARY_API_SECRET)");
  console.log("");
  console.log("Example .env configuration:");
  console.log("CLOUDINARY_CLOUD_NAME=your-cloud-name");
  console.log("CLOUDINARY_API_KEY=123456789012345");
  console.log("CLOUDINARY_API_SECRET=abcdefghijklmnopqrstuvwxyz123456");
  console.log("");
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes("--jwt-secret")) {
  console.log("Generated JWT Secret:");
  console.log(generateJWTSecret());
  console.log("");
  console.log("Add this to your .env file as:");
  console.log(`JWT_SECRET=${generateJWTSecret()}`);
  process.exit(0);
}

if (args.includes("--cloudinary-help")) {
  showCloudinarySetup();
  process.exit(0);
}

if (args.includes("--help")) {
  console.log("Habibi Configuration Checker");
  console.log("");
  console.log("Usage:");
  console.log(
    "  node checkConfig.js                  Run all configuration checks"
  );
  console.log(
    "  node checkConfig.js --jwt-secret     Generate a secure JWT secret"
  );
  console.log(
    "  node checkConfig.js --cloudinary-help Show Cloudinary setup guide"
  );
  console.log("  node checkConfig.js --help           Show this help message");
  console.log("");
  process.exit(0);
}

// Run the checks
runChecks()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error("Configuration checker failed:", error);
    process.exit(1);
  });
