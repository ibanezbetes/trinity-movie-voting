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
      
      // Scan the matches table and filter by matchedUsers array
      // Since we store matches with matchedUsers as an array, we need to scan and filter
      const result = await docClient.send(new ScanCommand({
        TableName: this.matchesTable,
        FilterExpression: 'contains(matchedUsers, :userId)',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        Limit: 50,
      }));

      const matches = (result.Items || []) as Match[];
      console.log(`Found ${matches.length} matches for user ${userId}`);
      
      // Sort by timestamp descending (newest first)
      matches.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      return matches;

    } catch (error) {
      console.error('Error getting user matches:', error);
      return [];
    }
  }

  async checkUserMatches(userId: string): Promise<Match[]> {
    try {
      console.log(`🔍 Checking for ANY matches for user: ${userId}`);
      
      // Scan the matches table and filter by matchedUsers array
      const result = await docClient.send(new ScanCommand({
        TableName: this.matchesTable,
        FilterExpression: 'contains(matchedUsers, :userId)',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        Limit: 10,
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
      
      // Sort by timestamp descending (newest first)
      matches.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      return matches;

    } catch (error) {
      console.error('❌ Error checking user matches:', error);
      return [];
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

// Lambda Handler for AppSync
export const handler: Handler = async (event) => {
  console.log('Match Lambda received AppSync event:', JSON.stringify(event));

  try {
    const matchService = new MatchService();

    // Extract user ID from AppSync context
    const userId = event.identity?.claims?.sub || event.identity?.username;
    
    // Determine operation from AppSync field name
    const fieldName = event.info?.fieldName;
    
    switch (fieldName) {
      case 'getMyMatches': {
        if (!userId) {
          throw new Error('User not authenticated');
        }

        const matches = await matchService.getUserMatches(userId);
        return matches;
      }

      case 'checkUserMatches': {
        if (!userId) {
          throw new Error('User not authenticated');
        }

        const matches = await matchService.checkUserMatches(userId);
        return matches;
      }

      case 'checkRoomMatch': {
        const { roomId } = event.arguments;
        
        if (!roomId) {
          throw new Error('Room ID is required');
        }

        const match = await matchService.checkRoomMatch(roomId);
        return match;
      }

      case 'createMatch': {
        const { input } = event.arguments;
        
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
        
        return match;
      }

      case 'publishRoomMatch': {
        const { roomId, matchData } = event.arguments;
        
        console.log(`🚀 CRITICAL FIX: Processing publishRoomMatch for room: ${roomId}`);
        console.log(`🎬 Movie: ${matchData.movieTitle}`);
        console.log(`👥 Matched users: ${matchData.matchedUsers.join(', ')}`);
        
        // Return the roomMatchEvent structure that AppSync expects
        const roomMatchEvent = {
          roomId: roomId,
          matchId: matchData.matchId,
          movieId: String(matchData.movieId),
          movieTitle: matchData.movieTitle,
          posterPath: matchData.posterPath || null,
          matchedUsers: matchData.matchedUsers,
          timestamp: new Date().toISOString(),
          matchDetails: matchData.matchDetails
        };

        console.log('📡 Returning roomMatchEvent for AppSync subscription trigger');
        
        return roomMatchEvent;
      }

      case 'publishUserMatch': {
        const { userId: targetUserId, matchData } = event.arguments;
        
        console.log(`🚀 Processing publishUserMatch for user: ${targetUserId}`);
        console.log(`🎬 Movie: ${matchData.movieTitle}`);
        
        // Return the userMatchEvent structure that AppSync expects
        const userMatchEvent = {
          userId: targetUserId,
          roomId: matchData.roomId,
          matchId: matchData.matchId,
          movieId: String(matchData.movieId),
          movieTitle: matchData.movieTitle,
          posterPath: matchData.posterPath || null,
          matchedUsers: matchData.matchedUsers,
          timestamp: new Date().toISOString(),
          matchDetails: matchData.matchDetails
        };

        console.log('📡 Returning userMatchEvent for AppSync subscription trigger');
        
        return userMatchEvent;
      }

      default:
        throw new Error(`Unknown field: ${fieldName}`);
    }

  } catch (error) {
    console.error('Match Lambda error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Error(errorMessage);
  }
};