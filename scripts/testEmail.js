// scripts/testEmail.js - Email Testing Script
require("dotenv").config();
const mongoose = require("mongoose");
const emailService = require("../services/emailService");
const emailJobs = require("../jobs/emailJobs");
const User = require("../models/User");

console.log("🧪 HABIBI EMAIL TESTING SUITE");
console.log("=============================\n");

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
}

async function testEmailService() {
  console.log("📧 Testing Email Service...\n");

  // Test 1: Initialize email service
  console.log("🔧 1. Initializing email service...");
  const initResult = await emailService.initialize();
  if (initResult) {
    console.log("✅ Email service initialized successfully");
  } else {
    console.log("❌ Email service initialization failed");
    return false;
  }

  // Test 2: Health check
  console.log("\n🏥 2. Health check...");
  const health = await emailService.healthCheck();
  console.log(
    `Health Status: ${health.healthy ? "✅ Healthy" : "❌ Unhealthy"}`
  );
  console.log(`Provider: ${health.provider || "Unknown"}`);
  console.log(`Templates Loaded: ${health.templatesLoaded || 0}`);

  // Test 3: Send test welcome email
  console.log("\n📩 3. Testing welcome email...");
  const testUser = {
    email: "test@example.com",
    firstName: "Test",
    lastName: "User",
  };

  const welcomeResult = await emailService.sendWelcomeEmail(
    testUser,
    "test-token-123"
  );
  if (welcomeResult.success) {
    console.log("✅ Welcome email sent successfully");
    if (welcomeResult.previewUrl) {
      console.log(`📖 Preview: ${welcomeResult.previewUrl}`);
    }
  } else {
    console.log(`❌ Welcome email failed: ${welcomeResult.error}`);
  }

  // Test 4: Send test password reset email
  console.log("\n🔐 4. Testing password reset email...");
  const resetResult = await emailService.sendPasswordResetEmail(
    testUser,
    "reset-token-456"
  );
  if (resetResult.success) {
    console.log("✅ Password reset email sent successfully");
    if (resetResult.previewUrl) {
      console.log(`📖 Preview: ${resetResult.previewUrl}`);
    }
  } else {
    console.log(`❌ Password reset email failed: ${resetResult.error}`);
  }

  // Test 5: Send test verification email
  console.log("\n✉️ 5. Testing verification email...");
  const verifyResult = await emailService.sendEmailVerification(
    testUser,
    "verify-token-789"
  );
  if (verifyResult.success) {
    console.log("✅ Verification email sent successfully");
    if (verifyResult.previewUrl) {
      console.log(`📖 Preview: ${verifyResult.previewUrl}`);
    }
  } else {
    console.log(`❌ Verification email failed: ${verifyResult.error}`);
  }

  return true;
}

async function testEmailJobs() {
  console.log("\n📅 Testing Email Jobs...\n");

  // Test job status
  console.log("📊 Job Status:");
  const status = emailJobs.getJobStatus();
  console.log(`Running: ${status.isRunning}`);
  console.log(`Total Jobs: ${status.totalJobs}`);
  console.log("Jobs:", Object.keys(status.jobs).join(", "));

  // Test manual trigger for a user
  console.log("\n🔧 Testing manual triggers...");

  try {
    // Find a test user or create one
    let testUser = await User.findOne({ email: "test@example.com" });

    if (!testUser) {
      console.log("👤 Creating test user...");
      testUser = new User({
        email: "test@example.com",
        password: "TestPassword123!",
        firstName: "Test",
        lastName: "User",
        dateOfBirth: new Date("1995-01-01"),
        gender: "other",
      });
      await testUser.save();
      console.log("✅ Test user created");
    }

    // Test welcome email trigger
    console.log("\n👋 Testing welcome email trigger...");
    const welcomeResult = await emailJobs.triggerWelcomeEmail(testUser._id);
    if (welcomeResult.success) {
      console.log("✅ Welcome email triggered successfully");
    } else {
      console.log(`❌ Welcome email trigger failed: ${welcomeResult.error}`);
    }

    // Test weekly summary trigger
    console.log("\n📊 Testing weekly summary trigger...");
    const weeklyResult = await emailJobs.triggerWeeklySummary(testUser._id);
    if (weeklyResult.success) {
      console.log("✅ Weekly summary triggered successfully");
    } else {
      console.log(`❌ Weekly summary trigger failed: ${weeklyResult.error}`);
    }
  } catch (error) {
    console.error("❌ Error testing email jobs:", error);
  }
}

async function testEmailTemplates() {
  console.log("\n📄 Testing Email Templates...\n");

  const templates = [
    "welcome",
    "password-reset",
    "email-verification",
    "weekly-matches",
    "new-match",
    "reminder",
  ];

  for (const templateName of templates) {
    try {
      const testData = {
        firstName: "John",
        lastName: "Doe",
        verificationUrl: "https://example.com/verify",
        resetUrl: "https://example.com/reset",
        matchFirstName: "Jane",
        matchAge: 25,
        matchBio: "Test bio",
        matchPhoto: "https://example.com/photo.jpg",
        chatUrl: "https://example.com/chat",
        newMatches: 3,
        profileViews: 15,
        likes: 8,
        appUrl: "https://example.com",
        unsubscribeUrl: "https://example.com/unsubscribe",
        title: "Test Title",
        message: "Test message content",
        actionUrl: "https://example.com/action",
        actionText: "Take Action",
        footerMessage: "Test footer",
      };

      const compiled = emailService.compileTemplate(templateName, testData);
      console.log(
        `✅ Template '${templateName}' compiled successfully (${compiled.length} chars)`
      );
    } catch (error) {
      console.log(`❌ Template '${templateName}' failed: ${error.message}`);
    }
  }
}

