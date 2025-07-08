const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Match = require("../models/Match");
const Message = require("../models/Message");

// Enhanced tracking with better performance
const onlineUsers = new Map(); // userId -> { socketId, user, connectedAt, lastSeen, rooms }
const userSockets = new Map(); // userId -> Set of socketIds (for multiple tabs/devices)
const typingUsers = new Map(); // matchId -> { userId, userName, timestamp, timeout }
const userRooms = new Map(); // userId -> Set of room names

const socketHandler = (io) => {
  console.log("🔌 Enhanced Socket.io handler initialized");

  // Enhanced authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        console.log("❌ Socket auth failed: No token provided");
        return next(new Error("Authentication error: No token provided"));
      }

      // Verify JWT token
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "your-secret-key"
      );

      // Get user from database with safety data
      const user = await User.findById(decoded.userId).select("+safety");

      if (!user || !user.isActive) {
        console.log(
          "❌ Socket auth failed: User not found or inactive:",
          decoded.userId
        );
        return next(new Error("User not found or inactive"));
      }

      // Check for account lockout
      if (user.isLocked) {
        return next(new Error("Account is temporarily locked"));
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

      if (error.name === "JsonWebTokenError") {
        next(new Error("Invalid token"));
      } else if (error.name === "TokenExpiredError") {
        next(new Error("Token expired"));
      } else {
        next(new Error("Authentication failed"));
      }
    }
  });

  // Connection event handler
  io.on("connection", async (socket) => {
    const userId = socket.userId;
    const user = socket.user;

    console.log(`👤 User ${user.firstName} connected: ${socket.id}`);

    try {
      // Track user sockets (handle multiple tabs/devices)
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(socket.id);

      // Add/update user in online users with enhanced metadata
      onlineUsers.set(userId, {
        socketId: socket.id, // Primary socket ID
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
        deviceCount: userSockets.get(userId).size,
      });

      // Initialize user rooms tracking
      if (!userRooms.has(userId)) {
        userRooms.set(userId, new Set());
      }

      // Update user's last active timestamp
      await User.findByIdAndUpdate(userId, {
        lastActive: new Date(),
        $inc: { "stats.profileViews": 1 },
      });

      // Join user to their match rooms
      const userMatches = await Match.findForUser(userId);

      for (const match of userMatches) {
        const roomName = `match_${match._id}`;
        socket.join(roomName);
        onlineUsers.get(userId).rooms.add(roomName);
        userRooms.get(userId).add(roomName);

        console.log(`🏠 User ${user.firstName} joined room: ${roomName}`);

        // Notify other user in the match that this user is online
        const otherUserId = match.getOtherUser(userId);
        socket.to(roomName).emit("user_online", {
          userId,
          user: onlineUsers.get(userId).user,
          matchId: match._id,
          timestamp: new Date(),
        });
      }

      // Send connection confirmation with user data
      socket.emit("connection_confirmed", {
        message: "Successfully connected to Habibi chat",
        userId,
        timestamp: new Date(),
        onlineUsers: getOnlineUsersForMatches(userId, userMatches),
      });

      // Send unread message summary
      const unreadCount = await Message.getUnreadCount(userId);
      socket.emit("unread_summary", {
        totalUnread: unreadCount,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error("❌ Error during socket connection setup:", error);
      socket.emit("error", {
        message: "Connection setup failed",
        details: error.message,
      });
    }

    // ===== EVENT HANDLERS =====

    // Handle joining a specific conversation
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
        const match = await Match.findById(matchId);
        if (!match || !match.users.includes(userId)) {
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

        // Mark messages as read when joining conversation
        await Message.markConversationAsRead(matchId, userId);

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
          conversationStarted: !!match.firstMessageSentAt,
          timeToExpiration: match.timeToExpiration,
          urgencyLevel: match.urgencyLevel,
          roomName,
        });
      } catch (error) {
        console.error("❌ Error joining conversation:", error);
        socket.emit("error", { message: "Error joining conversation" });
      }
    });

    // Handle leaving a conversation
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
        clearTypingIndicator(userId, matchId, roomName);

        // Notify other user
        socket.to(roomName).emit("user_left_conversation", {
          userId,
          matchId,
          timestamp: new Date(),
        });

        socket.emit("conversation_left", { matchId, roomName });
      } catch (error) {
        console.error("❌ Error leaving conversation:", error);
      }
    });

    // Enhanced message sending with comprehensive validation
    socket.on("send_message", async (data) => {
      try {
        const { matchId, content, messageType = "text", tempId } = data;

        // Input validation
        if (!matchId || !content?.trim()) {
          socket.emit("error", {
            message: "Match ID and content are required",
            tempId,
          });
          return;
        }

        // Content length validation
        if (content.trim().length > 1000) {
          socket.emit("error", {
            message: "Message too long (max 1000 characters)",
            tempId,
          });
          return;
        }

        console.log(`💬 Message from ${user.firstName} in match ${matchId}`);

        // Rate limiting check
        const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
        const recentMessageCount = await Message.countDocuments({
          sender: userId,
          match: matchId,
          createdAt: { $gte: oneMinuteAgo },
        });

        if (recentMessageCount >= 10) {
          socket.emit("error", {
            message: "Too many messages sent. Please slow down.",
            code: "RATE_LIMIT_EXCEEDED",
            tempId,
          });
          return;
        }

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
          user.safety.blockedUsers.includes(otherUser._id) ||
          otherUser.safety.blockedUsers.includes(userId)
        ) {
          socket.emit("error", {
            message: "Cannot send message to this user",
            tempId,
          });
          return;
        }

        // Check match status
        if (match.status === "expired") {
          socket.emit("error", {
            message: "This match has expired",
            tempId,
          });
          return;
        }

        // Content filtering for safety
        const filteredContent = content
          .trim()
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
          .replace(/javascript:/gi, "")
          .replace(/on\w+\s*=/gi, "");

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
          await match.markFirstMessageSent(userId);
        } else {
          match.lastActivity = new Date();
          await match.save();
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

        // Clear typing indicator
        clearTypingIndicator(userId, matchId, roomName);

        // Update last activity tracking
        updateUserActivity(userId);

        // Send push notification if other user is offline
        const isOtherUserOnline = onlineUsers.has(otherUser._id.toString());
        if (!isOtherUserOnline && otherUser.settings?.notifications?.messages) {
          const pushNotificationService = require("../services/pushNotificationService");

          const senderPhoto =
            user.photos?.find((p) => p.isPrimary)?.url ||
            user.photos?.[0]?.url ||
            "";
          const unreadCount = await Message.getUnreadCount(otherUser._id);

          await pushNotificationService.sendMessageNotification(otherUser._id, {
            messageId: message._id.toString(),
            matchId,
            senderId: userId,
            senderName: user.firstName,
            senderPhoto,
            content: message.content,
            unreadCount,
          });
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
          tempId,
          messageId: message._id,
          sentAt: message.createdAt,
          success: true,
        });
      } catch (error) {
        console.error("❌ Socket message send error:", error);
        socket.emit("error", {
          message: "Error sending message",
          tempId: data.tempId,
          details: error.message,
        });
      }
    });

    // Enhanced typing indicators
    socket.on("typing_start", (data) => {
      try {
        const { matchId } = data;

        if (!matchId) {
          socket.emit("error", { message: "Match ID is required" });
          return;
        }

        const roomName = `match_${matchId}`;
        setTypingIndicator(userId, user.firstName, matchId, roomName);
        updateUserActivity(userId);
      } catch (error) {
        console.error("❌ Error handling typing start:", error);
      }
    });

    socket.on("typing_stop", (data) => {
      try {
        const { matchId } = data;
        const roomName = `match_${matchId}`;
        clearTypingIndicator(userId, matchId, roomName);
      } catch (error) {
        console.error("❌ Error handling typing stop:", error);
      }
    });

    // Mark messages as read
    socket.on("mark_messages_read", async (data) => {
      try {
        const { matchId } = data;

        if (!matchId) {
          socket.emit("error", { message: "Match ID is required" });
          return;
        }

        const result = await Message.markConversationAsRead(matchId, userId);

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
          const newUnreadCount = await Message.getUnreadCount(userId);
          socket.emit("unread_count_updated", {
            totalUnread: newUnreadCount,
          });
        }

        updateUserActivity(userId);
      } catch (error) {
        console.error("❌ Error marking messages as read:", error);
        socket.emit("error", { message: "Error marking messages as read" });
      }
    });

    // Connection health check
    socket.on("ping", () => {
      socket.emit("pong", { timestamp: new Date() });
      updateUserActivity(userId);
    });

    // Enhanced disconnect handler with proper cleanup
    socket.on("disconnect", async (reason) => {
      console.log(`👋 User ${user.firstName} disconnected: ${reason}`);

      try {
        // Update user's last active timestamp
        await User.findByIdAndUpdate(userId, { lastActive: new Date() });

        // Remove socket from user's socket set
        if (userSockets.has(userId)) {
          userSockets.get(userId).delete(socket.id);

          // If no more sockets for this user, clean up completely
          if (userSockets.get(userId).size === 0) {
            userSockets.delete(userId);

            // Clean up typing indicators
            cleanupUserTypingIndicators(userId);

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
          } else {
            // Update device count for remaining connections
            if (onlineUsers.has(userId)) {
              onlineUsers.get(userId).deviceCount =
                userSockets.get(userId).size;
            }
          }
        }
      } catch (error) {
        console.error("❌ Error during disconnect cleanup:", error);
      }
    });

    // Handle errors
    socket.on("error", (error) => {
      console.error(`❌ Socket error for user ${user.firstName}:`, error);

      // Log error for monitoring in production
      if (process.env.NODE_ENV === "production") {
        console.error("Socket Error:", {
          userId,
          socketId: socket.id,
          error: error.message,
          timestamp: new Date(),
        });
      }
    });
  });

  // ===== UTILITY FUNCTIONS =====

  // Set typing indicator with auto-cleanup
  function setTypingIndicator(userId, userName, matchId, roomName) {
    // Clear any existing typing timeout for this match
    if (typingUsers.has(matchId)) {
      clearTimeout(typingUsers.get(matchId).timeout);
    }

    // Set new typing status with auto-cleanup
    const typingTimeout = setTimeout(() => {
      typingUsers.delete(matchId);
      io.to(roomName).emit("user_typing", {
        userId,
        userName,
        matchId,
        isTyping: false,
      });
    }, 3000);

    typingUsers.set(matchId, {
      userId,
      userName,
      timeout: typingTimeout,
      startedAt: new Date(),
    });

    io.to(roomName).emit("user_typing", {
      userId,
      userName,
      matchId,
      isTyping: true,
    });
  }

  // Clear typing indicator
  function clearTypingIndicator(userId, matchId, roomName) {
    if (
      typingUsers.has(matchId) &&
      typingUsers.get(matchId).userId === userId
    ) {
      clearTimeout(typingUsers.get(matchId).timeout);
      typingUsers.delete(matchId);

      io.to(roomName).emit("user_typing", {
        userId,
        userName: onlineUsers.get(userId)?.user?.firstName,
        matchId,
        isTyping: false,
      });
    }
  }

  // Clean up all typing indicators for a user
  function cleanupUserTypingIndicators(userId) {
    for (const [matchId, typingData] of typingUsers.entries()) {
      if (typingData.userId === userId) {
        clearTimeout(typingData.timeout);
        typingUsers.delete(matchId);

        const roomName = `match_${matchId}`;
        io.to(roomName).emit("user_typing", {
          userId,
          userName: typingData.userName,
          matchId,
          isTyping: false,
        });
      }
    }
  }

  // Update user activity timestamp
  function updateUserActivity(userId) {
    if (onlineUsers.has(userId)) {
      onlineUsers.get(userId).lastSeen = new Date();
    }
  }

  // Get online users for specific matches
  function getOnlineUsersForMatches(userId, matches) {
    const onlineMatchUsers = [];
    matches.forEach((match) => {
      const otherUserId = match.getOtherUser(userId).toString();
      if (onlineUsers.has(otherUserId)) {
        onlineMatchUsers.push({
          userId: otherUserId,
          user: onlineUsers.get(otherUserId).user,
          matchId: match._id,
          lastSeen: onlineUsers.get(otherUserId).lastSeen,
        });
      }
    });
    return onlineMatchUsers;
  }

  // ===== PUBLIC API FUNCTIONS =====

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
          deviceCount: userData.deviceCount,
        }
      : {
          isOnline: false,
          status: "offline",
          lastSeen: null,
        };
  };

  io.sendToUser = (userId, event, data) => {
    if (userSockets.has(userId)) {
      const socketIds = userSockets.get(userId);
      let sent = 0;
      for (const socketId of socketIds) {
        io.to(socketId).emit(event, data);
        sent++;
      }
      return sent > 0;
    }
    return false;
  };

  io.sendToMatch = (matchId, event, data) => {
    io.to(`match_${matchId}`).emit(event, data);
  };

  io.broadcastToAllUsers = (event, data) => {
    io.emit(event, data);
  };

  // NEW: Send real-time match notification to specific users
  io.sendMatchNotification = (userId1, userId2, matchData) => {
    const matchEvent = {
      type: "new_match",
      match: matchData,
      timestamp: new Date(),
    };

    // Send to user1 if online
    if (userSockets.has(userId1)) {
      const socketIds = userSockets.get(userId1);
      for (const socketId of socketIds) {
        io.to(socketId).emit("new_match", matchEvent);
      }
      console.log(`💕 Sent match notification to user ${userId1}`);
    }

    // Send to user2 if online
    if (userSockets.has(userId2)) {
      const socketIds = userSockets.get(userId2);
      for (const socketId of socketIds) {
        io.to(socketId).emit("new_match", matchEvent);
      }
      console.log(`💕 Sent match notification to user ${userId2}`);
    }

    // Log if users are offline
    if (!userSockets.has(userId1)) {
      console.log(
        `📱 User ${userId1} is offline - match notification queued for push`
      );
    }
    if (!userSockets.has(userId2)) {
      console.log(
        `📱 User ${userId2} is offline - match notification queued for push`
      );
    }

    return {
      user1Online: userSockets.has(userId1),
      user2Online: userSockets.has(userId2),
      sent:
        (userSockets.has(userId1) ? 1 : 0) + (userSockets.has(userId2) ? 1 : 0),
    };
  };

  // Enhanced periodic cleanup with better monitoring
  setInterval(() => {
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    // Clean up old typing indicators
    for (const [matchId, typingData] of typingUsers.entries()) {
      if (now - typingData.startedAt.getTime() > 10000) {
        clearTimeout(typingData.timeout);
        typingUsers.delete(matchId);
      }
    }

    // Clean up stale online users
    for (const [userId, userData] of onlineUsers.entries()) {
      if (userData.lastSeen.getTime() < fiveMinutesAgo) {
        console.log(`🧹 Cleaning up stale user data for ${userId}`);
        onlineUsers.delete(userId);
        userRooms.delete(userId);
        userSockets.delete(userId);
      }
    }

    // Log statistics
    console.log(
      `📊 Socket Stats - Online Users: ${
        onlineUsers.size
      }, Active Sockets: ${Array.from(userSockets.values()).reduce(
        (sum, set) => sum + set.size,
        0
      )}, Typing: ${typingUsers.size}`
    );
  }, 60000); // Run every minute

  console.log("✅ Enhanced Socket.io handler setup complete");
};

module.exports = socketHandler;
