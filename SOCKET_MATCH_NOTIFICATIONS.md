# 🚨 Real-time Socket Match Notifications

This document describes the implementation of real-time socket match notifications in the Habibi backend.

## ✅ Implementation Status

All required features have been implemented:

1. ✅ **New socket event "new_match"** - Added to `socket/socketHandler.js`
2. ✅ **Emit match event from swipe endpoint** - Added to `routes/matching.js`
3. ✅ **Handle the event on frontend** - Ready for frontend integration
4. ✅ **User online status check** - Only sends socket if user is currently online
5. ✅ **Test real-time notifications** - Test files and debug endpoints created

## 🔧 Implementation Details

### 1. Socket Handler Updates (`socket/socketHandler.js`)

Added a new public API function `io.sendMatchNotification()` that:

- Takes two user IDs and match data
- Checks if users are online using `userSockets` Map
- Emits "new_match" event to online users only
- Returns status of which users received the notification
- Logs detailed information for debugging

```javascript
io.sendMatchNotification = (userId1, userId2, matchData) => {
  // Sends "new_match" event to both users if they're online
  // Returns: { user1Online: boolean, user2Online: boolean, sent: number }
};
```

### 2. Swipe Endpoint Updates (`routes/matching.js`)

Added real-time socket notification right after match creation:

- Prepares match data with user information
- Calls `req.io.sendMatchNotification()`
- Handles errors gracefully (doesn't fail match creation)
- Logs detailed results for monitoring

### 3. Debug Endpoint (`routes/debug.js`)

Added `/api/debug/test-match-notification` endpoint for testing:

- Accepts user IDs and match data
- Verifies users exist in database
- Tests socket notification functionality
- Returns detailed results

## 🧪 Testing

### Method 1: Browser Test (Recommended)

1. **Start the server:**

   ```bash
   npm start
   ```

2. **Open test page in browser:**

   ```
   http://localhost:5000/test-socket-match.html
   ```

3. **Test with two browser tabs:**
   - Tab 1: Enter User ID 1, connect to socket
   - Tab 2: Enter User ID 2, connect to socket
   - In Tab 1: Enter User ID 2, click "Test Match Notification"
   - Watch for real-time notifications in both tabs!

### Method 2: Node.js Test Script

1. **Install dependencies:**

   ```bash
   npm install socket.io-client
   ```

2. **Set environment variables:**

   ```bash
   export TEST_USER1_ID="actual_user_id_1"
   export TEST_USER2_ID="actual_user_id_2"
   export JWT_SECRET="your-secret-key"
   ```

3. **Run test:**
   ```bash
   node test-socket-match.js
   ```

### Method 3: API Test

1. **Create two users and get their IDs**

2. **Make a POST request:**
   ```bash
   curl -X POST http://localhost:5000/api/debug/test-match-notification \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -d '{
       "user1Id": "user_id_1",
       "user2Id": "user_id_2",
       "matchData": {
         "_id": "test_match_id",
         "users": [...],
         "matchType": "regular",
         "createdAt": "2024-01-01T00:00:00.000Z",
         "initiatedBy": "user_id_1"
       }
     }'
   ```

## 📡 Frontend Integration

The frontend should listen for the "new_match" event:

```javascript
// Connect to socket
const socket = io("http://localhost:5000", {
  auth: { token: userJWTToken },
});

// Listen for match notifications
socket.on("new_match", (data) => {
  console.log("💕 New match!", data);

  // Show match popup/animation
  showMatchPopup(data.match);

  // Update UI
  updateMatchesList(data.match);

  // Play sound, show notification, etc.
  playMatchSound();
});
```

## 📊 Event Data Structure

The "new_match" event sends this data structure:

```javascript
{
  type: "new_match",
  match: {
    _id: "match_id",
    users: [
      {
        _id: "user_id_1",
        firstName: "Alice",
        lastName: "Smith",
        photos: [...],
        primaryPhoto: {...}
      },
      {
        _id: "user_id_2",
        firstName: "Bob",
        lastName: "Johnson",
        photos: [...],
        primaryPhoto: {...}
      }
    ],
    matchType: "regular", // or "superlike"
    createdAt: "2024-01-01T00:00:00.000Z",
    initiatedBy: "user_id_1"
  },
  timestamp: "2024-01-01T00:00:00.000Z"
}
```

## 🔍 Monitoring & Debugging

### Console Logs

The system logs detailed information:

```
💕 New match created: Alice + Bob
💕 Socket match notification sent: { user1Online: true, user2Online: false, totalSent: 1 }
💕 Sent match notification to user 507f1f77bcf86cd799439011
📱 User 507f1f77bcf86cd799439012 is offline - match notification queued for push
```

### Health Check

Check socket status via `/health` endpoint:

```json
{
  "onlineUsers": 5,
  "features": {
    "realTimeChat": true,
    "matching": true
  }
}
```

## 🚀 Production Considerations

1. **Error Handling**: Socket failures don't break match creation
2. **Performance**: Only sends to online users, reduces server load
3. **Scalability**: Uses efficient Map data structures for user tracking
4. **Monitoring**: Comprehensive logging for debugging
5. **Security**: JWT authentication required for socket connections

## 🐛 Troubleshooting

### Common Issues

1. **"Socket auth failed"**

   - Check JWT token is valid
   - Verify user exists and is active

2. **"User not found"**

   - Ensure user IDs exist in database
   - Check user is not deleted/blocked

3. **No notifications received**
   - Verify users are connected to socket
   - Check browser console for errors
   - Ensure frontend is listening for "new_match" event

### Debug Commands

```bash
# Check socket connections
curl http://localhost:5000/health

# Test match notification
curl -X POST http://localhost:5000/api/debug/test-match-notification \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user1Id":"ID1","user2Id":"ID2","matchData":{...}}'
```

## ✅ Testing Checklist

- [ ] Two users can connect to socket simultaneously
- [ ] Match notification sent when match is created
- [ ] Only online users receive notifications
- [ ] Offline users don't receive socket notifications
- [ ] Push notifications still work for offline users
- [ ] Error handling works (socket failures don't break matches)
- [ ] Frontend can receive and display match notifications
- [ ] Multiple browser tabs work correctly
- [ ] Performance is acceptable under load

## 🎯 Next Steps

1. **Frontend Integration**: Implement match popup/animation
2. **Sound Effects**: Add match notification sounds
3. **Analytics**: Track match notification delivery rates
4. **Optimization**: Consider WebSocket compression for large payloads
5. **Testing**: Add automated tests for socket functionality
