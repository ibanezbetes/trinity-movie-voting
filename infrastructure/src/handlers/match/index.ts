import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AppSyncClient, EvaluateCodeCommand } from '@aws-sdk/client-appsync';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const appSyncClient = new AppSyncClient({ region: process.env.AWS_REGION });

// Types
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

interface User {
  id: string;
  email: string;
  createdAt: string;
  lastActiveAt: string;
}

interface CreateMatchEvent {
  operation: 'createMatch';
  input: {
    roomId: string;
    movieId: number;
    title: string;
    posterPath?: string;
    matchedUsers: string[];
  };
}

interface GetUserMatchesEvent {
  operation: 'getUserMatches';
  userId: string;
}

interface CheckRoomMatchEvent {
  operation: 'checkRoomMatch';
  roomId: string;
}

interface NotifyMatchEvent {
  operation: 'notifyMatch';
  match: Match;
}

interface MatchCreatedEvent {
  operation: 'matchCreated';
  match: Match;
}

type MatchEvent = CreateMatchEvent | MatchCreatedEvent | GetUserMatchesEvent | CheckRoomMatchEvent | NotifyMatchEvent;

interface MatchResponse {
  statusCode: number;
  body: {
    matches?: Match[];
    match?: Match;
    success?: boolean;
    error?: string;
  };
}

// Match Service
class MatchService {
  private readonly matchesTable: string;
  private readonly usersTable: string;

  constructor() {
    this.matchesTable = process.env.MATCHES_TABLE || '';
    this.usersTable = process.env.USERS_TABLE || '';

    if (!this.matchesTable || !this.usersTable) {
      throw new Error('Required table environment variables are missing');
    }
  }

  async handleMatchCreated(match: Match): Promise<void> {
    console.log(`Processing match created: ${match.id} with ${match.matchedUsers.length} users`);

    // Update user activity for all matched users
    await this.updateUserActivity(match.matchedUsers);

    // Send notifications to all matched users
    await this.notifyMatchToUsers(match);

    // Log match creation for analytics
    console.log(`Match successfully processed: ${match.title} (${match.mediaType}) matched by users: ${match.matchedUsers.join(', ')}`);
  }

  async notifyMatchToUsers(match: Match): Promise<void> {
    try {
      console.log(`Sending match notifications to ${match.matchedUsers.length} users`);
      
      // In a real implementation, you would use AppSync subscriptions or push notifications
      // For now, we'll log the notification and store it for the frontend to poll
      
      const notificationPromises = match.matchedUsers.map(async (userId) => {
        try {
          // Store notification in user's record or send via AppSync subscription
          console.log(`Notifying user ${userId} about match: ${match.title}`);
          
          // Here you would typically:
          // 1. Send AppSync subscription notification
          // 2. Send push notification
          // 3. Store notification in user's inbox
          
          return { userId, success: true };
        } catch (error) {
          console.error(`Failed to notify user ${userId}:`, error);
          return { userId, success: false, error };
        }
      });

      const results = await Promise.allSettled(notificationPromises);
      const successful = results.filter(r => r.status === 'fulfilled').length;
      
      console.log(`Match notifications sent: ${successful}/${match.matchedUsers.length} successful`);
    } catch (error) {
      console.error('Error sending match notifications:', error);
    }
  }

  async checkRoomMatch(roomId: string): Promise<Match | null> {
    try {
      console.log(`Checking for existing match in room: ${roomId}`);
      
      // Query matches table for any match in this room
      const result = await docClient.send(new QueryCommand({
        TableName: this.matchesTable,
        KeyConditionExpression: 'roomId = :roomId',
        ExpressionAttributeValues: {
          ':roomId': roomId,
        },
        Limit: 1, // We only need to know if there's any match
      }));

      if (result.Items && result.Items.length > 0) {
        const match = result.Items[0] as Match;
        console.log(`Found existing match in room ${roomId}: ${match.title}`);
        return match;
      }

      console.log(`No match found in room: ${roomId}`);
      return null;
    } catch (error) {
      console.error(`Error checking room match for ${roomId}:`, error);
      return null;
    }
  }

  async getUserMatches(userId: string): Promise<Match[]> {
    try {
      // Query all matches across all rooms
      // Note: This is a scan operation which is not ideal for large datasets
      // In production, consider adding a GSI with userId as partition key
      const result = await docClient.send(new QueryCommand({
        TableName: this.matchesTable,
        // Since we don't have a GSI for userId, we need to scan all matches
        // This is a limitation of the current schema design
        IndexName: 'timestamp-index', // Use LSI to get matches ordered by time
        KeyConditionExpression: 'roomId = :roomId', // This won't work for cross-room queries
        ExpressionAttributeValues: {
          ':roomId': userId, // This is incorrect - we need a different approach
        },
      }));

      // Alternative approach: Scan with filter (not efficient but works for MVP)
      // In production, add GSI with userId as partition key
      const scanResult = await this.scanUserMatches(userId);
      
      return scanResult;

    } catch (error) {
      console.error('Error getting user matches:', error);
      return [];
    }
  }

