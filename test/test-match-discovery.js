const axios = require("axios");
const mongoose = require("mongoose");

// Configuration
const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/habibi-test";

// Test state
const testState = {
  tokens: [],
  users: [],
  premiumUser: null,
  regularUser: null,
};

// Helper function to make API calls
async function apiCall(method, endpoint, data = null, token = null) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message,
    };
  }
}

// Helper function to log test results
function logTest(message, type = "info") {
  const timestamp = new Date().toISOString();
  const emoji = {
    info: "ℹ️",
    success: "✅",
    error: "❌",
    warning: "⚠️",
  }[type];

  console.log(`${emoji} [${timestamp}] ${message}`);
}

// Test functions
async function testSetup() {
  logTest("Setting up test environment...");

  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    logTest("Connected to MongoDB", "success");

    // Clear test data
    const User = require("../models/User");
    const Swipe = require("../models/Swipe");
    const Match = require("../models/Match");

    await User.deleteMany({ email: /test.*@example\.com/ });
    await Swipe.deleteMany({});
    await Match.deleteMany({});

    logTest("Cleared test data", "success");
  } catch (error) {
    logTest(`Setup failed: ${error.message}`, "error");
    throw error;
  }
}

async function createTestUsers() {
  logTest("Creating test users...");

  try {
    // Create premium user
    const premiumUserData = {
      email: "premium.test@example.com",
      password: "testpass123",
      firstName: "Premium",
      lastName: "User",
      dateOfBirth: "1990-01-01",
      gender: "female",
      bio: "I love hiking, photography, and coffee!",
      interests: ["hiking", "photography", "coffee", "travel"],
      subscription: {
        type: "premium",
        features: ["priority_likes", "super_likes", "boosts"],
      },
    };

    const premiumResult = await apiCall(
      "POST",
      "/api/auth/register",
      premiumUserData
    );
    if (!premiumResult.success) {
      throw new Error(
        `Premium user creation failed: ${premiumResult.error.message}`
      );
    }

    testState.premiumUser = premiumResult.data.user;
    testState.tokens.push(premiumResult.data.token);

    // Create regular user
    const regularUserData = {
      email: "regular.test@example.com",
      password: "testpass123",
      firstName: "Regular",
      lastName: "User",
      dateOfBirth: "1992-05-15",
      gender: "male",
      bio: "Passionate about music and cooking!",
      interests: ["music", "cooking", "movies"],
    };

    const regularResult = await apiCall(
      "POST",
      "/api/auth/register",
      regularUserData
    );
    if (!regularResult.success) {
      throw new Error(
        `Regular user creation failed: ${regularResult.error.message}`
      );
    }

    testState.regularUser = regularResult.data.user;
    testState.tokens.push(regularResult.data.token);

    // Create additional users for testing
    const additionalUsers = [
      {
        email: "user1.test@example.com",
        firstName: "Alice",
        lastName: "Johnson",
        dateOfBirth: "1988-03-20",
        gender: "female",
        bio: "Adventure seeker and dog lover!",
        interests: ["hiking", "dogs", "adventure"],
      },
      {
        email: "user2.test@example.com",
        firstName: "Bob",
        lastName: "Smith",
        dateOfBirth: "1991-07-10",
        gender: "male",
        bio: "Tech enthusiast and foodie!",
        interests: ["technology", "food", "gaming"],
      },
      {
        email: "user3.test@example.com",
        firstName: "Carol",
        lastName: "Davis",
        dateOfBirth: "1989-11-05",
        gender: "female",
        bio: "Yoga instructor and nature lover!",
        interests: ["yoga", "nature", "meditation"],
      },
    ];

    for (const userData of additionalUsers) {
      const result = await apiCall("POST", "/api/auth/register", {
        ...userData,
        password: "testpass123",
      });
      if (result.success) {
        testState.users.push(result.data.user);
      }
    }

    logTest(`Created ${testState.users.length + 2} test users`, "success");
  } catch (error) {
    logTest(`User creation failed: ${error.message}`, "error");
    throw error;
  }
}

