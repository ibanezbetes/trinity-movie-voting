import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { AppSyncClient, EvaluateMappingTemplateCommand } from '@aws-sdk/client-appsync';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });
const appSyncClient = new AppSyncClient({ region: process.env.AWS_REGION });

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
      // Get all votes for this movie in this room
      const votesResult = await docClient.send(new QueryCommand({
        TableName: this.votesTable,
        KeyConditionExpression: 'roomId = :roomId',
        FilterExpression: 'movieId = :movieId AND vote = :vote',
        ExpressionAttributeValues: {
          ':roomId': roomId,
          ':movieId': movieId,
          ':vote': true, // Only positive votes
        },
      }));

      const positiveVotes = votesResult.Items || [];
      console.log(`Found ${positiveVotes.length} positive votes for movie ${movieId} in room ${roomId}`);

      // Get all unique users who have voted in this room
      const allVotesResult = await docClient.send(new QueryCommand({
        TableName: this.votesTable,
        KeyConditionExpression: 'roomId = :roomId',
        ExpressionAttributeValues: {
          ':roomId': roomId,
        },
      }));

      const allVotes = allVotesResult.Items || [];
      const uniqueUsers = new Set(allVotes.map(vote => (vote as Vote).userId));
      const totalUsers = uniqueUsers.size;

      console.log(`Total unique users in room: ${totalUsers}`);

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

    // Store match in DynamoDB
    await docClient.send(new PutCommand({
      TableName: this.matchesTable,
      Item: match,
      ConditionExpression: 'attribute_not_exists(roomId) AND attribute_not_exists(movieId)', // Prevent duplicates
    }));

    console.log(`Match created: ${matchId} with ${matchedUsers.length} users`);

    // Delete the room since match is found - room is no longer needed
    await this.deleteRoom(roomId);

    // Trigger AppSync subscription for all matched users
    await this.triggerMatchSubscriptions(match);

    // Optionally invoke Match Lambda for notifications (if implemented)
    if (this.matchLambdaArn) {
      try {
        await this.notifyMatchCreated(match);
      } catch (error) {
        console.error('Error notifying match creation:', error);
        // Don't fail the vote if notification fails
      }
    }

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
      // Get all votes for this room
      const votesResult = await docClient.send(new QueryCommand({
        TableName: this.votesTable,
        KeyConditionExpression: 'roomId = :roomId',
        ExpressionAttributeValues: {
          ':roomId': roomId,
        },
      }));

      const votes = votesResult.Items || [];
      
      // Delete votes in batches
      const deletePromises = votes.map(vote => 
        docClient.send(new DeleteCommand({
          TableName: this.votesTable,
          Key: {
            roomId: vote.roomId,
            userMovieId: vote.userMovieId,
          },
        }))
      );

      await Promise.allSettled(deletePromises);
      console.log(`Deleted ${votes.length} votes for room ${roomId}`);
    } catch (error) {
      console.error(`Error deleting votes for room ${roomId}:`, error);
    }
  }

  private async triggerMatchSubscriptions(match: Match): Promise<void> {
    try {
      console.log(`Triggering match subscriptions for ${match.matchedUsers.length} users`);
      
      // Instead of calling AppSync directly, we'll use the Match Lambda to trigger subscriptions
      // The Match Lambda will handle the createMatch mutation which triggers subscriptions
      
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

        const command = new InvokeCommand({
          FunctionName: this.matchLambdaArn,
          InvocationType: 'Event', // Async invocation
          Payload: JSON.stringify(payload),
        });

        await lambdaClient.send(command);
        console.log('Match subscription trigger sent to Match Lambda');
      } else {
        console.warn('MATCH_LAMBDA_ARN not configured, skipping subscription notifications');
      }
    } catch (error) {
      console.error('Error triggering match subscriptions:', error);
      // Don't fail the match creation if subscription fails
    }
  }
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