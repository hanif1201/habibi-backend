// Test photo upload with detailed error logging
const FormData = require("form-data");
const fs = require("fs");
const axios = require("axios");

async function testPhotoUpload() {
  try {
    console.log("🧪 Testing photo upload...\n");

    // Create a simple test image (1x1 pixel PNG)
    const testImageData = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64"
    );
    const testImagePath = "test-image.png";
    fs.writeFileSync(testImagePath, testImageData);

    console.log("📸 Created test image:", testImagePath);

    // Create form data
    const form = new FormData();
    form.append("photo", fs.createReadStream(testImagePath), {
      filename: "test-image.png",
      contentType: "image/png",
    });

    const token =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2ODZhZGUzMTU5YTc0NWRjMjBhMWIwOGQiLCJpYXQiOjE3NTE4MzQxNjIsImV4cCI6MTc1MjQzODk2MiwiYXVkIjoiaGFiaWJpLXVzZXJzIiwiaXNzIjoiaGFiaWJpLWFwcCJ9._IJHM52ios0RbAOnRHEfYzGRmqxpGHGXJUMjPONUI8I";

    console.log("📤 Uploading test image...");

    const response = await axios.post(
      "http://localhost:5000/api/photos/upload",
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${token}`,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    console.log("✅ Upload successful!");
    console.log("Response:", response.data);

    // Clean up
    fs.unlinkSync(testImagePath);
  } catch (error) {
    console.error("❌ Upload failed:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
      console.error("Headers:", error.response.headers);
    } else {
      console.error("Error:", error.message);
    }
  }
}

// Check if axios is available
try {
  require("axios");
  testPhotoUpload();
} catch (e) {
  console.log("❌ Axios not installed. Installing...");
  console.log("Run: npm install axios");
}
