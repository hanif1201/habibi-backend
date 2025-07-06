// socket/socketHandler.js - ENHANCED FIXED VERSION
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Match = require("../models/Match");
const Message = require("../models/Message");

// Enhanced data structures with better memory management
const onlineUsers = new Map();
const typingUsers = new Map(); // matchId -> { userId, userName, timestamp }
const userRooms = new Map(); // userId -> Set of room names
const connectionCleanupTimers = new Map(); // socketId -> timeoutId

const socketHandler = (io) => {
  console.log("🔌 Enhanced Socket.io handler initialized");

  // Enhanced middleware for socket authentication
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token || token === "null" || token === "undefined") {
        console.log("❌ Socket auth failed: No token provided");
        return next(new Error("Authentication error: No token provided"));
      }

      // Verify JWT token
      let decoded;
      try {
        decoded = jwt.verify(
          token,
          process.env.JWT_SECRET || "your-secret-key"
        );
      } catch (jwtError) {
        console.log("❌ Socket auth failed: Invalid token -", jwtError.message);
        if (jwtError.name === "TokenExpiredError") {
          return next(new Error("Token expired"));
        }
        return next(new Error("Invalid token"));
      }

      // Get user from database with safety data and essential fields only
      let user;
      try {
        user = await User.findById(decoded.userId)
          .select("firstName lastName photos safety settings isActive")
          .lean(); // Use lean() for better performance
      } catch (dbError) {
        console.log("❌ Socket auth failed: Database error -", dbError.message);
        return next(new Error("Database error"));
      }

      if (!user || !user.isActive) {
        console.log(
          "❌ Socket auth failed: User not found or inactive:",
          decoded.userId
        );
        return next(new Error("User not found or inactive"));
      }

      // Attach user data to socket
      socket.userId = user._id.toString();
      socket.user = {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        photos: user.photos,
        safety: user.safety,
        settings: user.settings,
      };

      console.log(`✅ Socket authenticated: ${user.firstName} (${user._id})`);
      next();
    } catch (error) {
      console.log("❌ Socket auth error:", error.message);
      next(new Error("Authentication failed"));
    }
  });

  // Connection event handler
  io.on("connection", async (socket) => {
    const userId = socket.userId;
    const user = socket.user;

    console.log(`👤 User ${user.firstName} connected: ${socket.id}`);

    try {
      // Enhanced user tracking with connection metadata
      onlineUsers.set(userId, {
        socketId: socket.id,
        user: {
          _id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          primaryPhoto:
            user.photos?.find((p) => p.isPrimary) || user.photos?.[0],
        },
        connectedAt: new Date(),
        lastSeen: new Date(),
        rooms: new Set(),
      });

      // Initialize user rooms tracking
      userRooms.set(userId, new Set());

      // Update user's last active timestamp (non-blocking)
      User.findByIdAndUpdate(userId, { lastActive: new Date() }).catch(
        (err) => {
          console.error("Error updating lastActive:", err);
        }
      );

      // Join user to their match rooms with error handling
      try {
        const userMatches = await Match.find({
          users: userId,
          status: "active",
        })
          .select("_id users")
          .lean();

        for (const match of userMatches) {
          const roomName = `match_${match._id}`;
          socket.join(roomName);

          if (onlineUsers.has(userId)) {
            onlineUsers.get(userId).rooms.add(roomName);
          }
          if (userRooms.has(userId)) {
            userRooms.get(userId).add(roomName);
          }

          console.log(`🏠 User ${user.firstName} joined room: ${roomName}`);

          // Notify other user in the match that this user is online
          const otherUserId = match.users
            .find((id) => id.toString() !== userId)
            .toString();
          socket.to(roomName).emit("user_online", {
            userId,
            user: onlineUsers.get(userId).user,
            matchId: match._id,
            timestamp: new Date(),
          });
        }
      } catch (matchError) {
        console.error("Error loading user matches:", matchError);
      }

      // Send initial online users list for user's matches
      const onlineMatchUsers = [];
      const userMatchesForOnline = await Match.find({
        users: userId,
        status: "active",
      })
        .select("_id users")
        .lean()
        .catch(() => []);

      userMatchesForOnline.forEach((match) => {
        const otherUserId = match.users
          .find((id) => id.toString() !== userId)
          .toString();
        if (onlineUsers.has(otherUserId)) {
          onlineMatchUsers.push({
            userId: otherUserId,
            user: onlineUsers.get(otherUserId).user,
            matchId: match._id,
          });
        }
      });

      socket.emit("online_users", onlineMatchUsers);

      // Send unread message summary with error handling
      try {
        const unreadCount = await Message.countDocuments({
          receiver: userId,
          readAt: null,
          isDeleted: false,
        });
        socket.emit("unread_summary", { totalUnread: unreadCount });
      } catch (unreadError) {
        console.error("Error getting unread count:", unreadError);
      }
    } catch (error) {
      console.error("❌ Error during socket connection setup:", error);
    }

    // Enhanced conversation joining with validation
    socket.on("join_conversation", async (data) => {
      try {
        const { matchId } = data;

        if (!matchId) {
          socket.emit("error", { message: "Match ID is required" });
          return;
        }

        console.log(
          `🏠 User ${user.firstName} joining conversation: ${matchId}`
        );

        // Verify user is part of this match
        const match = await Match.findById(matchId).select("users").lean();
        if (!match || !match.users.some((id) => id.toString() === userId)) {
          socket.emit("error", {
            message: "Access denied to this conversation",
          });
          return;
        }

        const roomName = `match_${matchId}`;
        socket.join(roomName);

        // Track room membership
        if (onlineUsers.has(userId)) {
          onlineUsers.get(userId).rooms.add(roomName);
        }
        if (userRooms.has(userId)) {
          userRooms.get(userId).add(roomName);
        }

        // Mark messages as read when joining conversation (non-blocking)
        Message.updateMany(
          {
            match: matchId,
            receiver: userId,
            readAt: null,
            isDeleted: false,
          },
          { readAt: new Date() }
        ).catch((err) => {
          console.error("Error marking messages as read:", err);
        });

        // Notify other user
        socket.to(roomName).emit("user_joined_conversation", {
          userId,
          user: user,
          matchId,
          timestamp: new Date(),
        });

        // Send conversation metadata
        socket.emit("conversation_joined", {
          matchId,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error("❌ Error joining conversation:", error);
        socket.emit("error", { message: "Error joining conversation" });
      }
    });

    // Enhanced conversation leaving
    socket.on("leave_conversation", (data) => {
      try {
        const { matchId } = data;
        const roomName = `match_${matchId}`;

        console.log(
          `🚪 User ${user.firstName} leaving conversation: ${matchId}`
        );

        socket.leave(roomName);

        // Update room tracking
        if (onlineUsers.has(userId)) {
          onlineUsers.get(userId).rooms.delete(roomName);
        }
        if (userRooms.has(userId)) {
          userRooms.get(userId).delete(roomName);
        }

        // Stop typing if user was typing
        if (
          typingUsers.has(matchId) &&
          typingUsers.get(matchId).userId === userId
        ) {
          typingUsers.delete(matchId);
          socket.to(roomName).emit("user_typing", {
            userId,
            userName: user.firstName,
            matchId,
            isTyping: false,
          });
        }

        // Notify other user
        socket.to(roomName).emit("user_left_conversation", {
          userId,
          matchId,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error("❌ Error leaving conversation:", error);
      }
    });

    // Enhanced typing indicators with better timeout management
    socket.on("typing_start", (data) => {
      try {
        const { matchId } = data;

        if (!matchId) {
          socket.emit("error", { message: "Match ID is required" });
          return;
        }

        const roomName = `match_${matchId}`;

        // Clear any existing typing timeout for this match
        if (typingUsers.has(matchId)) {
          const existingTyping = typingUsers.get(matchId);
          if (existingTyping.timeout) {
            clearTimeout(existingTyping.timeout);
          }
        }

        // Set new typing status with auto-cleanup
        const typingTimeout = setTimeout(() => {
          typingUsers.delete(matchId);
          socket.to(roomName).emit("user_typing", {
            userId,
            userName: user.firstName,
            matchId,
            isTyping: false,
          });
        }, 3000); // Auto-stop typing after 3 seconds

        typingUsers.set(matchId, {
          userId,
          userName: user.firstName,
          timeout: typingTimeout,
          startedAt: new Date(),
        });

        socket.to(roomName).emit("user_typing", {
          userId,
          userName: user.firstName,
          matchId,
          isTyping: true,
        });
      } catch (error) {
        console.error("❌ Error handling typing start:", error);
      }
    });

    socket.on("typing_stop", (data) => {
      try {
        const { matchId } = data;
        const roomName = `match_${matchId}`;

        // Clear typing status
        if (
          typingUsers.has(matchId) &&
          typingUsers.get(matchId).userId === userId
        ) {
          const typingData = typingUsers.get(matchId);
          if (typingData.timeout) {
            clearTimeout(typingData.timeout);
          }
          typingUsers.delete(matchId);

          socket.to(roomName).emit("user_typing", {
            userId,
            userName: user.firstName,
            matchId,
            isTyping: false,
          });
        }
      } catch (error) {
        console.error("❌ Error handling typing stop:", error);
      }
    });

    // Enhanced message read receipts
    socket.on("mark_messages_read", async (data) => {
      try {
        const { matchId } = data;

        if (!matchId) {
          socket.emit("error", { message: "Match ID is required" });
          return;
        }

        // Mark messages as read in database
        const result = await Message.updateMany(
          {
            match: matchId,
            receiver: userId,
            readAt: null,
            isDeleted: false,
          },
          { readAt: new Date() }
        );

        if (result.modifiedCount > 0) {
          const roomName = `match_${matchId}`;

          // Notify other user that messages have been read
          socket.to(roomName).emit("messages_read", {
            matchId,
            readBy: userId,
            readAt: new Date(),
            messagesRead: result.modifiedCount,
          });

          // Update user's unread count
          const newUnreadCount = await Message.countDocuments({
            receiver: userId,
            readAt: null,
            isDeleted: false,
          });

          socket.emit("unread_count_updated", {
            totalUnread: newUnreadCount,
          });
        }
      } catch (error) {
        console.error("❌ Error marking messages as read:", error);
        socket.emit("error", { message: "Error marking messages as read" });
      }
    });

    // Enhanced real-time message sending with comprehensive validation
    socket.on("send_message", async (data) => {
      try {
        const { matchId, content, messageType = "text", tempId } = data;

        if (!matchId || !content?.trim()) {
          socket.emit("error", {
            message: "Match ID and content are required",
            tempId,
          });
          return;
        }

        console.log(`💬 Message from ${user.firstName} in match ${matchId}`);

        // Verify match and user permissions
        const match = await Match.findById(matchId).populate(
          "users",
          "firstName lastName safety settings"
        );

        if (!match || !match.users.find((u) => u._id.toString() === userId)) {
          socket.emit("error", {
            message: "Access denied to this conversation",
            tempId,
          });
          return;
        }

        const otherUser = match.users.find((u) => u._id.toString() !== userId);

        // Check if users have blocked each other
        if (
          user.safety?.blockedUsers?.includes(otherUser._id) ||
          otherUser.safety?.blockedUsers?.includes(userId)
        ) {
          socket.emit("error", {
            message: "Cannot send message to this user",
            tempId,
          });
          return;
        }

        // Enhanced rate limiting
        const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
        const recentMessageCount = await Message.countDocuments({
          sender: userId,
          match: matchId,
          createdAt: { $gte: oneMinuteAgo },
        });

        if (recentMessageCount >= 15) {
          // Increased limit slightly
          socket.emit("error", {
            message: "Too many messages sent. Please slow down.",
            code: "RATE_LIMIT_EXCEEDED",
            tempId,
          });
          return;
        }

        // Content filtering (basic)
        const filteredContent = content.trim();
        if (filteredContent.length > 1000) {
          socket.emit("error", {
            message: "Message too long. Maximum 1000 characters.",
            tempId,
          });
          return;
        }

        // Create and save message
        const message = new Message({
          match: matchId,
          sender: userId,
          receiver: otherUser._id,
          content: filteredContent,
          messageType,
        });

        await message.save();

        // Update match activity
        const isFirstMessage = !match.firstMessageSentAt;
        if (isFirstMessage) {
          match.firstMessageSentAt = new Date();
          match.firstMessageSentBy = userId;
          match.conversationStarter = userId;
          match.lastActivity = new Date();
          match.expiresAt = null; // Clear expiration
          await match.save();
        } else {
          await Match.findByIdAndUpdate(matchId, { lastActivity: new Date() });
        }

        // Populate sender info for response
        await message.populate("sender", "firstName lastName photos");

        const formattedMessage = {
          _id: message._id,
          content: message.content,
          sender: {
            _id: message.sender._id,
            firstName: message.sender.firstName,
            lastName: message.sender.lastName,
          },
          createdAt: message.createdAt,
          messageType: message.messageType,
          matchId,
          receiverId: otherUser._id,
          isFirstMessage,
        };

        // Send to all users in the match room
        const roomName = `match_${matchId}`;
        io.to(roomName).emit("new_message", formattedMessage);

        // Clear typing indicator if user was typing
        if (
          typingUsers.has(matchId) &&
          typingUsers.get(matchId).userId === userId
        ) {
          const typingData = typingUsers.get(matchId);
          if (typingData.timeout) {
            clearTimeout(typingData.timeout);
          }
          typingUsers.delete(matchId);
        }

        // Send push notification if other user is offline and has notifications enabled
        const isOtherUserOnline = onlineUsers.has(otherUser._id.toString());
        if (!isOtherUserOnline && otherUser.settings?.notifications?.messages) {
          // TODO: Implement push notification service
          console.log(`📱 Send push notification to ${otherUser.firstName}`);
        }

        // Emit conversation started event if first message
        if (isFirstMessage) {
          io.to(roomName).emit("conversation_started", {
            matchId,
            startedBy: userId,
            startedAt: new Date(),
          });
        }

        // Confirm message sent to sender
        socket.emit("message_sent", {
          tempId: tempId,
          messageId: message._id,
          sentAt: message.createdAt,
        });
      } catch (error) {
        console.error("❌ Socket message send error:", error);
        socket.emit("error", {
          message: "Error sending message",
          tempId: data.tempId,
        });
      }
    });

    // Handle user status updates
    socket.on("update_status", async (data) => {
      try {
        const { status } = data; // 'online', 'away', 'busy'

        if (onlineUsers.has(userId)) {
          onlineUsers.get(userId).status = status;
          onlineUsers.get(userId).lastSeen = new Date();

          // Notify all matches about status change
          const userMatchesForStatus = await Match.find({
            users: userId,
            status: "active",
          })
            .select("_id")
            .lean();

          userMatchesForStatus.forEach((match) => {
            const roomName = `match_${match._id}`;
            socket.to(roomName).emit("user_status_changed", {
              userId,
              status,
              timestamp: new Date(),
            });
          });
        }
      } catch (error) {
        console.error("❌ Error updating user status:", error);
      }
    });

    // Handle ping/pong for connection health
    socket.on("ping", () => {
      socket.emit("pong", { timestamp: new Date() });

      // Update last seen
      if (onlineUsers.has(userId)) {
        onlineUsers.get(userId).lastSeen = new Date();
      }
    });

    // Enhanced disconnect handler with comprehensive cleanup
    socket.on("disconnect", async (reason) => {
      console.log(`👋 User ${user.firstName} disconnected: ${reason}`);

      try {
        // Clear any connection cleanup timer
        if (connectionCleanupTimers.has(socket.id)) {
          clearTimeout(connectionCleanupTimers.get(socket.id));
          connectionCleanupTimers.delete(socket.id);
        }

        // Update user's last active timestamp (non-blocking)
        User.findByIdAndUpdate(userId, { lastActive: new Date() }).catch(
          (err) => {
            console.error("Error updating lastActive on disconnect:", err);
          }
        );

        // Clean up typing indicators
        for (const [matchId, typingData] of typingUsers.entries()) {
          if (typingData.userId === userId) {
            if (typingData.timeout) {
              clearTimeout(typingData.timeout);
            }
            typingUsers.delete(matchId);

            // Notify other users that this user stopped typing
            const roomName = `match_${matchId}`;
            socket.to(roomName).emit("user_typing", {
              userId,
              userName: user.firstName,
              matchId,
              isTyping: false,
            });
          }
        }

        // Notify matches that user went offline
        const userRoomsList = userRooms.get(userId) || new Set();
        userRoomsList.forEach((roomName) => {
          socket.to(roomName).emit("user_offline", {
            userId,
            user: onlineUsers.get(userId)?.user,
            lastSeen: new Date(),
            timestamp: new Date(),
          });
        });

        // Clean up tracking data
        onlineUsers.delete(userId);
        userRooms.delete(userId);
      } catch (error) {
        console.error("❌ Error during disconnect cleanup:", error);
      }
    });

    // Handle socket errors
    socket.on("error", (error) => {
      console.error(`❌ Socket error for user ${user.firstName}:`, error);
    });
  });

  // Enhanced utility functions for external use
  io.getOnlineUsers = () => {
    return Array.from(onlineUsers.entries()).map(([userId, data]) => ({
      userId,
      ...data,
    }));
  };

  io.getOnlineUserCount = () => {
    return onlineUsers.size;
  };

  io.isUserOnline = (userId) => {
    return onlineUsers.has(userId);
  };

  io.getUserStatus = (userId) => {
    const userData = onlineUsers.get(userId);
    return userData
      ? {
          isOnline: true,
          status: userData.status || "online",
          lastSeen: userData.lastSeen,
          connectedAt: userData.connectedAt,
        }
      : {
          isOnline: false,
          status: "offline",
          lastSeen: null,
        };
  };

  io.sendToUser = (userId, event, data) => {
    const userInfo = onlineUsers.get(userId);
    if (userInfo) {
      io.to(userInfo.socketId).emit(event, data);
      return true;
    }
    return false;
  };

  io.sendToMatch = (matchId, event, data) => {
    io.to(`match_${matchId}`).emit(event, data);
  };

  io.broadcastToAllUsers = (event, data) => {
    io.emit(event, data);
  };

  // Enhanced periodic cleanup of stale data
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    // Clean up old typing indicators
    for (const [matchId, typingData] of typingUsers.entries()) {
      if (now - typingData.startedAt.getTime() > 10000) {
        // 10 seconds
        if (typingData.timeout) {
          clearTimeout(typingData.timeout);
        }
        typingUsers.delete(matchId);
      }
    }

    // Clean up stale online users (shouldn't happen with proper disconnect handling)
    for (const [userId, userData] of onlineUsers.entries()) {
      if (userData.lastSeen.getTime() < fiveMinutesAgo) {
        console.log(`🧹 Cleaning up stale user data for ${userId}`);
        onlineUsers.delete(userId);
        userRooms.delete(userId);
      }
    }

    // Clean up old connection cleanup timers
    for (const [socketId, timerId] of connectionCleanupTimers.entries()) {
      // If timer is very old, clear it
      clearTimeout(timerId);
      connectionCleanupTimers.delete(socketId);
    }
  }, 60000); // Run every minute

  // Cleanup interval on server shutdown
  process.on("SIGTERM", () => {
    clearInterval(cleanupInterval);

    // Clear all timeouts
    for (const [, typingData] of typingUsers.entries()) {
      if (typingData.timeout) {
        clearTimeout(typingData.timeout);
      }
    }

    for (const [, timerId] of connectionCleanupTimers.entries()) {
      clearTimeout(timerId);
    }
  });

  console.log("✅ Enhanced Socket.io handler setup complete");

  // Log statistics periodically
  const statsInterval = setInterval(() => {
    console.log(
      `📊 Socket Stats - Online Users: ${onlineUsers.size}, Active Typing: ${typingUsers.size}, Rooms: ${userRooms.size}`
    );
  }, 300000); // Every 5 minutes

  process.on("SIGTERM", () => {
    clearInterval(statsInterval);
  });
};

module.exports = socketHandler;
