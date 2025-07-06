// Test authentication and get a token
const axios = require("axios");

async function testAuth() {
  try {
    console.log("🧪 Testing authentication...\n");

    // Test user data
    const userData = {
      email: "test@example.com",
      password: "password123",
      firstName: "Test",
      lastName: "User",
      dateOfBirth: "1990-01-01",
      gender: "male",
    };

    // Try to register
    console.log("📝 Attempting to register user...");
    const registerResponse = await axios.post(
      "http://localhost:5000/api/auth/register",
      userData
    );

    console.log("✅ Registration successful!");
    console.log("Token:", registerResponse.data.token);
    console.log("User ID:", registerResponse.data.user._id);

    return registerResponse.data.token;
  } catch (error) {
    if (
      error.response &&
      error.response.status === 400 &&
      error.response.data.message.includes("already exists")
    ) {
      console.log("⚠️ User already exists, trying to login...");

      // Try to login instead
      const loginData = {
        email: "test@example.com",
        password: "password123",
      };

      const loginResponse = await axios.post(
        "http://localhost:5000/api/auth/login",
        loginData
      );

      console.log("✅ Login successful!");
      console.log("Token:", loginResponse.data.token);
      console.log("User ID:", loginResponse.data.user._id);

      return loginResponse.data.token;
    } else {
      console.error("❌ Authentication failed:");
      if (error.response) {
        console.error("Status:", error.response.status);
        console.error("Data:", error.response.data);
      } else {
        console.error("Error:", error.message);
      }
      return null;
    }
  }
}

// Test the discover endpoint with the token
async function testDiscoverWithToken(token) {
  if (!token) {
    console.log("❌ No token available for discover test");
    return;
  }

  try {
    console.log("\n🧪 Testing discover endpoint with token...");

    const response = await axios.get(
      "http://localhost:5000/api/matching/discover",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Discover endpoint successful!");
    console.log("Status:", response.status);
    console.log("Users found:", response.data.users?.length || 0);
    console.log("Response summary:", response.data.summary);
  } catch (error) {
    console.error("❌ Discover endpoint failed:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    } else {
      console.error("Error:", error.message);
    }
  }
}

// Run the tests
async function runTests() {
  const token = await testAuth();
  await testDiscoverWithToken(token);
}

runTests();
