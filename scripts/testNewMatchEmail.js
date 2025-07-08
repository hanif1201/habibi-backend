// scripts/testNewMatchEmail.js - Test New Match Email Functionality
require("dotenv").config();
const mongoose = require("mongoose");
const emailService = require("../services/emailService");
const User = require("../models/User");
const Match = require("../models/Match");

console.log("📧 TESTING NEW MATCH EMAIL FUNCTIONALITY");
console.log("==========================================\n");

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to MongoDB");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
}

async function createTestUsers() {
  try {
    console.log("👥 Creating test users...");

    // Create test user 1
    const user1 = new User({
      email: "alice@example.com",
      password: "TestPassword123!",
      firstName: "Alice",
      lastName: "Johnson",
      dateOfBirth: new Date("1995-06-15"),
      gender: "female",
      bio: "Love hiking, coffee shops, and good conversations! Looking for someone genuine who shares my passion for adventure and can make me laugh. Let's explore the city together! 🌟",
      photos: [
        {
          url: "https://images.unsplash.com/photo-1494790108755-2616b612b1ab?w=400",
          public_id: "alice_photo_1",
          isPrimary: true,
        },
        {
          url: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400",
          public_id: "alice_photo_2",
          isPrimary: false,
        },
      ],
      settings: {
        notifications: {
          email: true,
          matches: true,
        },
      },
    });

    // Create test user 2
    const user2 = new User({
      email: "bob@example.com",
      password: "TestPassword123!",
      firstName: "Bob",
      lastName: "Smith",
      dateOfBirth: new Date("1992-03-22"),
      gender: "male",
      bio: "Software developer by day, chef by night! I love trying new restaurants, playing guitar, and weekend getaways. Looking for someone to share life's adventures with.",
      photos: [
        {
          url: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
          public_id: "bob_photo_1",
          isPrimary: true,
        },
      ],
      settings: {
        notifications: {
          email: true,
          matches: true,
        },
      },
    });

    // Save users
    await user1.save();
    await user2.save();

    console.log(`✅ Created test user: ${user1.firstName} (${user1.email})`);
    console.log(`✅ Created test user: ${user2.firstName} (${user2.email})`);

    return { user1, user2 };
  } catch (error) {
    if (error.code === 11000) {
      console.log("📝 Test users already exist, fetching existing users...");
      const user1 = await User.findOne({ email: "alice@example.com" });
      const user2 = await User.findOne({ email: "bob@example.com" });
      return { user1, user2 };
    }
    throw error;
  }
}

async function createTestMatch(user1, user2) {
  try {
    console.log("\n💕 Creating test match...");

    // Create match
    const match = new Match({
      users: [user1._id, user2._id],
      initiatedBy: user1._id,
      matchType: "regular",
    });

    await match.save();
    console.log(`✅ Created match: ${match._id}`);

    return match;
  } catch (error) {
    console.error("❌ Error creating match:", error);
    throw error;
  }
}

async function testNewMatchEmail() {
  try {
    console.log("\n📧 Testing new match email service...");

    // Initialize email service
    const emailInitialized = await emailService.initialize();
    if (!emailInitialized) {
      console.log("❌ Email service failed to initialize");
      return false;
    }

    const { user1, user2 } = await createTestUsers();
    const match = await createTestMatch(user1, user2);

    // Test email to user1
    console.log(`\n📤 Sending match email to ${user1.firstName}...`);
    const result1 = await emailService.sendNewMatchEmail(user1, match, user2);

    if (result1.success) {
      console.log(`✅ Match email sent to ${user1.firstName}`);
      if (result1.previewUrl) {
        console.log(`📖 Preview: ${result1.previewUrl}`);
      }
    } else {
      console.log(`❌ Failed to send to ${user1.firstName}: ${result1.error}`);
    }

    // Test email to user2
    console.log(`\n📤 Sending match email to ${user2.firstName}...`);
    const result2 = await emailService.sendNewMatchEmail(user2, match, user1);

    if (result2.success) {
      console.log(`✅ Match email sent to ${user2.firstName}`);
      if (result2.previewUrl) {
        console.log(`📖 Preview: ${result2.previewUrl}`);
      }
    } else {
      console.log(`❌ Failed to send to ${user2.firstName}: ${result2.error}`);
    }

    return result1.success && result2.success;
  } catch (error) {
    console.error("❌ Error testing new match email:", error);
    return false;
  }
}

