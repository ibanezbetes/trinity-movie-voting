# Vote Handler Lambda

This Lambda function processes user votes and detects matches when all users in a room vote positively for the same content.

## Purpose

- Record individual votes in DynamoDB with proper user/movie/room association
- Check for matches when all users vote positively for the same content
- Trigger match notifications through Match Handler Lambda
- Return vote results with potential match data
- Handle vote overwriting (users can change their votes)

## Input Event Structure

```typescript
interface VoteEvent {
  operation: 'vote';
  userId: string;                    // Cognito User ID from AppSync context
  input: {
    roomId: string;                  // Required: Room UUID
    movieId: number;                 // Required: TMDB movie/TV show ID
    vote: boolean;                   // Required: true = like, false = dislike
  };
}
```

### Example Input
```json
{
  "operation": "vote",
  "userId": "user-123",
  "input": {
    "roomId": "550e8400-e29b-41d4-a716-446655440000",
    "movieId": 550,
    "vote": true
  }
}
```

## Output Logic

```typescript
interface VoteResponse {
  statusCode: number;
  body: {
    success: boolean;
    match?: Match;                   // Present if match was detected
    error?: string;                  // Present if error occurred
  };
}

interface Match {
  id: string;                        // Format: "roomId#movieId"
  roomId: string;
  movieId: number;
  title: string;
  posterPath?: string;
  mediaType: 'MOVIE' | 'TV';
  matchedUsers: string[];            // Array of user IDs who matched
  timestamp: string;                 // ISO timestamp
}
```

### Example Outputs

#### Successful Vote (No Match)
```json
{
  "statusCode": 200,
  "body": {
    "success": true
  }
}
```

#### Successful Vote (Match Detected)
```json
{
  "statusCode": 200,
  "body": {
    "success": true,
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
}
```

#### Error Response
```json
{
  "statusCode": 400,
  "body": {
    "success": false,
    "error": "Room not found or has expired"
  }
}
```

## Environment Variables

### Required
- `VOTES_TABLE`: DynamoDB table name for storing votes
- `MATCHES_TABLE`: DynamoDB table name for storing matches
- `ROOMS_TABLE`: DynamoDB table name for room lookups
- `AWS_REGION`: AWS region for service clients

### Optional
- `MATCH_LAMBDA_ARN`: ARN of Match Handler Lambda for notifications

## Business Logic

### Vote Processing Flow
1. **Input Validation**
   - Validate userId, roomId, movieId, and vote parameters
   - Ensure all required fields are present and correct types

2. **Room Validation**
   - Verify room exists and hasn't expired
   - Check that movieId is in room's candidate list
   - Validate user has access to the room

3. **Vote Recording**
   - Create vote record with composite key `userId#movieId`
   - Allow vote overwriting (users can change their minds)
   - Store timestamp for audit trail

4. **Match Detection** (only for positive votes)
   - Query all votes for the specific movie in the room
   - Count unique users who have voted in the room
   - Check if all users voted positively for this movie
   - Create match if unanimous positive votes detected

5. **Match Creation**
   - Generate unique match ID (`roomId#movieId`)
   - Store match record in DynamoDB
   - Notify Match Handler Lambda asynchronously
   - Return match data to client

### Match Detection Algorithm

```typescript
// Pseudocode for match detection
function checkForMatch(roomId, movieId) {
  // Get all positive votes for this movie
  positiveVotes = query votes WHERE roomId = roomId AND movieId = movieId AND vote = true
  
  // Get all unique users in this room
  allVotes = query votes WHERE roomId = roomId
  uniqueUsers = unique(allVotes.map(vote => vote.userId))
  
  // Check for unanimous positive votes
  if (positiveVotes.length === uniqueUsers.length && uniqueUsers.length > 1) {
    return createMatch(roomId, movieId, positiveVotes.userIds)
  }
  
  return null
}
```

### Vote Overwriting Logic
- Users can change their votes by submitting new votes for the same movie
- Previous vote is overwritten (same partition key + sort key)
- Match detection runs on every positive vote to handle vote changes
- Existing matches are not removed if users change votes to negative

## DynamoDB Operations

### Vote Storage (PutCommand)
```typescript
{
  TableName: 'TrinityVotes',
  Item: {
    roomId: 'room-uuid',
    userMovieId: 'userId#movieId',
    userId: 'user-123',
    movieId: 550,
    vote: true,
    timestamp: '2024-01-15T10:30:00.000Z'
  }
}
```

