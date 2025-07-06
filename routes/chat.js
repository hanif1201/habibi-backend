const mongoose = require("mongoose");
const express = require("express");
const { body, validationResult } = require("express-validator");
const { authenticate } = require("../middleware/auth");
const Message = require("../models/Message");
const Match = require("../models/Match");
const User = require("../models/User");

const router = express.Router();

// @route   POST /api/chat/:matchId/messages
// @desc    Send a message with enhanced features
// @access  Private
router.post(
  "/:matchId/messages",
  authenticate,
  [
    body("content")
      .trim()
      .isLength({ min: 1, max: 1000 })
      .withMessage("Message must be 1-1000 characters"),
    body("messageType")
      .optional()
      .isIn(["text", "image", "gif"])
      .withMessage("Invalid message type"),
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

      const { matchId } = req.params;
      const { content, messageType = "text" } = req.body;

      // Verify match exists and user is part of it
      const match = await Match.findById(matchId).populate(
        "users",
        "firstName lastName safety"
      );
      if (!match) {
        return res.status(404).json({
          success: false,
          message: "Match not found",
        });
      }

      const currentUser = match.users.find(
        (user) => user._id.toString() === req.user._id.toString()
      );
      const otherUser = match.users.find(
        (user) => user._id.toString() !== req.user._id.toString()
      );

      if (!currentUser) {
        return res.status(403).json({
          success: false,
          message: "Access denied to this conversation",
        });
      }

      // Check if users have blocked each other
      if (
        currentUser.safety.blockedUsers.includes(otherUser._id) ||
        otherUser.safety.blockedUsers.includes(currentUser._id)
      ) {
        return res.status(403).json({
          success: false,
          message: "Cannot send message to this user",
        });
      }

      // Check match status
      if (match.status === "expired") {
        return res.status(400).json({
          success: false,
          message: "This match has expired",
        });
      }

      if (match.status !== "active") {
        return res.status(400).json({
          success: false,
          message: "Cannot send message to inactive match",
        });
      }

      // Check if this is the first message and match hasn't expired
      const isFirstMessage = !match.firstMessageSentAt;
      if (isFirstMessage && match.isExpired) {
        match.status = "expired";
        await match.save();
        return res.status(400).json({
          success: false,
          message: "This match has expired. You can no longer send messages.",
        });
      }

      // Content filtering for safety
      const filteredContent = filterInappropriateContent(content);
      if (filteredContent !== content) {
        return res.status(400).json({
          success: false,
          message: "Message contains inappropriate content",
        });
      }

      // Rate limiting for messages
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
      const recentMessages = await Message.countDocuments({
        sender: req.user._id,
        match: matchId,
        createdAt: { $gte: oneMinuteAgo },
      });

      if (recentMessages >= 10) {
        return res.status(429).json({
          success: false,
          message: "Too many messages sent. Please slow down.",
        });
      }

      // Create message
      const message = new Message({
        match: matchId,
        sender: req.user._id,
        receiver: otherUser._id,
        content: content.trim(),
        messageType,
      });

      await message.save();

      // Update match if first message
      if (isFirstMessage) {
        await match.markFirstMessageSent(req.user._id);
      } else {
        match.lastActivity = new Date();
        await match.save();
      }

      // Populate sender info
      await message.populate("sender", "firstName lastName photos");

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

      // Emit socket event for real-time delivery
      if (req.io) {
        req.io.to(`match_${matchId}`).emit("new_message", {
          ...formattedMessage,
          matchId,
          receiverId: otherUser._id,
          isFirstMessage,
        });

        // Send push notification if user is offline
        const isReceiverOnline = req.io.isUserOnline?.(
          otherUser._id.toString()
        );
        if (!isReceiverOnline && otherUser.settings?.notifications?.messages) {
          // TODO: Send push notification
          console.log(`📱 Message notification for ${otherUser.firstName}`);
        }

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
  }
);

// @route   GET /api/chat/conversations
// @desc    Get all conversations with enhanced filtering
// @access  Private
router.get("/conversations", authenticate, async (req, res) => {
  try {
    const { filter = "all", sort = "recent", limit = 50 } = req.query;

    // First expire old matches
    await Match.expireOldMatches();

    let matchQuery = {
      users: req.user._id,
      status: "active",
    };

    // Apply filters
    switch (filter) {
      case "unread":
        // Will be filtered after getting message data
        break;
      case "new":
        matchQuery.firstMessageSentAt = null;
        break;
      case "active":
        matchQuery.firstMessageSentAt = { $ne: null };
        break;
      case "expiring":
        matchQuery.firstMessageSentAt = null;
        matchQuery.expiresAt = {
          $gt: new Date(),
          $lt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Next 24 hours
        };
        break;
    }

    const matches = await Match.find(matchQuery)
      .populate(
        "users",
        "firstName lastName photos bio dateOfBirth gender verification lastActive safety"
      )
      .limit(parseInt(limit))
      .lean();

    if (matches.length === 0) {
      return res.json({
        success: true,
        conversations: [],
        summary: {
          total: 0,
          unread: 0,
          needingFirstMessage: 0,
          activeConversations: 0,
        },
      });
    }

    const matchIds = matches.map((match) => match._id);

    // Get comprehensive message data
    const messageData = await Message.aggregate([
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
          lastMessage: { $first: "$ROOT" },
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
          totalMessages: { $sum: 1 },
        },
      },
    ]);

    // Create conversation objects
    let conversations = matches.map((match) => {
      const otherUser = match.users.find(
        (user) => user._id.toString() !== req.user._id.toString()
      );
      const msgData = messageData.find(
        (msg) => msg._id.toString() === match._id.toString()
      );

      // Check if users have blocked each other
      const isBlocked = otherUser.safety.blockedUsers.includes(req.user._id);

      return {
        matchId: match._id,
        user: {
          _id: otherUser._id,
          firstName: otherUser.firstName,
          lastName: otherUser.lastName,
          photos: otherUser.photos,
          primaryPhoto:
            otherUser.photos?.find((p) => p.isPrimary) || otherUser.photos?.[0],
          verification: otherUser.verification,
          isOnline: isUserRecentlyActive(otherUser.lastActive),
          lastActive: otherUser.lastActive,
        },
        lastMessage: msgData?.lastMessage
          ? {
              content: msgData.lastMessage.content,
              createdAt: msgData.lastMessage.createdAt,
              senderId: msgData.lastMessage.sender,
              isFromMe:
                msgData.lastMessage.sender.toString() ===
                req.user._id.toString(),
              messageType: msgData.lastMessage.messageType,
            }
          : null,
        unreadCount: msgData?.unreadCount || 0,
        totalMessages: msgData?.totalMessages || 0,
        matchedAt: match.matchedAt,
        conversationStarted: !!match.firstMessageSentAt,
        firstMessageSentAt: match.firstMessageSentAt,
        firstMessageSentBy: match.firstMessageSentBy,
        expiresAt: match.expiresAt,
        timeToExpiration: match.timeToExpiration,
        urgencyLevel: match.urgencyLevel,
        needsFirstMessage: !match.firstMessageSentAt && !match.isExpired,
        matchType: match.matchType,
        isBlocked,
      };
    });

    // Filter blocked conversations unless specifically requested
    if (filter !== "blocked") {
      conversations = conversations.filter((conv) => !conv.isBlocked);
    }

    // Apply additional filtering
    if (filter === "unread") {
      conversations = conversations.filter((conv) => conv.unreadCount > 0);
    }

    // Apply sorting
    conversations.sort((a, b) => {
      switch (sort) {
        case "recent":
          // First prioritize unread messages
          if (a.unreadCount !== b.unreadCount) {
            return b.unreadCount - a.unreadCount;
          }
          // Then by last activity
          const aTime = a.lastMessage
            ? new Date(a.lastMessage.createdAt)
            : new Date(a.matchedAt);
          const bTime = b.lastMessage
            ? new Date(b.lastMessage.createdAt)
            : new Date(b.matchedAt);
          return bTime - aTime;

        case "unread":
          if (a.unreadCount !== b.unreadCount) {
            return b.unreadCount - a.unreadCount;
          }
          return new Date(b.matchedAt) - new Date(a.matchedAt);

        case "new":
          if (a.needsFirstMessage !== b.needsFirstMessage) {
            return a.needsFirstMessage ? -1 : 1;
          }
          // Sort by urgency for new matches
          const urgencyOrder = {
            critical: 0,
            warning: 1,
            normal: 2,
            expired: 3,
          };
          return urgencyOrder[a.urgencyLevel] - urgencyOrder[b.urgencyLevel];

        case "online":
          if (a.user.isOnline !== b.user.isOnline) {
            return a.user.isOnline ? -1 : 1;
          }
          return new Date(b.user.lastActive) - new Date(a.user.lastActive);

        case "verified":
          if (
            a.user.verification.isVerified !== b.user.verification.isVerified
          ) {
            return a.user.verification.isVerified ? -1 : 1;
          }
          return new Date(b.matchedAt) - new Date(a.matchedAt);

        default:
          return new Date(b.matchedAt) - new Date(a.matchedAt);
      }
    });

    const summary = {
      total: conversations.length,
      unread: conversations.filter((c) => c.unreadCount > 0).length,
      needingFirstMessage: conversations.filter((c) => c.needsFirstMessage)
        .length,
      activeConversations: conversations.filter((c) => c.conversationStarted)
        .length,
      onlineNow: conversations.filter((c) => c.user.isOnline).length,
      expiringSoon: conversations.filter((c) => c.urgencyLevel === "critical")
        .length,
    };

    res.json({
      success: true,
      conversations,
      summary,
      filter,
      sort,
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
// @desc    Get messages with enhanced pagination and filtering
// @access  Private
router.get("/:matchId/messages", authenticate, async (req, res) => {
  try {
    const { matchId } = req.params;
    const {
      page = 1,
      limit = 50,
      before, // Message ID to get messages before
      after, // Message ID to get messages after
      search, // Search term
    } = req.query;

    // Verify user is part of this match
    const match = await Match.findById(matchId);
    if (!match || !match.users.includes(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this conversation",
      });
    }

    let query = {
      match: matchId,
      isDeleted: false,
    };

    // Add search functionality
    if (search) {
      query.content = { $regex: search, $options: "i" };
    }

    // Cursor-based pagination
    if (before) {
      const beforeMessage = await Message.findById(before);
      if (beforeMessage) {
        query.createdAt = { $lt: beforeMessage.createdAt };
      }
    }

    if (after) {
      const afterMessage = await Message.findById(after);
      if (afterMessage) {
        query.createdAt = { $gt: afterMessage.createdAt };
      }
    }

    const messages = await Message.find(query)
      .populate("sender", "firstName lastName photos")
      .populate("receiver", "firstName lastName photos")
      .sort({ createdAt: before ? -1 : 1 })
      .limit(parseInt(limit))
      .lean();

    // Mark messages as read (only unread messages to current user)
    await Message.updateMany(
      {
        match: matchId,
        receiver: req.user._id,
        readAt: null,
        isDeleted: false,
      },
      { readAt: new Date() }
    );

    // Emit read receipt to other user
    if (req.io && messages.length > 0) {
      req.io.to(`match_${matchId}`).emit("messages_read", {
        matchId,
        readBy: req.user._id,
        readAt: new Date(),
      });
    }

    // Format messages
    const formattedMessages = (before ? messages.reverse() : messages).map(
      (message) => ({
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
      })
    );

    // Get pagination info
    const hasMore = messages.length === parseInt(limit);
    const firstMessage = formattedMessages[0];
    const lastMessage = formattedMessages[formattedMessages.length - 1];

    res.json({
      success: true,
      messages: formattedMessages,
      pagination: {
        hasMore,
        hasPrevious: !!before || page > 1,
        cursors: {
          before: firstMessage?._id,
          after: lastMessage?._id,
        },
        count: formattedMessages.length,
      },
      conversationInfo: {
        matchId: match._id,
        conversationStarted: !!match.firstMessageSentAt,
        firstMessageSentAt: match.firstMessageSentAt,
        firstMessageSentBy: match.firstMessageSentBy,
        isExpired: match.isExpired,
        timeToExpiration: match.timeToExpiration,
        matchType: match.matchType,
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
// @desc    Edit a message with enhanced validation
// @access  Private
router.put(
  "/messages/:messageId",
  authenticate,
  [
    body("content")
      .trim()
      .isLength({ min: 1, max: 1000 })
      .withMessage("Message must be 1-1000 characters"),
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

      const { messageId } = req.params;
      const { content } = req.body;

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

      // Check if message is too old to edit (15 minutes)
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      if (message.createdAt < fifteenMinutesAgo) {
        return res.status(400).json({
          success: false,
          message: "Message too old to edit (15 minute limit)",
        });
      }

      // Content filtering
      const filteredContent = filterInappropriateContent(content);
      if (filteredContent !== content) {
        return res.status(400).json({
          success: false,
          message: "Message contains inappropriate content",
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
        editedAt: message.editedAt,
      });
    } catch (error) {
      console.error("Edit message error:", error);
      res.status(500).json({
        success: false,
        message: "Error editing message",
      });
    }
  }
);

// @route   DELETE /api/chat/messages/:messageId
// @desc    Delete a message with enhanced permissions
// @access  Private
router.delete("/messages/:messageId", authenticate, async (req, res) => {
  try {
    const { messageId } = req.params;

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

    // Check if message is too old to delete (1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (message.createdAt < oneHourAgo) {
      return res.status(400).json({
        success: false,
        message: "Message too old to delete (1 hour limit)",
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

// @route   GET /api/chat/search
// @desc    Search messages across all conversations
// @access  Private
router.get("/search", authenticate, async (req, res) => {
  try {
    const { q: query, limit = 20, matchId } = req.query;

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Search query must be at least 2 characters",
      });
    }

    // Get user's matches
    const userMatches = await Match.find({
      users: req.user._id,
      status: "active",
    }).select("_id");

    const matchIds = userMatches.map((match) => match._id);

    let searchQuery = {
      match: { $in: matchIds },
      content: { $regex: query, $options: "i" },
      isDeleted: false,
    };

    // Filter by specific match if provided
    if (matchId) {
      searchQuery.match = matchId;
    }

    const messages = await Message.find(searchQuery)
      .populate("sender", "firstName lastName")
      .populate("match", "users")
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    const formattedResults = messages.map((message) => ({
      _id: message._id,
      content: message.content,
      createdAt: message.createdAt,
      sender: message.sender,
      matchId: message.match._id,
      isFromMe: message.sender._id.toString() === req.user._id.toString(),
    }));

    res.json({
      success: true,
      results: formattedResults,
      query,
      count: formattedResults.length,
    });
  } catch (error) {
    console.error("Search messages error:", error);
    res.status(500).json({
      success: false,
      message: "Error searching messages",
    });
  }
});

// @route   GET /api/chat/unread-summary
// @desc    Get unread message summary
// @access  Private
router.get("/unread-summary", authenticate, async (req, res) => {
  try {
    const unreadMessages = await Message.aggregate([
      {
        $match: {
          receiver: req.user._id,
          readAt: null,
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: "$match",
          count: { $sum: 1 },
          latestMessage: { $max: "$createdAt" },
        },
      },
      {
        $lookup: {
          from: "matches",
          localField: "_id",
          foreignField: "_id",
          as: "match",
        },
      },
      {
        $unwind: "$match",
      },
      {
        $lookup: {
          from: "users",
          localField: "match.users",
          foreignField: "_id",
          as: "users",
        },
      },
    ]);

    const summary = {
      totalUnread: unreadMessages.reduce((sum, msg) => sum + msg.count, 0),
      conversationsWithUnread: unreadMessages.length,
      conversations: unreadMessages.map((msg) => {
        const otherUser = msg.users.find(
          (user) => user._id.toString() !== req.user._id.toString()
        );
        return {
          matchId: msg._id,
          unreadCount: msg.count,
          latestMessage: msg.latestMessage,
          user: {
            _id: otherUser._id,
            firstName: otherUser.firstName,
            primaryPhoto:
              otherUser.photos?.find((p) => p.isPrimary) ||
              otherUser.photos?.[0],
          },
        };
      }),
    };

    res.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error("Get unread summary error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching unread summary",
    });
  }
});

// Helper functions
function filterInappropriateContent(content) {
  // Basic content filtering - in production, use a more sophisticated service
  const inappropriateWords = [
    // Add inappropriate words here
    "spam",
    "scam", // Basic examples
  ];

  let filteredContent = content;
  inappropriateWords.forEach((word) => {
    const regex = new RegExp(word, "gi");
    filteredContent = filteredContent.replace(regex, "***");
  });

  return filteredContent;
}

function isUserRecentlyActive(lastActive) {
  if (!lastActive) return false;
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  return new Date(lastActive) > fifteenMinutesAgo;
}

module.exports = router;