async function testEmailTemplate() {
  try {
    console.log("\n📄 Testing email template compilation...");

    const testData = {
      firstName: "TestUser",
      matchFirstName: "TestMatch",
      matchAge: 25,
      matchBio:
        "This is a test bio for template testing purposes. It should be displayed nicely in the email.",
      matchPhoto:
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400",
      chatUrl: `${process.env.FRONTEND_URL}/chat/test-match-id`,
      appUrl: process.env.FRONTEND_URL,
      unsubscribeUrl: `${process.env.FRONTEND_URL}/unsubscribe?email=test@example.com`,
    };

    const compiledTemplate = emailService.compileTemplate(
      "new-match",
      testData
    );
    console.log(
      `✅ Template compiled successfully (${compiledTemplate.length} characters)`
    );

    // Check if template contains expected content
    const requiredContent = [
      "It's a Match!",
      testData.firstName,
      testData.matchFirstName,
      testData.matchAge.toString(),
      "Start Chatting",
      "72 hours",
    ];

    let missingContent = [];
    requiredContent.forEach((content) => {
      if (!compiledTemplate.includes(content)) {
        missingContent.push(content);
      }
    });

    if (missingContent.length === 0) {
      console.log("✅ All required content found in template");
    } else {
      console.log("❌ Missing content in template:", missingContent);
    }

    return missingContent.length === 0;
  } catch (error) {
    console.error("❌ Error testing template:", error);
    return false;
  }
}

async function testTemplateWithRealData() {
  try {
    console.log("\n🧪 Testing template with real user data...");

    const { user1, user2 } = await createTestUsers();

    // Calculate age
    const calculateAge = (dateOfBirth) => {
      const today = new Date();
      const birthDate = new Date(dateOfBirth);
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      if (
        monthDiff < 0 ||
        (monthDiff === 0 && today.getDate() < birthDate.getDate())
      ) {
        age--;
      }
      return age;
    };

    const templateData = {
      firstName: user1.firstName,
      matchFirstName: user2.firstName,
      matchAge: calculateAge(user2.dateOfBirth),
      matchBio: user2.bio,
      matchPhoto:
        user2.photos?.find((p) => p.isPrimary)?.url || user2.photos?.[0]?.url,
      chatUrl: `${process.env.FRONTEND_URL}/chat/test-match-id`,
      appUrl: process.env.FRONTEND_URL,
      unsubscribeUrl: `${
        process.env.FRONTEND_URL
      }/unsubscribe?email=${encodeURIComponent(user1.email)}`,
    };

    const compiledTemplate = emailService.compileTemplate(
      "new-match",
      templateData
    );
    console.log("✅ Template compiled with real user data");
    console.log(`📊 Template length: ${compiledTemplate.length} characters`);
    console.log(`👤 User: ${templateData.firstName}`);
    console.log(
      `💕 Match: ${templateData.matchFirstName}, ${templateData.matchAge}`
    );
    console.log(`📝 Bio length: ${templateData.matchBio.length} characters`);

    return true;
  } catch (error) {
    console.error("❌ Error testing with real data:", error);
    return false;
  }
}

async function testEmailSettings() {
  try {
    console.log("\n⚙️ Testing email notification settings...");

    const { user1, user2 } = await createTestUsers();

    // Test user with notifications enabled
    console.log(`📧 ${user1.firstName} notifications:`, {
      email: user1.settings?.notifications?.email,
      matches: user1.settings?.notifications?.matches,
      shouldReceive:
        user1.settings?.notifications?.email !== false &&
        user1.settings?.notifications?.matches !== false,
    });

    // Test user with notifications disabled
    await User.findByIdAndUpdate(user2._id, {
      "settings.notifications.email": false,
    });

    const updatedUser2 = await User.findById(user2._id);
    console.log(`📧 ${updatedUser2.firstName} notifications:`, {
      email: updatedUser2.settings?.notifications?.email,
      matches: updatedUser2.settings?.notifications?.matches,
      shouldReceive:
        updatedUser2.settings?.notifications?.email !== false &&
        updatedUser2.settings?.notifications?.matches !== false,
    });

    // Reset for next tests
    await User.findByIdAndUpdate(user2._id, {
      "settings.notifications.email": true,
    });

    console.log("✅ Email settings test completed");
    return true;
  } catch (error) {
    console.error("❌ Error testing email settings:", error);
    return false;
  }
}

async function cleanup() {
  try {
    console.log("\n🧹 Cleaning up test data...");

    // Delete test users and their matches
    await User.deleteMany({
      email: { $in: ["alice@example.com", "bob@example.com"] },
    });

    await Match.deleteMany({
      users: { $exists: true },
    });

    console.log("✅ Test data cleaned up");
  } catch (error) {
    console.error("❌ Error during cleanup:", error);
  }
}

