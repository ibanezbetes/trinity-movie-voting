import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

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

interface CheckUserMatchesEvent {
  operation: 'checkUserMatches';
  userId: string;
}

interface PublishRoomMatchEvent {
  operation: 'publishRoomMatch';
  roomId: string;
  matchData: {
    matchId: string;
    movieId: string;
    movieTitle: string;
    posterPath?: string;
    matchedUsers: string[];
    matchDetails: {
      voteCount: number;
      requiredVotes: number;
      matchType: string;
    };
  };
}

type MatchEvent = CreateMatchEvent | MatchCreatedEvent | GetUserMatchesEvent | CheckRoomMatchEvent | CheckUserMatchesEvent | NotifyMatchEvent | PublishRoomMatchEvent;

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
      console.log(`Getting matches for user: ${userId}`);
      
      // Use the new GSI to efficiently query matches by user
      const result = await docClient.send(new QueryCommand({
        TableName: this.matchesTable,
        IndexName: 'userId-timestamp-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        ScanIndexForward: false, // Sort by timestamp descending (newest first)
        Limit: 50, // Limit to last 50 matches for performance
      }));

      const matches = (result.Items || []) as Match[];
      console.log(`Found ${matches.length} matches for user ${userId}`);
      
      return matches;

    } catch (error) {
      console.error('Error getting user matches:', error);
      
      // Fallback to scan method for backward compatibility
      console.log('Falling back to scan method...');
      return await this.scanUserMatches(userId);
    }
  }

  async checkUserMatches(userId: string): Promise<Match[]> {
    try {
      console.log(`🔍 Checking for ANY matches for user: ${userId}`);
      
      // Use the GSI to efficiently query matches by user
      const result = await docClient.send(new QueryCommand({
        TableName: this.matchesTable,
        IndexName: 'userId-timestamp-index',
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        ScanIndexForward: false, // Sort by timestamp descending (newest first)
        Limit: 10, // Limit to last 10 matches for performance
      }));

      const matches = (result.Items || []) as Match[];
      console.log(`✅ Found ${matches.length} matches for user ${userId}`);
      
      if (matches.length > 0) {
        console.log(`📋 Recent matches:`, matches.map(m => ({
          id: m.id,
          title: m.title,
          roomId: m.roomId,
          timestamp: m.timestamp
        })));
      }
      
      return matches;

    } catch (error) {
      console.error('❌ Error checking user matches:', error);
      
      // Fallback to scan method for backward compatibility
      console.log('🔄 Falling back to scan method...');
      return await this.scanUserMatches(userId);
    }
  }

  private async scanUserMatches(userId: string): Promise<Match[]> {
    console.log(`Scanning matches for user: ${userId} (fallback method)`);
    
    try {
      // Scan the entire matches table and filter by user
      // This is inefficient but works as a fallback
      const result = await docClient.send(new ScanCommand({
        TableName: this.matchesTable,
        FilterExpression: 'contains(matchedUsers, :userId)',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        Limit: 50,
      }));

      const matches = (result.Items || []) as Match[];
      console.log(`Scan found ${matches.length} matches for user ${userId}`);
      
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
      case 'publishRoomMatch': {
        const { roomId, matchData } = event;
        
        console.log(`🚀 CRITICAL FIX: Processing publishRoomMatch for room: ${roomId}`);
        console.log(`🎬 Movie: ${matchData.movieTitle}`);
        console.log(`👥 Matched users: ${matchData.matchedUsers.join(', ')}`);
        
        // CRITICAL FIX: Return the correct roomMatchEvent structure that AppSync expects
        // The AppSync resolver will use this to trigger the roomMatch subscription
        
        const roomMatchEvent = {
          roomId: roomId,
          matchId: matchData.matchId,
          movieId: String(matchData.movieId), // Convert to string for consistency
          movieTitle: matchData.movieTitle,
          posterPath: matchData.posterPath || null,
          matchedUsers: matchData.matchedUsers,
          timestamp: new Date().toISOString(),
          matchDetails: matchData.matchDetails
        };

        console.log('📡 Returning roomMatchEvent for AppSync subscription trigger');
        console.log('✅ AppSync will broadcast this to all roomMatch subscribers');
        console.log(`🔔 All users subscribed to roomMatch(${roomId}) will be notified`);
        
        // CRITICAL: Return the roomMatchEvent in the body so AppSync resolver can use it
        return {
          statusCode: 200,
          body: { 
            success: true,
            roomMatchEvent: roomMatchEvent,
            message: 'Room match event prepared for AppSync subscription broadcast'
          },
        };
      }

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

        console.log(`🎉 CreateMatch mutation executed via AppSync resolver`);
        console.log(`📡 This will automatically trigger AppSync subscriptions`);
        console.log(`🎬 Match: ${match.title}`);
        console.log(`👥 Notifying ${match.matchedUsers.length} users: ${match.matchedUsers.join(', ')}`);
        
        // CRITICAL: When this resolver returns the match object, AppSync will automatically
        // trigger the onMatchCreated subscription for all connected clients.
        // The subscription is configured in schema.graphql as:
        // onMatchCreated: Match @aws_subscribe(mutations: ["createMatch"])
        
        // This means any client subscribed to onMatchCreated will receive this match
        // The client-side filtering in subscriptions.ts will ensure each user only
        // processes matches where they are in the matchedUsers array
        
        console.log('✅ Returning match object to AppSync for subscription broadcast');
        
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

      case 'checkUserMatches': {
        const { userId } = event;
        
        if (!userId) {
          throw new Error('User ID is required');
        }

        const matches = await matchService.checkUserMatches(userId);

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