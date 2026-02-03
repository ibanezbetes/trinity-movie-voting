const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { randomUUID } = require('crypto');

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

// Room code generator
class RoomCodeGenerator {
  static CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  static CODE_LENGTH = 6;

  static generate() {
    let code = '';
    for (let i = 0; i < this.CODE_LENGTH; i++) {
      code += this.CHARACTERS.charAt(Math.floor(Math.random() * this.CHARACTERS.length));
    }
    return code;
  }

  static async generateUnique(docClient, tableName) {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const code = this.generate();
      
      try {
        // Try to find existing room with this code using scan (fallback method)
        const result = await docClient.send(new ScanCommand({
          TableName: tableName,
          FilterExpression: 'code = :code',
          ExpressionAttributeValues: {
            ':code': code,
          },
          Limit: 1,
        }));

        if (!result.Items || result.Items.length === 0) {
          return code; // Code is unique
        }
      } catch (error) {
        console.error('Error checking code uniqueness:', error);
      }

      attempts++;
    }

    throw new Error('Failed to generate unique room code after maximum attempts');
  }
}

// TMDB Integration
class TMDBIntegration {
  constructor() {
    this.lambdaArn = process.env.TMDB_LAMBDA_ARN || '';
    if (!this.lambdaArn) {
      throw new Error('TMDB_LAMBDA_ARN environment variable is required');
    }
  }

  async fetchCandidates(mediaType, genreIds) {
    try {
      const payload = {
        mediaType,
        genreIds,
        page: 1,
      };

      console.log('Invoking TMDB Lambda with payload:', JSON.stringify(payload));

      const command = new InvokeCommand({
        FunctionName: this.lambdaArn,
        Payload: JSON.stringify(payload),
      });

      const response = await lambdaClient.send(command);
      
      if (!response.Payload) {
        throw new Error('No response from TMDB Lambda');
      }

      const result = JSON.parse(new TextDecoder().decode(response.Payload));
      
      if (result.statusCode !== 200) {
        throw new Error(`TMDB Lambda error: ${JSON.stringify(result.body)}`);
      }

      return result.body.candidates || [];

    } catch (error) {
      console.error('TMDB Integration error:', error);
      throw new Error(`Failed to fetch movie candidates: ${error}`);
    }
  }
}

// Room Service
class RoomService {
  constructor() {
    this.tableName = process.env.ROOMS_TABLE || '';
    if (!this.tableName) {
      throw new Error('ROOMS_TABLE environment variable is required');
    }
    this.tmdbIntegration = new TMDBIntegration();
  }