async function runTests() {
  try {
    await connectDB();

    console.log("🚀 Starting comprehensive new match email tests...\n");

    const tests = [
      {
        name: "Email Service Initialization",
        fn: () => emailService.initialize(),
      },
      { name: "Email Template Compilation", fn: testEmailTemplate },
      { name: "Template with Real Data", fn: testTemplateWithRealData },
      { name: "Email Notification Settings", fn: testEmailSettings },
      { name: "New Match Email Sending", fn: testNewMatchEmail },
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      try {
        console.log(`\n🧪 Running: ${test.name}`);
        const result = await test.fn();

        if (result) {
          console.log(`✅ PASSED: ${test.name}`);
          passed++;
        } else {
          console.log(`❌ FAILED: ${test.name}`);
          failed++;
        }
      } catch (error) {
        console.log(`❌ ERROR in ${test.name}:`, error.message);
        failed++;
      }
    }

    console.log("\n📊 TEST RESULTS");
    console.log("================");
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(
      `📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`
    );

    if (failed === 0) {
      console.log(
        "\n🎉 All tests passed! New match email functionality is working correctly."
      );
      console.log("\n📝 Next steps:");
      console.log("  1. Deploy the updated code to your server");
      console.log("  2. Test with real users in your development environment");
      console.log("  3. Monitor email delivery rates and user engagement");
      console.log("  4. Consider A/B testing different email templates");
    } else {
      console.log("\n⚠️  Some tests failed. Please review the errors above.");
    }

    // Cleanup
    await cleanup();
  } catch (error) {
    console.error("\n❌ Test suite failed:", error);
  } finally {
    mongoose.disconnect();
    process.exit(0);
  }
}

// Additional utility functions for testing
async function testEmailDeliveryWithDifferentProviders() {
  console.log("\n📬 Testing email delivery with different providers...");

  const originalProvider = process.env.EMAIL_PROVIDER;
  const providers = ["development", "gmail", "sendgrid"];

  for (const provider of providers) {
    try {
      console.log(`\n🔄 Testing with ${provider}...`);
      process.env.EMAIL_PROVIDER = provider;

      // Reinitialize email service with new provider
      emailService.initialized = false;
      const initialized = await emailService.initialize();

      if (initialized) {
        console.log(`✅ ${provider} initialized successfully`);
      } else {
        console.log(`❌ ${provider} failed to initialize`);
      }
    } catch (error) {
      console.log(`❌ ${provider} error:`, error.message);
    }
  }

  // Restore original provider
  process.env.EMAIL_PROVIDER = originalProvider;
  emailService.initialized = false;
  await emailService.initialize();
}

async function generateEmailPreviewHTML() {
  try {
    console.log("\n📋 Generating email preview HTML...");

    const testData = {
      firstName: "John",
      matchFirstName: "Emma",
      matchAge: 28,
      matchBio:
        "Adventure seeker, coffee lover, and dog mom! Looking for someone to explore the city with and share Sunday brunch adventures. Let's create some amazing memories together! 🌟☕🐕",
      matchPhoto:
        "https://images.unsplash.com/photo-1494790108755-2616b612b1ab?w=400",
      chatUrl: `${
        process.env.FRONTEND_URL || "https://habibi.app"
      }/chat/sample-match-id`,
      appUrl: process.env.FRONTEND_URL || "https://habibi.app",
      unsubscribeUrl: `${
        process.env.FRONTEND_URL || "https://habibi.app"
      }/unsubscribe?email=john@example.com`,
    };

    const html = emailService.compileTemplate("new-match", testData);

    // Save preview to file
    const fs = require("fs").promises;
    const path = require("path");
    const previewPath = path.join(__dirname, "../preview-new-match-email.html");

    await fs.writeFile(previewPath, html);
    console.log(`✅ Preview saved to: ${previewPath}`);
    console.log(
      "🌐 Open this file in your browser to see how the email looks!"
    );

    return true;
  } catch (error) {
    console.error("❌ Error generating preview:", error);
    return false;
  }
}

// Handle command line arguments
if (require.main === module) {
  const testType = process.argv[2] || "all";

  switch (testType) {
    case "email":
      connectDB()
        .then(() => testNewMatchEmail())
        .then(() => process.exit(0));
      break;
    case "template":
      connectDB()
        .then(() => testEmailTemplate())
        .then(() => process.exit(0));
      break;
    case "preview":
      emailService
        .initialize()
        .then(() => generateEmailPreviewHTML())
        .then(() => process.exit(0));
      break;
    case "providers":
      testEmailDeliveryWithDifferentProviders().then(() => process.exit(0));
      break;
    case "all":
    default:
      runTests();
      break;
  }
}

module.exports = {
  testNewMatchEmail,
  testEmailTemplate,
  testTemplateWithRealData,
  generateEmailPreviewHTML,
};
