const express = require("express");
const { authenticate } = require("../middleware/auth");
const Message = require("../models/Message");
const Match = require("../models/Match");

const router = express.Router();

// @route   GET /api/chat/conversations
// @desc    Get all conversations for user
// @access  Private
router.get("/conversations", authenticate, async (req, res) => {
  try {
    // Get user's matches
    const matches = await Match.findForUser(req.user._id);

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
      };
    });

    // Sort by last message time or match time
    conversations.sort((a, b) => {
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
    });
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching messages",
    });
  }
});

// @route   POST /api/chat/:matchId/messages
// @desc    Send a message
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
    if (
      !match ||
      !match.users.find(
        (user) => user._id.toString() === req.user._id.toString()
      )
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied to this conversation",
      });
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
    };

    // Emit socket event (will be handled by socket.io)
    if (req.io) {
      req.io.to(`match_${matchId}`).emit("new_message", {
        ...formattedMessage,
        matchId,
        receiverId: receiver._id,
      });
    }

    res.json({
      success: true,
      message: formattedMessage,
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({
      success: false,
      message: "Error sending message",
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

module.exports = router;
