// Test Cloudinary configuration
require("dotenv").config();
const { v2: cloudinary } = require("cloudinary");

console.log("🔍 Testing Cloudinary Configuration...\n");

// Check environment variables
console.log("Environment Variables:");
console.log(
  "CLOUDINARY_CLOUD_NAME:",
  process.env.CLOUDINARY_CLOUD_NAME ? "SET" : "NOT SET"
);
console.log(
  "CLOUDINARY_API_KEY:",
  process.env.CLOUDINARY_API_KEY ? "SET" : "NOT SET"
);
console.log(
  "CLOUDINARY_API_SECRET:",
  process.env.CLOUDINARY_API_SECRET ? "SET" : "NOT SET"
);

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Test Cloudinary connection
async function testCloudinary() {
  try {
    console.log("\n🧪 Testing Cloudinary connection...");

    // Try to get account info
    const result = await cloudinary.api.ping();
    console.log("✅ Cloudinary connection successful:", result);

    // Test upload capabilities
    console.log("\n📤 Testing upload capabilities...");
    const uploadResult = await cloudinary.uploader.upload(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      {
        public_id: "test_upload",
        folder: "habibi/test",
      }
    );
    console.log("✅ Test upload successful:", uploadResult.public_id);

    // Clean up test upload
    await cloudinary.uploader.destroy(uploadResult.public_id);
    console.log("✅ Test upload cleaned up");
  } catch (error) {
    console.error("❌ Cloudinary test failed:", error.message);
    console.error("Error details:", error);
  }
}

testCloudinary();
