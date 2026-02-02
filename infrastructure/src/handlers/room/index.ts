import { Handler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { randomUUID } from 'crypto';

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION });

// Types
interface MovieCandidate {
  id: number;
  title: string;
  overview: string;
  posterPath: string | null;
  releaseDate: string;
  mediaType: 'MOVIE' | 'TV';
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

interface CreateRoomEvent {
  operation: 'createRoom';
  userId: string;
  input: {
    mediaType: 'MOVIE' | 'TV';
    genreIds: number[];
  };
}

interface JoinRoomEvent {
  operation: 'joinRoom';
  userId: string;
  code: string;
}

interface GetRoomEvent {
  operation: 'getRoom';
  userId: string;
  roomId: string;
}

interface GetMyRoomsEvent {
  operation: 'getMyRooms';
  userId: string;
}

type RoomEvent = CreateRoomEvent | JoinRoomEvent | GetRoomEvent | GetMyRoomsEvent;

interface RoomResponse {
  statusCode: number;
  body: Room | Room[] | { error: string };
}

// Room code generator
class RoomCodeGenerator {
  private static readonly CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  private static readonly CODE_LENGTH = 6;

  static generate(): string {
    let code = '';
    for (let i = 0; i < this.CODE_LENGTH; i++) {
      code += this.CHARACTERS.charAt(Math.floor(Math.random() * this.CHARACTERS.length));
    }
    return code;
  }

