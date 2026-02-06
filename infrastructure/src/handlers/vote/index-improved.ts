import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@aws-sdk/protocol-http';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

// CONFIGURATION: Choose match logic
// 'maxParticipants' = Match when exactly maxParticipants users vote YES (current)
// 'allUsers' = Match when ALL users in room vote YES (your specification)
const MATCH_LOGIC: 'maxParticipants' | 'allUsers' = 'maxParticipants';

// Types
interface Vote {
  roomId: string;
  userMovieId: string; // Format: "userId#movieId"
  userId: string;
  movieId: number;
  vote: boolean;
  timestamp: string;
  isParticipation?: boolean;
}

interface Match {
  id: string;
  roomId: string;
  movieId: number;
  title: string;
  posterPath?: string;
  mediaType: 'MOVIE' | 'TV';
  matchedUsers: string[];
  timestamp: string;
}

interface Room {
  id: string;
  code: string;
  hostId: string;
  mediaType: 'MOVIE' | 'TV';
  genreIds: number[];
  candidates: MovieCandidate[];
  createdAt: string;
  ttl: number;
  maxParticipants: number;
}

interface MovieCandidate {
  id: number;
  title: string;
  overview: string;
  posterPath: string | null;
  releaseDate: string;
  mediaType: 'MOVIE' | 'TV';
}

interface VoteEvent {
  operation: 'vote';
  userId: string;
  input: {
    roomId: string;
    movieId: number;
    vote: boolean;
  };
}

interface VoteResponse {
  statusCode: number;
  body: {
    success: boolean;
    match?: Match;
    error?: string;
  };
}

// Vote Service
class VoteService {
  private readonly votesTable: string;
  private readonly matchesTable: string;
  private readonly roomsTable: string;
  private readonly matchLambdaArn: string;

  constructor() {
    this.votesTable = process.env.VOTES_TABLE || '';
    this.matchesTable = process.env.MATCHES_TABLE || '';
    this.roomsTable = process.env.ROOMS_TABLE || '';
    this.matchLambdaArn = process.env.MATCH_LAMBDA_ARN || '';

    if (!this.votesTable || !this.matchesTable || !this.roomsTable) {
      throw new Error('Required table environment variables are missing');
    }
  }

  async processVote(userId: string, roomId: string, movieId: number, vote: boolean): Promise<{ success: boolean; match?: Match }> {
    // Validate room exists and get room details
    const room = await this.getRoom(roomId);
    if (!room) {
      throw new Error('Room not found or has expired');
    }

    // Basic room membership validation
    const hasRoomAccess = await this.validateRoomAccess(userId, roomId, room);
    if (!hasRoomAccess) {
      throw new Error('User does not have access to this room');
    }

    // Validate movie is in room candidates
    const movieCandidate = room.candidates.find(c => c.id === movieId);
    if (!movieCandidate) {
      throw new Error('Movie not found in room candidates');
    }

    // Record the vote
    await this.recordVote(userId, roomId, movieId, vote);

    // Check for match if vote is positive
    let match: Match | undefined;
    if (vote) {
      match = await this.checkForMatch(roomId, movieId, movieCandidate, room);
    }

    return { success: true, match };
  }