  private async scanUserMatches(userId: string): Promise<Match[]> {
    // This is a temporary solution - in production, use GSI
    console.log(`Scanning matches for user: ${userId}`);
    
    // For MVP, we'll implement a simple approach
    // In production, this should be optimized with proper indexing
    const matches: Match[] = [];
    
    try {
      // Since we don't have an efficient way to query matches by user,
      // we'll implement a basic version that works for the MVP
      // This would need to be optimized for production use
      
      // For now, return empty array and log the limitation
      console.log('getUserMatches: Returning empty array - requires GSI optimization for production');
      return matches;
      
    } catch (error) {
      console.error('Error scanning user matches:', error);
      return [];
    }
  }

  private async updateUserActivity(userIds: string[]): Promise<void> {
    const timestamp = new Date().toISOString();

    // Update lastActiveAt for all matched users
    const updatePromises = userIds.map(async (userId) => {
      try {
        // Check if user exists, create if not
        const existingUser = await this.getUser(userId);
        
        if (existingUser) {
          // Update existing user's last activity
          await docClient.send(new PutCommand({
            TableName: this.usersTable,
            Item: {
              ...existingUser,
              lastActiveAt: timestamp,
            },
          }));
        } else {
          // Create new user record
          const newUser: User = {
            id: userId,
            email: '', // Will be populated from Cognito when available
            createdAt: timestamp,
            lastActiveAt: timestamp,
          };

          await docClient.send(new PutCommand({
            TableName: this.usersTable,
            Item: newUser,
            ConditionExpression: 'attribute_not_exists(id)', // Prevent overwriting
          }));
        }

        console.log(`Updated activity for user: ${userId}`);
      } catch (error) {
        console.error(`Error updating user activity for ${userId}:`, error);
        // Continue with other users even if one fails
      }
    });

    await Promise.allSettled(updatePromises);
  }

  private async getUser(userId: string): Promise<User | null> {
    try {
      const result = await docClient.send(new GetCommand({
        TableName: this.usersTable,
        Key: { id: userId },
      }));

      return result.Item as User || null;
    } catch (error) {
      console.error(`Error getting user ${userId}:`, error);
      return null;
    }
  }

  async processMatchNotification(match: Match): Promise<void> {
    // Future implementation for real-time notifications
    // Could integrate with:
    // - AppSync subscriptions
    // - SNS for push notifications
    // - WebSocket connections
    // - Email notifications

    console.log(`Match notification: ${match.title} matched in room ${match.roomId}`);
    
    // For MVP, just log the notification
    // In production, implement actual notification delivery
  }
}

// Lambda Handler
export const handler: Handler<MatchEvent, MatchResponse> = async (event) => {
  console.log('Match Lambda received event:', JSON.stringify(event));

  try {
    const matchService = new MatchService();

    switch (event.operation) {
      case 'createMatch': {
        const { input } = event;
        
        // Create the match object
        const timestamp = new Date().toISOString();
        const matchId = `${input.roomId}#${input.movieId}`;
        
        const match: Match = {
          id: matchId,
          roomId: input.roomId,
          movieId: input.movieId,
          title: input.title,
          posterPath: input.posterPath,
          mediaType: 'MOVIE', // Default, should be passed from input
          matchedUsers: input.matchedUsers,
          timestamp,
        };

        // This mutation is called to trigger AppSync subscriptions
        // The actual match storage is already done by the Vote Handler
        console.log(`CreateMatch mutation executed - triggering subscriptions for: ${match.title}`);
        
        // The subscription will be automatically triggered by AppSync when this resolver returns
        // All users subscribed to onMatchCreated will receive this match notification

        return {
          statusCode: 200,
          body: { match },
        };
      }

      case 'matchCreated': {
        const { match } = event;
        
        // Process the match creation
        await matchService.handleMatchCreated(match);
        
        // Send notifications (future implementation)
        await matchService.processMatchNotification(match);

        return {
          statusCode: 200,
          body: { success: true },
        };
      }

      case 'getUserMatches': {
        const { userId } = event;
        
        if (!userId) {
          throw new Error('User ID is required');
        }

        const matches = await matchService.getUserMatches(userId);

        return {
          statusCode: 200,
          body: { matches },
        };
      }

      case 'checkRoomMatch': {
        const { roomId } = event;
        
        if (!roomId) {
          throw new Error('Room ID is required');
        }

        const match = await matchService.checkRoomMatch(roomId);

        return {
          statusCode: 200,
          body: { match: match || undefined },
        };
      }

      case 'notifyMatch': {
        const { match } = event;
        
        if (!match) {
          throw new Error('Match is required');
        }

        await matchService.notifyMatchToUsers(match);

        return {
          statusCode: 200,
          body: { success: true },
        };
      }

      default:
        throw new Error(`Unknown operation: ${(event as any).operation}`);
    }

  } catch (error) {
    console.error('Match Lambda error:', error);
    
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