// test/integration.js - Basic integration tests for Habibi

const axios = require("axios");
const io = require("socket.io-client");

const API_URL = "http://localhost:5000";
const SOCKET_URL = "http://localhost:5000";

// Test configuration
const testConfig = {
  timeout: 10000,
  apiUrl: API_URL,
  socketUrl: SOCKET_URL,
};

// Test users
const testUsers = [
  {
    email: "alice@test.com",
    password: "Test123!@#",
    firstName: "Alice",
    lastName: "Johnson",
    dateOfBirth: "1995-03-15",
    gender: "female",
  },
  {
    email: "bob@test.com",
    password: "Test123!@#",
    firstName: "Bob",
    lastName: "Smith",
    dateOfBirth: "1992-07-22",
    gender: "male",
  },
];

// Global test state
const testState = {
  users: [],
  tokens: [],
  sockets: [],
};

// Utility functions
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logTest = (message, status = "info") => {
  const timestamp = new Date().toISOString();
  const emoji = status === "success" ? "✅" : status === "error" ? "❌" : "🧪";
  console.log(`${emoji} [${timestamp}] ${message}`);
};

const apiCall = async (method, endpoint, data = null, token = null) => {
  try {
    const config = {
      method,
      url: `${testConfig.apiUrl}${endpoint}`,
      timeout: testConfig.timeout,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      ...(data && { data }),
    };

    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || { message: error.message },
    };
  }
};

// Test functions
async function testServerHealth() {
  logTest("Testing server health...");

  const result = await apiCall("GET", "/health");

  if (result.success && result.data.success) {
    logTest(`Server is healthy! Uptime: ${result.data.uptime}s`, "success");
    return true;
  } else {
    logTest("Server health check failed", "error");
    return false;
  }
}

async function testUserRegistration() {
  logTest("Testing user registration...");

  for (let i = 0; i < testUsers.length; i++) {
    const userData = testUsers[i];
    const result = await apiCall("POST", "/api/auth/register", userData);

    if (result.success && result.data.success) {
      testState.users.push(result.data.user);
      testState.tokens.push(result.data.token);
      logTest(`User ${userData.firstName} registered successfully`, "success");
    } else {
      logTest(
        `Failed to register ${userData.firstName}: ${result.error.message}`,
        "error"
      );
      return false;
    }
  }

  return true;
}

async function testUserLogin() {
  logTest("Testing user login...");

  const loginData = {
    email: testUsers[0].email,
    password: testUsers[0].password,
  };

  const result = await apiCall("POST", "/api/auth/login", loginData);

  if (result.success && result.data.success) {
    logTest("User login successful", "success");
    return true;
  } else {
    logTest(`Login failed: ${result.error.message}`, "error");
    return false;
  }
}

async function testProfileOperations() {
  logTest("Testing profile operations...");

  const token = testState.tokens[0];

  // Get profile
  const getResult = await apiCall("GET", "/api/profile", null, token);
  if (!getResult.success) {
    logTest("Failed to get profile", "error");
    return false;
  }

  // Update profile
  const updateData = {
    bio: "This is a test bio for integration testing!",
  };

  const updateResult = await apiCall(
    "PUT",
    "/api/profile/basic",
    updateData,
    token
  );
  if (updateResult.success) {
    logTest("Profile updated successfully", "success");
    return true;
  } else {
    logTest("Failed to update profile", "error");
    return false;
  }
}

async function testDiscoveryEndpoint() {
  logTest("Testing discovery endpoint...");

  const token = testState.tokens[0];
  const result = await apiCall("GET", "/api/matching/discover", null, token);

  if (result.success && result.data.success) {
    logTest(
      `Discovery returned ${result.data.users.length} potential matches`,
      "success"
    );
    return true;
  } else {
    logTest(`Discovery failed: ${result.error.message}`, "error");
    return false;
  }
}

async function testSocketConnection() {
  logTest("Testing Socket.io connection...");

  return new Promise((resolve) => {
    const token = testState.tokens[0];
    const socket = io(testConfig.socketUrl, {
      auth: { token },
      transports: ["polling", "websocket"],
    });

    const timeout = setTimeout(() => {
      logTest("Socket connection timeout", "error");
      socket.disconnect();
      resolve(false);
    }, 5000);

    socket.on("connect", () => {
      clearTimeout(timeout);
      logTest("Socket connected successfully", "success");
      testState.sockets.push(socket);

      socket.on("connection_confirmed", (data) => {
        logTest(
          `Socket connection confirmed for user: ${data.userId}`,
          "success"
        );
        resolve(true);
      });
    });

    socket.on("connect_error", (error) => {
      clearTimeout(timeout);
      logTest(`Socket connection failed: ${error.message}`, "error");
      resolve(false);
    });
  });
}

async function testChatFunctionality() {
  logTest("Testing chat functionality...");

  // This is a simplified test - in reality you'd need two users and a match
  return new Promise((resolve) => {
    if (testState.sockets.length === 0) {
      logTest("No socket connection available for chat test", "error");
      resolve(false);
      return;
    }

    const socket = testState.sockets[0];

    socket.emit("ping");

    socket.on("pong", (data) => {
      logTest(`Chat ping/pong successful at ${data.timestamp}`, "success");
      resolve(true);
    });

    setTimeout(() => {
      logTest("Chat ping/pong timeout", "error");
      resolve(false);
    }, 3000);
  });
}

async function cleanup() {
  logTest("Cleaning up test data...");

  // Disconnect sockets
  testState.sockets.forEach((socket) => {
    socket.disconnect();
  });

  // In a real test, you'd also clean up test users from the database
  logTest("Cleanup completed", "success");
}

// Main test runner
async function runIntegrationTests() {
  console.log("\n🚀 HABIBI INTEGRATION TESTS");
  console.log("============================\n");

  const tests = [
    { name: "Server Health", fn: testServerHealth },
    { name: "User Registration", fn: testUserRegistration },
    { name: "User Login", fn: testUserLogin },
    { name: "Profile Operations", fn: testProfileOperations },
    { name: "Discovery Endpoint", fn: testDiscoveryEndpoint },
    { name: "Socket Connection", fn: testSocketConnection },
    { name: "Chat Functionality", fn: testChatFunctionality },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      logTest(`Test "${test.name}" threw an error: ${error.message}`, "error");
      failed++;
    }

    // Wait between tests
    await delay(1000);
  }

  // Cleanup
  await cleanup();

  // Final results
  console.log("\n📊 TEST RESULTS");
  console.log("================");
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(
    `📈 Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%\n`
  );

  if (failed === 0) {
    console.log(
      "🎉 All tests passed! Your Habibi platform is working correctly!\n"
    );
  } else {
    console.log(
      "⚠️  Some tests failed. Please check the logs above for details.\n"
    );
  }

  process.exit(failed === 0 ? 0 : 1);
}

// Run tests if this file is executed directly
if (require.main === module) {
  runIntegrationTests().catch((error) => {
    console.error("❌ Test runner failed:", error);
    process.exit(1);
  });
}

module.exports = {
  runIntegrationTests,
  testConfig,
  testUsers,
};
