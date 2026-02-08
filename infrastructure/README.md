# 🏗️ Trinity Infrastructure

AWS CDK infrastructure for Trinity Movie Matching platform.

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [AWS Services](#aws-services)
- [Lambda Functions](#lambda-functions)
- [GraphQL Schema](#graphql-schema)
- [DynamoDB Tables](#dynamodb-tables)
- [Setup](#setup)
- [Deployment](#deployment)
- [Scripts](#scripts)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## 🎯 Overview

Trinity infrastructure is built using AWS CDK (Cloud Development Kit) with TypeScript. It provides a fully serverless, scalable, and cost-effective backend for the Trinity mobile application.

### Key Features

- **Serverless**: No servers to manage, auto-scaling
- **Real-Time**: GraphQL subscriptions via WebSockets
- **Secure**: Cognito authentication, IAM policies
- **Cost-Effective**: Pay only for what you use
- **Scalable**: Handles thousands of concurrent users
- **Observable**: CloudWatch logs and metrics

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AWS Cloud                            │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────┐                                  │
│  │  Amazon Cognito  │  ← User Authentication          │
│  │   User Pool      │                                  │
│  └────────┬─────────┘                                  │
│           │                                            │
│  ┌────────┴─────────┐                                  │
│  │  AWS AppSync     │  ← GraphQL API                  │
│  │  (GraphQL API)   │                                  │
│  └────────┬─────────┘                                  │
│           │                                            │
│  ┌────────┴─────────────────────────────┐             │
│  │         AWS Lambda Functions          │             │
│  ├───────────────────────────────────────┤             │
│  │  • Room Handler                       │             │
│  │  • Vote Handler                       │             │
│  │  • Match Handler                      │             │
│  │  • TMDB Handler                       │             │
│  │  • Username Handler                   │             │
│  │  • Cognito Triggers                   │             │
│  └────────┬─────────────────────────────┘             │
│           │                                            │
│  ┌────────┴─────────┐                                  │
│  │  Amazon DynamoDB │  ← NoSQL Database               │
│  ├──────────────────┤                                  │
│  │  • trinity-rooms │                                  │
│  │  • trinity-votes │                                  │
│  │  • trinity-matches│                                 │
│  │  • trinity-usernames│                               │
│  └──────────────────┘                                  │
│                                                         │
│  ┌──────────────────┐                                  │
│  │ CloudWatch Logs  │  ← Monitoring & Logging         │
│  └──────────────────┘                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## ☁️ AWS Services

### Amazon Cognito
**Purpose**: User authentication and authorization

**Configuration**:
- User Pool with email/password authentication
- Google OAuth integration
- Custom attributes: `preferred_username`
- Password policy: 8+ chars, uppercase, lowercase, numbers
- Auto-confirm users (via Lambda trigger)

**Triggers**:
- Pre Sign-up: Username validation
- Post Confirmation: User initialization
- Post Authentication: Session logging

---

### AWS AppSync
**Purpose**: GraphQL API with real-time subscriptions

**Features**:
- Cognito User Pool authorization
- IAM authorization for subscriptions
- WebSocket support for real-time updates
- Automatic schema validation
- Built-in caching

**Resolvers**:
- Direct Lambda resolvers (no VTL)
- Optimized for performance
- Error handling and logging

---

### AWS Lambda
**Purpose**: Serverless compute for business logic

**Configuration**:
- Runtime: Node.js 18.x
- Memory: 512 MB (configurable)
- Timeout: 30 seconds (configurable)
- Environment variables: TMDB_API_KEY, table names
- IAM roles with least privilege

**Optimization**:
- Bundled with dependencies
- Minified code
- Cold start optimization
- Connection pooling

---

### Amazon DynamoDB
**Purpose**: NoSQL database for data storage

**Features**:
- On-demand billing (pay per request)
- Automatic scaling
- Point-in-time recovery
- TTL for automatic cleanup
- Global secondary indexes

**Performance**:
- Single-digit millisecond latency
- Unlimited throughput
- 99.99% availability SLA

---

### Amazon CloudWatch
**Purpose**: Monitoring and logging

**Features**:
- Lambda function logs
- API Gateway logs
- Custom metrics
- Alarms and notifications
- Log insights for querying

## 🔧 Lambda Functions

### Room Handler
**File**: `src/handlers/room/index.ts`

**Purpose**: Manage voting rooms

**Operations**:

#### `createRoom`
Creates a new voting room with movie candidates.

**Input**:
```typescript
{
  mediaType: 'MOVIE' | 'TV',
  genreIds: number[]  // Max 2 genres
}
```

**Process**:
1. Generate unique 6-character room code
2. Call TMDB Handler to fetch 50 movie candidates
3. Create room record in DynamoDB
4. Set TTL to 24 hours from creation
5. Auto-join host to room (participation vote)
6. Return room object with code

**Output**:
```typescript
{
  id: string,
  code: string,
  hostId: string,
  mediaType: string,
  genreIds: number[],
  candidates: Movie[],
  createdAt: string,
  ttl: number
}
```

**Error Handling**:
- Validates genre count (max 2)
- Retries code generation if collision
- Handles TMDB API failures
- Returns empty array on error (never null)

---

#### `joinRoom`
Adds user to existing room.

**Input**:
```typescript
{
  roomCode: string  // 6-character code
}
```

**Process**:
1. Query room by code (GSI)
2. Validate room exists and not expired
3. Create participation vote (movieId: -1)
4. Return room details

**Output**: Room object

**Error Handling**:
- Room not found
- Room expired
- Already joined (idempotent)

---

#### `getMyRooms`
Fetches user's active rooms.

**Input**: None (uses authenticated user ID)

**Process**:
1. Query rooms where user is host
2. Query rooms where user has voted
3. Filter expired rooms (TTL check)
4. Filter rooms with matches
5. Sort by creation date (newest first)
6. Return deduplicated list

**Output**: `Room[]`

**Filters**:
- Not expired (TTL > now)
- No matches found
- User is participant

---

### Vote Handler
**File**: `src/handlers/vote/index.ts`

**Purpose**: Process votes and detect matches

**Operations**:

#### `vote`
Records user vote and checks for matches.

**Input**:
```typescript
{
  roomId: string,
  movieId: number,
  vote: boolean  // true = yes, false = no
}
```

**Process**:
1. Validate room exists
2. Create vote record in DynamoDB
3. If vote is "yes":
   - Get all participants (users with votes in room)
   - Get all votes for this movie
   - Check if all participants voted yes
   - If match: Create match record
   - If match: Publish notification via GraphQL
4. Return vote result with match info

**Output**:
```typescript
{
  success: boolean,
  vote: Vote,
  match?: Match
}
```

**Match Detection Logic**:
```typescript
// Get unique participants
const participants = [...new Set(allVotes.map(v => v.userId))];

// Get yes votes for this movie
const yesVotes = allVotes.filter(v => 
  v.movieId === movieId && v.vote === true
);

// Match if all participants voted yes
const isMatch = participants.length > 0 && 
                yesVotes.length === participants.length;
```

**Error Handling**:
- Room not found
- Duplicate votes (upsert)
- Match creation failures
- Notification failures (non-blocking)

---

### Match Handler
**File**: `src/handlers/match/index.ts`

**Purpose**: Manage match records and notifications

**Operations**:

#### `getMyMatches`
Fetches user's match history.

**Input**: None (uses authenticated user ID)

**Process**:
1. Scan matches table
2. Filter matches where user is participant
3. Sort by timestamp (newest first)
4. Return match list

**Output**: `Match[]`

**Optimization**:
- Consider adding GSI on userId for better performance
- Current implementation uses scan with filter

---

#### `publishUserMatch`
Publishes match notification via GraphQL subscription.

**Input**:
```typescript
{
  userId: string,
  match: Match
}
```

**Process**:
1. Validate match exists
2. Publish to AppSync subscription
3. Return success status

**Output**:
```typescript
{
  success: boolean,
  message: string
}
```

**Subscription Flow**:
```
Lambda → AppSync → WebSocket → Mobile App
```

---

### TMDB Handler
**File**: `src/handlers/tmdb/index.ts`

**Purpose**: Fetch movie data from The Movie Database API

**Operations**:

#### `getRecommendations`
Fetches movie candidates using Smart Discovery algorithm.

**Input**:
```typescript
{
  mediaType: 'MOVIE' | 'TV',
  genreIds: number[]  // 1-2 genres
}
```

**Process**: See [Smart Discovery Algorithm](#smart-discovery-algorithm) below

**Output**:
```typescript
{
  candidates: Movie[]  // Exactly 50 movies
}
```

**Movie Object**:
```typescript
{
  id: number,
  title: string,
  overview: string,
  posterPath: string,
  releaseDate: string,
  voteAverage: number,
  voteCount: number,
  genreIds: number[]
}
```

---

### Smart Discovery Algorithm

Trinity uses an intelligent movie discovery system that adapts based on content availability.

#### Phase 1: Availability Check
```typescript
// Test with AND logic (intersection)
const testResponse = await tmdb.discover({
  with_genres: genreIds.join(','),  // "18,16" = Drama AND Animation
  page: 1
});

const totalResults = testResponse.total_results;
const threshold = 50;
```

**Purpose**: Determine if enough movies exist with ALL selected genres.

---

#### Phase 2: Strategy Selection

**Scenario A: Abundant Content (≥50 results)**
```typescript
if (totalResults >= threshold) {
  // Use STRICT AND logic
  strategy = 'AND';
  // Only fetch movies that have ALL genres
  // Example: Drama AND Animation only
}
```

**Scenario B: Limited Content (<50 results)**
```typescript
else {
  // Use FALLBACK OR logic with prioritization
  strategy = 'OR';
  // Fetch movies with ANY genre
  // Prioritize movies with ALL genres first
  // Example: Drama AND Animation first, then Drama OR Animation
}
```

---

#### Phase 3: Fetching

**AND Strategy**:
```typescript
// Fetch 3 random pages
const pages = [
  randomPage(1, maxPages),
  randomPage(1, maxPages),
  randomPage(1, maxPages)
];

for (const page of pages) {
  const response = await tmdb.discover({
    with_genres: genreIds.join(','),  // AND logic
    page
  });
  
  candidates.push(...response.results);
}
```

**OR Strategy**:
```typescript
// Fetch with OR logic
const response = await tmdb.discover({
  with_genres: genreIds.join('|'),  // OR logic: "18|16"
  page
});

// Sort to prioritize multi-genre matches
candidates.sort((a, b) => {
  const aMatches = a.genreIds.filter(g => genreIds.includes(g)).length;
  const bMatches = b.genreIds.filter(g => genreIds.includes(g)).length;
  return bMatches - aMatches;  // More matches first
});
```

---

#### Phase 4: Quality Filters

All candidates must pass these filters:

```typescript
const isValid = (movie) => {
  return (
    movie.poster_path &&                    // Has poster
    movie.overview &&                       // Has description
    movie.vote_count >= 50 &&              // Minimum votes
    ['en','es','fr','it','de','pt'].includes(movie.original_language) &&  // Western languages
    /^[\x00-\x7F]*$/.test(movie.title) &&  // Latin script
    !movie.adult                            // No adult content
  );
};
```

**Filter Rationale**:
- **Poster**: Visual appeal essential for swipe interface
- **Overview**: Users need context to decide
- **Vote count**: Quality indicator (popular/reviewed)
- **Language**: Target audience compatibility
- **Script**: UI rendering compatibility
- **Adult**: Family-friendly content

---

#### Phase 5: Randomization

```typescript
// Fisher-Yates shuffle
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Return exactly 50
return shuffle(candidates).slice(0, 50);
```

**Purpose**: Maximum variety, prevent predictable ordering

---

#### Algorithm Examples

**Example 1: Action + Adventure** (Popular combination)
```
Phase 1: AND check → 1,247 results ✅
Phase 2: Use AND strategy
Phase 3: Fetch 3 random pages with AND
Phase 4: Apply filters
Phase 5: Shuffle and return 50

Result: 50 movies that are BOTH Action AND Adventure
```

**Example 2: Drama + Animation** (Uncommon combination)
```
Phase 1: AND check → 23 results ⚠️
Phase 2: Use OR strategy with prioritization
Phase 3: Fetch with OR logic
Phase 4: Apply filters
Phase 5: Sort (multi-genre first), shuffle, return 50

Result: 
- 23 movies that are Drama AND Animation (prioritized)
- 27 movies that are Drama OR Animation (to reach 50)
```

**Example 3: Western + Documentary** (Very rare combination)
```
Phase 1: AND check → 2 results ⚠️
Phase 2: Use OR strategy
Phase 3: Fetch with OR logic
Phase 4: Apply filters
Phase 5: Sort, shuffle, return 50

Result:
- 2 movies that are Western AND Documentary
- 48 movies that are Western OR Documentary
```

---

### Username Handler
**File**: `src/handlers/username/index.ts`

**Purpose**: Manage username uniqueness

**Operations**:

#### `checkUsername`
Validates username availability.

**Input**:
```typescript
{
  username: string
}
```

**Process**:
1. Query usernames table
2. Check if username exists
3. Return availability status

**Output**:
```typescript
{
  available: boolean
}
```

---

#### `reserveUsername`
Reserves username for user.

**Input**:
```typescript
{
  username: string,
  userId: string
}
```

**Process**:
1. Check availability
2. Create username record
3. Return success status

**Output**:
```typescript
{
  success: boolean
}
```

---

### Cognito Triggers
**Files**: `src/handlers/cognito-triggers/*.ts`

**Purpose**: Custom Cognito User Pool triggers

#### Pre Sign-up
**File**: `pre-signup.ts`

**Purpose**: Validate and auto-confirm users

**Process**:
1. Validate email format
2. Check username availability
3. Auto-confirm user
4. Return modified event

---

#### Post Confirmation
**File**: `post-confirmation.ts`

**Purpose**: Initialize user data

**Process**:
1. Reserve username
2. Create user profile
3. Log confirmation

---

#### Post Authentication
**File**: `post-authentication.ts`

**Purpose**: Log authentication events

**Process**:
1. Log successful login
2. Update last login timestamp
3. Return event

## 📊 GraphQL Schema

**File**: `schema.graphql`

### Types

```graphql
type Room {
  id: ID!
  code: String!
  hostId: ID!
  mediaType: MediaType!
  genreIds: [Int!]!
  candidates: [Movie!]!
  createdAt: AWSDateTime!
  ttl: Int!
}

type Movie {
  id: Int!
  title: String!
  overview: String!
  posterPath: String
  releaseDate: String
  voteAverage: Float
  voteCount: Int
  genreIds: [Int!]!
}

type Vote {
  roomId: ID!
  userMovieId: ID!
  userId: ID!
  movieId: Int!
  vote: Boolean!
  timestamp: AWSDateTime!
}

type Match {
  roomId: ID!
  movieId: Int!
  matchId: ID!
  title: String!
  posterPath: String
  matchedUsers: [ID!]!
  timestamp: AWSDateTime!
}

enum MediaType {
  MOVIE
  TV
}
```

### Queries

```graphql
type Query {
  getMyRooms: [Room!]! @aws_auth(cognito_groups: ["Users"])
  getMyMatches: [Match!]! @aws_auth(cognito_groups: ["Users"])
  getRoomByCode(code: String!): Room @aws_auth(cognito_groups: ["Users"])
}
```

### Mutations

```graphql
type Mutation {
  createRoom(input: CreateRoomInput!): Room! 
    @aws_auth(cognito_groups: ["Users"])
  
  joinRoom(input: JoinRoomInput!): Room! 
    @aws_auth(cognito_groups: ["Users"])
  
  vote(input: VoteInput!): VoteResult! 
    @aws_auth(cognito_groups: ["Users"])
  
  publishUserMatch(input: PublishUserMatchInput!): PublishResult!
    @aws_iam
    @aws_cognito_user_pools
}
```

### Subscriptions

```graphql
type Subscription {
  userMatch(userId: ID!): UserMatchEvent
    @aws_subscribe(mutations: ["publishUserMatch"])
    @aws_iam
    @aws_cognito_user_pools
}
```

## 🗄️ DynamoDB Tables

### trinity-rooms
**Purpose**: Store voting rooms

**Schema**:
```
Partition Key: id (String)
GSI: code-index
  - Partition Key: code (String)
TTL: ttl (Number)
```

**Attributes**:
- `id`: UUID
- `code`: 6-character room code
- `hostId`: Creator's user ID
- `mediaType`: MOVIE or TV
- `genreIds`: Array of genre IDs
- `candidates`: Array of movie objects
- `createdAt`: ISO timestamp
- `ttl`: Unix timestamp (24h expiration)

**Indexes**:
- Primary: `id`
- GSI: `code` (for room lookup)

---

### trinity-votes
**Purpose**: Store user votes

**Schema**:
```
Partition Key: roomId (String)
Sort Key: userMovieId (String)  # userId#movieId
```

**Attributes**:
- `roomId`: Room identifier
- `userMovieId`: Composite key
- `userId`: User identifier
- `movieId`: TMDB movie ID (-1 for participation)
- `vote`: Boolean (true/false)
- `timestamp`: ISO timestamp
- `isParticipation`: Boolean flag

**Query Patterns**:
- Get all votes for room: `roomId = X`
- Get user's votes: `roomId = X AND begins_with(userMovieId, 'userId#')`
- Get movie votes: `roomId = X AND contains(userMovieId, '#movieId')`

---

### trinity-matches
**Purpose**: Store match results

**Schema**:
```
Partition Key: roomId (String)
Sort Key: movieId (Number)
```

**Attributes**:
- `roomId`: Room identifier
- `movieId`: TMDB movie ID
- `matchId`: UUID
- `title`: Movie title
- `posterPath`: TMDB poster URL
- `matchedUsers`: Array of user IDs
- `timestamp`: ISO timestamp

**Query Patterns**:
- Get room matches: `roomId = X`
- Get specific match: `roomId = X AND movieId = Y`

---

### trinity-usernames
**Purpose**: Ensure username uniqueness

**Schema**:
```
Partition Key: username (String)
```

**Attributes**:
- `username`: Unique username
- `userId`: Owner's user ID
- `createdAt`: ISO timestamp

## 🚀 Setup

### Prerequisites

- Node.js 18+
- AWS CLI configured
- AWS CDK CLI: `npm install -g aws-cdk`
- TMDB API Key

### Installation

1. **Install dependencies**
   ```bash
   cd infrastructure
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   
   Update `.env`:
   ```env
   TMDB_API_KEY=your_tmdb_api_key
   AWS_REGION=eu-west-1
   ```

3. **Bootstrap CDK** (first time only)
   ```bash
   cdk bootstrap aws://ACCOUNT-ID/REGION
   ```

## 📦 Deployment

### Deploy Stack

```bash
# Synthesize CloudFormation template
cdk synth

# Show changes
cdk diff

# Deploy
cdk deploy

# Deploy with approval
cdk deploy --require-approval never
```

### Deploy Specific Resources

```bash
# Deploy only Lambda functions
cdk deploy --exclusively TrinityStack/RoomHandler

# Deploy with hotswap (faster, dev only)
cdk deploy --hotswap
```

### Destroy Stack

```bash
cdk destroy
```

**Warning**: This will delete all resources including data!

## 🔧 Scripts

### create-zips.ps1
**Purpose**: Package Lambda functions for deployment

**Usage**:
```powershell
.\create-zips.ps1
```

**Process**:
1. Compile TypeScript to JavaScript
2. Copy dependencies
3. Create ZIP archives
4. Save to `lambda-zips/`

**Output**:
- `room-handler.zip`
- `vote-handler.zip`
- `match-handler.zip`
- `tmdb-handler.zip`
- `username-handler.zip`
- `cognito-trigger.zip`

---

### scripts/cleanup-test-rooms.ps1
**Purpose**: Delete test data from DynamoDB

**Usage**:
```powershell
.\scripts\cleanup-test-rooms.ps1
```

**Warning**: Irreversible operation!

**Process**:
1. Scan all tables
2. Delete all items
3. Show summary

---

### scripts/sync-from-aws.ps1
**Purpose**: Download Lambda code from AWS

**Usage**:
```powershell
.\scripts\sync-from-aws.ps1
```

**Process**:
1. Get Lambda function list
2. Download function code
3. Extract to `src/handlers/`
4. Update local files

## 📊 Monitoring

### CloudWatch Logs

**Log Groups**:
- `/aws/lambda/TrinityStack-RoomHandler`
- `/aws/lambda/TrinityStack-VoteHandler`
- `/aws/lambda/TrinityStack-MatchHandler`
- `/aws/lambda/TrinityStack-TMDBHandler`
- `/aws/lambda/TrinityStack-UsernameHandler`

**Query Examples**:

Find errors:
```
fields @timestamp, @message
| filter @message like /ERROR/
| sort @timestamp desc
| limit 20
```

Track API calls:
```
fields @timestamp, operation, userId
| filter operation = "createRoom"
| stats count() by userId
```

Monitor performance:
```
fields @timestamp, @duration
| stats avg(@duration), max(@duration), min(@duration)
```

### Metrics

**Lambda Metrics**:
- Invocations
- Duration
- Errors
- Throttles
- Concurrent executions

**DynamoDB Metrics**:
- Read/Write capacity
- Throttled requests
- Latency
- Item count

**AppSync Metrics**:
- Request count
- Latency
- Errors
- Connection count (WebSocket)

### Alarms

Recommended alarms:
- Lambda error rate > 5%
- Lambda duration > 25s
- DynamoDB throttles > 0
- AppSync error rate > 5%

## 🐛 Troubleshooting

### Lambda Timeout
**Symptom**: Function times out after 30s

**Solutions**:
- Increase timeout in `trinity-stack.ts`
- Optimize database queries
- Add pagination for large datasets
- Check external API latency (TMDB)

---

### DynamoDB Throttling
**Symptom**: `ProvisionedThroughputExceededException`

**Solutions**:
- Switch to on-demand billing
- Increase provisioned capacity
- Add exponential backoff
- Optimize query patterns

---

### TMDB API Errors
**Symptom**: `TMDB_API_KEY not found` or rate limit errors

**Solutions**:
- Verify API key in `.env`
- Check environment variables in Lambda
- Implement caching
- Add retry logic
- Monitor rate limits (40 req/10s)

---

### Subscription Not Receiving Events
**Symptom**: Mobile app doesn't get match notifications

**Solutions**:
- Check WebSocket connection
- Verify IAM permissions
- Test with AppSync console
- Check CloudWatch logs
- Verify subscription filter

---

### Cold Start Latency
**Symptom**: First request slow (>3s)

**Solutions**:
- Increase memory allocation
- Use provisioned concurrency
- Optimize bundle size
- Minimize dependencies
- Use Lambda layers

---

### Deployment Failures
**Symptom**: `cdk deploy` fails

**Solutions**:
- Check AWS credentials
- Verify CDK bootstrap
- Review CloudFormation events
- Check resource limits
- Validate IAM permissions

## 📚 Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [AppSync Documentation](https://docs.aws.amazon.com/appsync/)
- [TMDB API Documentation](https://developers.themoviedb.org/3)

## 🤝 Contributing

See main [README.md](../README.md) for contribution guidelines.

---

**Version**: 1.0.0  
**Last Updated**: 2026-02-08
