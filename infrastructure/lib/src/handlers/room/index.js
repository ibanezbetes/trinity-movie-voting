"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_lambda_1 = require("@aws-sdk/client-lambda");
const crypto_1 = require("crypto");
// Initialize AWS clients
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new client_lambda_1.LambdaClient({ region: process.env.AWS_REGION });
// Room code generator
class RoomCodeGenerator {
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
            // Check if code already exists
            try {
                const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
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
            }
            catch (error) {
                console.error('Error checking code uniqueness:', error);
            }
            attempts++;
        }
        throw new Error('Failed to generate unique room code after maximum attempts');
    }
}
RoomCodeGenerator.CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
RoomCodeGenerator.CODE_LENGTH = 6;
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
            const command = new client_lambda_1.InvokeCommand({
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
        }
        catch (error) {
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
        const roomId = (0, crypto_1.randomUUID)();
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
        await docClient.send(new lib_dynamodb_1.PutCommand({
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
        // Query by room code using GSI
        const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
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
        const room = result.Items[0];
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
    async recordRoomParticipation(userId, roomId) {
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
            await docClient.send(new lib_dynamodb_1.PutCommand({
                TableName: votesTable,
                Item: participationRecord,
                // Allow overwriting if user joins the same room multiple times
            }));
            console.log(`Participation recorded for user ${userId} in room ${roomId}`);
        }
        catch (error) {
            console.error(`Error recording participation for user ${userId} in room ${roomId}:`, error);
            // Don't fail the join operation if participation tracking fails
        }
    }
    async getMyRooms(userId) {
        if (!userId) {
            throw new Error('User ID is required');
        }
        try {
            const allRooms = [];
            // 1. Get rooms where user is the host
            const hostRoomsResult = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.tableName,
                IndexName: 'hostId-createdAt-index',
                KeyConditionExpression: 'hostId = :userId',
                ExpressionAttributeValues: {
                    ':userId': userId,
                },
                ScanIndexForward: false, // Most recent first
            }));
            const hostRooms = hostRoomsResult.Items || [];
            allRooms.push(...hostRooms);
            // 2. Get rooms where user has participated (joined or voted)
            const votesTable = process.env.VOTES_TABLE || '';
            if (votesTable) {
                // Get all participation records by this user
                const userParticipationResult = await docClient.send(new lib_dynamodb_1.QueryCommand({
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
                        const roomResult = await docClient.send(new lib_dynamodb_1.GetCommand({
                            TableName: this.tableName,
                            Key: { id: roomId },
                        }));
                        return roomResult.Item;
                    }
                    catch (error) {
                        console.error(`Error fetching room ${roomId}:`, error);
                        return null;
                    }
                });
                const participatedRooms = (await Promise.all(participatedRoomsPromises))
                    .filter(room => room !== null);
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
                        const matchResult = await docClient.send(new lib_dynamodb_1.QueryCommand({
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
                    }
                    catch (error) {
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
        }
        catch (error) {
            console.error('Error fetching user rooms:', error);
            throw new Error('Failed to fetch user rooms');
        }
    }
    async getRoom(roomId) {
        const result = await docClient.send(new lib_dynamodb_1.GetCommand({
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
// Lambda Handler
const handler = async (event) => {
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
                throw new Error(`Unknown operation: ${event.operation}`);
        }
    }
    catch (error) {
        console.error('Room Lambda error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
            statusCode: 400,
            body: { error: errorMessage },
        };
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvcm9vbS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQXFHO0FBQ3JHLDBEQUFxRTtBQUNyRSxtQ0FBb0M7QUFFcEMseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUF3RDFFLHNCQUFzQjtBQUN0QixNQUFNLGlCQUFpQjtJQUlyQixNQUFNLENBQUMsUUFBUTtRQUNiLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUNkLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDMUMsSUFBSSxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUNyRixDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsTUFBTSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBaUMsRUFBRSxTQUFpQjtRQUM5RSxJQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7UUFDakIsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFDO1FBRXZCLE9BQU8sUUFB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QUFDO1lBQ0osQ0FBQztZQUVELEtBQUssU0FBUyxDQUFDLENBQUMsQ0FBQztnQkFDZixNQUFNLEVBQUUsTUFBTSxFQUFFLEdBQUcsS0FBSyxDQUFDO2dCQUV6QixJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7b0JBQ1osTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO2dCQUN6QyxDQUFDO2dCQUVELE1BQU0sSUFBSSxHQUFHLE1BQU0sV0FBVyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFFL0MsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO29CQUNWLE1BQU0sSUFBSSxLQUFLLENBQUMsK0JBQStCLENBQUMsQ0FBQztnQkFDbkQsQ0FBQztnQkFFRCxPQUFPO29CQUNMLFVBQVUsRUFBRSxHQUFHO29CQUNmLElBQUksRUFBRSxJQUFJO2lCQUNYLENBQUM7WUFDSixDQUFDO1lBRUQ7Z0JBQ0UsTUFBTSxJQUFJLEtBQUssQ0FBQyxzQkFBdUIsS0FBYSxDQUFDLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDdEUsQ0FBQztJQUVILENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUUzQyxNQUFNLFlBQVksR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQztRQUV2RixPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixJQUFJLEVBQUUsRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFO1NBQzlCLENBQUM7SUFDSixDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBdEZXLFFBQUEsT0FBTyxXQXNGbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUHV0Q29tbWFuZCwgR2V0Q29tbWFuZCwgUXVlcnlDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcclxuaW1wb3J0IHsgTGFtYmRhQ2xpZW50LCBJbnZva2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSc7XHJcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpO1xyXG5jb25zdCBsYW1iZGFDbGllbnQgPSBuZXcgTGFtYmRhQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5cclxuLy8gVHlwZXNcclxuaW50ZXJmYWNlIE1vdmllQ2FuZGlkYXRlIHtcclxuICBpZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgb3ZlcnZpZXc6IHN0cmluZztcclxuICBwb3N0ZXJQYXRoOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJlbGVhc2VEYXRlOiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxufVxyXG5cclxuaW50ZXJmYWNlIFJvb20ge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgY29kZTogc3RyaW5nO1xyXG4gIGhvc3RJZDogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgZ2VucmVJZHM6IG51bWJlcltdO1xyXG4gIGNhbmRpZGF0ZXM6IE1vdmllQ2FuZGlkYXRlW107XHJcbiAgY3JlYXRlZEF0OiBzdHJpbmc7XHJcbiAgdHRsOiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBDcmVhdGVSb29tRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2NyZWF0ZVJvb20nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIGlucHV0OiB7XHJcbiAgICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gICAgZ2VucmVJZHM6IG51bWJlcltdO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBKb2luUm9vbUV2ZW50IHtcclxuICBvcGVyYXRpb246ICdqb2luUm9vbSc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgY29kZTogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgR2V0Um9vbUV2ZW50IHtcclxuICBvcGVyYXRpb246ICdnZXRSb29tJztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICByb29tSWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIEdldE15Um9vbXNFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnZ2V0TXlSb29tcyc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbn1cclxuXHJcbnR5cGUgUm9vbUV2ZW50ID0gQ3JlYXRlUm9vbUV2ZW50IHwgSm9pblJvb21FdmVudCB8IEdldFJvb21FdmVudCB8IEdldE15Um9vbXNFdmVudDtcclxuXHJcbmludGVyZmFjZSBSb29tUmVzcG9uc2Uge1xyXG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcclxuICBib2R5OiBSb29tIHwgUm9vbVtdIHwgeyBlcnJvcjogc3RyaW5nIH07XHJcbn1cclxuXHJcbi8vIFJvb20gY29kZSBnZW5lcmF0b3JcclxuY2xhc3MgUm9vbUNvZGVHZW5lcmF0b3Ige1xyXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IENIQVJBQ1RFUlMgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5JztcclxuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBDT0RFX0xFTkdUSCA9IDY7XHJcblxyXG4gIHN0YXRpYyBnZW5lcmF0ZSgpOiBzdHJpbmcge1xyXG4gICAgbGV0IGNvZGUgPSAnJztcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5DT0RFX0xFTkdUSDsgaSsrKSB7XHJcbiAgICAgIGNvZGUgKz0gdGhpcy5DSEFSQUNURVJTLmNoYXJBdChNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiB0aGlzLkNIQVJBQ1RFUlMubGVuZ3RoKSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gY29kZTtcclxuICB9XHJcblxyXG4gIHN0YXRpYyBhc3luYyBnZW5lcmF0ZVVuaXF1ZShkb2NDbGllbnQ6IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIHRhYmxlTmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIGxldCBhdHRlbXB0cyA9IDA7XHJcbiAgICBjb25zdCBtYXhBdHRlbXB0cyA9IDEwO1xyXG5cclxuICAgIHdoaWxlIChhdHRlbXB0cyA8IG1heEF0dGVtcHRzKSB7XHJcbiAgICAgIGNvbnN0IGNvZGUgPSB0aGlzLmdlbmVyYXRlKCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBpZiBjb2RlIGFscmVhZHkgZXhpc3RzXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHRhYmxlTmFtZSxcclxuICAgICAgICAgIEluZGV4TmFtZTogJ2NvZGUtaW5kZXgnLFxyXG4gICAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ2NvZGUgPSA6Y29kZScsXHJcbiAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAgICc6Y29kZSc6IGNvZGUsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgaWYgKCFyZXN1bHQuSXRlbXMgfHwgcmVzdWx0Lkl0ZW1zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgcmV0dXJuIGNvZGU7IC8vIENvZGUgaXMgdW5pcXVlXHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGNvZGUgdW5pcXVlbmVzczonLCBlcnJvcik7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGF0dGVtcHRzKys7XHJcbiAgICB9XHJcblxyXG4gICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gZ2VuZXJhdGUgdW5pcXVlIHJvb20gY29kZSBhZnRlciBtYXhpbXVtIGF0dGVtcHRzJyk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBUTURCIEludGVncmF0aW9uXHJcbmNsYXNzIFRNREJJbnRlZ3JhdGlvbiB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBsYW1iZGFBcm46IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmxhbWJkYUFybiA9IHByb2Nlc3MuZW52LlRNREJfTEFNQkRBX0FSTiB8fCAnJztcclxuICAgIGlmICghdGhpcy5sYW1iZGFBcm4pIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdUTURCX0xBTUJEQV9BUk4gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGZldGNoQ2FuZGlkYXRlcyhtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnLCBnZW5yZUlkcz86IG51bWJlcltdKTogUHJvbWlzZTxNb3ZpZUNhbmRpZGF0ZVtdPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBwYXlsb2FkID0ge1xyXG4gICAgICAgIG1lZGlhVHlwZSxcclxuICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICBwYWdlOiAxLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc29sZS5sb2coJ0ludm9raW5nIFRNREIgTGFtYmRhIHdpdGggcGF5bG9hZDonLCBKU09OLnN0cmluZ2lmeShwYXlsb2FkKSk7XHJcblxyXG4gICAgICBjb25zdCBjb21tYW5kID0gbmV3IEludm9rZUNvbW1hbmQoe1xyXG4gICAgICAgIEZ1bmN0aW9uTmFtZTogdGhpcy5sYW1iZGFBcm4sXHJcbiAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChjb21tYW5kKTtcclxuICAgICAgXHJcbiAgICAgIGlmICghcmVzcG9uc2UuUGF5bG9hZCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gcmVzcG9uc2UgZnJvbSBUTURCIExhbWJkYScpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5QYXlsb2FkKSk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAocmVzdWx0LnN0YXR1c0NvZGUgIT09IDIwMCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVE1EQiBMYW1iZGEgZXJyb3I6ICR7SlNPTi5zdHJpbmdpZnkocmVzdWx0LmJvZHkpfWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gcmVzdWx0LmJvZHkuY2FuZGlkYXRlcyB8fCBbXTtcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdUTURCIEludGVncmF0aW9uIGVycm9yOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gZmV0Y2ggbW92aWUgY2FuZGlkYXRlczogJHtlcnJvcn1gKTtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbi8vIFJvb20gU2VydmljZVxyXG5jbGFzcyBSb29tU2VydmljZSB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB0YWJsZU5hbWU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHRtZGJJbnRlZ3JhdGlvbjogVE1EQkludGVncmF0aW9uO1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMudGFibGVOYW1lID0gcHJvY2Vzcy5lbnYuUk9PTVNfVEFCTEUgfHwgJyc7XHJcbiAgICBpZiAoIXRoaXMudGFibGVOYW1lKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUk9PTVNfVEFCTEUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuICAgIHRoaXMudG1kYkludGVncmF0aW9uID0gbmV3IFRNREJJbnRlZ3JhdGlvbigpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgY3JlYXRlUm9vbSh1c2VySWQ6IHN0cmluZywgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgZ2VucmVJZHM6IG51bWJlcltdKTogUHJvbWlzZTxSb29tPiB7XHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCFtZWRpYVR5cGUgfHwgIVsnTU9WSUUnLCAnVFYnXS5pbmNsdWRlcyhtZWRpYVR5cGUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBtZWRpYVR5cGUuIE11c3QgYmUgTU9WSUUgb3IgVFYnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBFbmZvcmNlIGdlbnJlIGxpbWl0IChtYXggMiBhcyBwZXIgbWFzdGVyIHNwZWMpXHJcbiAgICBpZiAoZ2VucmVJZHMubGVuZ3RoID4gMikge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ01heGltdW0gMiBnZW5yZXMgYWxsb3dlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEdlbmVyYXRlIHVuaXF1ZSByb29tIGNvZGVcclxuICAgIGNvbnN0IGNvZGUgPSBhd2FpdCBSb29tQ29kZUdlbmVyYXRvci5nZW5lcmF0ZVVuaXF1ZShkb2NDbGllbnQsIHRoaXMudGFibGVOYW1lKTtcclxuICAgIFxyXG4gICAgLy8gRmV0Y2ggbW92aWUgY2FuZGlkYXRlcyBmcm9tIFRNREJcclxuICAgIGNvbnNvbGUubG9nKGBGZXRjaGluZyAke21lZGlhVHlwZX0gY2FuZGlkYXRlcyBmb3IgZ2VucmVzOiAke2dlbnJlSWRzLmpvaW4oJywnKX1gKTtcclxuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBhd2FpdCB0aGlzLnRtZGJJbnRlZ3JhdGlvbi5mZXRjaENhbmRpZGF0ZXMobWVkaWFUeXBlLCBnZW5yZUlkcyk7XHJcbiAgICBcclxuICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICBjb25zb2xlLndhcm4oJ05vIGNhbmRpZGF0ZXMgcmV0dXJuZWQgZnJvbSBUTURCIC0gcHJvY2VlZGluZyB3aXRoIGVtcHR5IGxpc3QnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDcmVhdGUgcm9vbSByZWNvcmRcclxuICAgIGNvbnN0IHJvb21JZCA9IHJhbmRvbVVVSUQoKTtcclxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgIGNvbnN0IHR0bCA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDI0ICogNjAgKiA2MCk7IC8vIDI0IGhvdXJzIGZyb20gbm93XHJcblxyXG4gICAgY29uc3Qgcm9vbTogUm9vbSA9IHtcclxuICAgICAgaWQ6IHJvb21JZCxcclxuICAgICAgY29kZSxcclxuICAgICAgaG9zdElkOiB1c2VySWQsXHJcbiAgICAgIG1lZGlhVHlwZSxcclxuICAgICAgZ2VucmVJZHMsXHJcbiAgICAgIGNhbmRpZGF0ZXMsXHJcbiAgICAgIGNyZWF0ZWRBdDogbm93LFxyXG4gICAgICB0dGwsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFN0b3JlIGluIER5bmFtb0RCXHJcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXHJcbiAgICAgIEl0ZW06IHJvb20sXHJcbiAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfbm90X2V4aXN0cyhpZCknLCAvLyBFbnN1cmUgbm8gZHVwbGljYXRlIElEc1xyXG4gICAgfSkpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBSb29tIGNyZWF0ZWQgc3VjY2Vzc2Z1bGx5OiAke3Jvb21JZH0gd2l0aCBjb2RlOiAke2NvZGV9YCk7XHJcbiAgICByZXR1cm4gcm9vbTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGpvaW5Sb29tKHVzZXJJZDogc3RyaW5nLCBjb2RlOiBzdHJpbmcpOiBQcm9taXNlPFJvb20+IHtcclxuICAgIGlmICghY29kZSB8fCBjb2RlLnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIGNvZGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgSUQgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBRdWVyeSBieSByb29tIGNvZGUgdXNpbmcgR1NJXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgSW5kZXhOYW1lOiAnY29kZS1pbmRleCcsXHJcbiAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdjb2RlID0gOmNvZGUnLFxyXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgJzpjb2RlJzogY29kZS50b1VwcGVyQ2FzZSgpLFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIGlmICghcmVzdWx0Lkl0ZW1zIHx8IHJlc3VsdC5JdGVtcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZC4gUGxlYXNlIGNoZWNrIHRoZSByb29tIGNvZGUuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHJlc3VsdC5JdGVtcy5sZW5ndGggPiAxKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYE11bHRpcGxlIHJvb21zIGZvdW5kIGZvciBjb2RlICR7Y29kZX06YCwgcmVzdWx0Lkl0ZW1zKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNdWx0aXBsZSByb29tcyBmb3VuZCBmb3IgY29kZS4gUGxlYXNlIGNvbnRhY3Qgc3VwcG9ydC4nKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByb29tID0gcmVzdWx0Lkl0ZW1zWzBdIGFzIFJvb207XHJcblxyXG4gICAgLy8gQ2hlY2sgaWYgcm9vbSBoYXMgZXhwaXJlZFxyXG4gICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XHJcbiAgICBpZiAocm9vbS50dGwgJiYgcm9vbS50dGwgPCBub3cpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIGhhcyBleHBpcmVkLiBQbGVhc2UgY3JlYXRlIGEgbmV3IHJvb20uJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ1JJVElDQUwgRklYOiBSZWNvcmQgdXNlciBwYXJ0aWNpcGF0aW9uIHdoZW4gam9pbmluZyByb29tXHJcbiAgICAvLyBUaGlzIGVuc3VyZXMgdGhlIHJvb20gYXBwZWFycyBpbiBcIk1pcyBTYWxhc1wiIGV2ZW4gaWYgdXNlciBoYXNuJ3Qgdm90ZWQgeWV0XHJcbiAgICBhd2FpdCB0aGlzLnJlY29yZFJvb21QYXJ0aWNpcGF0aW9uKHVzZXJJZCwgcm9vbS5pZCk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGpvaW5lZCByb29tOiAke3Jvb20uaWR9IHdpdGggY29kZTogJHtjb2RlfWApO1xyXG4gICAgcmV0dXJuIHJvb207XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlY29yZFJvb21QYXJ0aWNpcGF0aW9uKHVzZXJJZDogc3RyaW5nLCByb29tSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3Qgdm90ZXNUYWJsZSA9IHByb2Nlc3MuZW52LlZPVEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgICBpZiAoIXZvdGVzVGFibGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ1ZPVEVTX1RBQkxFIG5vdCBjb25maWd1cmVkLCBza2lwcGluZyBwYXJ0aWNpcGF0aW9uIHRyYWNraW5nJyk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDcmVhdGUgYSBzcGVjaWFsIFwicGFydGljaXBhdGlvblwiIHJlY29yZCBpbiBWT1RFUyB0YWJsZVxyXG4gICAgICAvLyBUaGlzIGFsbG93cyB0aGUgcm9vbSB0byBhcHBlYXIgaW4gZ2V0TXlSb29tcygpIGV2ZW4gd2l0aG91dCBhY3R1YWwgdm90ZXNcclxuICAgICAgY29uc3QgcGFydGljaXBhdGlvblJlY29yZCA9IHtcclxuICAgICAgICByb29tSWQsXHJcbiAgICAgICAgdXNlck1vdmllSWQ6IGAke3VzZXJJZH0jSk9JTkVEYCwgLy8gU3BlY2lhbCBtYXJrZXIgZm9yIHJvb20gcGFydGljaXBhdGlvblxyXG4gICAgICAgIHVzZXJJZCxcclxuICAgICAgICBtb3ZpZUlkOiAtMSwgLy8gU3BlY2lhbCB2YWx1ZSBpbmRpY2F0aW5nIHRoaXMgaXMgYSBwYXJ0aWNpcGF0aW9uIHJlY29yZCwgbm90IGEgdm90ZVxyXG4gICAgICAgIHZvdGU6IGZhbHNlLCAvLyBOb3QgYSByZWFsIHZvdGVcclxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICBpc1BhcnRpY2lwYXRpb246IHRydWUsIC8vIEZsYWcgdG8gZGlzdGluZ3Vpc2ggZnJvbSByZWFsIHZvdGVzXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB2b3Rlc1RhYmxlLFxyXG4gICAgICAgIEl0ZW06IHBhcnRpY2lwYXRpb25SZWNvcmQsXHJcbiAgICAgICAgLy8gQWxsb3cgb3ZlcndyaXRpbmcgaWYgdXNlciBqb2lucyB0aGUgc2FtZSByb29tIG11bHRpcGxlIHRpbWVzXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBQYXJ0aWNpcGF0aW9uIHJlY29yZGVkIGZvciB1c2VyICR7dXNlcklkfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgcmVjb3JkaW5nIHBhcnRpY2lwYXRpb24gZm9yIHVzZXIgJHt1c2VySWR9IGluIHJvb20gJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgICAgLy8gRG9uJ3QgZmFpbCB0aGUgam9pbiBvcGVyYXRpb24gaWYgcGFydGljaXBhdGlvbiB0cmFja2luZyBmYWlsc1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0TXlSb29tcyh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8Um9vbVtdPiB7XHJcbiAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgSUQgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBhbGxSb29tczogUm9vbVtdID0gW107XHJcblxyXG4gICAgICAvLyAxLiBHZXQgcm9vbXMgd2hlcmUgdXNlciBpcyB0aGUgaG9zdFxyXG4gICAgICBjb25zdCBob3N0Um9vbXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudGFibGVOYW1lLFxyXG4gICAgICAgIEluZGV4TmFtZTogJ2hvc3RJZC1jcmVhdGVkQXQtaW5kZXgnLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdob3N0SWQgPSA6dXNlcklkJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIFNjYW5JbmRleEZvcndhcmQ6IGZhbHNlLCAvLyBNb3N0IHJlY2VudCBmaXJzdFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBob3N0Um9vbXMgPSBob3N0Um9vbXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIGFsbFJvb21zLnB1c2goLi4uKGhvc3RSb29tcyBhcyBSb29tW10pKTtcclxuXHJcbiAgICAgIC8vIDIuIEdldCByb29tcyB3aGVyZSB1c2VyIGhhcyBwYXJ0aWNpcGF0ZWQgKGpvaW5lZCBvciB2b3RlZClcclxuICAgICAgY29uc3Qgdm90ZXNUYWJsZSA9IHByb2Nlc3MuZW52LlZPVEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgICBpZiAodm90ZXNUYWJsZSkge1xyXG4gICAgICAgIC8vIEdldCBhbGwgcGFydGljaXBhdGlvbiByZWNvcmRzIGJ5IHRoaXMgdXNlclxyXG4gICAgICAgIGNvbnN0IHVzZXJQYXJ0aWNpcGF0aW9uUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHZvdGVzVGFibGUsXHJcbiAgICAgICAgICBJbmRleE5hbWU6ICd1c2VySWQtdGltZXN0YW1wLWluZGV4JyxcclxuICAgICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICd1c2VySWQgPSA6dXNlcklkJyxcclxuICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgY29uc3QgdXNlclBhcnRpY2lwYXRpb24gPSB1c2VyUGFydGljaXBhdGlvblJlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBHZXQgdW5pcXVlIHJvb20gSURzIGZyb20gcGFydGljaXBhdGlvbiByZWNvcmRzIChib3RoIHZvdGVzIGFuZCBqb2lucylcclxuICAgICAgICBjb25zdCBwYXJ0aWNpcGF0ZWRSb29tSWRzID0gbmV3IFNldCh1c2VyUGFydGljaXBhdGlvbi5tYXAocmVjb3JkID0+IHJlY29yZC5yb29tSWQpKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBHZXQgcm9vbSBkZXRhaWxzIGZvciBwYXJ0aWNpcGF0ZWQgcm9vbXMgKGV4Y2x1ZGluZyBhbHJlYWR5IGZldGNoZWQgaG9zdCByb29tcylcclxuICAgICAgICBjb25zdCBob3N0Um9vbUlkcyA9IG5ldyBTZXQoaG9zdFJvb21zLm1hcChyb29tID0+IHJvb20uaWQpKTtcclxuICAgICAgICBjb25zdCBuZXdSb29tSWRzID0gQXJyYXkuZnJvbShwYXJ0aWNpcGF0ZWRSb29tSWRzKS5maWx0ZXIocm9vbUlkID0+ICFob3N0Um9vbUlkcy5oYXMocm9vbUlkKSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gRmV0Y2ggcm9vbSBkZXRhaWxzIGZvciBwYXJ0aWNpcGF0ZWQgcm9vbXNcclxuICAgICAgICBjb25zdCBwYXJ0aWNpcGF0ZWRSb29tc1Byb21pc2VzID0gbmV3Um9vbUlkcy5tYXAoYXN5bmMgKHJvb21JZCkgPT4ge1xyXG4gICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3Qgcm9vbVJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMudGFibGVOYW1lLFxyXG4gICAgICAgICAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICAgICAgICAgIH0pKTtcclxuICAgICAgICAgICAgcmV0dXJuIHJvb21SZXN1bHQuSXRlbSBhcyBSb29tO1xyXG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZmV0Y2hpbmcgcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uc3QgcGFydGljaXBhdGVkUm9vbXMgPSAoYXdhaXQgUHJvbWlzZS5hbGwocGFydGljaXBhdGVkUm9vbXNQcm9taXNlcykpXHJcbiAgICAgICAgICAuZmlsdGVyKHJvb20gPT4gcm9vbSAhPT0gbnVsbCkgYXMgUm9vbVtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGFsbFJvb21zLnB1c2goLi4ucGFydGljaXBhdGVkUm9vbXMpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyAzLiBGaWx0ZXIgb3V0IGV4cGlyZWQgcm9vbXMgYW5kIHJvb21zIHdpdGggbWF0Y2hlc1xyXG4gICAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgICAgY29uc3QgYWN0aXZlUm9vbXMgPSBhbGxSb29tcy5maWx0ZXIocm9vbSA9PiAhcm9vbS50dGwgfHwgcm9vbS50dGwgPj0gbm93KTtcclxuXHJcbiAgICAgIC8vIDQuIENoZWNrIGZvciBtYXRjaGVzIGFuZCBmaWx0ZXIgb3V0IHJvb21zIHdpdGggbWF0Y2hlc1xyXG4gICAgICBjb25zdCBtYXRjaGVzVGFibGUgPSBwcm9jZXNzLmVudi5NQVRDSEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgICBpZiAobWF0Y2hlc1RhYmxlKSB7XHJcbiAgICAgICAgY29uc3Qgcm9vbXNXaXRob3V0TWF0Y2hlcyA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZvciAoY29uc3Qgcm9vbSBvZiBhY3RpdmVSb29tcykge1xyXG4gICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcm9vbSBoYXMgYW55IG1hdGNoZXNcclxuICAgICAgICAgICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICAgICAgICBUYWJsZU5hbWU6IG1hdGNoZXNUYWJsZSxcclxuICAgICAgICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgICAgICAgJzpyb29tSWQnOiByb29tLmlkLFxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgTGltaXQ6IDEsIC8vIFdlIG9ubHkgbmVlZCB0byBrbm93IGlmIGFueSBtYXRjaCBleGlzdHNcclxuICAgICAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICAgICAgLy8gSWYgbm8gbWF0Y2hlcyBmb3VuZCwgaW5jbHVkZSB0aGUgcm9vbVxyXG4gICAgICAgICAgICBpZiAoIW1hdGNoUmVzdWx0Lkl0ZW1zIHx8IG1hdGNoUmVzdWx0Lkl0ZW1zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgIHJvb21zV2l0aG91dE1hdGNoZXMucHVzaChyb29tKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgY2hlY2tpbmcgbWF0Y2hlcyBmb3Igcm9vbSAke3Jvb20uaWR9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgLy8gSW5jbHVkZSByb29tIGlmIHdlIGNhbid0IGNoZWNrIG1hdGNoZXMgKGZhaWwgc2FmZSlcclxuICAgICAgICAgICAgcm9vbXNXaXRob3V0TWF0Y2hlcy5wdXNoKHJvb20pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7cm9vbXNXaXRob3V0TWF0Y2hlcy5sZW5ndGh9IGFjdGl2ZSByb29tcyB3aXRob3V0IG1hdGNoZXMgZm9yIHVzZXIgJHt1c2VySWR9YCk7XHJcbiAgICAgICAgcmV0dXJuIHJvb21zV2l0aG91dE1hdGNoZXMuc29ydCgoYSwgYikgPT4gbmV3IERhdGUoYi5jcmVhdGVkQXQpLmdldFRpbWUoKSAtIG5ldyBEYXRlKGEuY3JlYXRlZEF0KS5nZXRUaW1lKCkpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHthY3RpdmVSb29tcy5sZW5ndGh9IGFjdGl2ZSByb29tcyBmb3IgdXNlciAke3VzZXJJZH1gKTtcclxuICAgICAgcmV0dXJuIGFjdGl2ZVJvb21zLnNvcnQoKGEsIGIpID0+IG5ldyBEYXRlKGIuY3JlYXRlZEF0KS5nZXRUaW1lKCkgLSBuZXcgRGF0ZShhLmNyZWF0ZWRBdCkuZ2V0VGltZSgpKTtcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBmZXRjaGluZyB1c2VyIHJvb21zOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gZmV0Y2ggdXNlciByb29tcycpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0Um9vbShyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8Um9vbSB8IG51bGw+IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgS2V5OiB7IGlkOiByb29tSWQgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdC5JdGVtKSB7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJvb20gPSByZXN1bHQuSXRlbSBhcyBSb29tO1xyXG5cclxuICAgIC8vIENoZWNrIGlmIHJvb20gaGFzIGV4cGlyZWRcclxuICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xyXG4gICAgaWYgKHJvb20udHRsICYmIHJvb20udHRsIDwgbm93KSB7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByb29tO1xyXG4gIH1cclxufVxyXG5cclxuLy8gTGFtYmRhIEhhbmRsZXJcclxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXI8Um9vbUV2ZW50LCBSb29tUmVzcG9uc2U+ID0gYXN5bmMgKGV2ZW50KSA9PiB7XHJcbiAgY29uc29sZS5sb2coJ1Jvb20gTGFtYmRhIHJlY2VpdmVkIGV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCByb29tU2VydmljZSA9IG5ldyBSb29tU2VydmljZSgpO1xyXG5cclxuICAgIHN3aXRjaCAoZXZlbnQub3BlcmF0aW9uKSB7XHJcbiAgICAgIGNhc2UgJ2NyZWF0ZVJvb20nOiB7XHJcbiAgICAgICAgY29uc3QgeyB1c2VySWQsIGlucHV0IH0gPSBldmVudDtcclxuICAgICAgICBjb25zdCB7IG1lZGlhVHlwZSwgZ2VucmVJZHMgfSA9IGlucHV0O1xyXG5cclxuICAgICAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCByb29tID0gYXdhaXQgcm9vbVNlcnZpY2UuY3JlYXRlUm9vbSh1c2VySWQsIG1lZGlhVHlwZSwgZ2VucmVJZHMpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgICBib2R5OiByb29tLFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2pvaW5Sb29tJzoge1xyXG4gICAgICAgIGNvbnN0IHsgdXNlcklkLCBjb2RlIH0gPSBldmVudDtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IHJvb20gPSBhd2FpdCByb29tU2VydmljZS5qb2luUm9vbSh1c2VySWQsIGNvZGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgICBib2R5OiByb29tLFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2dldE15Um9vbXMnOiB7XHJcbiAgICAgICAgY29uc3QgeyB1c2VySWQgfSA9IGV2ZW50O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghdXNlcklkKSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgSUQgaXMgcmVxdWlyZWQnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IHJvb21zID0gYXdhaXQgcm9vbVNlcnZpY2UuZ2V0TXlSb29tcyh1c2VySWQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgICBib2R5OiByb29tcyxcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdnZXRSb29tJzoge1xyXG4gICAgICAgIGNvbnN0IHsgcm9vbUlkIH0gPSBldmVudDtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXJvb21JZCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCByb29tID0gYXdhaXQgcm9vbVNlcnZpY2UuZ2V0Um9vbShyb29tSWQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghcm9vbSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZCBvciBoYXMgZXhwaXJlZCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgICAgYm9keTogcm9vbSxcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBkZWZhdWx0OlxyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvcGVyYXRpb246ICR7KGV2ZW50IGFzIGFueSkub3BlcmF0aW9ufWApO1xyXG4gICAgfVxyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignUm9vbSBMYW1iZGEgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgXHJcbiAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yIG9jY3VycmVkJztcclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICBib2R5OiB7IGVycm9yOiBlcnJvck1lc3NhZ2UgfSxcclxuICAgIH07XHJcbiAgfVxyXG59OyJdfQ==