  async createRoom(userId, mediaType, genreIds) {
    // Validate input
    if (!mediaType || !['MOVIE', 'TV'].includes(mediaType)) {
      throw new Error('Invalid mediaType. Must be MOVIE or TV');
    }

    // Enforce genre limit (max 2 as per master spec)
    if (genreIds.length > 2) {
      throw new Error('Maximum 2 genres allowed');
    }

    // Generate unique room code
    const code = await RoomCodeGenerator.generateUnique(docClient, this.tableName);
    
    // Fetch movie candidates from TMDB
    console.log(`Fetching ${mediaType} candidates for genres: ${genreIds.join(',')}`);
    const candidates = await this.tmdbIntegration.fetchCandidates(mediaType, genreIds);
    
    if (candidates.length === 0) {
      console.warn('No candidates returned from TMDB - proceeding with empty list');
    }

    // Create room record
    const roomId = randomUUID();
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours from now

    const room = {
      id: roomId,
      code,
      hostId: userId,
      mediaType,
      genreIds,
      candidates,
      createdAt: now,
      ttl,
    };

    // Store in DynamoDB
    await docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: room,
      ConditionExpression: 'attribute_not_exists(id)', // Ensure no duplicate IDs
    }));

    console.log(`Room created successfully: ${roomId} with code: ${code}`);
    return room;
  }

  async joinRoom(userId, code) {
    if (!code || code.trim() === '') {
      throw new Error('Room code is required');
    }

    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      // Try GSI first
      const result = await docClient.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'code-index',
        KeyConditionExpression: 'code = :code',
        ExpressionAttributeValues: {
          ':code': code.toUpperCase(),
        },
      }));

      if (!result.Items || result.Items.length === 0) {
        throw new Error('Room not found. Please check the room code.');
      }

      const room = result.Items[0];

      // Check if room has expired
      const now = Math.floor(Date.now() / 1000);
      if (room.ttl && room.ttl < now) {
        throw new Error('Room has expired. Please create a new room.');
      }

      await this.recordRoomParticipation(userId, room.id);

      console.log(`User ${userId} joined room: ${room.id} with code: ${code}`);
      return room;
    } catch (error) {
      // Fallback to scan if GSI is not available yet
      console.log('GSI not available, falling back to scan method');
      return await this.joinRoomByScan(userId, code);
    }
  }

  async joinRoomByScan(userId, code) {
    // Fallback method using scan
    const result = await docClient.send(new ScanCommand({
      TableName: this.tableName,
      FilterExpression: 'code = :code',
      ExpressionAttributeValues: {
        ':code': code.toUpperCase(),
      },
    }));

    if (!result.Items || result.Items.length === 0) {
      throw new Error('Room not found. Please check the room code.');
    }

    const room = result.Items[0];

    // Check if room has expired
    const now = Math.floor(Date.now() / 1000);
    if (room.ttl && room.ttl < now) {
      throw new Error('Room has expired. Please create a new room.');
    }

    await this.recordRoomParticipation(userId, room.id);

    console.log(`User ${userId} joined room: ${room.id} with code: ${code} (scan method)`);
    return room;
  }

  async recordRoomParticipation(userId, roomId) {
    try {
      const votesTable = process.env.VOTES_TABLE || '';
      if (!votesTable) {
        console.warn('VOTES_TABLE not configured, skipping participation tracking');
        return;
      }

      const participationRecord = {
        roomId,
        userMovieId: `${userId}#JOINED`,
        userId,
        movieId: -1,
        vote: false,
        timestamp: new Date().toISOString(),
        isParticipation: true,
      };

      await docClient.send(new PutCommand({
        TableName: votesTable,
        Item: participationRecord,
      }));

      console.log(`Participation recorded for user ${userId} in room ${roomId}`);
    } catch (error) {
      console.error(`Error recording participation for user ${userId} in room ${roomId}:`, error);
    }
  }

  async getMyRooms(userId) {
    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      const allRooms = [];

      // Get rooms where user is the host - use scan for now
      const hostRoomsResult = await docClient.send(new ScanCommand({
        TableName: this.tableName,
        FilterExpression: 'hostId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
      }));

      const hostRooms = hostRoomsResult.Items || [];
      allRooms.push(...hostRooms);

      // Get rooms where user has participated
      const votesTable = process.env.VOTES_TABLE || '';
      if (votesTable) {
        const userParticipationResult = await docClient.send(new ScanCommand({
          TableName: votesTable,
          FilterExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':userId': userId,
          },
        }));

        const userParticipation = userParticipationResult.Items || [];
        const participatedRoomIds = new Set(userParticipation.map(record => record.roomId));
        const hostRoomIds = new Set(hostRooms.map(room => room.id));
        const newRoomIds = Array.from(participatedRoomIds).filter(roomId => !hostRoomIds.has(roomId));
        
        const participatedRoomsPromises = newRoomIds.map(async (roomId) => {
          try {
            const roomResult = await docClient.send(new GetCommand({
              TableName: this.tableName,
              Key: { id: roomId },
            }));
            return roomResult.Item;
          } catch (error) {
            console.error(`Error fetching room ${roomId}:`, error);
            return null;
          }
        });

        const participatedRooms = (await Promise.all(participatedRoomsPromises))
          .filter(room => room !== null);
        
        allRooms.push(...participatedRooms);
      }

      // Filter out expired rooms
      const now = Math.floor(Date.now() / 1000);
      const activeRooms = allRooms.filter(room => !room.ttl || room.ttl >= now);

      console.log(`Found ${activeRooms.length} active rooms for user ${userId}`);
      return activeRooms.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    } catch (error) {
      console.error('Error fetching user rooms:', error);
      throw new Error('Failed to fetch user rooms');
    }
  }

  async getRoom(roomId) {
    const result = await docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { id: roomId },
    }));

    if (!result.Item) {
      return null;
    }

    const room = result.Item;

    // Check if room has expired
    const now = Math.floor(Date.now() / 1000);
    if (room.ttl && room.ttl < now) {
      return null;
    }

    return room;
  }
}

// Lambda Handler for AppSync
exports.handler = async (event) => {
  console.log('Room Lambda received AppSync event:', JSON.stringify(event));

  try {
    const roomService = new RoomService();

    // Extract user ID from AppSync context
    const userId = event.identity?.claims?.sub || event.identity?.username;
    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Determine operation from AppSync field name
    const fieldName = event.info?.fieldName;
    console.log('Field name:', fieldName);
    
    switch (fieldName) {
      case 'createRoom': {
        console.log('Processing createRoom mutation');
        const { input } = event.arguments;
        const { mediaType, genreIds } = input;

        const room = await roomService.createRoom(userId, mediaType, genreIds);
        return room;
      }

      case 'joinRoom': {
        console.log('Processing joinRoom mutation');
        const { code } = event.arguments;
        const room = await roomService.joinRoom(userId, code);
        return room;
      }

      case 'getMyRooms': {
        console.log('Processing getMyRooms query');
        const rooms = await roomService.getMyRooms(userId);
        return rooms;
      }

      case 'getRoom': {
        console.log('Processing getRoom query');
        const { id } = event.arguments;
        const room = await roomService.getRoom(id);
        
        if (!room) {
          throw new Error('Room not found or has expired');
        }
        
        return room;
      }

      default:
        console.error('Unknown field name:', fieldName);
        console.error('Available event properties:', Object.keys(event));
        console.error('Event info:', event.info);
        throw new Error(`Unknown field: ${fieldName}`);
    }

  } catch (error) {
    console.error('Room Lambda error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Error(errorMessage);
  }
};