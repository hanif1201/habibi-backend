// routes/email.js - Email Management and Testing Routes
const express = require("express");
const { body, validationResult } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const User = require("../models/User");
const emailService = require("../services/emailService");
const emailJobs = require("../jobs/emailJobs");

const router = express.Router();

// @route   GET /api/email/health
// @desc    Check email system health
// @access  Private (could be public for monitoring)
router.get("/health", async (req, res) => {
  try {
    const health = await emailService.healthCheck();
    const jobsStatus = emailJobs.getJobStatus();

    res.json({
      success: true,
      emailService: health,
      emailJobs: jobsStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error checking email health",
      error: error.message,
    });
  }
});

// @route   POST /api/email/test
// @desc    Send test email to authenticated user
// @access  Private
router.post("/test", authenticate, async (req, res) => {
  try {
    const user = req.user;

    // Send test email
    const result = await emailService.sendEmail(
      user.email,
      "🧪 Test Email from Habibi",
      "reminder",
      {
        firstName: user.firstName,
        title: "🧪 Test Email",
        message:
          "This is a test email from your Habibi dating platform. If you can read this, the email system is working perfectly!",
        actionUrl: process.env.FRONTEND_URL,
        actionText: "Visit Habibi",
        footerMessage: "Email system is working! 🎉",
      }
    );

    if (result.success) {
      res.json({
        success: true,
        message: "Test email sent successfully",
        messageId: result.messageId,
        previewUrl: result.previewUrl,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to send test email",
        error: result.error,
      });
    }
  } catch (error) {
    console.error("Test email error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending test email",
      error: error.message,
    });
  }
});

// @route   POST /api/email/send-welcome
// @desc    Manually trigger welcome email for a user
// @access  Private
router.post("/send-welcome", authenticate, async (req, res) => {
  try {
    const user = req.user;

    // Generate verification token if needed
    let verificationToken = user.emailVerificationToken;
    if (!verificationToken) {
      verificationToken = emailService.generateVerificationToken();
      await User.findByIdAndUpdate(user._id, {
        emailVerificationToken: verificationToken,
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
    }

    const result = await emailService.sendWelcomeEmail(user, verificationToken);

    if (result.success) {
      res.json({
        success: true,
        message: "Welcome email sent successfully",
        messageId: result.messageId,
        previewUrl: result.previewUrl,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to send welcome email",
        error: result.error,
      });
    }
  } catch (error) {
    console.error("Welcome email error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending welcome email",
      error: error.message,
    });
  }
});

// @route   POST /api/email/send-weekly-summary
// @desc    Manually trigger weekly summary for a user
// @access  Private
router.post("/send-weekly-summary", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    const result = await emailJobs.triggerWeeklySummary(userId);

    if (result.success) {
      res.json({
        success: true,
        message: "Weekly summary email sent successfully",
        details: result,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to send weekly summary",
        error: result.error,
      });
    }
  } catch (error) {
    console.error("Weekly summary error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending weekly summary",
      error: error.message,
    });
  }
});

// @route   POST /api/email/send-custom
// @desc    Send custom email (admin only)
// @access  Private (Admin)
router.post(
  "/send-custom",
  authenticate,
  [
    body("to").isEmail().withMessage("Valid email address required"),
    body("subject").notEmpty().withMessage("Subject is required"),
    body("template").notEmpty().withMessage("Template name is required"),
    body("templateData")
      .optional()
      .isObject()
      .withMessage("Template data must be an object"),
  ],
  async (req, res) => {
    try {
      // TODO: Add proper admin check
      const isAdmin = req.user.email === "admin@habibi.com"; // Replace with your admin logic

      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          message: "Admin access required",
        });
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { to, subject, template, templateData = {} } = req.body;

      const result = await emailService.sendEmail(
        to,
        subject,
        template,
        templateData
      );

      if (result.success) {
        res.json({
          success: true,
          message: "Custom email sent successfully",
          messageId: result.messageId,
          previewUrl: result.previewUrl,
        });
      } else {
        res.status(500).json({
          success: false,
          message: "Failed to send custom email",
          error: result.error,
        });
      }
    } catch (error) {
      console.error("Custom email error:", error);
      res.status(500).json({
        success: false,
        message: "Error sending custom email",
        error: error.message,
      });
    }
  }
);

