const express = require("express");
const { authenticate } = require("../middleware/auth");
const Message = require("../models/Message");
const Match = require("../models/Match");

const router = express.Router();

// @route   POST /api/chat/:matchId/messages
// @desc    Send a message (with first message handling)
// @access  Private
router.post("/:matchId/messages", authenticate, async (req, res) => {
  try {
    const { matchId } = req.params;
    const { content, messageType = "text" } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Message content is required",
      });
    }

    if (content.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Message too long (max 1000 characters)",
      });
    }

    // Verify match exists and user is part of it
    const match = await Match.findById(matchId).populate(
      "users",
      "firstName lastName"
    );

    if (!match) {
      return res.status(404).json({
        success: false,
        message: "Match not found",
      });
    }

    if (
      !match.users.find(
        (user) => user._id.toString() === req.user._id.toString()
      )
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this conversation",
      });
    }

    // Check if match is expired
    if (match.status === "expired") {
      return res.status(400).json({
        success: false,
        message: "This match has expired",
      });
    }

    // Check if match is still active
    if (match.status !== "active") {
      return res.status(400).json({
        success: false,
        message: "Cannot send message to inactive match",
      });
    }

    // Check if this is the first message
    const isFirstMessage = !match.firstMessageSentAt;

    if (isFirstMessage) {
      // Verify the match hasn't expired
      if (match.isExpired) {
        // Mark match as expired
        match.status = "expired";
        await match.save();

        return res.status(400).json({
          success: false,
          message: "This match has expired. You can no longer send messages.",
        });
      }
    }

    // Get receiver (the other user in the match)
    const receiver = match.users.find(
      (user) => user._id.toString() !== req.user._id.toString()
    );

    // Create message
    const message = new Message({
      match: matchId,
      sender: req.user._id,
      receiver: receiver._id,
      content: content.trim(),
      messageType,
    });

    await message.save();

    // If this is the first message, update the match
    if (isFirstMessage) {
      await match.markFirstMessageSent(req.user._id);
    } else {
      // Update last activity
      match.lastActivity = new Date();
      await match.save();
    }

    // Populate sender info for response
    await message.populate("sender", "firstName lastName");

    // Format response
    const formattedMessage = {
      _id: message._id,
      content: message.content,
      sender: {
        _id: message.sender._id,
        firstName: message.sender.firstName,
        lastName: message.sender.lastName,
      },
      isFromMe: true,
      createdAt: message.createdAt,
      readAt: message.readAt,
      messageType: message.messageType,
      isFirstMessage,
    };

    // Emit socket event (will be handled by socket.io)
    if (req.io) {
      req.io.to(`match_${matchId}`).emit("new_message", {
        ...formattedMessage,
        matchId,
        receiverId: receiver._id,
        isFirstMessage,
      });

      // If this was the first message, notify about conversation start
      if (isFirstMessage) {
        req.io.to(`match_${matchId}`).emit("conversation_started", {
          matchId,
          startedBy: req.user._id,
          startedAt: new Date(),
        });
      }
    }

    res.json({
      success: true,
      message: formattedMessage,
      conversationStarted: isFirstMessage,
      match: isFirstMessage
        ? {
            _id: match._id,
            conversationStarted: true,
            firstMessageSentAt: match.firstMessageSentAt,
            firstMessageSentBy: match.firstMessageSentBy,
          }
        : undefined,
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending message",
    });
  }
});

