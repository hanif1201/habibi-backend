// services/firebaseAdmin.js - NEW FILE
const admin = require("firebase-admin");

class FirebaseService {
  constructor() {
    this.initialized = false;
    this.app = null;
  }

  async initialize() {
    try {
      if (this.initialized) {
        return this.app;
      }

      // Check for required environment variables
      if (
        !process.env.FIREBASE_PROJECT_ID ||
        !process.env.FIREBASE_PRIVATE_KEY
      ) {
        console.log(
          "⚠️  Firebase credentials not found. Push notifications will be simulated."
        );
        return null;
      }

      // Parse the private key (handle escaped newlines)
      const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n");

      const serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: privateKey,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token",
        auth_provider_x509_cert_url:
          "https://www.googleapis.com/oauth2/v1/certs",
        client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.FIREBASE_CLIENT_EMAIL}`,
      };

      this.app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID,
      });

      console.log("✅ Firebase Admin SDK initialized successfully");
      this.initialized = true;
      return this.app;
    } catch (error) {
      console.error("❌ Firebase initialization error:", error);
      console.log("📝 Push notifications will be simulated instead");
      return null;
    }
  }

  async sendNotification(tokens, payload, options = {}) {
    try {
      if (!this.app) {
        await this.initialize();
      }

      if (!this.app) {
        // Simulate notification for development
        return this.simulateNotification(tokens, payload);
      }

      // Ensure tokens is an array
      const tokenArray = Array.isArray(tokens) ? tokens : [tokens];

      // Filter out invalid tokens
      const validTokens = tokenArray.filter(
        (token) => token && typeof token === "string" && token.length > 10
      );

      if (validTokens.length === 0) {
        return {
          success: false,
          error: "No valid tokens provided",
          results: [],
        };
      }

      const message = {
        notification: {
          title: payload.title,
          body: payload.body,
          ...(payload.icon && { imageUrl: payload.icon }),
        },
        data: {
          ...payload.data,
          // Ensure all data values are strings
          timestamp: new Date().toISOString(),
        },
        android: {
          notification: {
            icon: "ic_notification",
            color: "#FF69B4", // Habibi pink
            ...(payload.vibrate && { vibrateTimingsMillis: payload.vibrate }),
            channelId: "habibi_messages",
            priority: "high",
          },
          data: payload.data,
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: payload.title,
                body: payload.body,
              },
              badge: payload.badge || 1,
              sound: payload.sound || "default",
              category: payload.data?.type || "default",
            },
          },
        },
        webpush: {
          headers: {
            TTL: "86400", // 24 hours
          },
          notification: {
            title: payload.title,
            body: payload.body,
            icon: payload.icon || "/icon-192x192.png",
            badge: "/badge-72x72.png",
            tag: payload.tag || "default",
            requireInteraction: payload.requireInteraction || false,
            ...(payload.actions && { actions: payload.actions }),
            data: payload.data,
          },
          fcmOptions: {
            link: payload.data?.url || "/",
          },
        },
        ...options,
      };

      let response;
      if (validTokens.length === 1) {
        // Send to single device
        response = await admin.messaging().send({
          ...message,
          token: validTokens[0],
        });

        return {
          success: true,
          results: [
            {
              success: true,
              messageId: response,
              token: validTokens[0],
            },
          ],
          successCount: 1,
          failureCount: 0,
        };
      } else {
        // Send to multiple devices
        response = await admin.messaging().sendMulticast({
          ...message,
          tokens: validTokens,
        });

        const results = response.responses.map((resp, index) => ({
          success: resp.success,
          messageId: resp.messageId,
          error: resp.error?.message,
          token: validTokens[index],
        }));

        return {
          success: response.successCount > 0,
          results,
          successCount: response.successCount,
          failureCount: response.failureCount,
          invalidTokens: results
            .filter(
              (r) =>
                r.error && r.error.includes("registration-token-not-registered")
            )
            .map((r) => r.token),
        };
      }
    } catch (error) {
      console.error("❌ Firebase notification error:", error);
      return {
        success: false,
        error: error.message,
        results: [],
      };
    }
  }

  // Simulate notifications for development
  simulateNotification(tokens, payload) {
    const tokenArray = Array.isArray(tokens) ? tokens : [tokens];

    console.log("🔔 SIMULATED PUSH NOTIFICATION");
    console.log("==============================");
    console.log(`📱 To: ${tokenArray.length} device(s)`);
    console.log(`🏷️  Title: ${payload.title}`);
    console.log(`💬 Body: ${payload.body}`);
    console.log(`📊 Data:`, payload.data);
    console.log("==============================\n");

    const results = tokenArray.map((token) => ({
      success: true,
      messageId: `sim_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      token: token,
      simulated: true,
    }));

    return {
      success: true,
      results,
      successCount: results.length,
      failureCount: 0,
      simulated: true,
    };
  }

  async subscribeToTopic(tokens, topic) {
    try {
      if (!this.app) {
        await this.initialize();
      }

      if (!this.app) {
        console.log(
          `🔔 SIMULATED: Subscribe ${tokens.length} tokens to topic: ${topic}`
        );
        return { success: true, simulated: true };
      }

      const tokenArray = Array.isArray(tokens) ? tokens : [tokens];
      const response = await admin
        .messaging()
        .subscribeToTopic(tokenArray, topic);

      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
        errors: response.errors,
      };
    } catch (error) {
      console.error("❌ Topic subscription error:", error);
      return { success: false, error: error.message };
    }
  }

  async unsubscribeFromTopic(tokens, topic) {
    try {
      if (!this.app) {
        await this.initialize();
      }

      if (!this.app) {
        console.log(
          `🔔 SIMULATED: Unsubscribe ${tokens.length} tokens from topic: ${topic}`
        );
        return { success: true, simulated: true };
      }

      const tokenArray = Array.isArray(tokens) ? tokens : [tokens];
      const response = await admin
        .messaging()
        .unsubscribeFromTopic(tokenArray, topic);

      return {
        success: response.successCount > 0,
        successCount: response.successCount,
        failureCount: response.failureCount,
      };
    } catch (error) {
      console.error("❌ Topic unsubscription error:", error);
      return { success: false, error: error.message };
    }
  }

  async sendToTopic(topic, notification, data = {}) {
    try {
      if (!this.app) {
        await this.initialize();
      }

      if (!this.app) {
        console.log(
          `🔔 SIMULATED: Send to topic "${topic}": ${notification.title}`
        );
        return { success: true, simulated: true };
      }

      const message = {
        notification,
        data: {
          ...data,
          timestamp: new Date().toISOString(),
        },
        topic,
      };

      const response = await admin.messaging().send(message);

      return {
        success: true,
        messageId: response,
      };
    } catch (error) {
      console.error("❌ Topic notification error:", error);
      return { success: false, error: error.message };
    }
  }

  async validateTokens(tokens) {
    try {
      if (!this.app) {
        return { validTokens: tokens, invalidTokens: [] };
      }

      // This would use Firebase's dryRun feature to validate tokens
      // For now, we'll do basic validation
      const tokenArray = Array.isArray(tokens) ? tokens : [tokens];

      const validTokens = tokenArray.filter(
        (token) => token && typeof token === "string" && token.length > 10
      );

      const invalidTokens = tokenArray.filter(
        (token) => !token || typeof token !== "string" || token.length <= 10
      );

      return { validTokens, invalidTokens };
    } catch (error) {
      console.error("❌ Token validation error:", error);
      return { validTokens: [], invalidTokens: tokens };
    }
  }

  isInitialized() {
    return this.initialized;
  }

  async healthCheck() {
    try {
      if (!this.app) {
        await this.initialize();
      }

      return {
        healthy: !!this.app,
        initialized: this.initialized,
        timestamp: new Date().toISOString(),
        ...(this.app && { projectId: this.app.options.projectId }),
      };
    } catch (error) {
      return {
        healthy: false,
        initialized: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Export singleton instance
module.exports = new FirebaseService();
