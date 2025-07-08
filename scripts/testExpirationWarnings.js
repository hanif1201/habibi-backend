// scripts/testExpirationWarnings.js - Test Progressive Expiration Warnings
const mongoose = require("mongoose");
const Match = require("../models/Match");
const User = require("../models/User");
const emailJobs = require("../jobs/emailJobs");

// Connect to MongoDB
mongoose.connect(
  process.env.MONGODB_URI || "mongodb://localhost:27017/habibi",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
);

async function testExpirationWarnings() {
  try {
    console.log("🧪 Testing Progressive Expiration Warnings...\n");

    // 1. Check current matches
    const now = new Date();
    const activeMatches = await Match.countDocuments({
      status: "active",
      firstMessageSentAt: null,
    });

    console.log(`📊 Current active matches: ${activeMatches}`);

    // 2. Get matches expiring in different intervals
    const intervals = [24, 12, 6, 2, 1];

    for (const hours of intervals) {
      const expiringMatches = await Match.countDocuments({
        status: "active",
        firstMessageSentAt: null,
        expiresAt: {
          $gt: now,
          $lt: new Date(now.getTime() + hours * 60 * 60 * 1000),
        },
      });

      console.log(`⏰ Matches expiring in ${hours}h: ${expiringMatches}`);
    }

    // 3. Test specific interval (e.g., 6 hours)
    console.log("\n🧪 Testing 6-hour expiration warnings...");
    const testResult = await emailJobs.triggerExpirationWarnings(6);
    console.log("Test result:", testResult);

    // 4. Check warning tracking
    const matchesWithWarnings = await Match.countDocuments({
      "warningSent.6": true,
    });
    console.log(`📧 Matches with 6h warnings sent: ${matchesWithWarnings}`);

    // 5. Test all intervals
    console.log("\n🧪 Testing all expiration warning intervals...");
    const allResult = await emailJobs.triggerExpirationWarnings();
    console.log("All intervals result:", allResult);

    console.log("\n✅ Progressive expiration warnings test completed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
}

// Run the test
if (require.main === module) {
  testExpirationWarnings();
}

module.exports = { testExpirationWarnings };