// @route   GET /api/chat/conversations
// @desc    Get all conversations for user (enhanced with first message info)
// @access  Private
router.get("/conversations", authenticate, async (req, res) => {
  try {
    // First expire old matches
    await Match.expireOldMatches();

    // Get user's active matches
    const matches = await Match.find({
      users: req.user._id,
      status: "active",
    }).populate("users", "firstName lastName photos bio dateOfBirth gender");

    if (matches.length === 0) {
      return res.json({
        success: true,
        conversations: [],
      });
    }

    // Get match IDs
    const matchIds = matches.map((match) => match._id);

    // Get last message for each match
    const lastMessages = await Message.aggregate([
      {
        $match: {
          match: { $in: matchIds },
          isDeleted: false,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: "$match",
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiver", req.user._id] },
                    { $eq: ["$readAt", null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    // Create conversation objects
    const conversations = matches.map((match) => {
      const lastMessageData = lastMessages.find(
        (msg) => msg._id.toString() === match._id.toString()
      );

      const otherUser = match.getOtherUser(req.user._id);

      return {
        matchId: match._id,
        user: {
          _id: otherUser._id,
          firstName: otherUser.firstName,
          lastName: otherUser.lastName,
          photos: otherUser.photos,
          primaryPhoto:
            otherUser.photos?.find((p) => p.isPrimary) || otherUser.photos?.[0],
        },
        lastMessage: lastMessageData
          ? {
              content: lastMessageData.lastMessage.content,
              createdAt: lastMessageData.lastMessage.createdAt,
              senderId: lastMessageData.lastMessage.sender,
              isFromMe:
                lastMessageData.lastMessage.sender.toString() ===
                req.user._id.toString(),
            }
          : null,
        unreadCount: lastMessageData ? lastMessageData.unreadCount : 0,
        matchedAt: match.matchedAt,
        conversationStarted: !!match.firstMessageSentAt,
        firstMessageSentAt: match.firstMessageSentAt,
        firstMessageSentBy: match.firstMessageSentBy,
        expiresAt: match.expiresAt,
        timeToExpiration: match.timeToExpiration,
        urgencyLevel: match.urgencyLevel,
        needsFirstMessage: !match.firstMessageSentAt && !match.isExpired,
      };
    });

    // Sort conversations
    conversations.sort((a, b) => {
      // First, prioritize conversations that need first message
      if (a.needsFirstMessage && !b.needsFirstMessage) return -1;
      if (!a.needsFirstMessage && b.needsFirstMessage) return 1;

      // Then sort by last message time or match time
      const aTime = a.lastMessage
        ? new Date(a.lastMessage.createdAt)
        : new Date(a.matchedAt);
      const bTime = b.lastMessage
        ? new Date(b.lastMessage.createdAt)
        : new Date(b.matchedAt);
      return bTime - aTime;
    });

    res.json({
      success: true,
      conversations,
      summary: {
        total: conversations.length,
        needingFirstMessage: conversations.filter((c) => c.needsFirstMessage)
          .length,
        withUnreadMessages: conversations.filter((c) => c.unreadCount > 0)
          .length,
        activeConversations: conversations.filter((c) => c.conversationStarted)
          .length,
      },
    });
  } catch (error) {
    console.error("Get conversations error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching conversations",
    });
  }
});

// @route   GET /api/chat/:matchId/messages
// @desc    Get messages for a specific conversation
// @access  Private
router.get("/:matchId/messages", authenticate, async (req, res) => {
  try {
    const { matchId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify user is part of this match
    const match = await Match.findById(matchId);
    if (!match || !match.users.includes(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this conversation",
      });
    }

    // Get messages
    const messages = await Message.getConversation(
      matchId,
      parseInt(page),
      parseInt(limit)
    );

    // Mark messages as read
    await Message.markConversationAsRead(matchId, req.user._id);

    // Format messages
    const formattedMessages = messages.reverse().map((message) => ({
      _id: message._id,
      content: message.content,
      sender: {
        _id: message.sender._id,
        firstName: message.sender.firstName,
        lastName: message.sender.lastName,
      },
      isFromMe: message.sender._id.toString() === req.user._id.toString(),
      createdAt: message.createdAt,
      readAt: message.readAt,
      isEdited: message.isEdited,
      editedAt: message.editedAt,
      messageType: message.messageType,
    }));

    res.json({
      success: true,
      messages: formattedMessages,
      hasMore: messages.length === parseInt(limit),
      conversationInfo: {
        matchId: match._id,
        conversationStarted: !!match.firstMessageSentAt,
        firstMessageSentAt: match.firstMessageSentAt,
        firstMessageSentBy: match.firstMessageSentBy,
        isExpired: match.isExpired,
        timeToExpiration: match.timeToExpiration,
      },
    });
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching messages",
    });
  }
});

// @route   PUT /api/chat/messages/:messageId
// @desc    Edit a message
// @access  Private
router.put("/messages/:messageId", authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Message content is required",
      });
    }

    // Find message and verify ownership
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own messages",
      });
    }

    // Check if message is too old to edit (e.g., 15 minutes)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    if (message.createdAt < fifteenMinutesAgo) {
      return res.status(400).json({
        success: false,
        message: "Message too old to edit",
      });
    }

    // Edit message
    await message.editContent(content.trim());

    // Emit socket event
    if (req.io) {
      req.io.to(`match_${message.match}`).emit("message_edited", {
        messageId: message._id,
        content: message.content,
        editedAt: message.editedAt,
      });
    }

    res.json({
      success: true,
      message: "Message edited successfully",
    });
  } catch (error) {
    console.error("Edit message error:", error);
    res.status(500).json({
      success: false,
      message: "Error editing message",
    });
  }
});

// @route   DELETE /api/chat/messages/:messageId
// @desc    Delete a message
// @access  Private
router.delete("/messages/:messageId", authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;

    // Find message and verify ownership
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own messages",
      });
    }

    // Soft delete message
    await message.softDelete();

    // Emit socket event
    if (req.io) {
      req.io.to(`match_${message.match}`).emit("message_deleted", {
        messageId: message._id,
      });
    }

    res.json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    console.error("Delete message error:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting message",
    });
  }
});

