const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, GetCommand, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Match Service
class MatchService {
  constructor() {
    this.matchesTable = process.env.MATCHES_TABLE || '';

    if (!this.matchesTable) {
      throw new Error('Required table environment variables are missing');
    }
  }

  async getUserMatches(userId) {
    try {
      console.log(`Getting matches for user: ${userId}`);
      
      // Scan the matches table and filter by matchedUsers array
      const result = await docClient.send(new ScanCommand({
        TableName: this.matchesTable,
        FilterExpression: 'contains(matchedUsers, :userId)',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        Limit: 50,
      }));

      const matches = result.Items || [];
      console.log(`Found ${matches.length} matches for user ${userId}`);
      
      // Sort by timestamp descending (newest first)
      matches.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      return matches;

    } catch (error) {
      console.error('Error getting user matches:', error);
      return [];
    }
  }

  async checkUserMatches(userId) {
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

      const matches = result.Items || [];
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

  async checkRoomMatch(roomId) {
    try {
      console.log(`Checking for existing match in room: ${roomId}`);
      
      // Query matches table for any match in this room
      const result = await docClient.send(new QueryCommand({
        TableName: this.matchesTable,
        KeyConditionExpression: 'roomId = :roomId',
        ExpressionAttributeValues: {
          ':roomId': roomId,
        },
        Limit: 1,
      }));

      if (result.Items && result.Items.length > 0) {
        const match = result.Items[0];
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
}

// Lambda Handler for AppSync
exports.handler = async (event) => {
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
        
        const match = {
          id: matchId,
          roomId: input.roomId,
          movieId: input.movieId,
          title: input.title,
          posterPath: input.posterPath,
          mediaType: 'MOVIE',
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