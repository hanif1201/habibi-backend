// Test the discover endpoint
const axios = require("axios");

async function testDiscover() {
  try {
    console.log("🧪 Testing /api/matching/discover endpoint...\n");

    // You'll need to replace this with a valid JWT token from a logged-in user
    const token = "YOUR_JWT_TOKEN_HERE";

    if (token === "YOUR_JWT_TOKEN_HERE") {
      console.log(
        "❌ Please replace YOUR_JWT_TOKEN_HERE with a valid JWT token"
      );
      console.log("To get a token:");
      console.log("1. Register a user: POST /api/auth/register");
      console.log("2. Login: POST /api/auth/login");
      console.log("3. Use the token from the response");
      return;
    }

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
    console.log("Response status:", response.status);
    console.log("Users found:", response.data.users?.length || 0);
    console.log("Response data:", JSON.stringify(response.data, null, 2));
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

testDiscover();
