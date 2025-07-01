const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Match = require("../models/Match");

// Store online users
const onlineUsers = new Map();

const socketHandler = (io) => {
  console.log("🔌 Socket.io handler initialized");

  // Middleware for socket authentication
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        console.log("❌ Socket auth failed: No token provided");
        return next(new Error("Authentication error"));
      }

      // FIX: Use the correct JWT secret and decode structure
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "your-secret-key"
      );

      // FIX: The JWT contains 'userId', not 'id'
      const user = await User.findById(decoded.userId);

      if (!user) {
        console.log(
          "❌ Socket auth failed: User not found for ID:",
          decoded.userId
        );
        return next(new Error("User not found"));
      }

      // FIX: Use consistent userId naming
      socket.userId = user._id.toString();
      socket.user = user;
      console.log(
        "✅ Socket authenticated for user:",
        user.firstName,
        "ID:",
        user._id
      );
      next();
    } catch (error) {
      console.log("❌ Socket auth error:", error.message);
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", async (socket) => {
    console.log(`👤 User ${socket.user.firstName} connected: ${socket.id}`);

    // Add user to online users
    onlineUsers.set(socket.userId, {
      socketId: socket.id,
      user: {
        _id: socket.user._id,
        firstName: socket.user.firstName,
        lastName: socket.user.lastName,
      },
      lastSeen: new Date(),
    });

    try {
      // Join user to their match rooms
      const userMatches = await Match.findForUser(socket.userId);
      userMatches.forEach((match) => {
        socket.join(`match_${match._id}`);
        console.log(`🏠 User joined room: match_${match._id}`);
      });

      // Notify matches that user is online
      userMatches.forEach((match) => {
        const otherUserId = match.getOtherUser(socket.userId);
        socket.to(`match_${match._id}`).emit("user_online", {
          userId: socket.userId,
          matchId: match._id,
        });
      });
    } catch (error) {
      console.error("❌ Error joining match rooms:", error);
    }

    // Handle joining a specific conversation
    socket.on("join_conversation", async (data) => {
      const { matchId } = data;
      console.log(
        `🏠 User ${socket.user.firstName} joining conversation: ${matchId}`
      );

      try {
        // Verify user is part of this match
        const match = await Match.findById(matchId);
        if (match && match.users.includes(socket.userId)) {
          socket.join(`match_${matchId}`);

          // Notify other user that this user joined the conversation
          socket.to(`match_${matchId}`).emit("user_joined_conversation", {
            userId: socket.userId,
            matchId,
          });
        }
      } catch (error) {
        console.error("❌ Error joining conversation:", error);
      }
    });

    // Handle leaving a conversation
    socket.on("leave_conversation", (data) => {
      const { matchId } = data;
      console.log(
        `🚪 User ${socket.user.firstName} leaving conversation: ${matchId}`
      );
      socket.leave(`match_${matchId}`);

      // Notify other user that this user left the conversation
      socket.to(`match_${matchId}`).emit("user_left_conversation", {
        userId: socket.userId,
        matchId,
      });
    });

    // Handle typing indicators
    socket.on("typing_start", (data) => {
      const { matchId } = data;
      socket.to(`match_${matchId}`).emit("user_typing", {
        userId: socket.userId,
        userName: socket.user.firstName,
        matchId,
        isTyping: true,
      });
    });

    socket.on("typing_stop", (data) => {
      const { matchId } = data;
      socket.to(`match_${matchId}`).emit("user_typing", {
        userId: socket.userId,
        userName: socket.user.firstName,
        matchId,
        isTyping: false,
      });
    });

    // Handle message read receipts
    socket.on("mark_messages_read", async (data) => {
      const { matchId } = data;

      try {
        // Mark messages as read in database
        const Message = require("../models/Message");
        await Message.markConversationAsRead(matchId, socket.userId);

        // Notify other user that messages have been read
        socket.to(`match_${matchId}`).emit("messages_read", {
          matchId,
          readBy: socket.userId,
          readAt: new Date(),
        });
      } catch (error) {
        console.error("❌ Error marking messages as read:", error);
      }
    });

    // Handle real-time message sending
    socket.on("send_message", async (data) => {
      const { matchId, content, messageType = "text" } = data;
      console.log(
        `💬 Message from ${socket.user.firstName} in match ${matchId}`
      );

      try {
        // Verify match and create message
        const match = await Match.findById(matchId).populate(
          "users",
          "firstName lastName"
        );
        if (
          !match ||
          !match.users.find((user) => user._id.toString() === socket.userId)
        ) {
          socket.emit("error", {
            message: "Access denied to this conversation",
          });
          return;
        }

        const receiver = match.users.find(
          (user) => user._id.toString() !== socket.userId
        );

        const Message = require("../models/Message");
        const message = new Message({
          match: matchId,
          sender: socket.userId,
          receiver: receiver._id,
          content: content.trim(),
          messageType,
        });

        await message.save();
        await message.populate("sender", "firstName lastName");

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
          receiverId: receiver._id,
        };

        // Send to all users in the match room
        io.to(`match_${matchId}`).emit("new_message", formattedMessage);
      } catch (error) {
        console.error("❌ Socket message send error:", error);
        socket.emit("error", { message: "Error sending message" });
      }
    });

    // Handle user going offline
    socket.on("disconnect", async (reason) => {
      console.log(`👋 User ${socket.user.firstName} disconnected: ${reason}`);

      // Remove from online users
      onlineUsers.delete(socket.userId);

      // Notify matches that user went offline
      try {
        const userMatches = await Match.findForUser(socket.userId);
        userMatches.forEach((match) => {
          socket.to(`match_${match._id}`).emit("user_offline", {
            userId: socket.userId,
            matchId: match._id,
            lastSeen: new Date(),
          });
        });
      } catch (error) {
        console.error("❌ Error notifying offline status:", error);
      }
    });

    // Send initial online status for user's matches
    socket.emit("online_users", Array.from(onlineUsers.values()));
  });

  // Utility functions
  io.getOnlineUsers = () => {
    return Array.from(onlineUsers.values());
  };

  io.isUserOnline = (userId) => {
    return onlineUsers.has(userId);
  };

  io.sendToUser = (userId, event, data) => {
    const userInfo = onlineUsers.get(userId);
    if (userInfo) {
      io.to(userInfo.socketId).emit(event, data);
    }
  };

  console.log("✅ Socket.io handler setup complete");
};

module.exports = socketHandler;
