# Room Handler Lambda

This Lambda function manages room creation and joining operations for the Trinity movie voting application.

## Purpose

- Generate unique room codes for easy sharing
- Validate genre selections (max 2 genres)
- Fetch initial movie candidates via TMDB Lambda
- Store room configuration in DynamoDB
- Handle room joining with code validation

## Input Event Structure

### Create Room Operation
```typescript
interface CreateRoomEvent {
  operation: 'createRoom';
  userId: string;                    // Cognito User ID from AppSync context
  input: {
    mediaType: 'MOVIE' | 'TV';      // Required: Type of content for the room
    genreIds: number[];             // Required: Array of TMDB genre IDs (max 2)
  };
}
```

### Join Room Operation
```typescript
interface JoinRoomEvent {
  operation: 'joinRoom';
  userId: string;                    // Cognito User ID from AppSync context
  code: string;                      // Required: 6-character room code
}
```

### Example Inputs
```json
// Create Room
{
  "operation": "createRoom",
  "userId": "user-123",
  "input": {
    "mediaType": "MOVIE",
    "genreIds": [28, 12]
  }
}

// Join Room
{
  "operation": "joinRoom",
  "userId": "user-456",
  "code": "ABC123"
}
```

## Output Logic

```typescript
interface RoomResponse {
  statusCode: number;
  body: Room | { error: string };
}

interface Room {
  id: string;                       // UUID for the room
  code: string;                     // 6-character alphanumeric code
  hostId: string;                   // User ID of room creator
  mediaType: 'MOVIE' | 'TV';        // Content type
  genreIds: number[];               // Selected genre IDs
  candidates: MovieCandidate[];     // Filtered movie/TV candidates
  createdAt: string;                // ISO timestamp
  ttl: number;                      // Unix timestamp for auto-expiry
}
```

### Example Output
```json
{
  "statusCode": 200,
  "body": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "code": "ABC123",
    "hostId": "user-123",
    "mediaType": "MOVIE",
    "genreIds": [28, 12],
    "candidates": [
      {
        "id": 550,
        "title": "Fight Club",
        "overview": "A ticking-time-bomb insomniac...",
        "posterPath": "https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
        "releaseDate": "1999-10-15",
        "mediaType": "MOVIE"
      }
    ],
    "createdAt": "2024-01-15T10:30:00.000Z",
    "ttl": 1705406200
  }
}
```

## Environment Variables

### Required
- `ROOMS_TABLE`: DynamoDB table name for storing rooms
- `TMDB_LAMBDA_ARN`: ARN of the TMDB Integration Lambda function
- `AWS_REGION`: AWS region for service clients

### Optional
- None (all required variables must be set)

## Business Logic

### Room Creation Flow
1. **Input Validation**
   - Validate mediaType is 'MOVIE' or 'TV'
   - Enforce maximum 2 genres rule
   - Ensure userId is provided

2. **Unique Code Generation**
   - Generate 6-character alphanumeric code
   - Check uniqueness against existing rooms using GSI
   - Retry up to 10 times if collision occurs

3. **Content Fetching**
   - Invoke TMDB Lambda with mediaType and genreIds
   - Apply Latin Script Validator through TMDB Lambda
   - Handle empty candidate lists gracefully

4. **Room Storage**
   - Create room record with UUID
   - Set TTL for 24-hour auto-expiry
   - Store in DynamoDB with conditional write

### Room Joining Flow
1. **Code Validation**
   - Normalize code to uppercase
   - Query GSI by room code
   - Validate room exists and is unique

2. **Expiry Check**
   - Compare current time with room TTL
   - Reject expired rooms
   - Return active room data

### Room Code Generation
- **Format**: 6-character alphanumeric (A-Z, 0-9)
- **Example**: "ABC123", "XYZ789", "DEF456"
- **Uniqueness**: Verified against existing rooms
- **Collision Handling**: Retry with new code (max 10 attempts)

## DynamoDB Operations

### Room Storage (PutCommand)
```typescript
{
  TableName: 'TrinityRooms',
  Item: room,
  ConditionExpression: 'attribute_not_exists(id)'
}
```

### Room Lookup by Code (QueryCommand)
```typescript
{
  TableName: 'TrinityRooms',
  IndexName: 'code-index',
  KeyConditionExpression: 'code = :code',
  ExpressionAttributeValues: { ':code': code }
}
```

### Room Lookup by ID (GetCommand)
```typescript
{
  TableName: 'TrinityRooms',
  Key: { id: roomId }
}
```

## TMDB Lambda Integration

### Invocation Payload
```typescript
{
  mediaType: 'MOVIE' | 'TV',
  genreIds: number[],
  page: 1
}
```

### Response Handling
- Parse Lambda response payload
- Extract candidates array
- Handle TMDB Lambda errors gracefully
- Log integration failures for debugging

### Error Scenarios
- TMDB Lambda timeout: Return room with empty candidates
- Invalid response format: Log error and proceed
- Network failures: Retry once, then fail gracefully

## Error Handling

### Input Validation Errors
- Invalid mediaType: "Invalid mediaType. Must be MOVIE or TV"
- Too many genres: "Maximum 2 genres allowed"
- Missing userId: "User ID is required"
- Empty room code: "Room code is required"

### Business Logic Errors
- Code generation failure: "Failed to generate unique room code"
- Room not found: "Room not found. Please check the room code"
- Expired room: "Room has expired. Please create a new room"
- Multiple rooms for code: "Multiple rooms found for code. Please contact support"

### System Errors
- DynamoDB failures: Logged with correlation ID
- TMDB Lambda failures: Graceful degradation
- Network timeouts: Retry logic with exponential backoff

## Performance Considerations

### Room Code Generation
- Average 1 attempt for unique code
- Maximum 10 attempts to prevent infinite loops
- GSI query optimized for code lookups

### TMDB Integration
- Single Lambda invocation per room creation
- Async invocation for better performance
- Timeout handling to prevent hanging requests

### DynamoDB Optimization
- On-demand capacity for variable load
- GSI for efficient code lookups
- TTL for automatic cleanup of expired rooms

## Security

### Access Control
- Room creation requires authenticated user
- Room joining validates user context
- No sensitive data in room codes

### Data Protection
- Room codes are not predictable
- TTL prevents data accumulation
- User IDs from Cognito context only

### Input Sanitization
- Room codes normalized to uppercase
- Genre IDs validated as numbers
- MediaType restricted to enum values

## Monitoring

### CloudWatch Logs
- Room creation/joining events
- TMDB Lambda invocation results
- Error details with correlation IDs
- Performance metrics (duration, memory)

### Custom Metrics
- Rooms created per hour
- Room joining success rate
- TMDB Lambda integration failures
- Code generation collision rate

### Alarms
- High error rate (>5% over 5 minutes)
- Long duration (>10 seconds average)
- TMDB Lambda failures (>10% over 5 minutes)
- Code generation failures

## Testing

### Unit Tests
- Room code generation and uniqueness
- Input validation logic
- Error handling scenarios
- TMDB Lambda integration mocking

### Integration Tests
- End-to-end room creation flow
- Room joining with valid/invalid codes
- Expired room handling
- DynamoDB operations

### Load Testing
- Concurrent room creation
- Code collision handling under load
- TMDB Lambda integration performance
- DynamoDB throughput limits