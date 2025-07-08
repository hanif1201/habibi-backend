# Progressive Expiration Warnings

## Overview

The Progressive Expiration Warnings feature sends escalating notifications to users as their matches approach expiration. This system helps increase engagement by reminding users to send their first message before matches expire.

## Features

### Multiple Warning Intervals

- **24 hours**: Gentle notice with blue styling
- **12 hours**: Warning with orange styling
- **6 hours**: Urgent warning with red styling
- **2 hours**: Critical warning with blinking red styling
- **1 hour**: Final warning with intense red styling and blinking

### Dual Notification Channels

- **Email notifications**: All intervals (24h, 12h, 6h, 2h, 1h)
- **Push notifications**: Critical intervals only (2h, 1h)

### Smart Warning Tracking

- Prevents duplicate warnings using `warningSent` flags
- Tracks last warning sent timestamp
- Respects user notification preferences

## Implementation Details

### Database Schema Updates

#### Match Model (`models/Match.js`)

```javascript
// Progressive expiration warning tracking
warningSent: {
  24: { type: Boolean, default: false }, // 24 hours remaining
  12: { type: Boolean, default: false }, // 12 hours remaining
  6: { type: Boolean, default: false },  // 6 hours remaining
  2: { type: Boolean, default: false },  // 2 hours remaining
  1: { type: Boolean, default: false },  // 1 hour remaining
},
lastWarningSentAt: {
  type: Date,
  default: null,
},
```

#### New Match Methods

- `shouldSendWarning(hoursRemaining)`: Checks if warning should be sent
- `markWarningSent(hoursRemaining)`: Marks warning as sent
- `getWarningLevel()`: Returns current urgency level

### Email Templates

#### Template Files

- `templates/match-expiration-24h.html` - Gentle notice
- `templates/match-expiration-12h.html` - Warning
- `templates/match-expiration-6h.html` - Urgent
- `templates/match-expiration-2h.html` - Critical
- `templates/match-expiration-1h.html` - Final warning

#### Template Features

- Progressive color schemes (blue → orange → red)
- Increasing urgency in messaging
- Blinking animations for critical warnings
- Responsive design

### Email Service Updates

#### New Method

```javascript
async sendExpirationWarningEmail(user, match, otherUser, hoursRemaining)
```

#### Features

- Automatic template selection based on hours remaining
- Progressive subject lines with emojis
- User preference checking
- Rate limiting

### Push Notification Service Updates

#### New Method

```javascript
async sendExpirationWarningNotification(userId, matchData, hoursRemaining)
```

#### Features

- Only sends for critical intervals (2h, 1h)
- Progressive vibration patterns
- Interactive notifications with actions
- Quiet hours respect

### Job System Updates

#### Cron Schedule

- **Previous**: Every 6 hours (`0 */6 * * *`)
- **New**: Every hour (`0 * * * *`)

#### New Methods

- `processExpirationWarnings(hoursRemaining, now)`: Handles email warnings
- `processExpirationPushNotifications(hoursRemaining, now)`: Handles push notifications
- `triggerExpirationWarnings(hoursRemaining)`: Manual testing method

## Usage

### Automatic Operation

The system runs automatically every hour and checks for matches that need warnings.

### Manual Testing

#### Via Debug Routes

```bash
# Test specific interval
POST /api/debug/test-expiration-warnings
{
  "hoursRemaining": 6,
  "matchId": "match_id_here"
}

# Get expiration statistics
GET /api/debug/expiration-stats
```

#### Via Test Script

```bash
node scripts/testExpirationWarnings.js
```

### Manual Trigger

```javascript
const emailJobs = require("./jobs/emailJobs");

// Test specific interval
await emailJobs.triggerExpirationWarnings(6);

// Test all intervals
await emailJobs.triggerExpirationWarnings();
```

## Configuration

### Environment Variables

- `FRONTEND_URL`: Required for email links
- `EMAIL_PROVIDER`: Email service configuration
- `FIREBASE_*`: Push notification configuration

### User Settings

Users can control notifications via:

- `settings.notifications.email`: Email notifications
- `settings.notifications.push`: Push notifications
- `settings.notifications.matchExpiring`: Match expiration warnings
- `settings.notifications.quietHours`: Quiet hours settings

## Monitoring

### Logs

The system logs detailed information:

```
⏰ Starting progressive match expiration warnings...
⏰ 24h warnings: 5 emails, 0 push notifications sent
⏰ 12h warnings: 3 emails, 0 push notifications sent
⏰ 6h warnings: 2 emails, 0 push notifications sent
⏰ 2h warnings: 1 emails, 1 push notifications sent
⏰ 1h warnings: 0 emails, 0 push notifications sent
⏰ Progressive expiration warnings complete: 11 emails, 1 push notifications sent
```

### Metrics

Track via debug endpoint:

- Active matches count
- Matches expiring in each interval
- Warning delivery statistics

## Testing

### Test Scenarios

1. **Normal Flow**: Match expires naturally, warnings sent at appropriate intervals
2. **User Preferences**: Users with disabled notifications don't receive warnings
3. **Duplicate Prevention**: Same warning not sent twice
4. **Message Sent**: Warnings stop when first message is sent
5. **Match Expired**: No warnings for already expired matches

### Test Data Setup

```javascript
// Create test match expiring in 6 hours
const testMatch = new Match({
  users: [user1Id, user2Id],
  expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
  status: "active",
  firstMessageSentAt: null,
  warningSent: { 24: false, 12: false, 6: false, 2: false, 1: false },
});
```

## Troubleshooting

### Common Issues

1. **No warnings sent**: Check user notification preferences
2. **Duplicate warnings**: Verify `warningSent` flags are working
3. **Wrong timing**: Check cron schedule and timezone settings
4. **Email failures**: Verify email service configuration
5. **Push notification failures**: Check Firebase configuration

### Debug Commands

```bash
# Check job status
GET /api/debug/jobs

# Test email service
GET /api/debug/email-health

# Check expiration stats
GET /api/debug/expiration-stats
```

## Future Enhancements

### Potential Improvements

1. **A/B Testing**: Different warning messages and timing
2. **Personalization**: Custom messages based on user behavior
3. **Analytics**: Track warning effectiveness and conversion rates
4. **Smart Timing**: Adjust warning intervals based on user activity
5. **In-App Notifications**: Add in-app notification center

### Configuration Options

- Customizable warning intervals
- Different templates per user segment
- Timezone-aware scheduling
- Batch processing for large user bases