async function testWhoLikedYou() {
  logTest("Testing 'Who Liked You' endpoint...");

  try {
    // First, make some users like the premium user
    const Swipe = require("../models/Swipe");

    // User 1 likes premium user
    await Swipe.create({
      swiper: testState.users[0]._id,
      swiped: testState.premiumUser._id,
      action: "like",
    });

    // User 2 superlikes premium user
    await Swipe.create({
      swiper: testState.users[1]._id,
      swiped: testState.premiumUser._id,
      action: "superlike",
    });

    // User 3 likes premium user
    await Swipe.create({
      swiper: testState.users[2]._id,
      swiped: testState.premiumUser._id,
      action: "like",
    });

    logTest("Created test swipes", "success");

    // Test premium user can access "who liked you"
    const premiumResult = await apiCall(
      "GET",
      "/api/matching/who-liked-you",
      null,
      testState.tokens[0]
    );

    if (premiumResult.success) {
      logTest(
        `Premium user found ${premiumResult.data.likes.length} likes`,
        "success"
      );
      logTest(`Superlikes: ${premiumResult.data.summary.superlikes}`, "info");
      logTest(
        `Regular likes: ${premiumResult.data.summary.regularLikes}`,
        "info"
      );
    } else {
      logTest(
        `Premium user test failed: ${premiumResult.error.message}`,
        "error"
      );
    }

    // Test regular user cannot access "who liked you"
    const regularResult = await apiCall(
      "GET",
      "/api/matching/who-liked-you",
      null,
      testState.tokens[1]
    );

    if (!regularResult.success && regularResult.error.requiresPremium) {
      logTest("Regular user correctly blocked from premium feature", "success");
    } else {
      logTest("Regular user should have been blocked", "error");
    }
  } catch (error) {
    logTest(`Who liked you test failed: ${error.message}`, "error");
  }
}

async function testMatchQueue() {
  logTest("Testing Match Queue endpoint...");

  try {
    // Test match queue for premium user
    const result = await apiCall(
      "GET",
      "/api/matching/match-queue?sort=compatibility&limit=10",
      null,
      testState.tokens[0]
    );

    if (result.success) {
      logTest(
        `Match queue returned ${result.data.matches.length} potential matches`,
        "success"
      );
      logTest(
        `High compatibility: ${result.data.summary.highCompatibility}`,
        "info"
      );
      logTest(`Verified users: ${result.data.summary.verified}`, "info");
      logTest(`Online now: ${result.data.summary.onlineNow}`, "info");

      // Check if matches have insights
      if (result.data.matches.length > 0) {
        const firstMatch = result.data.matches[0];
        if (firstMatch.matchInsights && firstMatch.icebreakerSuggestions) {
          logTest("Match insights and icebreakers included", "success");
        } else {
          logTest("Match insights missing", "warning");
        }
      }
    } else {
      logTest(`Match queue test failed: ${result.error.message}`, "error");
    }
  } catch (error) {
    logTest(`Match queue test failed: ${error.message}`, "error");
  }
}

async function testMatchInsights() {
  logTest("Testing Match Insights endpoint...");

  try {
    if (testState.users.length === 0) {
      logTest("No users available for insights test", "warning");
      return;
    }

    const targetUserId = testState.users[0]._id;
    const result = await apiCall(
      "GET",
      `/api/matching/insights/${targetUserId}`,
      null,
      testState.tokens[0]
    );

    if (result.success) {
      logTest("Match insights retrieved successfully", "success");
      logTest(
        `Compatibility score: ${result.data.insights.compatibilityScore}`,
        "info"
      );
      logTest(
        `Shared interests: ${result.data.insights.sharedInterests.count}`,
        "info"
      );
      logTest(
        `Icebreaker suggestions: ${result.data.insights.icebreakerSuggestions.length}`,
        "info"
      );
    } else {
      logTest(`Match insights test failed: ${result.error.message}`, "error");
    }
  } catch (error) {
    logTest(`Match insights test failed: ${error.message}`, "error");
  }
}

async function testEnhancedDiscovery() {
  logTest("Testing Enhanced Discovery endpoint...");

  try {
    const result = await apiCall(
      "GET",
      "/api/matching/discover?boost=true",
      null,
      testState.tokens[0]
    );

    if (result.success) {
      logTest(
        `Enhanced discovery returned ${result.data.users.length} users`,
        "success"
      );
      logTest(`Boost applied: ${result.data.boost}`, "info");
      logTest(`Summary: ${JSON.stringify(result.data.summary)}`, "info");
    } else {
      logTest(
        `Enhanced discovery test failed: ${result.error.message}`,
        "error"
      );
    }
  } catch (error) {
    logTest(`Enhanced discovery test failed: ${error.message}`, "error");
  }
}

async function runAllTests() {
  try {
    await testSetup();
    await createTestUsers();
    await testWhoLikedYou();
    await testMatchQueue();
    await testMatchInsights();
    await testEnhancedDiscovery();

    logTest("All Match Discovery Improvement tests completed!", "success");
  } catch (error) {
    logTest(`Test suite failed: ${error.message}`, "error");
  } finally {
    await mongoose.disconnect();
    logTest("Disconnected from MongoDB", "info");
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  runAllTests,
  testSetup,
  createTestUsers,
  testWhoLikedYou,
  testMatchQueue,
  testMatchInsights,
  testEnhancedDiscovery,
};