// @route   GET /api/email/templates
// @desc    Get list of available email templates
// @access  Private
router.get("/templates", authenticate, (req, res) => {
  try {
    const templates = [
      {
        name: "welcome",
        description: "Welcome email with verification link",
        variables: ["firstName", "verificationUrl"],
      },
      {
        name: "password-reset",
        description: "Password reset email",
        variables: ["firstName", "resetUrl"],
      },
      {
        name: "email-verification",
        description: "Email verification request",
        variables: ["firstName", "verificationUrl"],
      },
      {
        name: "weekly-matches",
        description: "Weekly match summary",
        variables: [
          "firstName",
          "newMatches",
          "profileViews",
          "likes",
          "newMatchesList",
          "appUrl",
          "unsubscribeUrl",
        ],
      },
      {
        name: "new-match",
        description: "New match notification",
        variables: [
          "firstName",
          "matchFirstName",
          "matchAge",
          "matchBio",
          "matchPhoto",
          "chatUrl",
        ],
      },
      {
        name: "reminder",
        description: "Generic reminder template",
        variables: [
          "firstName",
          "title",
          "message",
          "actionUrl",
          "actionText",
          "footerMessage",
        ],
      },
    ];

    res.json({
      success: true,
      templates,
      totalTemplates: templates.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching templates",
      error: error.message,
    });
  }
});

// @route   GET /api/email/jobs/status
// @desc    Get email jobs status
// @access  Private (Admin)
router.get("/jobs/status", authenticate, (req, res) => {
  try {
    // TODO: Add proper admin check
    const isAdmin = req.user.email === "admin@habibi.com";

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    const status = emailJobs.getJobStatus();

    res.json({
      success: true,
      ...status,
      environment: process.env.NODE_ENV,
      emailJobsEnabled:
        process.env.ENABLE_EMAIL_JOBS === "true" ||
        process.env.NODE_ENV === "production",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching job status",
      error: error.message,
    });
  }
});

// @route   POST /api/email/jobs/start
// @desc    Start email jobs (admin only)
// @access  Private (Admin)
router.post("/jobs/start", authenticate, (req, res) => {
  try {
    // TODO: Add proper admin check
    const isAdmin = req.user.email === "admin@habibi.com";

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    if (emailJobs.isRunning) {
      return res.status(400).json({
        success: false,
        message: "Email jobs are already running",
      });
    }

    emailJobs.start();

    res.json({
      success: true,
      message: "Email jobs started successfully",
      status: emailJobs.getJobStatus(),
    });
  } catch (error) {
    console.error("Start jobs error:", error);
    res.status(500).json({
      success: false,
      message: "Error starting email jobs",
      error: error.message,
    });
  }
});

// @route   POST /api/email/jobs/stop
// @desc    Stop email jobs (admin only)
// @access  Private (Admin)
router.post("/jobs/stop", authenticate, (req, res) => {
  try {
    // TODO: Add proper admin check
    const isAdmin = req.user.email === "admin@habibi.com";

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    if (!emailJobs.isRunning) {
      return res.status(400).json({
        success: false,
        message: "Email jobs are not running",
      });
    }

    emailJobs.stop();

    res.json({
      success: true,
      message: "Email jobs stopped successfully",
      status: emailJobs.getJobStatus(),
    });
  } catch (error) {
    console.error("Stop jobs error:", error);
    res.status(500).json({
      success: false,
      message: "Error stopping email jobs",
      error: error.message,
    });
  }
});

// @route   POST /api/email/jobs/trigger/:jobName
// @desc    Manually trigger specific email job (admin only)
// @access  Private (Admin)
router.post("/jobs/trigger/:jobName", authenticate, async (req, res) => {
  try {
    // TODO: Add proper admin check
    const isAdmin = req.user.email === "admin@habibi.com";

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    const { jobName } = req.params;
    const { userId } = req.body; // Optional user ID for user-specific jobs

    let result;

    switch (jobName) {
      case "weekly-summary":
        result = await emailJobs.triggerWeeklySummary(userId);
        break;
      case "welcome":
        if (!userId) {
          return res.status(400).json({
            success: false,
            message: "User ID required for welcome email",
          });
        }
        result = await emailJobs.triggerWelcomeEmail(userId);
        break;
      case "inactive-reminders":
        await emailJobs.sendInactiveUserReminders();
        result = {
          success: true,
          message: "Inactive user reminders triggered",
        };
        break;
      case "match-expiration":
        await emailJobs.sendMatchExpirationWarnings();
        result = {
          success: true,
          message: "Match expiration warnings triggered",
        };
        break;
      case "welcome-followup":
        await emailJobs.sendWelcomeFollowUps();
        result = { success: true, message: "Welcome follow-ups triggered" };
        break;
      case "profile-completion":
        await emailJobs.sendProfileCompletionReminders();
        result = {
          success: true,
          message: "Profile completion reminders triggered",
        };
        break;
      case "cleanup-tokens":
        await emailJobs.cleanupExpiredTokens();
        result = { success: true, message: "Token cleanup completed" };
        break;
      default:
        return res.status(400).json({
          success: false,
          message: `Unknown job: ${jobName}`,
          availableJobs: [
            "weekly-summary",
            "welcome",
            "inactive-reminders",
            "match-expiration",
            "welcome-followup",
            "profile-completion",
            "cleanup-tokens",
          ],
        });
    }

    if (result.success) {
      res.json({
        success: true,
        message: `Job '${jobName}' triggered successfully`,
        result,
      });
    } else {
      res.status(500).json({
        success: false,
        message: `Failed to trigger job '${jobName}'`,
        error: result.error,
      });
    }
  } catch (error) {
    console.error(`Trigger job ${req.params.jobName} error:`, error);
    res.status(500).json({
      success: false,
      message: `Error triggering job '${req.params.jobName}'`,
      error: error.message,
    });
  }
});