// @route   GET /api/chat/unread-count
// @desc    Get unread message count
// @access  Private
router.get("/unread-count", authenticate, async (req, res) => {
  try {
    const unreadCount = await Message.getUnreadCount(req.user._id);

    res.json({
      success: true,
      unreadCount,
    });
  } catch (error) {
    console.error("Get unread count error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching unread count",
    });
  }
});

// @route   GET /api/chat/conversation-starters/:matchId
// @desc    Get personalized conversation starters for a match
// @access  Private
router.get(
  "/conversation-starters/:matchId",
  authenticate,
  async (req, res) => {
    try {
      const { matchId } = req.params;

      // Verify match exists and user is part of it
      const match = await Match.findById(matchId).populate(
        "users",
        "firstName lastName bio photos"
      );

      if (
        !match ||
        !match.users.find(
          (user) => user._id.toString() === req.user._id.toString()
        )
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied to this match",
        });
      }

      const otherUser = match.getOtherUser(req.user._id);

      // Generate personalized ice breakers
      const iceBreakers = generateIceBreakers(otherUser);

      res.json({
        success: true,
        iceBreakers,
        user: {
          firstName: otherUser.firstName,
          bio: otherUser.bio,
        },
      });
    } catch (error) {
      console.error("Get conversation starters error:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching conversation starters",
      });
    }
  }
);

// @route   POST /api/chat/:matchId/typing
// @desc    Handle typing indicators
// @access  Private
router.post("/:matchId/typing", authenticate, (req, res) => {
  try {
    const { matchId } = req.params;
    const { isTyping } = req.body;

    if (req.io) {
      req.io.to(`match_${matchId}`).emit("user_typing", {
        userId: req.user._id,
        userName: req.user.firstName,
        matchId,
        isTyping: !!isTyping,
      });
    }

    res.json({
      success: true,
      message: "Typing status updated",
    });
  } catch (error) {
    console.error("Typing indicator error:", error);
    res.status(500).json({
      success: false,
      message: "Error updating typing status",
    });
  }
});

// Helper function to generate personalized ice breakers
function generateIceBreakers(user) {
  const defaultBreakers = [
    `Hey ${user.firstName}! I'm excited we matched! How's your day going? 😊`,
    `Hi there! I love your photos! What's your favorite thing to do on weekends?`,
    `Hey! Your profile caught my eye. What's something you're passionate about?`,
    `Hi! I noticed we matched - what's the best concert/event you've been to recently?`,
    `Hey there! Great to match with you! What's your go-to coffee order? ☕`,
    `Hi! I'm curious - what's your favorite way to spend a lazy Sunday?`,
  ];

  const personalizedBreakers = [];

  if (user.bio) {
    const bio = user.bio.toLowerCase();

    if (bio.includes("travel")) {
      personalizedBreakers.push(
        `Hi ${user.firstName}! I noticed you love traveling. What's the most amazing place you've visited? ✈️`
      );
    }
    if (bio.includes("music")) {
      personalizedBreakers.push(
        `Hey! I see you're into music. What's the last song that gave you goosebumps? 🎵`
      );
    }
    if (bio.includes("food") || bio.includes("cooking")) {
      personalizedBreakers.push(
        `Hi there! Fellow foodie here! What's your signature dish or favorite restaurant? 🍕`
      );
    }
    if (
      bio.includes("fitness") ||
      bio.includes("gym") ||
      bio.includes("workout")
    ) {
      personalizedBreakers.push(
        `Hey ${user.firstName}! I see you're into fitness. What's your favorite workout or sport? 💪`
      );
    }
    if (bio.includes("dog") || bio.includes("cat") || bio.includes("pet")) {
      personalizedBreakers.push(
        `Hi! I noticed you're a pet lover! Tell me about your furry friend! 🐕`
      );
    }
    if (bio.includes("book") || bio.includes("read")) {
      personalizedBreakers.push(
        `Hey there! What's the last book that kept you up all night reading? 📚`
      );
    }
    if (
      bio.includes("netflix") ||
      bio.includes("movie") ||
      bio.includes("series")
    ) {
      personalizedBreakers.push(
        `Hi ${user.firstName}! What's your current Netflix obsession? 🎬`
      );
    }
    if (
      bio.includes("adventure") ||
      bio.includes("hiking") ||
      bio.includes("outdoor")
    ) {
      personalizedBreakers.push(
        `Hey! I love that you're into adventures! What's the most exciting outdoor activity you've done? 🏔️`
      );
    }
  }

  // Combine and return top 6 ice breakers
  return [...personalizedBreakers, ...defaultBreakers].slice(0, 6);
}

module.exports = router;