  static async generateUnique(docClient: DynamoDBDocumentClient, tableName: string): Promise<string> {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const code = this.generate();
      
      // Check if code already exists
      try {
        const result = await docClient.send(new QueryCommand({
          TableName: tableName,
          IndexName: 'code-index',
          KeyConditionExpression: 'code = :code',
          ExpressionAttributeValues: {
            ':code': code,
          },
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
  private readonly lambdaArn: string;

  constructor() {
    this.lambdaArn = process.env.TMDB_LAMBDA_ARN || '';
    if (!this.lambdaArn) {
      throw new Error('TMDB_LAMBDA_ARN environment variable is required');
    }
  }

  async fetchCandidates(mediaType: 'MOVIE' | 'TV', genreIds?: number[]): Promise<MovieCandidate[]> {
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
  private readonly tableName: string;
  private readonly tmdbIntegration: TMDBIntegration;

  constructor() {
    this.tableName = process.env.ROOMS_TABLE || '';
    if (!this.tableName) {
      throw new Error('ROOMS_TABLE environment variable is required');
    }
    this.tmdbIntegration = new TMDBIntegration();
  }

  async createRoom(userId: string, mediaType: 'MOVIE' | 'TV', genreIds: number[]): Promise<Room> {
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

    const room: Room = {
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

  async joinRoom(userId: string, code: string): Promise<Room> {
    if (!code || code.trim() === '') {
      throw new Error('Room code is required');
    }

    if (!userId) {
      throw new Error('User ID is required');
    }

    // Query by room code using GSI
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

    if (result.Items.length > 1) {
      console.error(`Multiple rooms found for code ${code}:`, result.Items);
      throw new Error('Multiple rooms found for code. Please contact support.');
    }

    const room = result.Items[0] as Room;

    // Check if room has expired
    const now = Math.floor(Date.now() / 1000);
    if (room.ttl && room.ttl < now) {
      throw new Error('Room has expired. Please create a new room.');
    }

    // CRITICAL FIX: Record user participation when joining room
    // This ensures the room appears in "Mis Salas" even if user hasn't voted yet
    await this.recordRoomParticipation(userId, room.id);

    console.log(`User ${userId} joined room: ${room.id} with code: ${code}`);
    return room;
  }

  private async recordRoomParticipation(userId: string, roomId: string): Promise<void> {
    try {
      const votesTable = process.env.VOTES_TABLE || '';
      if (!votesTable) {
        console.warn('VOTES_TABLE not configured, skipping participation tracking');
        return;
      }

      // Create a special "participation" record in VOTES table
      // This allows the room to appear in getMyRooms() even without actual votes
      const participationRecord = {
        roomId,
        userMovieId: `${userId}#JOINED`, // Special marker for room participation
        userId,
        movieId: -1, // Special value indicating this is a participation record, not a vote
        vote: false, // Not a real vote
        timestamp: new Date().toISOString(),
        isParticipation: true, // Flag to distinguish from real votes
      };

      await docClient.send(new PutCommand({
        TableName: votesTable,
        Item: participationRecord,
        // Allow overwriting if user joins the same room multiple times
      }));

      console.log(`Participation recorded for user ${userId} in room ${roomId}`);
    } catch (error) {
      console.error(`Error recording participation for user ${userId} in room ${roomId}:`, error);
      // Don't fail the join operation if participation tracking fails
    }
  }

  async getMyRooms(userId: string): Promise<Room[]> {
    if (!userId) {
      throw new Error('User ID is required');
    }

    try {
      const allRooms: Room[] = [];

      // 1. Get rooms where user is the host
      const hostRoomsResult = await docClient.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'hostId-createdAt-index',
        KeyConditionExpression: 'hostId = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        ScanIndexForward: false, // Most recent first
      }));

      const hostRooms = hostRoomsResult.Items || [];
      allRooms.push(...(hostRooms as Room[]));

      // 2. Get rooms where user has participated (joined or voted)
      const votesTable = process.env.VOTES_TABLE || '';
      if (votesTable) {
        // Get all participation records by this user
        const userParticipationResult = await docClient.send(new QueryCommand({
          TableName: votesTable,
          IndexName: 'userId-timestamp-index',
          KeyConditionExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':userId': userId,
          },
        }));

        const userParticipation = userParticipationResult.Items || [];
        
        // Get unique room IDs from participation records (both votes and joins)
        const participatedRoomIds = new Set(userParticipation.map(record => record.roomId));
        
        // Get room details for participated rooms (excluding already fetched host rooms)
        const hostRoomIds = new Set(hostRooms.map(room => room.id));
        const newRoomIds = Array.from(participatedRoomIds).filter(roomId => !hostRoomIds.has(roomId));
        
        // Fetch room details for participated rooms
        const participatedRoomsPromises = newRoomIds.map(async (roomId) => {
          try {
            const roomResult = await docClient.send(new GetCommand({
              TableName: this.tableName,
              Key: { id: roomId },
            }));
            return roomResult.Item as Room;
          } catch (error) {
            console.error(`Error fetching room ${roomId}:`, error);
            return null;
          }
        });

        const participatedRooms = (await Promise.all(participatedRoomsPromises))
          .filter(room => room !== null) as Room[];
        
        allRooms.push(...participatedRooms);
      }

      // 3. Filter out expired rooms and rooms with matches
      const now = Math.floor(Date.now() / 1000);
      const activeRooms = allRooms.filter(room => !room.ttl || room.ttl >= now);

      // 4. Check for matches and filter out rooms with matches
      const matchesTable = process.env.MATCHES_TABLE || '';
      if (matchesTable) {
        const roomsWithoutMatches = [];
        
        for (const room of activeRooms) {
          try {
            // Check if room has any matches
            const matchResult = await docClient.send(new QueryCommand({
              TableName: matchesTable,
              KeyConditionExpression: 'roomId = :roomId',
              ExpressionAttributeValues: {
                ':roomId': room.id,
              },
              Limit: 1, // We only need to know if any match exists
            }));

            // If no matches found, include the room
            if (!matchResult.Items || matchResult.Items.length === 0) {
              roomsWithoutMatches.push(room);
            }
          } catch (error) {
            console.error(`Error checking matches for room ${room.id}:`, error);
            // Include room if we can't check matches (fail safe)
            roomsWithoutMatches.push(room);
          }
        }

        console.log(`Found ${roomsWithoutMatches.length} active rooms without matches for user ${userId}`);
        return roomsWithoutMatches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }

      console.log(`Found ${activeRooms.length} active rooms for user ${userId}`);
      return activeRooms.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    } catch (error) {
      console.error('Error fetching user rooms:', error);
      throw new Error('Failed to fetch user rooms');
    }
  }

  async getRoom(roomId: string): Promise<Room | null> {
    const result = await docClient.send(new GetCommand({
      TableName: this.tableName,
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
  }
}

// Lambda Handler
export const handler: Handler<RoomEvent, RoomResponse> = async (event) => {
  console.log('Room Lambda received event:', JSON.stringify(event));

  try {
    const roomService = new RoomService();

    switch (event.operation) {
      case 'createRoom': {
        const { userId, input } = event;
        const { mediaType, genreIds } = input;

        if (!userId) {
          throw new Error('User ID is required');
        }

        const room = await roomService.createRoom(userId, mediaType, genreIds);
        
        return {
          statusCode: 200,
          body: room,
        };
      }

      case 'joinRoom': {
        const { userId, code } = event;
        
        if (!userId) {
          throw new Error('User ID is required');
        }
        
        const room = await roomService.joinRoom(userId, code);
        
        return {
          statusCode: 200,
          body: room,
        };
      }

      case 'getMyRooms': {
        const { userId } = event;
        
        if (!userId) {
          throw new Error('User ID is required');
        }

        const rooms = await roomService.getMyRooms(userId);
        
        return {
          statusCode: 200,
          body: rooms,
        };
      }

      case 'getRoom': {
        const { roomId } = event;
        
        if (!roomId) {
          throw new Error('Room ID is required');
        }

        const room = await roomService.getRoom(roomId);
        
        if (!room) {
          throw new Error('Room not found or has expired');
        }
        
        return {
          statusCode: 200,
          body: room,
        };
      }

      default:
        throw new Error(`Unknown operation: ${(event as any).operation}`);
    }

  } catch (error) {
    console.error('Room Lambda error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return {
      statusCode: 400,
      body: { error: errorMessage },
    };
  }
};