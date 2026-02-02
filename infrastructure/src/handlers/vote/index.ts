import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

// Types
interface Vote {
  roomId: string;
  userMovieId: string; // Format: "userId#movieId"
  userId: string;
  movieId: number;
  vote: boolean;
  timestamp: string;
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
      match = await this.checkForMatch(roomId, movieId, movieCandidate);
    }

    return { success: true, match };
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
      // Allow overwriting previous votes for the same user/movie combination
    }));

    console.log(`Vote recorded: User ${userId} voted ${vote ? 'YES' : 'NO'} for movie ${movieId} in room ${roomId}`);
  }

  private async checkForMatch(roomId: string, movieId: number, movieCandidate: MovieCandidate): Promise<Match | undefined> {
    try {
      // Get all votes for this movie in this room (excluding participation records)
      const votesResult = await docClient.send(new QueryCommand({
        TableName: this.votesTable,
        KeyConditionExpression: 'roomId = :roomId',
        FilterExpression: 'movieId = :movieId AND vote = :vote AND movieId <> :participationMarker',
        ExpressionAttributeValues: {
          ':roomId': roomId,
          ':movieId': movieId,
          ':vote': true, // Only positive votes
          ':participationMarker': -1, // Exclude participation records
        },
      }));

      const positiveVotes = votesResult.Items || [];
      console.log(`Found ${positiveVotes.length} positive votes for movie ${movieId} in room ${roomId}`);

      // Get all unique users who have voted in this room (excluding participation records)
      const allVotesResult = await docClient.send(new QueryCommand({
        TableName: this.votesTable,
        KeyConditionExpression: 'roomId = :roomId',
        FilterExpression: 'movieId <> :participationMarker', // Exclude participation records
        ExpressionAttributeValues: {
          ':roomId': roomId,
          ':participationMarker': -1,
        },
      }));

      const allVotes = allVotesResult.Items || [];
      const uniqueUsers = new Set(allVotes.map(vote => (vote as Vote).userId));
      const totalUsers = uniqueUsers.size;

      console.log(`Total unique users who have voted in room: ${totalUsers}`);

      // Check if all users voted positively for this movie
      const positiveUserIds = new Set(positiveVotes.map(vote => (vote as Vote).userId));
      
      if (positiveUserIds.size === totalUsers && totalUsers > 1) {
        // We have a match! All users voted positively
        console.log(`MATCH DETECTED! All ${totalUsers} users voted positively for movie ${movieId}`);
        
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

      console.log(`No match yet. Positive votes: ${positiveUserIds.size}, Total users: ${totalUsers}`);
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

    // Store the main match record
    await docClient.send(new PutCommand({
      TableName: this.matchesTable,
      Item: match,
      ConditionExpression: 'attribute_not_exists(roomId) AND attribute_not_exists(movieId)', // Prevent duplicates
    }));

    // CRITICAL: Create individual match records for each user to enable GSI queries
    // This allows efficient querying of matches by userId using the new GSI
    const userMatchPromises = matchedUsers.map(async (userId) => {
      const userMatch = {
        ...match,
        userId, // Add userId field for GSI
        id: `${userId}#${matchId}`, // Unique ID per user
        roomId: `${userId}#${roomId}`, // Composite key to avoid conflicts
      };

      try {
        await docClient.send(new PutCommand({
          TableName: this.matchesTable,
          Item: userMatch,
        }));
        console.log(`User match record created for user ${userId}`);
      } catch (error) {
        console.error(`Error creating user match record for ${userId}:`, error);
        // Continue with other users even if one fails
      }
    });

    // Wait for all user match records to be created
    await Promise.allSettled(userMatchPromises);

    console.log(`Match created: ${matchId} with ${matchedUsers.length} users and individual user records`);

    // Delete the room since match is found - room is no longer needed
    await this.deleteRoom(roomId);

    // CRITICAL: Trigger AppSync subscription by calling the createMatch mutation
    // This is the key fix - we need to execute the GraphQL mutation to trigger subscriptions
    await this.triggerAppSyncSubscription(match);

    return match;
  }

  private async deleteRoom(roomId: string): Promise<void> {
    try {
      // Delete the room from DynamoDB
      await docClient.send(new DeleteCommand({
        TableName: this.roomsTable,
        Key: { id: roomId },
      }));

      console.log(`Room ${roomId} deleted after match creation`);

      // Optionally: Delete all votes for this room to free up space
      await this.deleteRoomVotes(roomId);
    } catch (error) {
      console.error(`Error deleting room ${roomId}:`, error);
      // Don't fail the match creation if room deletion fails
    }
  }

  private async deleteRoomVotes(roomId: string): Promise<void> {
    try {
      // Get all votes and participation records for this room
      const votesResult = await docClient.send(new QueryCommand({
        TableName: this.votesTable,
        KeyConditionExpression: 'roomId = :roomId',
        ExpressionAttributeValues: {
          ':roomId': roomId,
        },
      }));

      const allRecords = votesResult.Items || [];
      
      // Delete all records (votes and participation) in batches
      const deletePromises = allRecords.map(record => 
        docClient.send(new DeleteCommand({
          TableName: this.votesTable,
          Key: {
            roomId: record.roomId,
            userMovieId: record.userMovieId,
          },
        }))
      );

      await Promise.allSettled(deletePromises);
      console.log(`Deleted ${allRecords.length} records (votes and participation) for room ${roomId}`);
    } catch (error) {
      console.error(`Error deleting records for room ${roomId}:`, error);
    }
  }

  private async triggerAppSyncSubscription(match: Match): Promise<void> {
    try {
      console.log(`🔔 Triggering AppSync subscription for match: ${match.title}`);
      console.log(`📱 Notifying ${match.matchedUsers.length} users: ${match.matchedUsers.join(', ')}`);
      
      // The key insight: AppSync subscriptions are triggered when a GraphQL mutation
      // is executed through the AppSync API, not when Lambda functions are called directly.
      
      // APPROACH 1: Call the Match Lambda with createMatch operation
      // This will execute the createMatch resolver which should trigger subscriptions
      if (this.matchLambdaArn) {
        const payload = {
          operation: 'createMatch',
          input: {
            roomId: match.roomId,
            movieId: match.movieId,
            title: match.title,
            posterPath: match.posterPath,
            matchedUsers: match.matchedUsers,
          },
        };

        console.log('🚀 Invoking Match Lambda to trigger AppSync subscription...');
        
        const command = new InvokeCommand({
          FunctionName: this.matchLambdaArn,
          InvocationType: 'RequestResponse',
          Payload: JSON.stringify(payload),
        });

        const response = await lambdaClient.send(command);
        
        if (response.Payload) {
          const result = JSON.parse(new TextDecoder().decode(response.Payload));
          if (result.statusCode === 200) {
            console.log('✅ Match Lambda executed successfully');
            console.log('📡 AppSync subscription should now be triggered');
            console.log(`🎬 Match: ${match.title}`);
            console.log(`👥 Users: ${match.matchedUsers.join(', ')}`);
          } else {
            console.error('❌ Match Lambda returned error:', result.body?.error);
          }
        }
      } else {
        console.warn('⚠️ Match Lambda ARN not configured - subscriptions may not work');
      }

      // APPROACH 2: Store notifications for polling fallback
      await this.storeMatchNotifications(match);

    } catch (error) {
      console.error('❌ Error triggering AppSync subscription:', error);
      // Store notifications for polling as fallback
      await this.storeMatchNotifications(match);
    }
  }

  private async storeMatchNotifications(match: Match): Promise<void> {
    try {
      // Store individual notification records for each user
      // This enables polling-based match detection as a fallback
      const notificationPromises = match.matchedUsers.map(async (userId) => {
        const notificationRecord = {
          userId,
          matchId: match.id,
          roomId: match.roomId,
          movieId: match.movieId,
          title: match.title,
          posterPath: match.posterPath,
          timestamp: match.timestamp,
          notified: false, // Flag to track if user has been notified
          ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days TTL
        };

        // Store in a notifications table (we'll use the matches table with a special pattern)
        await docClient.send(new PutCommand({
          TableName: this.matchesTable,
          Item: {
            roomId: `NOTIFICATION#${userId}`, // Special prefix for notifications
            movieId: Date.now(), // Use timestamp as sort key for uniqueness
            ...notificationRecord,
          },
        }));

        console.log(`Notification stored for user ${userId}`);
      });

      await Promise.allSettled(notificationPromises);
      console.log('✅ Match notifications stored for polling fallback');
    } catch (error) {
      console.error('Error storing match notifications:', error);
    }
  }

  private async notifyMatchCreated(match: Match): Promise<void> {
    try {
      const payload = {
        operation: 'matchCreated',
        match,
      };

      const command = new InvokeCommand({
        FunctionName: this.matchLambdaArn,
        InvocationType: 'Event', // Async invocation
        Payload: JSON.stringify(payload),
      });

      await lambdaClient.send(command);
      console.log('Match notification sent to Match Lambda');
    } catch (error) {
      console.error('Failed to notify Match Lambda:', error);
      throw error;
    }
  }
}

// Lambda Handler
export const handler: Handler<VoteEvent, VoteResponse> = async (event) => {
  console.log('Vote Lambda received event:', JSON.stringify(event));

  try {
    const { userId, input } = event;
    const { roomId, movieId, vote } = input;

    // Validate input
    if (!userId) {
      throw new Error('User ID is required');
    }

    if (!roomId) {
      throw new Error('Room ID is required');
    }

    if (typeof movieId !== 'number') {
      throw new Error('Movie ID must be a number');
    }

    if (typeof vote !== 'boolean') {
      throw new Error('Vote must be a boolean');
    }

    const voteService = new VoteService();
    const result = await voteService.processVote(userId, roomId, movieId, vote);

    return {
      statusCode: 200,
      body: result,
    };

  } catch (error) {
    console.error('Vote Lambda error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return {
      statusCode: 400,
      body: {
        success: false,
        error: errorMessage,
      },
    };
  }
};