  private async validateRoomAccess(userId: string, roomId: string, room: Room): Promise<boolean> {
    try {
      // Check if user is the room host
      if (room.hostId === userId) {
        console.log(`User ${userId} is the host of room ${roomId} - access granted`);
        return true;
      }

      // Check if user has previously participated in this room
      const userVotesResult = await docClient.send(new QueryCommand({
        TableName: this.votesTable,
        KeyConditionExpression: 'roomId = :roomId',
        FilterExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':roomId': roomId,
          ':userId': userId,
        },
        Limit: 1,
      }));

      if (userVotesResult.Items && userVotesResult.Items.length > 0) {
        console.log(`User ${userId} has previously voted in room ${roomId} - access granted`);
        return true;
      }

      // For MVP: Allow any authenticated user to join any active room
      console.log(`User ${userId} granted access to room ${roomId} (MVP mode - all users allowed)`);
      return true;

    } catch (error) {
      console.error(`Error validating room access for user ${userId} in room ${roomId}:`, error);
      return true; // Fail open for MVP
    }
  }

  private async getRoom(roomId: string): Promise<Room | null> {
    try {
      const result = await docClient.send(new GetCommand({
        TableName: this.roomsTable,
        Key: { id: roomId },
      }));

      if (!result.Item) {
        return null;
      }

      const room = result.Item as Room;

      // Check if room has expired
      const now = Math.floor(Date.now() / 1000);
      if (room.ttl && room.ttl < now) {
        return null;
      }

      return room;
    } catch (error) {
      console.error('Error getting room:', error);
      return null;
    }
  }

  private async recordVote(userId: string, roomId: string, movieId: number, vote: boolean): Promise<void> {
    const userMovieId = `${userId}#${movieId}`;
    const timestamp = new Date().toISOString();

    const voteRecord: Vote = {
      roomId,
      userMovieId,
      userId,
      movieId,
      vote,
      timestamp,
    };

    await docClient.send(new PutCommand({
      TableName: this.votesTable,
      Item: voteRecord,
    }));

    console.log(`Vote recorded: User ${userId} voted ${vote ? 'YES' : 'NO'} for movie ${movieId} in room ${roomId}`);
  }

  /**
   * CRITICAL: Check for match using configured logic
   * 
   * Two modes:
   * 1. 'maxParticipants': Match when exactly maxParticipants users vote YES
   * 2. 'allUsers': Match when ALL users in room vote YES (true consensus)
   */
  private async checkForMatch(roomId: string, movieId: number, movieCandidate: MovieCandidate, room: Room): Promise<Match | undefined> {
    try {
      console.log(`🔍 Checking for match using logic: ${MATCH_LOGIC}`);

      // STEP 1: Get all positive votes for this movie
      // CRITICAL: Use ConsistentRead to see votes that were just written
      const positiveVotesResult = await docClient.send(new QueryCommand({
        TableName: this.votesTable,
        KeyConditionExpression: 'roomId = :roomId',
        FilterExpression: 'movieId = :movieId AND vote = :vote AND movieId <> :participationMarker',
        ExpressionAttributeValues: {
          ':roomId': roomId,
          ':movieId': movieId,
          ':vote': true,
          ':participationMarker': -1, // Exclude participation records
        },
        ConsistentRead: true, // ✅ CRITICAL: Force strong consistency
      }));

      const positiveVotes = positiveVotesResult.Items || [];
      const positiveUserIds = new Set(positiveVotes.map(vote => (vote as Vote).userId));
      const positiveVoteCount = positiveUserIds.size;

      console.log(`Found ${positiveVoteCount} unique positive votes for movie ${movieId} in room ${roomId}`);

      // STEP 2: Determine required votes based on match logic
      let requiredVotes: number;
      let matchLogicDescription: string;

      if (MATCH_LOGIC === 'maxParticipants') {
        // MODE 1: Match when exactly maxParticipants users vote YES
        requiredVotes = room.maxParticipants || 2;
        matchLogicDescription = `maxParticipants (${requiredVotes})`;
        
        console.log(`Using maxParticipants logic: Room ${roomId} requires ${requiredVotes} positive votes for a match`);

      } else {
        // MODE 2: Match when ALL users in room vote YES
        // Get ALL users who have participated in this room
        const allUsersResult = await docClient.send(new QueryCommand({
          TableName: this.votesTable,
          KeyConditionExpression: 'roomId = :roomId',
          FilterExpression: 'movieId = :participationMarker',
          ExpressionAttributeValues: {
            ':roomId': roomId,
            ':participationMarker': -1, // Participation records
          },
          ConsistentRead: true,
        }));

        const allUsers = allUsersResult.Items || [];
        const totalUsersInRoom = new Set(allUsers.map(record => (record as Vote).userId)).size;
        requiredVotes = totalUsersInRoom;
        matchLogicDescription = `all users in room (${requiredVotes})`;

        console.log(`Using allUsers logic: Room ${roomId} has ${totalUsersInRoom} users, requires ${requiredVotes} positive votes for a match`);
      }

      // STEP 3: Check if match condition is met
      if (positiveVoteCount === requiredVotes) {
        console.log(`🎉 MATCH DETECTED! ${positiveVoteCount} users voted positively for movie ${movieId} (required: ${matchLogicDescription})`);
        
        // Check if match already exists
        const existingMatch = await this.getExistingMatch(roomId, movieId);
        if (existingMatch) {
          console.log('Match already exists, returning existing match');
          return existingMatch;
        }

        // Create new match
        const match = await this.createMatch(roomId, movieId, movieCandidate, Array.from(positiveUserIds));
        return match;
      }

      console.log(`No match yet. Positive votes: ${positiveVoteCount}, Required: ${requiredVotes} (${matchLogicDescription})`);
      return undefined;

    } catch (error) {
      console.error('Error checking for match:', error);
      return undefined;
    }
  }

  private async getExistingMatch(roomId: string, movieId: number): Promise<Match | null> {
    try {
      const result = await docClient.send(new GetCommand({
        TableName: this.matchesTable,
        Key: {
          roomId,
          movieId,
        },
      }));

      return result.Item as Match || null;
    } catch (error) {
      console.error('Error checking existing match:', error);
      return null;
    }
  }

  private async createMatch(roomId: string, movieId: number, movieCandidate: MovieCandidate, matchedUsers: string[]): Promise<Match> {
    const timestamp = new Date().toISOString();
    const matchId = `${roomId}#${movieId}`;

    const match: Match = {
      id: matchId,
      roomId,
      movieId,
      title: movieCandidate.title,
      posterPath: movieCandidate.posterPath || undefined,
      mediaType: movieCandidate.mediaType,
      matchedUsers,
      timestamp,
    };

    // Store match in DynamoDB
    try {
      await docClient.send(new PutCommand({
        TableName: this.matchesTable,
        Item: match,
        ConditionExpression: 'attribute_not_exists(roomId) AND attribute_not_exists(movieId)',
      }));
      console.log(`✅ Match created: ${match.title} for ${matchedUsers.length} users`);
    } catch (error) {
      const err = error as any;
      if (err.name === 'ConditionalCheckFailedException') {
        console.log(`Match already exists for room ${roomId} and movie ${movieId}`);
      } else {
        console.error('Error creating match:', error);
        throw error;
      }
    }

    // CRITICAL: Trigger AppSync subscription to notify all users
    await this.triggerAppSyncSubscription(match);

    // Wait to ensure notifications are sent
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log(`Match created and notifications sent for room ${roomId}`);

    return match;
  }

  /**
   * CRITICAL: Trigger AppSync subscriptions via GraphQL mutations
   * This is the ONLY way to notify frontend clients in real-time
   * Direct DynamoDB writes do NOT trigger subscriptions
   */
  private async triggerAppSyncSubscription(match: Match): Promise<void> {
    console.log(`🔔 BROADCASTING match notifications to ${match.matchedUsers.length} users`);
    console.log(`👥 Users to notify: ${match.matchedUsers.join(', ')}`);
    
    const endpoint = process.env.GRAPHQL_ENDPOINT;
    if (!endpoint) {
      console.error('❌ FATAL: GRAPHQL_ENDPOINT not defined');
      return;
    }

    // STRATEGY: Send individual notification to each user
    // This ensures ALL users who participated in the match receive notification
    const notificationPromises = match.matchedUsers.map(async (userId) => {
      await this.sendIndividualUserNotification(userId, match, endpoint);
    });

    // Send all notifications in parallel
    const results = await Promise.allSettled(notificationPromises);
    
    // Log results
    results.forEach((result, index) => {
      const userId = match.matchedUsers[index];
      if (result.status === 'fulfilled') {
        console.log(`✅ Notification sent successfully to user: ${userId}`);
      } else {
        console.error(`❌ Error sending notification to user ${userId}:`, result.reason);
      }
    });

    // Also send room notification for compatibility
    await this.sendRoomNotification(match, endpoint);
  }

  /**
   * Send individual user notification via publishUserMatch mutation
   */
  private async sendIndividualUserNotification(userId: string, match: Match, endpoint: string): Promise<void> {
    console.log(`📤 Sending individual notification to user: ${userId}`);
    
    const mutation = `
      mutation PublishUserMatch($userId: ID!, $matchData: RoomMatchInput!) {
        publishUserMatch(userId: $userId, matchData: $matchData) {
          roomId
          matchId
          movieId
          matchedUsers
        }
      }
    `;

    const variables = {
      userId: userId,
      matchData: {
        matchId: match.id,
        movieId: match.movieId,
        movieTitle: match.title,
        posterPath: match.posterPath,
        matchedUsers: match.matchedUsers,
        roomId: match.roomId,
        timestamp: match.timestamp,
        matchDetails: {
          voteCount: match.matchedUsers.length,
          requiredVotes: match.matchedUsers.length,
          matchType: 'unanimous'
        }
      }
    };

    try {
      const url = new URL(endpoint);
      const request = new HttpRequest({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: url.hostname,
        },
        hostname: url.hostname,
        path: '/graphql',
        body: JSON.stringify({ query: mutation, variables }),
      });

      // Sign request with IAM credentials
      const signer = new SignatureV4({
        credentials: defaultProvider(),
        region: process.env.AWS_REGION || 'us-east-1',
        service: 'appsync',
        sha256: Sha256,
      });

      const signedRequest = await signer.sign(request);

      const response = await fetch(endpoint, {
        method: signedRequest.method,
        headers: signedRequest.headers as any,
        body: signedRequest.body,
      });

      const result = await response.json() as { data?: any; errors?: any[] };
      
      if (result.errors) {
        console.error(`❌ Error notifying user ${userId}:`, JSON.stringify(result.errors));
        throw new Error(`AppSync error for user ${userId}: ${result.errors[0]?.message}`);
      } else {
        console.log(`✅ User ${userId} notified successfully`);
      }
    } catch (error) {
      console.error(`❌ Error sending notification to user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Send room notification via publishRoomMatch mutation
   */
  private async sendRoomNotification(match: Match, endpoint: string): Promise<void> {
    console.log(`📤 Sending room notification: ${match.roomId}`);
    
    const mutation = `
      mutation PublishRoomMatch($roomId: ID!, $matchData: RoomMatchInput!) {
        publishRoomMatch(roomId: $roomId, matchData: $matchData) {
          roomId
          matchId
          movieId
          matchedUsers
        }
      }
    `;

    const variables = {
      roomId: match.roomId,
      matchData: {
        matchId: match.id,
        movieId: match.movieId,
        movieTitle: match.title,
        posterPath: match.posterPath,
        matchedUsers: match.matchedUsers,
        matchDetails: {
          voteCount: match.matchedUsers.length,
          requiredVotes: match.matchedUsers.length,
          matchType: 'unanimous'
        }
      }
    };

    try {
      const url = new URL(endpoint);
      const request = new HttpRequest({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: url.hostname,
        },
        hostname: url.hostname,
        path: '/graphql',
        body: JSON.stringify({ query: mutation, variables }),
      });

      const signer = new SignatureV4({
        credentials: defaultProvider(),
        region: process.env.AWS_REGION || 'us-east-1',
        service: 'appsync',
        sha256: Sha256,
      });

      const signedRequest = await signer.sign(request);

      const response = await fetch(endpoint, {
        method: signedRequest.method,
        headers: signedRequest.headers as any,
        body: signedRequest.body,
      });

      const result = await response.json() as { data?: any; errors?: any[] };
      
      if (result.errors) {
        console.error('❌ Error in room notification:', JSON.stringify(result.errors));
      } else {
        console.log('✅ Room notification sent successfully');
      }
    } catch (error) {
      console.error('❌ Error sending room notification:', error);
    }
  }
}

// Lambda Handler for AppSync
export const handler: Handler = async (event) => {
  console.log('Vote Lambda received AppSync event:', JSON.stringify(event));
  console.log(`🔧 Match logic configured as: ${MATCH_LOGIC}`);

  try {
    // Extract user ID from AppSync context
    const userId = event.identity?.claims?.sub || event.identity?.username;
    if (!userId) {
      console.error('User not authenticated for vote');
      return { success: false };
    }

    // Get arguments from AppSync
    const { input } = event.arguments;
    const { roomId, movieId, vote } = input;

    // Validate input
    if (!roomId) {
      console.error('Room ID is required');
      return { success: false };
    }

    if (typeof movieId !== 'number') {
      console.error('Movie ID must be a number');
      return { success: false };
    }

    if (typeof vote !== 'boolean') {
      console.error('Vote must be a boolean');
      return { success: false };
    }

    const voteService = new VoteService();
    
    try {
      const result = await voteService.processVote(userId, roomId, movieId, vote);
      return result;
    } catch (error) {
      console.error('Error processing vote:', error);
      return { success: false };
    }

  } catch (error) {
    console.error('Vote Lambda error:', error);
    return { success: false };
  }
};