async function runTests() {
  try {
    await connectDB();

    const testSuite = process.argv[2] || "all";

    switch (testSuite) {
      case "service":
        await testEmailService();
        break;
      case "jobs":
        await testEmailJobs();
        break;
      case "templates":
        await testEmailTemplates();
        break;
      case "all":
      default:
        await testEmailService();
        await testEmailJobs();
        await testEmailTemplates();
        break;
    }

    console.log("\n🎉 Email testing completed!");
    console.log("\n💡 Usage:");
    console.log("  node scripts/testEmail.js        - Run all tests");
    console.log(
      "  node scripts/testEmail.js service   - Test email service only"
    );
    console.log("  node scripts/testEmail.js jobs      - Test email jobs only");
    console.log("  node scripts/testEmail.js templates - Test templates only");
  } catch (error) {
    console.error("\n❌ Test suite failed:", error);
  } finally {
    mongoose.disconnect();
    process.exit(0);
  }
}

// Handle command line arguments
if (require.main === module) {
  runTests();
}

module.exports = {
  testEmailService,
  testEmailJobs,
  testEmailTemplates,
};

// === SEPARATE FILE: scripts/triggerWeekly.js ===

// scripts/triggerWeekly.js - Manual Weekly Email Trigger
// require("dotenv").config();
// const mongoose = require("mongoose");
// const emailJobs = require("../jobs/emailJobs");

// async function triggerWeeklyEmails() {
//   try {
//     console.log("📊 Triggering weekly email summaries...");

//     await mongoose.connect(process.env.MONGODB_URI);
//     console.log("✅ Connected to MongoDB");

//     // Trigger weekly summaries
//     const result = await emailJobs.triggerWeeklySummary();

//     if (result.success) {
//       console.log("✅ Weekly email summaries triggered successfully");
//     } else {
//       console.log(`❌ Failed to trigger weekly summaries: ${result.error}`);
//     }
//   } catch (error) {
//     console.error("❌ Error triggering weekly emails:", error);
//   } finally {
//     mongoose.disconnect();
//     process.exit(0);
//   }
// }

// if (require.main === module) {
//   triggerWeeklyEmails();
// }

// === SEPARATE FILE: scripts/setupEmail.js ===

// scripts/setupEmail.js - Email Setup Helper
// require("dotenv").config();
// const emailService = require("../services/emailService");

// async function setupEmailService() {
//   console.log("🚀 HABIBI EMAIL SETUP");
//   console.log("=====================\n");

//   // Check environment variables
//   const requiredVars = ["FRONTEND_URL", "FROM_EMAIL", "FROM_NAME"];

//   const providerVars = {
//     sendgrid: ["SENDGRID_API_KEY"],
//     gmail: ["GMAIL_USER", "GMAIL_APP_PASSWORD"],
//     smtp: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD"],
//   };

//   console.log("🔍 Checking environment variables...");

//   const missing = requiredVars.filter((variable) => !process.env[variable]);
//   if (missing.length > 0) {
//     console.log("❌ Missing required variables:", missing.join(", "));
//     return false;
//   }

//   const provider = process.env.EMAIL_PROVIDER || "development";
//   console.log(`📧 Email provider: ${provider}`);

//   if (provider !== "development" && providerVars[provider]) {
//     const missingProvider = providerVars[provider].filter(
//       (variable) => !process.env[variable]
//     );
//     if (missingProvider.length > 0) {
//       console.log(
//         `❌ Missing ${provider} variables:`,
//         missingProvider.join(", ")
//       );
//       return false;
//     }
//   }

//   console.log("✅ Environment variables OK");

//   // Test email service
//   console.log("\n📧 Testing email service...");
//   const initResult = await emailService.initialize();

//   if (initResult) {
//     console.log("✅ Email service initialized successfully");

//     const health = await emailService.healthCheck();
//     console.log(`Health: ${health.healthy ? "✅ Healthy" : "❌ Unhealthy"}`);
//     console.log(`Templates: ${health.templatesLoaded} loaded`);

//     return true;
//   } else {
//     console.log("❌ Email service initialization failed");
//     return false;
//   }
// }

// if (require.main === module) {
//   setupEmailService().then((success) => {
//     if (success) {
//       console.log("\n🎉 Email setup completed successfully!");
//       console.log("\n📝 Next steps:");
//       console.log("  1. Start your server: npm start");
//       console.log("  2. Test emails: npm run email:test");
//       console.log("  3. Trigger weekly emails: npm run email:weekly");
//     } else {
//       console.log("\n❌ Email setup failed. Please fix the issues above.");
//     }
//     process.exit(success ? 0 : 1);
//   });
// }
