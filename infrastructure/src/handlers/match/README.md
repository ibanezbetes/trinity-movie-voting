# Match Handler Lambda

This Lambda function manages match detection, user match history, and match-related notifications for the Trinity movie voting application.

## Purpose

- Process match creation notifications from Vote Handler
- Update user activity tracking when matches occur
- Retrieve user match history for the mobile app
- Handle match-related notifications (future implementation)
- Maintain user records and activity timestamps

## Input Event Structure

### Match Created Operation
```typescript
interface MatchCreatedEvent {
  operation: 'matchCreated';
  match: {
    id: string;                      // Format: "roomId#movieId"
    roomId: string;                  // Room UUID
    movieId: number;                 // TMDB movie/TV show ID
    title: string;                   // Movie/TV show title
    posterPath?: string;             // Poster image URL
    mediaType: 'MOVIE' | 'TV';       // Content type
    matchedUsers: string[];          // Array of user IDs who matched
    timestamp: string;               // ISO timestamp
  };
}
```

### Get User Matches Operation
```typescript
interface GetUserMatchesEvent {
  operation: 'getUserMatches';
  userId: string;                    // Cognito User ID
}
```

### Example Inputs

#### Match Created
```json
{
  "operation": "matchCreated",
  "match": {
    "id": "550e8400-e29b-41d4-a716-446655440000#550",
    "roomId": "550e8400-e29b-41d4-a716-446655440000",
    "movieId": 550,
    "title": "Fight Club",
    "posterPath": "https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
    "mediaType": "MOVIE",
    "matchedUsers": ["user-123", "user-456"],
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

#### Get User Matches
```json
{
  "operation": "getUserMatches",
  "userId": "user-123"
}
```

## Output Logic

```typescript
interface MatchResponse {
  statusCode: number;
  body: {
    matches?: Match[];               // Present for getUserMatches operation
    success?: boolean;               // Present for matchCreated operation
    error?: string;                  // Present if error occurred
  };
}
```

### Example Outputs

#### Match Created Success
```json
{
  "statusCode": 200,
  "body": {
    "success": true
  }
}
```

#### Get User Matches Success
```json
{
  "statusCode": 200,
  "body": {
    "matches": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440000#550",
        "roomId": "550e8400-e29b-41d4-a716-446655440000",
        "movieId": 550,
        "title": "Fight Club",
        "posterPath": "https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
        "mediaType": "MOVIE",
        "matchedUsers": ["user-123", "user-456"],
        "timestamp": "2024-01-15T10:30:00.000Z"
      }
    ]
  }
}
```

#### Error Response
```json
{
  "statusCode": 400,
  "body": {
    "success": false,
    "error": "User ID is required"
  }
}
```

## Environment Variables

### Required
- `MATCHES_TABLE`: DynamoDB table name for storing matches
- `USERS_TABLE`: DynamoDB table name for user records
- `AWS_REGION`: AWS region for service clients

### Optional
- None (all required variables must be set)

## Business Logic

### Match Created Processing Flow
1. **Match Validation**
   - Validate match object structure
   - Ensure all required fields are present
   - Log match details for analytics

2. **User Activity Update**
   - Update `lastActiveAt` timestamp for all matched users
   - Create user records if they don't exist
   - Handle user creation/update errors gracefully

3. **Notification Processing**
   - Log match notification (MVP implementation)
   - Future: Send push notifications, emails, etc.
   - Process notifications asynchronously

4. **Analytics Logging**
   - Log match statistics for monitoring
   - Track user engagement metrics
   - Record match frequency data

### Get User Matches Flow
1. **Input Validation**
   - Validate userId parameter
   - Ensure user exists in system

2. **Match Retrieval**
   - Query matches where user is in matchedUsers array
   - Sort matches by timestamp (most recent first)
   - Handle pagination for large result sets

3. **Response Formatting**
   - Return matches in chronological order
   - Include all match metadata
   - Handle empty result sets gracefully

## DynamoDB Operations

### User Activity Update (PutCommand)
```typescript
// Update existing user
{
  TableName: 'TrinityUsers',
  Item: {
    id: 'user-123',
    email: 'user@example.com',
    createdAt: '2024-01-15T09:00:00.000Z',
    lastActiveAt: '2024-01-15T10:30:00.000Z'
  }
}