// @route   GET /api/email/stats
// @desc    Get email statistics (admin only)
// @access  Private (Admin)
router.get("/stats", authenticate, async (req, res) => {
  try {
    // TODO: Add proper admin check
    const isAdmin = req.user.email === "admin@habibi.com";

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Admin access required",
      });
    }

    const stats = await emailJobs.getEmailStats();

    res.json({
      success: true,
      stats,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Email stats error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching email statistics",
      error: error.message,
    });
  }
});

// @route   POST /api/email/unsubscribe
// @desc    Handle email unsubscribe requests
// @access  Public
router.post(
  "/unsubscribe",
  [
    body("email").isEmail().withMessage("Valid email address required"),
    body("type")
      .optional()
      .isIn(["all", "weekly", "reminders", "marketing"])
      .withMessage("Invalid unsubscribe type"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: errors.array(),
        });
      }

      const { email, type = "all" } = req.body;

      const user = await User.findOne({ email });
      if (!user) {
        // Don't reveal if email exists for privacy
        return res.json({
          success: true,
          message: "Unsubscribe request processed",
        });
      }

      // Update notification preferences based on type
      const updateData = {};

      switch (type) {
        case "all":
          updateData["settings.notifications.email"] = false;
          break;
        case "weekly":
          updateData["settings.notifications.weeklyEmails"] = false;
          break;
        case "reminders":
          updateData["settings.notifications.reminders"] = false;
          break;
        case "marketing":
          updateData["settings.notifications.marketing"] = false;
          break;
      }

      await User.findByIdAndUpdate(user._id, updateData);

      console.log(`📧 User ${email} unsubscribed from ${type} emails`);

      res.json({
        success: true,
        message: "Unsubscribe request processed successfully",
      });
    } catch (error) {
      console.error("Unsubscribe error:", error);
      res.status(500).json({
        success: false,
        message: "Error processing unsubscribe request",
        error: error.message,
      });
    }
  }
);

// @route   GET /api/email/preview/:template
// @desc    Preview email template with sample data
// @access  Private
router.get("/preview/:template", authenticate, (req, res) => {
  try {
    const { template } = req.params;

    // Sample data for preview
    const sampleData = {
      firstName: "John",
      lastName: "Doe",
      verificationUrl: `${process.env.FRONTEND_URL}/verify-email?token=sample-token`,
      resetUrl: `${process.env.FRONTEND_URL}/reset-password?token=sample-token`,
      matchFirstName: "Jane",
      matchAge: 25,
      matchBio:
        "Love hiking, coffee, and good conversations! Looking for someone genuine.",
      matchPhoto:
        "https://images.unsplash.com/photo-1494790108755-2616b612b1ab?w=200",
      chatUrl: `${process.env.FRONTEND_URL}/chat/sample-match-id`,
      newMatches: 3,
      profileViews: 15,
      likes: 8,
      newMatchesList: [
        {
          firstName: "Emma",
          age: 24,
          bio: "Yoga instructor and travel enthusiast...",
          photo:
            "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200",
        },
        {
          firstName: "Sophie",
          age: 27,
          bio: "Art lover and foodie looking for adventure...",
          photo:
            "https://images.unsplash.com/photo-1489424731084-a5d8b219a5bb?w=200",
        },
      ],
      appUrl: process.env.FRONTEND_URL,
      unsubscribeUrl: `${process.env.FRONTEND_URL}/unsubscribe?email=john@example.com`,
      title: "Sample Notification",
      message:
        "This is a sample message for preview purposes. Your actual message will appear here.",
      actionUrl: process.env.FRONTEND_URL,
      actionText: "Take Action",
      footerMessage: "Thanks for using Habibi! 💕",
    };

    try {
      const compiledTemplate = emailService.compileTemplate(
        template,
        sampleData
      );

      res.send(compiledTemplate); // Return HTML for preview
    } catch (templateError) {
      res.status(404).json({
        success: false,
        message: `Template '${template}' not found`,
        availableTemplates: [
          "welcome",
          "password-reset",
          "email-verification",
          "weekly-matches",
          "new-match",
          "reminder",
        ],
      });
    }
  } catch (error) {
    console.error("Template preview error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating template preview",
      error: error.message,
    });
  }
});

module.exports = router;
