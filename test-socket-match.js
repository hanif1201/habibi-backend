const io = require("socket.io-client");
const jwt = require("jsonwebtoken");

// Test configuration
const SERVER_URL = process.env.SERVER_URL || "http://localhost:5000";
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL || "test@example.com";
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD || "testpassword123";

console.log("🧪 Testing Socket Match Notifications");
console.log("=====================================");
console.log(`Server: ${SERVER_URL}`);
console.log("");

// Helper function to create JWT token
function createTestToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET || "your-secret-key", {
    expiresIn: "1h",
  });
}

// Test user IDs (you'll need to replace these with actual user IDs from your database)
const USER1_ID = process.env.TEST_USER1_ID || "507f1f77bcf86cd799439011";
const USER2_ID = process.env.TEST_USER2_ID || "507f1f77bcf86cd799439012";

async function testSocketMatchNotification() {
  console.log("🔌 Connecting to socket server...");

  // Create two socket connections to simulate two users
  const socket1 = io(SERVER_URL, {
    auth: {
      token: createTestToken(USER1_ID),
    },
  });

  const socket2 = io(SERVER_URL, {
    auth: {
      token: createTestToken(USER2_ID),
    },
  });

  // Set up event listeners for both sockets
  socket1.on("connect", () => {
    console.log("✅ User 1 connected to socket");
  });

  socket2.on("connect", () => {
    console.log("✅ User 2 connected to socket");
  });

  socket1.on("new_match", (data) => {
    console.log("💕 User 1 received match notification:", {
      matchId: data.match._id,
      users: data.match.users.map((u) => u.firstName),
      timestamp: data.timestamp,
    });
  });

  socket2.on("new_match", (data) => {
    console.log("💕 User 2 received match notification:", {
      matchId: data.match._id,
      users: data.match.users.map((u) => u.firstName),
      timestamp: data.timestamp,
    });
  });

  socket1.on("error", (error) => {
    console.error("❌ User 1 socket error:", error);
  });

  socket2.on("error", (error) => {
    console.error("❌ User 2 socket error:", error);
  });

  socket1.on("disconnect", () => {
    console.log("🔌 User 1 disconnected");
  });

  socket2.on("disconnect", () => {
    console.log("🔌 User 2 disconnected");
  });

  // Wait for both connections to be established
  await new Promise((resolve) => {
    let connectedCount = 0;
    const checkConnection = () => {
      connectedCount++;
      if (connectedCount === 2) {
        setTimeout(resolve, 1000); // Wait 1 second for full connection
      }
    };

    socket1.on("connect", checkConnection);
    socket2.on("connect", checkConnection);
  });

  console.log("");
  console.log("🎯 Testing match notification...");
  console.log("   (This simulates what happens when a match is created)");
  console.log("");

  // Simulate match data (similar to what would be sent from the swipe endpoint)
  const testMatchData = {
    _id: "507f1f77bcf86cd799439013",
    users: [
      {
        _id: USER1_ID,
        firstName: "Alice",
        lastName: "Smith",
        photos: [{ url: "https://example.com/photo1.jpg", isPrimary: true }],
        primaryPhoto: {
          url: "https://example.com/photo1.jpg",
          isPrimary: true,
        },
      },
      {
        _id: USER2_ID,
        firstName: "Bob",
        lastName: "Johnson",
        photos: [{ url: "https://example.com/photo2.jpg", isPrimary: true }],
        primaryPhoto: {
          url: "https://example.com/photo2.jpg",
          isPrimary: true,
        },
      },
    ],
    matchType: "regular",
    createdAt: new Date(),
    initiatedBy: USER1_ID,
  };

  // Test the socket notification function directly
  try {
    console.log("📡 Sending test match notification...");

    // This would normally be called from the swipe endpoint
    // For testing, we'll simulate it by making a request to trigger a match
    const response = await fetch(
      `${SERVER_URL}/api/debug/test-match-notification`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${createTestToken(USER1_ID)}`,
        },
        body: JSON.stringify({
          user1Id: USER1_ID,
          user2Id: USER2_ID,
          matchData: testMatchData,
        }),
      }
    );

    if (response.ok) {
      const result = await response.json();
      console.log("✅ Test match notification sent successfully");
      console.log("📊 Results:", result);
    } else {
      console.log(
        "⚠️  Debug endpoint not available, testing with direct socket call..."
      );

      // Fallback: test the socket function directly if debug endpoint doesn't exist
      // This would require the socket handler to be accessible
      console.log(
        "💡 To test with real data, create a match through the swipe endpoint"
      );
      console.log("   or implement the debug endpoint in routes/debug.js");
    }
  } catch (error) {
    console.error("❌ Error testing match notification:", error.message);
  }

  // Wait a bit to see the notifications
  console.log("");
  console.log("⏳ Waiting 5 seconds to see notifications...");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Clean up
  console.log("");
  console.log("🧹 Cleaning up connections...");
  socket1.disconnect();
  socket2.disconnect();

  console.log("");
  console.log("✅ Test completed!");
  console.log("");
  console.log("📝 To test with real data:");
  console.log("   1. Replace USER1_ID and USER2_ID with actual user IDs");
  console.log("   2. Create a match through the swipe endpoint");
  console.log("   3. Check the console for real-time notifications");
}

// Run the test
testSocketMatchNotification().catch(console.error);