// Create new user
{
  TableName: 'TrinityUsers',
  Item: {
    id: 'user-123',
    email: '',
    createdAt: '2024-01-15T10:30:00.000Z',
    lastActiveAt: '2024-01-15T10:30:00.000Z'
  },
  ConditionExpression: 'attribute_not_exists(id)'
}
```

### User Lookup (GetCommand)
```typescript
{
  TableName: 'TrinityUsers',
  Key: { id: 'user-123' }
}
```

### Match Queries (Future Implementation)
```typescript
// Note: Current implementation has limitations
// Production version should include GSI for efficient user match queries
{
  TableName: 'TrinityMatches',
  IndexName: 'user-matches-index', // Future GSI
  KeyConditionExpression: 'userId = :userId',
  ExpressionAttributeValues: {
    ':userId': 'user-123'
  },
  ScanIndexForward: false // Most recent first
}
```

## User Management

### User Record Structure
```typescript
interface User {
  id: string;                        // Cognito User ID (partition key)
  email: string;                     // User email (populated from Cognito)
  createdAt: string;                 // ISO timestamp of first activity
  lastActiveAt: string;              // ISO timestamp of last match
}
```

### User Creation Logic
- Users are created automatically when they participate in matches
- Email field is initially empty (populated from Cognito when available)
- `createdAt` timestamp set on first match participation
- `lastActiveAt` updated on every match participation

### Activity Tracking
- Track user engagement through match participation
- Update activity timestamps for analytics
- Handle concurrent updates gracefully
- Maintain user activity history

## Notification System (Future Implementation)

### Notification Types
- **Match Created**: Notify all users in room when match occurs
- **Room Activity**: Notify users of new votes in their rooms
- **Daily Summary**: Send daily match summaries to active users

### Delivery Channels
- **Push Notifications**: Mobile app notifications via FCM/APNS
- **Email**: Match summaries and important updates
- **In-App**: Real-time notifications via AppSync subscriptions
- **WebSocket**: Real-time updates for web clients

### Notification Payload Structure
```typescript
interface MatchNotification {
  type: 'match_created';
  roomId: string;
  roomCode: string;
  movieTitle: string;
  posterPath: string;
  matchedUsers: string[];
  timestamp: string;
}
```

## Performance Considerations

### User Match Queries
- **Current Limitation**: No efficient way to query matches by user
- **MVP Solution**: Return empty array with logging
- **Production Solution**: Add GSI with userId as partition key

### Batch User Updates
- Process user activity updates in parallel
- Use `Promise.allSettled` to handle partial failures
- Continue processing even if some user updates fail

### Notification Scalability
- Asynchronous notification processing
- Batch notifications for efficiency
- Queue-based delivery for reliability

## Schema Optimization (Future)

### Recommended GSI for User Matches
```typescript
// Add to TrinityMatches table
{
  IndexName: 'user-matches-index',
  PartitionKey: 'userId',           // New attribute
  SortKey: 'timestamp',             // Existing attribute
  ProjectionType: 'ALL'
}
```

### User Match Denormalization
```typescript
// Alternative: Store user matches separately
interface UserMatch {
  userId: string;                   // Partition key
  matchId: string;                  // Sort key (roomId#movieId)
  roomId: string;
  movieId: number;
  title: string;
  posterPath?: string;
  mediaType: 'MOVIE' | 'TV';
  timestamp: string;
}
```

## Error Handling

### Input Validation Errors
- Missing userId: "User ID is required"
- Invalid match object: "Invalid match data structure"
- Missing operation: "Operation is required"

### System Errors
- DynamoDB failures: Logged with correlation ID
- User update failures: Logged but don't fail match processing
- Notification failures: Logged but don't affect core functionality

### Partial Failure Handling
- User activity updates use `Promise.allSettled`
- Continue processing even if some operations fail
- Log all errors for debugging and monitoring

## Security

### Access Control
- Match creation only from Vote Handler Lambda
- User match queries require authenticated user
- User activity updates restricted to system operations

### Data Privacy
- User emails not stored until explicitly provided
- Match data includes only necessary information
- User activity tracking for analytics only

### Input Validation
- Validate all input parameters
- Sanitize user IDs and match data
- Prevent injection attacks through input validation

## Monitoring

### CloudWatch Logs
- Match processing events with correlation IDs
- User activity update results
- Notification delivery status
- Error details with stack traces

### Custom Metrics
- Matches processed per hour
- User activity update success rate
- Notification delivery success rate
- Average match processing time

### Alarms
- High error rate (>5% over 5 minutes)
- Long duration (>3 seconds average)
- User update failures (>10% over 5 minutes)
- Notification delivery failures

## Testing

### Unit Tests
- Match processing logic
- User activity update handling
- Input validation scenarios
- Error handling paths

### Integration Tests
- End-to-end match processing
- User record creation and updates
- DynamoDB operations
- Error recovery scenarios

### Load Testing
- Concurrent match processing
- Batch user updates under load
- DynamoDB throughput limits
- Notification system scalability

## Future Enhancements

### Real-time Notifications
- AppSync subscriptions for live updates
- WebSocket connections for web clients
- Push notification integration
- Email notification system

### Analytics Integration
- User engagement tracking
- Match frequency analysis
- Popular content identification
- User behavior insights

### Performance Optimizations
- GSI for efficient user match queries
- Caching layer for frequent queries
- Batch processing for notifications
- Connection pooling for external services