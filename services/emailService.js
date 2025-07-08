// services/emailService.js - Updated with New Match Email Method
const nodemailer = require("nodemailer");
const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const User = require("../models/User");
const Match = require("../models/Match");

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
    this.templates = new Map();
    this.fromEmail = process.env.FROM_EMAIL || "noreply@habibi.com";
    this.fromName = process.env.FROM_NAME || "Habibi Dating";
  }

  async initialize() {
    try {
      if (this.initialized) return true;

      // Initialize email transporter based on provider
      await this.setupTransporter();

      // Load email templates
      await this.loadTemplates();

      // Verify connection
      await this.verifyConnection();

      this.initialized = true;
      console.log("✅ Email service initialized successfully");
      return true;
    } catch (error) {
      console.error("❌ Email service initialization failed:", error);
      return false;
    }
  }

  async setupTransporter() {
    const emailProvider = process.env.EMAIL_PROVIDER || "sendgrid";

    switch (emailProvider) {
      case "sendgrid":
        await this.setupSendGrid();
        break;
      case "gmail":
        await this.setupGmail();
        break;
      case "smtp":
        await this.setupSMTP();
        break;
      default:
        await this.setupDevelopment();
    }
  }

  async setupSendGrid() {
    if (!process.env.SENDGRID_API_KEY) {
      throw new Error("SENDGRID_API_KEY is required for SendGrid");
    }

    this.transporter = nodemailer.createTransporter({
      service: "SendGrid",
      auth: {
        user: "apikey",
        pass: process.env.SENDGRID_API_KEY,
      },
    });

    console.log("📧 Email configured with SendGrid");
  }

  async setupGmail() {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      throw new Error(
        "GMAIL_USER and GMAIL_APP_PASSWORD are required for Gmail"
      );
    }

    this.transporter = nodemailer.createTransporter({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    console.log("📧 Email configured with Gmail");
  }

  async setupSMTP() {
    if (!process.env.SMTP_HOST || !process.env.SMTP_PORT) {
      throw new Error("SMTP_HOST and SMTP_PORT are required for SMTP");
    }

    this.transporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    console.log("📧 Email configured with SMTP");
  }

  async setupDevelopment() {
    // Use Ethereal Email for development/testing
    const testAccount = await nodemailer.createTestAccount();

    this.transporter = nodemailer.createTransporter({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });

    console.log("📧 Email configured for development (Ethereal)");
    console.log(`   Preview emails at: https://ethereal.email/messages`);
  }

  async verifyConnection() {
    try {
      await this.transporter.verify();
      console.log("✅ Email transporter verified");
    } catch (error) {
      console.error("❌ Email transporter verification failed:", error);
      throw error;
    }
  }

  async loadTemplates() {
    const templatesDir = path.join(__dirname, "../templates");

    try {
      // Check if templates directory exists
      await fs.access(templatesDir);
    } catch {
      // Create templates directory if it doesn't exist
      await fs.mkdir(templatesDir, { recursive: true });
      console.log("📁 Created templates directory");
    }

    const templateFiles = [
      "welcome.html",
      "password-reset.html",
      "email-verification.html",
      "weekly-matches.html",
      "new-match.html", // Added new match template
      "reminder.html",
      // Progressive expiration warning templates
      "match-expiration-24h.html",
      "match-expiration-12h.html",
      "match-expiration-6h.html",
      "match-expiration-2h.html",
      "match-expiration-1h.html",
    ];

    for (const templateFile of templateFiles) {
      try {
        const templatePath = path.join(templatesDir, templateFile);
        const templateContent = await fs.readFile(templatePath, "utf8");
        const templateName = path.basename(templateFile, ".html");
        this.templates.set(templateName, templateContent);
        console.log(`📄 Loaded template: ${templateName}`);
      } catch (error) {
        // Template doesn't exist, will use default
        console.log(`⚠️  Template ${templateFile} not found, using default`);
        this.templates.set(
          path.basename(templateFile, ".html"),
          this.getDefaultTemplate(templateFile)
        );
      }
    }
  }

  getDefaultTemplate(templateName) {
    const templates = {
      "welcome.html": `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Welcome to Habibi</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #FF69B4, #FF1493); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #ddd; }
            .button { background: #FF69B4; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; margin: 20px 0; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; border-radius: 0 0 10px 10px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>💕 Welcome to Habibi!</h1>
            <p>Your journey to find love starts here</p>
          </div>
          <div class="content">
            <h2>Hi {{firstName}}!</h2>
            <p>Welcome to Habibi, where meaningful connections happen every day. We're excited to help you find that special someone!</p>
            
            <h3>🎯 Complete Your Profile</h3>
            <p>To get the best matches, make sure to:</p>
            <ul>
              <li>Add at least 3 photos</li>
              <li>Write an engaging bio</li>
              <li>Set your preferences</li>
              <li>Verify your account</li>
            </ul>
            
            <a href="{{verificationUrl}}" class="button">Verify Your Email</a>
            
            <h3>💡 Pro Tips for Success</h3>
            <ul>
              <li>Be authentic in your photos and bio</li>
              <li>Stay active and swipe regularly</li>
              <li>Start conversations with thoughtful messages</li>
              <li>Be respectful and kind</li>
            </ul>
          </div>
          <div class="footer">
            <p>Happy matching! ❤️<br>The Habibi Team</p>
            <p><small>If you didn't create this account, please ignore this email.</small></p>
          </div>
        </body>
        </html>
      `,
      "password-reset.html": `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Reset Your Password - Habibi</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #FF69B4; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #ddd; }
            .button { background: #FF69B4; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; margin: 20px 0; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; border-radius: 0 0 10px 10px; }
            .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>🔐 Password Reset</h1>
          </div>
          <div class="content">
            <h2>Hi {{firstName}},</h2>
            <p>We received a request to reset your password for your Habibi account.</p>
            
            <div class="warning">
              <strong>⚠️ Security Notice:</strong> This link will expire in 1 hour for your security.
            </div>
            
            <a href="{{resetUrl}}" class="button">Reset Your Password</a>
            
            <p>If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">{{resetUrl}}</p>
            
            <h3>🛡️ Didn't request this?</h3>
            <p>If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
            
            <p><strong>Tips for a secure password:</strong></p>
            <ul>
              <li>Use at least 8 characters</li>
              <li>Include uppercase and lowercase letters</li>
              <li>Add numbers and special characters</li>
              <li>Don't reuse passwords from other sites</li>
            </ul>
          </div>
          <div class="footer">
            <p>Stay safe! 🛡️<br>The Habibi Security Team</p>
          </div>
        </body>
        </html>
      `,
      "email-verification.html": `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Verify Your Email - Habibi</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #FF69B4, #FF1493); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #ddd; }
            .button { background: #FF69B4; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; margin: 20px 0; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; border-radius: 0 0 10px 10px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>✉️ Verify Your Email</h1>
          </div>
          <div class="content">
            <h2>Hi {{firstName}},</h2>
            <p>Thanks for joining Habibi! Please verify your email address to complete your registration and start finding meaningful connections.</p>
            
            <a href="{{verificationUrl}}" class="button">Verify Email Address</a>
            
            <p>If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">{{verificationUrl}}</p>
            
            <h3>Why verify your email?</h3>
            <ul>
              <li>✅ Increase trust with other users</li>
              <li>🔒 Secure your account</li>
              <li>📧 Receive important updates</li>
              <li>💕 Get match notifications</li>
            </ul>
            
            <p><strong>This verification link expires in 24 hours.</strong></p>
          </div>
          <div class="footer">
            <p>Welcome to the community! 💖<br>The Habibi Team</p>
          </div>
        </body>
        </html>
      `,
      "weekly-matches.html": `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Your Weekly Match Summary - Habibi</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #FF69B4, #FF1493); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #ddd; }
            .stats { display: flex; justify-content: space-around; margin: 20px 0; }
            .stat { text-align: center; padding: 15px; background: #f8f9fa; border-radius: 10px; margin: 0 5px; }
            .stat-number { font-size: 24px; font-weight: bold; color: #FF69B4; }
            .match-card { border: 1px solid #ddd; border-radius: 10px; padding: 15px; margin: 15px 0; display: flex; align-items: center; }
            .match-photo { width: 60px; height: 60px; border-radius: 50%; margin-right: 15px; background: #f0f0f0; }
            .button { background: #FF69B4; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; margin: 20px 0; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; border-radius: 0 0 10px 10px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>📊 Your Weekly Summary</h1>
            <p>Here's what happened this week on Habibi</p>
          </div>
          <div class="content">
            <h2>Hi {{firstName}}!</h2>
            
            <div class="stats">
              <div class="stat">
                <div class="stat-number">{{newMatches}}</div>
                <div>New Matches</div>
              </div>
              <div class="stat">
                <div class="stat-number">{{profileViews}}</div>
                <div>Profile Views</div>
              </div>
              <div class="stat">
                <div class="stat-number">{{likes}}</div>
                <div>Likes Received</div>
              </div>
            </div>
            
            {{#if hasNewMatches}}
            <h3>💕 New Matches This Week</h3>
            {{#each newMatchesList}}
            <div class="match-card">
              <img src="{{photo}}" class="match-photo" alt="{{firstName}}">
              <div>
                <strong>{{firstName}}, {{age}}</strong>
                <p style="margin: 5px 0; color: #666;">{{bio}}</p>
              </div>
            </div>
            {{/each}}
            {{/if}}
            
            <a href="{{appUrl}}" class="button">Continue Your Journey</a>
            
            <h3>💡 Tips to Get More Matches</h3>
            <ul>
              <li>Update your photos regularly</li>
              <li>Write a compelling bio</li>
              <li>Be active and swipe daily</li>
              <li>Start conversations with matches</li>
            </ul>
          </div>
          <div class="footer">
            <p>Keep spreading the love! ❤️<br>The Habibi Team</p>
            <p><small><a href="{{unsubscribeUrl}}">Unsubscribe from weekly emails</a></small></p>
          </div>
        </body>
        </html>
      `,
      "new-match.html": `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>It's a Match! - Habibi</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fa; }
            .container { background: white; border-radius: 15px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #FFD700, #FF69B4, #FF1493); color: white; padding: 40px 30px; text-align: center; }
            .header h1 { margin: 0 0 10px 0; font-size: 32px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); }
            .content { background: white; padding: 40px 30px; }
            .match-card { border: 3px solid #FF69B4; border-radius: 20px; padding: 25px; margin: 25px 0; text-align: center; background: linear-gradient(135deg, #fff5f8, #ffffff); box-shadow: 0 4px 15px rgba(255, 105, 180, 0.2); }
            .match-photo { width: 120px; height: 120px; border-radius: 50%; margin: 0 auto 20px; background: #f0f0f0; border: 4px solid #FF69B4; box-shadow: 0 4px 15px rgba(255, 105, 180, 0.3); object-fit: cover; }
            .match-name { font-size: 24px; font-weight: bold; color: #FF1493; margin: 0 0 10px 0; }
            .match-bio { color: #666; font-style: italic; line-height: 1.5; margin: 10px 0 20px 0; }
            .button { background: linear-gradient(135deg, #FF69B4, #FF1493); color: white; padding: 18px 35px; text-decoration: none; border-radius: 30px; display: inline-block; margin: 25px 0; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(255, 105, 180, 0.4); }
            .urgency-notice { background: linear-gradient(135deg, #FFF3CD, #FFEAA7); border: 2px solid #FFD700; border-radius: 10px; padding: 20px; margin: 25px 0; text-align: center; }
            .footer { background: #f8f9fa; padding: 30px; text-align: center; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 It's a Match!</h1>
              <p>Someone special likes you back! 💝</p>
            </div>
            <div class="content">
              <h2>Hi {{firstName}}!</h2>
              <p style="font-size: 18px;">Great news! You and <strong>{{matchFirstName}}</strong> liked each other. This is the beginning of something beautiful! 💕</p>
              
              <div class="match-card">
                <img src="{{matchPhoto}}" class="match-photo" alt="{{matchFirstName}}" onerror="this.style.display='none'">
                <div class="match-name">{{matchFirstName}}, {{matchAge}}</div>
                <div class="match-bio">{{matchBio}}</div>
              </div>
              
              <div style="text-align: center;">
                <a href="{{chatUrl}}" class="button">💬 Start Chatting</a>
              </div>
              
              <div class="urgency-notice">
                <strong>⏰ Important:</strong> You have 72 hours to start a conversation before this match expires. Don't wait - break the ice now!
              </div>
              
              <h3>💬 Great Conversation Starters</h3>
              <ul>
                <li>"Hi {{matchFirstName}}! How's your day going?"</li>
                <li>"I love your photos! Where was that photo taken?"</li>
                <li>"We seem to have something in common. Tell me more about [shared interest]"</li>
                <li>"{{matchFirstName}}, your bio made me smile! Tell me more about [specific detail]"</li>
              </ul>
            </div>
            <div class="footer">
              <p style="font-size: 18px; color: #FF69B4; font-weight: bold;">Happy chatting! 💕</p>
              <p>The Habibi Team</p>
            </div>
          </div>
        </body>
        </html>
      `,
      "reminder.html": `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>{{subject}} - Habibi</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #FF69B4; color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: white; padding: 30px; border: 1px solid #ddd; }
            .button { background: #FF69B4; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; margin: 20px 0; }
            .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; border-radius: 0 0 10px 10px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>{{title}}</h1>
          </div>
          <div class="content">
            <h2>Hi {{firstName}},</h2>
            <p>{{message}}</p>
            
            {{#if actionUrl}}
            <a href="{{actionUrl}}" class="button">{{actionText}}</a>
            {{/if}}
          </div>
          <div class="footer">
            <p>{{footerMessage}}<br>The Habibi Team</p>
          </div>
        </body>
        </html>
      `,
    };

    return (
      templates[templateName] ||
      "<html><body><h1>{{title}}</h1><p>{{message}}</p></body></html>"
    );
  }

  compileTemplate(templateName, data) {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Template "${templateName}" not found`);
    }

    // Simple template compilation (replace {{variable}} with data)
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return data[key] || match;
    });
  }

  async sendEmail(to, subject, templateName, templateData = {}) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      if (!this.transporter) {
        console.error("❌ Email transporter not initialized");
        return { success: false, error: "Email service not available" };
      }

      // Compile template
      const html = this.compileTemplate(templateName, templateData);

      // Email options
      const mailOptions = {
        from: `"${this.fromName}" <${this.fromEmail}>`,
        to,
        subject,
        html,
        // Generate text version from HTML
        text: html
          .replace(/<[^>]*>/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      };

      // Send email
      const info = await this.transporter.sendMail(mailOptions);

      console.log(`✅ Email sent to ${to}: ${subject}`);

      // Log preview URL for development
      if (process.env.NODE_ENV === "development" && info.messageId) {
        console.log(`📧 Preview: ${nodemailer.getTestMessageUrl(info)}`);
      }

      return {
        success: true,
        messageId: info.messageId,
        previewUrl:
          process.env.NODE_ENV === "development"
            ? nodemailer.getTestMessageUrl(info)
            : null,
      };
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // === SPECIFIC EMAIL METHODS ===

  async sendWelcomeEmail(user, verificationToken) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    return await this.sendEmail(
      user.email,
      "💕 Welcome to Habibi - Verify Your Email",
      "welcome",
      {
        firstName: user.firstName,
        verificationUrl,
      }
    );
  }

  async sendPasswordResetEmail(user, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    return await this.sendEmail(
      user.email,
      "🔐 Reset Your Habibi Password",
      "password-reset",
      {
        firstName: user.firstName,
        resetUrl,
      }
    );
  }

  async sendEmailVerification(user, verificationToken) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    return await this.sendEmail(
      user.email,
      "✉️ Verify Your Email Address",
      "email-verification",
      {
        firstName: user.firstName,
        verificationUrl,
      }
    );
  }

  // *** NEW: Send New Match Email Method ***
  async sendNewMatchEmail(user, match, otherUser) {
    try {
      // Calculate other user's age
      const calculateAge = (dateOfBirth) => {
        if (!dateOfBirth) return "Unknown";
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

      const chatUrl = `${process.env.FRONTEND_URL}/chat/${match._id}`;
      const appUrl = process.env.FRONTEND_URL;
      const unsubscribeUrl = `${
        process.env.FRONTEND_URL
      }/unsubscribe?email=${encodeURIComponent(user.email)}`;

      const templateData = {
        firstName: user.firstName,
        matchFirstName: otherUser.firstName,
        matchAge: calculateAge(otherUser.dateOfBirth),
        matchBio:
          otherUser.bio && otherUser.bio.length > 10
            ? otherUser.bio.substring(0, 150) +
              (otherUser.bio.length > 150 ? "..." : "")
            : "No bio available yet - ask them about themselves!",
        matchPhoto:
          otherUser.photos?.find((p) => p.isPrimary)?.url ||
          otherUser.photos?.[0]?.url ||
          "/default-avatar.png",
        chatUrl,
        appUrl,
        unsubscribeUrl,
      };

      const result = await this.sendEmail(
        user.email,
        `🎉 It's a Match with ${otherUser.firstName}!`,
        "new-match",
        templateData
      );

      if (result.success) {
        console.log(
          `💕 New match email sent to ${user.firstName} (${user.email}) about match with ${otherUser.firstName}`
        );
      }

      return result;
    } catch (error) {
      console.error("❌ Error sending new match email:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async sendWeeklyMatchSummary(user, weeklyStats) {
    const appUrl = process.env.FRONTEND_URL;
    const unsubscribeUrl = `${
      process.env.FRONTEND_URL
    }/unsubscribe?email=${encodeURIComponent(user.email)}`;

    return await this.sendEmail(
      user.email,
      "📊 Your Weekly Habibi Summary",
      "weekly-matches",
      {
        firstName: user.firstName,
        newMatches: weeklyStats.newMatches || 0,
        profileViews: weeklyStats.profileViews || 0,
        likes: weeklyStats.likes || 0,
        hasNewMatches:
          weeklyStats.newMatchesList && weeklyStats.newMatchesList.length > 0,
        newMatchesList: weeklyStats.newMatchesList || [],
        appUrl,
        unsubscribeUrl,
      }
    );
  }

  async sendReminderEmail(user, reminderData) {
    return await this.sendEmail(user.email, reminderData.subject, "reminder", {
      firstName: user.firstName,
      title: reminderData.title,
      message: reminderData.message,
      actionUrl: reminderData.actionUrl,
      actionText: reminderData.actionText || "Take Action",
      footerMessage: reminderData.footerMessage || "See you soon! 💕",
    });
  }

  // *** NEW: Send Progressive Expiration Warning Email ***
  async sendExpirationWarningEmail(user, match, otherUser, hoursRemaining) {
    try {
      const chatUrl = `${process.env.FRONTEND_URL}/chat/${match._id}`;
      const appUrl = process.env.FRONTEND_URL;
      const unsubscribeUrl = `${
        process.env.FRONTEND_URL
      }/unsubscribe?email=${encodeURIComponent(user.email)}`;

      // Determine template and subject based on hours remaining
      let templateName, subject;

      switch (hoursRemaining) {
        case 24:
          templateName = "match-expiration-24h";
          subject = "⏰ Your match expires in 24 hours";
          break;
        case 12:
          templateName = "match-expiration-12h";
          subject = "⚠️ Your match expires in 12 hours!";
          break;
        case 6:
          templateName = "match-expiration-6h";
          subject = "🚨 URGENT: Your match expires in 6 hours!";
          break;
        case 2:
          templateName = "match-expiration-2h";
          subject = "🚨 CRITICAL: Your match expires in 2 hours!";
          break;
        case 1:
          templateName = "match-expiration-1h";
          subject = "🚨 FINAL WARNING: Your match expires in 1 hour!";
          break;
        default:
          templateName = "match-expiration-6h";
          subject = "⏰ Your match expires soon!";
      }

      const templateData = {
        firstName: user.firstName,
        matchName: otherUser.firstName,
        timeRemaining: hoursRemaining,
        actionUrl: chatUrl,
        appUrl,
        unsubscribeUrl,
      };

      const result = await this.sendEmail(
        user.email,
        subject,
        templateName,
        templateData
      );

      if (result.success) {
        console.log(
          `⏰ ${hoursRemaining}h expiration warning sent to ${user.firstName} (${user.email}) about match with ${otherUser.firstName}`
        );
      }

      return result;
    } catch (error) {
      console.error("❌ Error sending expiration warning email:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // === UTILITY METHODS ===

  generateVerificationToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  generatePasswordResetToken() {
    return crypto.randomBytes(32).toString("hex");
  }

  async healthCheck() {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      await this.transporter.verify();

      return {
        healthy: true,
        initialized: this.initialized,
        templatesLoaded: this.templates.size,
        provider: process.env.EMAIL_PROVIDER || "development",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = new EmailService();
