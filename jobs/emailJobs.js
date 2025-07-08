// jobs/emailJobs.js - Scheduled Email System
const cron = require("node-cron");
const User = require("../models/User");
const Match = require("../models/Match");
const Message = require("../models/Message");
const Swipe = require("../models/Swipe");
const emailService = require("../services/emailService");

class EmailJobs {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      console.log("📧 Email jobs already running");
      return;
    }

    console.log("🚀 Starting email jobs...");

    // Weekly match summary - Sundays at 9 AM
    this.jobs.set(
      "weekly-summary",
      cron.schedule(
        "0 9 * * 0",
        async () => {
          await this.sendWeeklyMatchSummaries();
        },
        { scheduled: false }
      )
    );

    // Daily inactive user reminders - Every day at 7 PM
    this.jobs.set(
      "inactive-reminders",
      cron.schedule(
        "0 19 * * *",
        async () => {
          await this.sendInactiveUserReminders();
        },
        { scheduled: false }
      )
    );

    // Progressive match expiration warnings - Every hour
    this.jobs.set(
      "match-expiration",
      cron.schedule(
        "0 * * * *",
        async () => {
          await this.sendMatchExpirationWarnings();
        },
        { scheduled: false }
      )
    );

    // Welcome sequence follow-ups - Every day at 10 AM
    this.jobs.set(
      "welcome-followup",
      cron.schedule(
        "0 10 * * *",
        async () => {
          await this.sendWelcomeFollowUps();
        },
        { scheduled: false }
      )
    );

    // Profile completion reminders - Every Tuesday and Friday at 2 PM
    this.jobs.set(
      "profile-completion",
      cron.schedule(
        "0 14 * * 2,5",
        async () => {
          await this.sendProfileCompletionReminders();
        },
        { scheduled: false }
      )
    );

    // Cleanup email tokens - Daily at 2 AM
    this.jobs.set(
      "cleanup-tokens",
      cron.schedule(
        "0 2 * * *",
        async () => {
          await this.cleanupExpiredTokens();
        },
        { scheduled: false }
      )
    );

    // Start all jobs
    this.jobs.forEach((job, name) => {
      job.start();
      console.log(`✅ Started job: ${name}`);
    });

    this.isRunning = true;
    console.log("📧 All email jobs started successfully");
  }

  stop() {
    if (!this.isRunning) {
      console.log("📧 Email jobs not running");
      return;
    }

    this.jobs.forEach((job, name) => {
      job.stop();
      console.log(`🛑 Stopped job: ${name}`);
    });

    this.jobs.clear();
    this.isRunning = false;
    console.log("📧 All email jobs stopped");
  }

  // === JOB IMPLEMENTATIONS ===

  async sendWeeklyMatchSummaries() {
    try {
      console.log("📊 Starting weekly match summaries...");

      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Find users who want weekly emails
      const users = await User.find({
        isActive: true,
        "settings.notifications.email": { $ne: false },
        "settings.notifications.weeklyEmails": { $ne: false },
        createdAt: { $lt: oneWeekAgo }, // Don't send to brand new users
      }).select("_id firstName lastName email stats");

      let emailsSent = 0;
      let emailsFailed = 0;

      for (const user of users) {
        try {
          // Calculate weekly stats
          const weeklyStats = await this.calculateWeeklyStats(
            user._id,
            oneWeekAgo
          );

          // Only send if user had some activity
          if (
            weeklyStats.newMatches > 0 ||
            weeklyStats.profileViews > 0 ||
            weeklyStats.likes > 0
          ) {
            const result = await emailService.sendWeeklyMatchSummary(
              user,
              weeklyStats
            );

            if (result.success) {
              emailsSent++;
              console.log(
                `📧 Weekly summary sent to ${user.firstName} (${user.email})`
              );
            } else {
              emailsFailed++;
              console.error(
                `❌ Failed to send weekly summary to ${user.email}:`,
                result.error
              );
            }
          }

          // Rate limiting - wait 100ms between emails
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          emailsFailed++;
          console.error(
            `❌ Error processing weekly summary for user ${user._id}:`,
            error
          );
        }
      }

      console.log(
        `📊 Weekly summaries complete: ${emailsSent} sent, ${emailsFailed} failed`
      );
    } catch (error) {
      console.error("❌ Error in weekly match summaries job:", error);
    }
  }

  async calculateWeeklyStats(userId, oneWeekAgo) {
    try {
      const [matches, swipes, views] = await Promise.all([
        // New matches this week
        Match.find({
          users: userId,
          matchedAt: { $gte: oneWeekAgo },
        }).populate("users", "firstName lastName photos bio dateOfBirth"),

        // Swipes received this week (likes)
        Swipe.countDocuments({
          swiped: userId,
          action: { $in: ["like", "superlike"] },
          swipedAt: { $gte: oneWeekAgo },
        }),

        // Profile views (approximated by swipes on user)
        Swipe.countDocuments({
          swiped: userId,
          swipedAt: { $gte: oneWeekAgo },
        }),
      ]);

      // Format new matches for email
      const newMatchesList = matches.map((match) => {
        const otherUser = match.users.find(
          (u) => u._id.toString() !== userId.toString()
        );
        return {
          firstName: otherUser.firstName,
          age: this.calculateAge(otherUser.dateOfBirth),
          bio: otherUser.bio
            ? otherUser.bio.substring(0, 100) + "..."
            : "No bio available",
          photo: otherUser.photos?.[0]?.url || "",
        };
      });

      return {
        newMatches: matches.length,
        profileViews: views,
        likes: swipes,
        newMatchesList,
      };
    } catch (error) {
      console.error("Error calculating weekly stats:", error);
      return { newMatches: 0, profileViews: 0, likes: 0, newMatchesList: [] };
    }
  }

  async sendInactiveUserReminders() {
    try {
      console.log("💤 Starting inactive user reminders...");

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Find users inactive for 3+ days but less than 7 days
      const inactiveUsers = await User.find({
        isActive: true,
        lastActive: {
          $gte: oneWeekAgo,
          $lt: threeDaysAgo,
        },
        "settings.notifications.email": { $ne: false },
        "settings.notifications.reminders": { $ne: false },
      }).select("_id firstName lastName email lastActive");

      let emailsSent = 0;

      for (const user of inactiveUsers) {
        try {
          // Check if user has any pending matches
          const pendingMatches = await Match.countDocuments({
            users: user._id,
            status: "active",
            firstMessageSentAt: null,
            expiresAt: { $gt: new Date() },
          });

          const reminderData = {
            subject: "💕 Someone might be waiting for you!",
            title: "💕 Don't Miss Out!",
            message:
              pendingMatches > 0
                ? `You have ${pendingMatches} new match${
                    pendingMatches > 1 ? "es" : ""
                  } waiting! Don't let love slip away.`
                : "There are new people to discover on Habibi. Your perfect match might be just a swipe away!",
            actionUrl: process.env.FRONTEND_URL,
            actionText: "Start Swiping",
            footerMessage: "We miss you! 💕",
          };

          const result = await emailService.sendReminderEmail(
            user,
            reminderData
          );

          if (result.success) {
            emailsSent++;
            console.log(
              `📧 Inactive reminder sent to ${user.firstName} (${user.email})`
            );
          }

          // Rate limiting
          await new Promise((resolve) => setTimeout(resolve, 200));
        } catch (error) {
          console.error(
            `❌ Error sending inactive reminder to user ${user._id}:`,
            error
          );
        }
      }

      console.log(`💤 Inactive reminders complete: ${emailsSent} sent`);
    } catch (error) {
      console.error("❌ Error in inactive user reminders job:", error);
    }
  }

  async sendMatchExpirationWarnings() {
    try {
      console.log("⏰ Starting progressive match expiration warnings...");

      const now = new Date();
      const warningIntervals = [24, 12, 6, 2, 1]; // Hours remaining
      let totalEmailsSent = 0;
      let totalPushNotificationsSent = 0;

      for (const hoursRemaining of warningIntervals) {
        try {
          const emailsSent = await this.processExpirationWarnings(
            hoursRemaining,
            now
          );
          const pushNotificationsSent =
            await this.processExpirationPushNotifications(hoursRemaining, now);

          totalEmailsSent += emailsSent;
          totalPushNotificationsSent += pushNotificationsSent;

          console.log(
            `⏰ ${hoursRemaining}h warnings: ${emailsSent} emails, ${pushNotificationsSent} push notifications sent`
          );
        } catch (error) {
          console.error(
            `❌ Error processing ${hoursRemaining}h warnings:`,
            error
          );
        }
      }

      console.log(
        `⏰ Progressive expiration warnings complete: ${totalEmailsSent} emails, ${totalPushNotificationsSent} push notifications sent`
      );
    } catch (error) {
      console.error(
        "❌ Error in progressive match expiration warnings job:",
        error
      );
    }
  }

  async processExpirationWarnings(hoursRemaining, now) {
    try {
      // Calculate the time window for this specific interval
      const timeWindowStart = new Date(
        now.getTime() + hoursRemaining * 60 * 60 * 1000
      );
      const timeWindowEnd = new Date(
        timeWindowStart.getTime() + 60 * 60 * 1000
      ); // 1 hour window

      // Find matches that should receive warnings for this interval
      const matchesToWarn = await Match.find({
        status: "active",
        firstMessageSentAt: null,
        expiresAt: {
          $gte: timeWindowStart,
          $lt: timeWindowEnd,
        },
        [`warningSent.${hoursRemaining}`]: { $ne: true }, // Haven't sent this warning yet
      }).populate("users", "firstName lastName email settings");

      let emailsSent = 0;

      for (const match of matchesToWarn) {
        try {
          // Double-check if we should send this warning
          if (!match.shouldSendWarning(hoursRemaining)) {
            continue;
          }

          for (const user of match.users) {
            // Check if user wants expiration warnings
            if (
              user.settings?.notifications?.email === false ||
              user.settings?.notifications?.matchExpiring === false
            ) {
              continue;
            }

            const otherUser = match.users.find(
              (u) => u._id.toString() !== user._id.toString()
            );

            // Send email warning
            const emailResult = await emailService.sendExpirationWarningEmail(
              user,
              match,
              otherUser,
              hoursRemaining
            );

            if (emailResult.success) {
              emailsSent++;
            }

            // Rate limiting between emails
            await new Promise((resolve) => setTimeout(resolve, 150));
          }

          // Mark warning as sent for this match
          await match.markWarningSent(hoursRemaining);
        } catch (error) {
          console.error(
            `❌ Error sending ${hoursRemaining}h warning for match ${match._id}:`,
            error
          );
        }
      }

      return emailsSent;
    } catch (error) {
      console.error(
        `❌ Error processing ${hoursRemaining}h email warnings:`,
        error
      );
      return 0;
    }
  }

  async processExpirationPushNotifications(hoursRemaining, now) {
    try {
      // Only send push notifications for critical intervals (2h and 1h)
      if (hoursRemaining > 2) {
        return 0;
      }

      const pushNotificationService = require("../services/pushNotificationService");

      // Calculate the time window for this specific interval
      const timeWindowStart = new Date(
        now.getTime() + hoursRemaining * 60 * 60 * 1000
      );
      const timeWindowEnd = new Date(
        timeWindowStart.getTime() + 60 * 60 * 1000
      ); // 1 hour window

      // Find matches that should receive push notifications for this interval
      const matchesToWarn = await Match.find({
        status: "active",
        firstMessageSentAt: null,
        expiresAt: {
          $gte: timeWindowStart,
          $lt: timeWindowEnd,
        },
        [`warningSent.${hoursRemaining}`]: { $ne: true }, // Haven't sent this warning yet
      }).populate("users", "firstName lastName photos settings");

      let pushNotificationsSent = 0;

      for (const match of matchesToWarn) {
        try {
          // Double-check if we should send this warning
          if (!match.shouldSendWarning(hoursRemaining)) {
            continue;
          }

          for (const user of match.users) {
            // Check if user wants push notifications
            if (
              user.settings?.notifications?.push === false ||
              user.settings?.notifications?.matchExpiring === false
            ) {
              continue;
            }

            const otherUser = match.users.find(
              (u) => u._id.toString() !== user._id.toString()
            );

            const matchData = {
              matchId: match._id.toString(),
              matchedUserId: otherUser._id.toString(),
              matchedUserName: otherUser.firstName,
              matchedUserPhoto:
                otherUser.photos?.find((p) => p.isPrimary)?.url ||
                otherUser.photos?.[0]?.url,
            };

            // Send push notification
            const pushResult =
              await pushNotificationService.sendExpirationWarningNotification(
                user._id,
                matchData,
                hoursRemaining
              );

            if (pushResult.success && pushResult.sentTo > 0) {
              pushNotificationsSent++;
            }

            // Rate limiting between notifications
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        } catch (error) {
          console.error(
            `❌ Error sending ${hoursRemaining}h push notification for match ${match._id}:`,
            error
          );
        }
      }

      return pushNotificationsSent;
    } catch (error) {
      console.error(
        `❌ Error processing ${hoursRemaining}h push notifications:`,
        error
      );
      return 0;
    }
  }

  async sendWelcomeFollowUps() {
    try {
      console.log("👋 Starting welcome follow-ups...");

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);

      // Find users who registered 3 days ago
      const newUsers = await User.find({
        createdAt: {
          $gte: fourDaysAgo,
          $lt: threeDaysAgo,
        },
        isActive: true,
        "settings.notifications.email": { $ne: false },
      }).select("_id firstName lastName email photos bio verification");

      let emailsSent = 0;

      for (const user of newUsers) {
        try {
          // Check user's progress
          const hasPhotos = user.photos && user.photos.length > 0;
          const hasBio = user.bio && user.bio.length > 10;
          const isVerified = user.verification?.emailVerified;

          let reminderData;

          if (!isVerified) {
            reminderData = {
              subject: "✉️ Please verify your email to find love!",
              title: "✉️ Verify Your Email",
              message:
                "You're almost ready to start matching! Please verify your email address to unlock all features and start connecting with amazing people.",
              actionUrl: `${process.env.FRONTEND_URL}/verify-email`,
              actionText: "Verify Email",
              footerMessage: "We're excited to help you find love! 💕",
            };
          } else if (!hasPhotos) {
            reminderData = {
              subject: "📸 Add photos to get 10x more matches!",
              title: "📸 Add Your Photos",
              message:
                "Profiles with photos get 10 times more matches! Upload your best photos to start attracting the right people.",
              actionUrl: `${process.env.FRONTEND_URL}/profile/photos`,
              actionText: "Add Photos",
              footerMessage: "Show your best self! 📷",
            };
          } else if (!hasBio) {
            reminderData = {
              subject: "✍️ Write your bio and stand out!",
              title: "✍️ Complete Your Profile",
              message:
                "A great bio helps you connect with people who share your interests and values. Tell your story in a few sentences!",
              actionUrl: `${process.env.FRONTEND_URL}/profile/edit`,
              actionText: "Write Bio",
              footerMessage: "Your story matters! ✨",
            };
          } else {
            // Profile is complete, encourage swiping
            reminderData = {
              subject: "🎯 Ready to find your match?",
              title: "🎯 Start Discovering",
              message:
                "Your profile looks great! Now it's time to start discovering amazing people in your area. Your perfect match is waiting!",
              actionUrl: `${process.env.FRONTEND_URL}/discover`,
              actionText: "Start Swiping",
              footerMessage: "Happy matching! 💕",
            };
          }

          const result = await emailService.sendReminderEmail(
            user,
            reminderData
          );

          if (result.success) {
            emailsSent++;
            console.log(
              `👋 Welcome follow-up sent to ${user.firstName} (${user.email})`
            );
          }

          // Rate limiting
          await new Promise((resolve) => setTimeout(resolve, 250));
        } catch (error) {
          console.error(
            `❌ Error sending welcome follow-up to user ${user._id}:`,
            error
          );
        }
      }

      console.log(`👋 Welcome follow-ups complete: ${emailsSent} sent`);
    } catch (error) {
      console.error("❌ Error in welcome follow-ups job:", error);
    }
  }

  async sendProfileCompletionReminders() {
    try {
      console.log("📝 Starting profile completion reminders...");

      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Find users with incomplete profiles
      const incompleteUsers = await User.find({
        isActive: true,
        createdAt: { $lt: oneWeekAgo },
        "settings.notifications.email": { $ne: false },
        $or: [
          { photos: { $size: 0 } }, // No photos
          { photos: { $exists: false } },
          { bio: { $exists: false } }, // No bio
          { bio: { $regex: /^.{0,20}$/ } }, // Bio too short
          { "verification.emailVerified": { $ne: true } }, // Email not verified
        ],
      }).select("_id firstName lastName email photos bio verification");

      let emailsSent = 0;

      for (const user of incompleteUsers) {
        try {
          const completionIssues = [];

          if (!user.verification?.emailVerified) {
            completionIssues.push("verify your email");
          }
          if (!user.photos || user.photos.length === 0) {
            completionIssues.push("add photos");
          }
          if (!user.bio || user.bio.length < 20) {
            completionIssues.push("write a bio");
          }

          if (completionIssues.length === 0) continue;

          const reminderData = {
            subject: "📝 Complete your profile to get more matches!",
            title: "📝 Boost Your Profile",
            message: `Complete profiles get 5x more matches! You just need to ${completionIssues.join(
              ", "
            )} to unlock your full potential.`,
            actionUrl: `${process.env.FRONTEND_URL}/profile/edit`,
            actionText: "Complete Profile",
            footerMessage: "Small changes, big results! 🚀",
          };

          const result = await emailService.sendReminderEmail(
            user,
            reminderData
          );

          if (result.success) {
            emailsSent++;
            console.log(
              `📝 Profile completion reminder sent to ${user.firstName} (${user.email})`
            );
          }

          // Rate limiting
          await new Promise((resolve) => setTimeout(resolve, 300));
        } catch (error) {
          console.error(
            `❌ Error sending profile completion reminder to user ${user._id}:`,
            error
          );
        }
      }

      console.log(
        `📝 Profile completion reminders complete: ${emailsSent} sent`
      );
    } catch (error) {
      console.error("❌ Error in profile completion reminders job:", error);
    }
  }

  async cleanupExpiredTokens() {
    try {
      console.log("🧹 Starting token cleanup...");

      const now = new Date();

      // Clean up expired email verification tokens
      const emailResult = await User.updateMany(
        {
          emailVerificationExpires: { $lt: now },
        },
        {
          $unset: {
            emailVerificationToken: 1,
            emailVerificationExpires: 1,
          },
        }
      );

      // Clean up expired password reset tokens
      const passwordResult = await User.updateMany(
        {
          passwordResetExpires: { $lt: now },
        },
        {
          $unset: {
            passwordResetToken: 1,
            passwordResetExpires: 1,
          },
        }
      );

      console.log(
        `🧹 Token cleanup complete: ${emailResult.modifiedCount} email tokens, ${passwordResult.modifiedCount} password tokens`
      );
    } catch (error) {
      console.error("❌ Error in token cleanup job:", error);
    }
  }

  // === UTILITY METHODS ===

  calculateAge(dateOfBirth) {
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
  }

  // === MANUAL TRIGGER METHODS ===

  async triggerWeeklySummary(userId = null) {
    try {
      if (userId) {
        const user = await User.findById(userId).select(
          "_id firstName lastName email stats"
        );
        if (!user) throw new Error("User not found");

        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const weeklyStats = await this.calculateWeeklyStats(userId, oneWeekAgo);

        return await emailService.sendWeeklyMatchSummary(user, weeklyStats);
      } else {
        await this.sendWeeklyMatchSummaries();
        return {
          success: true,
          message: "Weekly summaries triggered for all users",
        };
      }
    } catch (error) {
      console.error("Error triggering weekly summary:", error);
      return { success: false, error: error.message };
    }
  }

  async triggerWelcomeEmail(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) throw new Error("User not found");

      // Generate verification token if needed
      let verificationToken = user.emailVerificationToken;
      if (!verificationToken) {
        verificationToken = emailService.generateVerificationToken();
        user.emailVerificationToken = verificationToken;
        user.emailVerificationExpires = new Date(
          Date.now() + 24 * 60 * 60 * 1000
        );
        await user.save();
      }

      return await emailService.sendWelcomeEmail(user, verificationToken);
    } catch (error) {
      console.error("Error triggering welcome email:", error);
      return { success: false, error: error.message };
    }
  }

  async triggerExpirationWarnings(hoursRemaining = null) {
    try {
      if (hoursRemaining) {
        // Test specific interval
        const now = new Date();
        const emailsSent = await this.processExpirationWarnings(
          hoursRemaining,
          now
        );
        const pushNotificationsSent =
          await this.processExpirationPushNotifications(hoursRemaining, now);

        return {
          success: true,
          message: `${hoursRemaining}h expiration warnings triggered`,
          emailsSent,
          pushNotificationsSent,
        };
      } else {
        // Test all intervals
        await this.sendMatchExpirationWarnings();
        return {
          success: true,
          message: "All expiration warnings triggered",
        };
      }
    } catch (error) {
      console.error("Error triggering expiration warnings:", error);
      return { success: false, error: error.message };
    }
  }

  // === ADMIN METHODS ===

  getJobStatus() {
    const status = {};
    this.jobs.forEach((job, name) => {
      status[name] = {
        running: job.running || false,
        scheduled: true,
      };
    });

    return {
      isRunning: this.isRunning,
      totalJobs: this.jobs.size,
      jobs: status,
    };
  }

  async getEmailStats() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thisMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      // These would require an email tracking collection in a real app
      // For now, we'll return placeholder stats
      return {
        today: { sent: 0, failed: 0 },
        thisWeek: { sent: 0, failed: 0 },
        thisMonth: { sent: 0, failed: 0 },
        types: {
          welcome: 0,
          verification: 0,
          passwordReset: 0,
          weeklyDigest: 0,
          reminders: 0,
          newMatch: 0,
        },
      };
    } catch (error) {
      console.error("Error getting email stats:", error);
      return null;
    }
  }
}

module.exports = new EmailJobs();