### Vote Queries for Match Detection
```typescript
// Get positive votes for specific movie
{
  TableName: 'TrinityVotes',
  KeyConditionExpression: 'roomId = :roomId',
  FilterExpression: 'movieId = :movieId AND vote = :vote',
  ExpressionAttributeValues: {
    ':roomId': roomId,
    ':movieId': movieId,
    ':vote': true
  }
}

// Get all votes in room (for user count)
{
  TableName: 'TrinityVotes',
  KeyConditionExpression: 'roomId = :roomId',
  ExpressionAttributeValues: {
    ':roomId': roomId
  }
}
```

### Match Storage (PutCommand)
```typescript
{
  TableName: 'TrinityMatches',
  Item: match,
  ConditionExpression: 'attribute_not_exists(roomId) AND attribute_not_exists(movieId)'
}
```

## Match Handler Integration

### Notification Payload
```typescript
{
  operation: 'matchCreated',
  match: {
    id: 'roomId#movieId',
    roomId: 'room-uuid',
    movieId: 550,
    title: 'Fight Club',
    posterPath: 'https://...',
    mediaType: 'MOVIE',
    matchedUsers: ['user-123', 'user-456'],
    timestamp: '2024-01-15T10:30:00.000Z'
  }
}
```

### Invocation Method
- Asynchronous Lambda invocation (`InvocationType: 'Event'`)
- Non-blocking - vote processing continues if notification fails
- Error logging for notification failures (doesn't affect vote result)

## Error Handling

### Input Validation Errors
- Missing userId: "User ID is required"
- Missing roomId: "Room ID is required"
- Invalid movieId: "Movie ID must be a number"
- Invalid vote: "Vote must be a boolean"

### Business Logic Errors
- Room not found: "Room not found or has expired"
- Movie not in candidates: "Movie not found in room candidates"
- Expired room: Handled by room validation logic

### System Errors
- DynamoDB failures: Logged with correlation ID, return 500
- Match Lambda notification failures: Logged but don't fail vote
- Network timeouts: Retry logic with exponential backoff

### Duplicate Match Handling
- Conditional write prevents duplicate matches
- If match already exists, return existing match
- Race condition handling for concurrent votes

## Performance Considerations

### Vote Recording
- Single DynamoDB write per vote
- Composite sort key enables efficient queries
- Vote overwriting uses same key (no cleanup needed)

### Match Detection Queries
- Two queries per positive vote (optimized for accuracy)
- Filter expressions reduce data transfer
- Indexes optimized for room-based queries

### Asynchronous Processing
- Match notifications don't block vote response
- Lambda-to-Lambda invocation for scalability
- Error isolation between vote and notification

## Security

### Access Control
- Vote submission requires authenticated user
- Room membership validation
- Movie candidate validation

### Data Integrity
- Conditional writes prevent duplicate matches
- Vote timestamps for audit trail
- User ID validation from Cognito context

### Input Sanitization
- Type validation for all inputs
- Room and movie ID format validation
- Boolean vote validation

## Monitoring

### CloudWatch Logs
- Vote processing events with correlation IDs
- Match detection logic with vote counts
- Error details with stack traces
- Performance metrics (query duration, match frequency)

### Custom Metrics
- Votes processed per minute
- Match detection rate
- Vote overwrite frequency
- Match Lambda notification success rate

### Alarms
- High error rate (>5% over 5 minutes)
- Long duration (>5 seconds average)
- Match Lambda notification failures (>10% over 5 minutes)
- DynamoDB throttling events

## Testing

### Unit Tests
- Vote recording logic
- Match detection algorithm with various scenarios
- Input validation edge cases
- Error handling paths

### Integration Tests
- End-to-end vote processing
- Match detection with multiple users
- Vote overwriting scenarios
- DynamoDB operations

### Match Detection Test Scenarios
```javascript
// Test cases for match detection
scenarios = [
  { users: 2, positiveVotes: 2, expectedMatch: true },
  { users: 3, positiveVotes: 2, expectedMatch: false },
  { users: 3, positiveVotes: 3, expectedMatch: true },
  { users: 1, positiveVotes: 1, expectedMatch: false }, // Single user
  { users: 4, positiveVotes: 4, expectedMatch: true },
]
```

### Load Testing
- Concurrent votes for same movie
- Race condition handling
- DynamoDB throughput under load
- Match Lambda notification performance