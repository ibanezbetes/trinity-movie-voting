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
                // Note: page parameter removed - Smart Random Discovery handles pagination internally
            };
            console.log('Invoking TMDB Lambda with Smart Random Discovery payload:', JSON.stringify(payload));
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
            const candidates = result.body.candidates || [];
            console.log(`Smart Random Discovery returned ${candidates.length} candidates`);
            return candidates;
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
    async createRoom(userId, mediaType, genreIds, maxParticipants) {
        // Validate input
        if (!mediaType || !['MOVIE', 'TV'].includes(mediaType)) {
            throw new Error('Invalid mediaType. Must be MOVIE or TV');
        }
        // Validate maxParticipants
        if (!maxParticipants || typeof maxParticipants !== 'number') {
            throw new Error('maxParticipants is required and must be a number');
        }
        if (maxParticipants < 2 || maxParticipants > 6) {
            throw new Error('maxParticipants must be between 2 and 6');
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
            maxParticipants,
        };
        // Store in DynamoDB
        await docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: this.tableName,
            Item: room,
            ConditionExpression: 'attribute_not_exists(id)', // Ensure no duplicate IDs
        }));
        // Record user participation when creating room (host automatically participates)
        await this.recordRoomParticipation(userId, roomId);
        console.log(`Room created successfully: ${roomId} with code: ${code}, maxParticipants: ${maxParticipants}`);
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
            // Record user participation when joining room
            await this.recordRoomParticipation(userId, room.id);
            console.log(`User ${userId} joined room: ${room.id} with code: ${code}`);
            return room;
        }
        catch (error) {
            // Fallback to scan if GSI is not available yet
            console.log('GSI not available, falling back to scan method');
            return await this.joinRoomByScan(userId, code);
        }
    }
    async joinRoomByScan(userId, code) {
        // Fallback method using scan
        const result = await docClient.send(new lib_dynamodb_1.ScanCommand({
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
        // Record user participation when joining room
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
            console.error('getMyRooms called without userId');
            return []; // Return empty array instead of throwing
        }
        try {
            console.log(`Getting rooms for user: ${userId}`);
            const allRooms = [];
            // 1. Get rooms where user is the host - use scan for now since GSI might not be ready
            try {
                const hostRoomsResult = await docClient.send(new lib_dynamodb_1.ScanCommand({
                    TableName: this.tableName,
                    FilterExpression: 'hostId = :userId',
                    ExpressionAttributeValues: {
                        ':userId': userId,
                    },
                }));
                const hostRooms = hostRoomsResult.Items || [];
                console.log(`Found ${hostRooms.length} rooms where user is host`);
                allRooms.push(...hostRooms);
            }
            catch (error) {
                console.error('Error fetching host rooms:', error);
                // Continue with empty host rooms
            }
            // 2. Get rooms where user has participated (joined or voted)
            const votesTable = process.env.VOTES_TABLE || '';
            if (votesTable) {
                try {
                    // Get all participation records by this user - use scan for now
                    const userParticipationResult = await docClient.send(new lib_dynamodb_1.ScanCommand({
                        TableName: votesTable,
                        FilterExpression: 'userId = :userId',
                        ExpressionAttributeValues: {
                            ':userId': userId,
                        },
                    }));
                    const userParticipation = userParticipationResult.Items || [];
                    console.log(`Found ${userParticipation.length} participation records for user`);
                    // Get unique room IDs from participation records (both votes and joins)
                    const participatedRoomIds = new Set(userParticipation.map(record => record.roomId));
                    // Get room details for participated rooms (excluding already fetched host rooms)
                    const hostRoomIds = new Set(allRooms.map(room => room.id));
                    const newRoomIds = Array.from(participatedRoomIds).filter(roomId => !hostRoomIds.has(roomId));
                    console.log(`Found ${newRoomIds.length} additional rooms where user participated`);
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
                catch (error) {
                    console.error('Error fetching participated rooms:', error);
                    // Continue with only host rooms
                }
            }
            else {
                console.warn('VOTES_TABLE not configured, only showing hosted rooms');
            }
            // 3. Filter out expired rooms and rooms with matches
            const now = Math.floor(Date.now() / 1000);
            const activeRooms = allRooms.filter(room => !room.ttl || room.ttl >= now);
            console.log(`Found ${activeRooms.length} active rooms after filtering expired`);
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
                        else {
                            console.log(`Room ${room.id} has matches, excluding from results`);
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
            console.log(`Found ${activeRooms.length} active rooms for user ${userId} (matches table not configured)`);
            return activeRooms.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }
        catch (error) {
            console.error('Error fetching user rooms:', error);
            // Return empty array instead of throwing to prevent GraphQL null error
            return [];
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
// Lambda Handler for AppSync
const handler = async (event) => {
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
                const { mediaType, genreIds, maxParticipants } = input;
                const room = await roomService.createRoom(userId, mediaType, genreIds, maxParticipants);
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
                try {
                    const rooms = await roomService.getMyRooms(userId);
                    console.log(`Returning ${rooms.length} rooms for user ${userId}`);
                    return rooms;
                }
                catch (error) {
                    console.error('Error in getMyRooms handler:', error);
                    // Return empty array to prevent GraphQL null error
                    return [];
                }
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
    }
    catch (error) {
        console.error('Room Lambda error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        throw new Error(errorMessage);
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvcm9vbS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQWtIO0FBQ2xILDBEQUFxRTtBQUNyRSxtQ0FBb0M7QUFFcEMseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUEwRDFFLHNCQUFzQjtBQUN0QixNQUFNLGlCQUFpQjtJQUlyQixNQUFNLENBQUMsUUFBUTtRQUNiLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUNkLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDMUMsSUFBSSxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUNyRixDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsTUFBTSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBaUMsRUFBRSxTQUFpQjtRQUM5RSxJQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7UUFDakIsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFDO1FBRXZCLE9BQU8sUUFB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QUMscUJBQXFCLEVBQUUsU0FBUyxDQUFDLENBQUM7Z0JBQ2hELE9BQU8sQ0FBQyxLQUFLLENBQUMsNkJBQTZCLEVBQUUsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO2dCQUNqRSxPQUFPLENBQUMsS0FBSyxDQUFDLGFBQWEsRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ3pDLE1BQU0sSUFBSSxLQUFLLENBQUMsa0JBQWtCLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDbkQsQ0FBQztJQUVILENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUUzQyxNQUFNLFlBQVksR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQztRQUN2RixNQUFNLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQ2hDLENBQUM7QUFDSCxDQUFDLENBQUM7QUF2RVcsUUFBQSxPQUFPLFdBdUVsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBQdXRDb21tYW5kLCBHZXRDb21tYW5kLCBRdWVyeUNvbW1hbmQsIFNjYW5Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcclxuaW1wb3J0IHsgTGFtYmRhQ2xpZW50LCBJbnZva2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSc7XHJcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpO1xyXG5jb25zdCBsYW1iZGFDbGllbnQgPSBuZXcgTGFtYmRhQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5cclxuLy8gVHlwZXNcclxuaW50ZXJmYWNlIE1vdmllQ2FuZGlkYXRlIHtcclxuICBpZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgb3ZlcnZpZXc6IHN0cmluZztcclxuICBwb3N0ZXJQYXRoOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJlbGVhc2VEYXRlOiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxufVxyXG5cclxuaW50ZXJmYWNlIFJvb20ge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgY29kZTogc3RyaW5nO1xyXG4gIGhvc3RJZDogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgZ2VucmVJZHM6IG51bWJlcltdO1xyXG4gIGNhbmRpZGF0ZXM6IE1vdmllQ2FuZGlkYXRlW107XHJcbiAgY3JlYXRlZEF0OiBzdHJpbmc7XHJcbiAgdHRsOiBudW1iZXI7XHJcbiAgbWF4UGFydGljaXBhbnRzOiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBDcmVhdGVSb29tRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2NyZWF0ZVJvb20nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIGlucHV0OiB7XHJcbiAgICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gICAgZ2VucmVJZHM6IG51bWJlcltdO1xyXG4gICAgbWF4UGFydGljaXBhbnRzOiBudW1iZXI7XHJcbiAgfTtcclxufVxyXG5cclxuaW50ZXJmYWNlIEpvaW5Sb29tRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2pvaW5Sb29tJztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICBjb2RlOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBHZXRSb29tRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2dldFJvb20nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIHJvb21JZDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgR2V0TXlSb29tc0V2ZW50IHtcclxuICBvcGVyYXRpb246ICdnZXRNeVJvb21zJztcclxuICB1c2VySWQ6IHN0cmluZztcclxufVxyXG5cclxudHlwZSBSb29tRXZlbnQgPSBDcmVhdGVSb29tRXZlbnQgfCBKb2luUm9vbUV2ZW50IHwgR2V0Um9vbUV2ZW50IHwgR2V0TXlSb29tc0V2ZW50O1xyXG5cclxuaW50ZXJmYWNlIFJvb21SZXNwb25zZSB7XHJcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xyXG4gIGJvZHk6IFJvb20gfCBSb29tW10gfCB7IGVycm9yOiBzdHJpbmcgfTtcclxufVxyXG5cclxuLy8gUm9vbSBjb2RlIGdlbmVyYXRvclxyXG5jbGFzcyBSb29tQ29kZUdlbmVyYXRvciB7XHJcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgQ0hBUkFDVEVSUyA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWjAxMjM0NTY3ODknO1xyXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IENPREVfTEVOR1RIID0gNjtcclxuXHJcbiAgc3RhdGljIGdlbmVyYXRlKCk6IHN0cmluZyB7XHJcbiAgICBsZXQgY29kZSA9ICcnO1xyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLkNPREVfTEVOR1RIOyBpKyspIHtcclxuICAgICAgY29kZSArPSB0aGlzLkNIQVJBQ1RFUlMuY2hhckF0KE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIHRoaXMuQ0hBUkFDVEVSUy5sZW5ndGgpKTtcclxuICAgIH1cclxuICAgIHJldHVybiBjb2RlO1xyXG4gIH1cclxuXHJcbiAgc3RhdGljIGFzeW5jIGdlbmVyYXRlVW5pcXVlKGRvY0NsaWVudDogRHluYW1vREJEb2N1bWVudENsaWVudCwgdGFibGVOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xyXG4gICAgbGV0IGF0dGVtcHRzID0gMDtcclxuICAgIGNvbnN0IG1heEF0dGVtcHRzID0gMTA7XHJcblxyXG4gICAgd2hpbGUgKGF0dGVtcHRzIDwgbWF4QXR0ZW1wdHMpIHtcclxuICAgICAgY29uc3QgY29kZSA9IHRoaXMuZ2VuZXJhdGUoKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGlmIGNvZGUgYWxyZWFkeSBleGlzdHNcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICAgIFRhYmxlTmFtZTogdGFibGVOYW1lLFxyXG4gICAgICAgICAgSW5kZXhOYW1lOiAnY29kZS1pbmRleCcsXHJcbiAgICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAnY29kZSA9IDpjb2RlJyxcclxuICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICAgJzpjb2RlJzogY29kZSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICBpZiAoIXJlc3VsdC5JdGVtcyB8fCByZXN1bHQuSXRlbXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICByZXR1cm4gY29kZTsgLy8gQ29kZSBpcyB1bmlxdWVcclxuICAgICAgICB9XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgY2hlY2tpbmcgY29kZSB1bmlxdWVuZXNzOicsIGVycm9yKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgYXR0ZW1wdHMrKztcclxuICAgIH1cclxuXHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBnZW5lcmF0ZSB1bmlxdWUgcm9vbSBjb2RlIGFmdGVyIG1heGltdW0gYXR0ZW1wdHMnKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIFRNREIgSW50ZWdyYXRpb25cclxuY2xhc3MgVE1EQkludGVncmF0aW9uIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IGxhbWJkYUFybjogc3RyaW5nO1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMubGFtYmRhQXJuID0gcHJvY2Vzcy5lbnYuVE1EQl9MQU1CREFfQVJOIHx8ICcnO1xyXG4gICAgaWYgKCF0aGlzLmxhbWJkYUFybikge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RNREJfTEFNQkRBX0FSTiBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgZmV0Y2hDYW5kaWRhdGVzKG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVicsIGdlbnJlSWRzPzogbnVtYmVyW10pOiBQcm9taXNlPE1vdmllQ2FuZGlkYXRlW10+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICAgICAgbWVkaWFUeXBlLFxyXG4gICAgICAgIGdlbnJlSWRzLFxyXG4gICAgICAgIC8vIE5vdGU6IHBhZ2UgcGFyYW1ldGVyIHJlbW92ZWQgLSBTbWFydCBSYW5kb20gRGlzY292ZXJ5IGhhbmRsZXMgcGFnaW5hdGlvbiBpbnRlcm5hbGx5XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zb2xlLmxvZygnSW52b2tpbmcgVE1EQiBMYW1iZGEgd2l0aCBTbWFydCBSYW5kb20gRGlzY292ZXJ5IHBheWxvYWQ6JywgSlNPTi5zdHJpbmdpZnkocGF5bG9hZCkpO1xyXG5cclxuICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcclxuICAgICAgICBGdW5jdGlvbk5hbWU6IHRoaXMubGFtYmRhQXJuLFxyXG4gICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQoY29tbWFuZCk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoIXJlc3BvbnNlLlBheWxvYWQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIHJlc3BvbnNlIGZyb20gVE1EQiBMYW1iZGEnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocmVzcG9uc2UuUGF5bG9hZCkpO1xyXG4gICAgICBcclxuICAgICAgaWYgKHJlc3VsdC5zdGF0dXNDb2RlICE9PSAyMDApIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRNREIgTGFtYmRhIGVycm9yOiAke0pTT04uc3RyaW5naWZ5KHJlc3VsdC5ib2R5KX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IHJlc3VsdC5ib2R5LmNhbmRpZGF0ZXMgfHwgW107XHJcbiAgICAgIGNvbnNvbGUubG9nKGBTbWFydCBSYW5kb20gRGlzY292ZXJ5IHJldHVybmVkICR7Y2FuZGlkYXRlcy5sZW5ndGh9IGNhbmRpZGF0ZXNgKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiBjYW5kaWRhdGVzO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1RNREIgSW50ZWdyYXRpb24gZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBmZXRjaCBtb3ZpZSBjYW5kaWRhdGVzOiAke2Vycm9yfWApO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuLy8gUm9vbSBTZXJ2aWNlXHJcbmNsYXNzIFJvb21TZXJ2aWNlIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IHRhYmxlTmFtZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgdG1kYkludGVncmF0aW9uOiBUTURCSW50ZWdyYXRpb247XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy50YWJsZU5hbWUgPSBwcm9jZXNzLmVudi5ST09NU19UQUJMRSB8fCAnJztcclxuICAgIGlmICghdGhpcy50YWJsZU5hbWUpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdST09NU19UQUJMRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG4gICAgdGhpcy50bWRiSW50ZWdyYXRpb24gPSBuZXcgVE1EQkludGVncmF0aW9uKCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBjcmVhdGVSb29tKHVzZXJJZDogc3RyaW5nLCBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnLCBnZW5yZUlkczogbnVtYmVyW10sIG1heFBhcnRpY2lwYW50czogbnVtYmVyKTogUHJvbWlzZTxSb29tPiB7XHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCFtZWRpYVR5cGUgfHwgIVsnTU9WSUUnLCAnVFYnXS5pbmNsdWRlcyhtZWRpYVR5cGUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBtZWRpYVR5cGUuIE11c3QgYmUgTU9WSUUgb3IgVFYnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBtYXhQYXJ0aWNpcGFudHNcclxuICAgIGlmICghbWF4UGFydGljaXBhbnRzIHx8IHR5cGVvZiBtYXhQYXJ0aWNpcGFudHMgIT09ICdudW1iZXInKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignbWF4UGFydGljaXBhbnRzIGlzIHJlcXVpcmVkIGFuZCBtdXN0IGJlIGEgbnVtYmVyJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1heFBhcnRpY2lwYW50cyA8IDIgfHwgbWF4UGFydGljaXBhbnRzID4gNikge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ21heFBhcnRpY2lwYW50cyBtdXN0IGJlIGJldHdlZW4gMiBhbmQgNicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEVuZm9yY2UgZ2VucmUgbGltaXQgKG1heCAyIGFzIHBlciBtYXN0ZXIgc3BlYylcclxuICAgIGlmIChnZW5yZUlkcy5sZW5ndGggPiAyKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTWF4aW11bSAyIGdlbnJlcyBhbGxvd2VkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2VuZXJhdGUgdW5pcXVlIHJvb20gY29kZVxyXG4gICAgY29uc3QgY29kZSA9IGF3YWl0IFJvb21Db2RlR2VuZXJhdG9yLmdlbmVyYXRlVW5pcXVlKGRvY0NsaWVudCwgdGhpcy50YWJsZU5hbWUpO1xyXG4gICAgXHJcbiAgICAvLyBGZXRjaCBtb3ZpZSBjYW5kaWRhdGVzIGZyb20gVE1EQlxyXG4gICAgY29uc29sZS5sb2coYEZldGNoaW5nICR7bWVkaWFUeXBlfSBjYW5kaWRhdGVzIGZvciBnZW5yZXM6ICR7Z2VucmVJZHMuam9pbignLCcpfWApO1xyXG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGF3YWl0IHRoaXMudG1kYkludGVncmF0aW9uLmZldGNoQ2FuZGlkYXRlcyhtZWRpYVR5cGUsIGdlbnJlSWRzKTtcclxuICAgIFxyXG4gICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIGNvbnNvbGUud2FybignTm8gY2FuZGlkYXRlcyByZXR1cm5lZCBmcm9tIFRNREIgLSBwcm9jZWVkaW5nIHdpdGggZW1wdHkgbGlzdCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENyZWF0ZSByb29tIHJlY29yZFxyXG4gICAgY29uc3Qgcm9vbUlkID0gcmFuZG9tVVVJRCgpO1xyXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG4gICAgY29uc3QgdHRsID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgKyAoMjQgKiA2MCAqIDYwKTsgLy8gMjQgaG91cnMgZnJvbSBub3dcclxuXHJcbiAgICBjb25zdCByb29tOiBSb29tID0ge1xyXG4gICAgICBpZDogcm9vbUlkLFxyXG4gICAgICBjb2RlLFxyXG4gICAgICBob3N0SWQ6IHVzZXJJZCxcclxuICAgICAgbWVkaWFUeXBlLFxyXG4gICAgICBnZW5yZUlkcyxcclxuICAgICAgY2FuZGlkYXRlcyxcclxuICAgICAgY3JlYXRlZEF0OiBub3csXHJcbiAgICAgIHR0bCxcclxuICAgICAgbWF4UGFydGljaXBhbnRzLFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBTdG9yZSBpbiBEeW5hbW9EQlxyXG4gICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHRoaXMudGFibGVOYW1lLFxyXG4gICAgICBJdGVtOiByb29tLFxyXG4gICAgICBDb25kaXRpb25FeHByZXNzaW9uOiAnYXR0cmlidXRlX25vdF9leGlzdHMoaWQpJywgLy8gRW5zdXJlIG5vIGR1cGxpY2F0ZSBJRHNcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBSZWNvcmQgdXNlciBwYXJ0aWNpcGF0aW9uIHdoZW4gY3JlYXRpbmcgcm9vbSAoaG9zdCBhdXRvbWF0aWNhbGx5IHBhcnRpY2lwYXRlcylcclxuICAgIGF3YWl0IHRoaXMucmVjb3JkUm9vbVBhcnRpY2lwYXRpb24odXNlcklkLCByb29tSWQpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBSb29tIGNyZWF0ZWQgc3VjY2Vzc2Z1bGx5OiAke3Jvb21JZH0gd2l0aCBjb2RlOiAke2NvZGV9LCBtYXhQYXJ0aWNpcGFudHM6ICR7bWF4UGFydGljaXBhbnRzfWApO1xyXG4gICAgcmV0dXJuIHJvb207XHJcbiAgfVxyXG5cclxuICBhc3luYyBqb2luUm9vbSh1c2VySWQ6IHN0cmluZywgY29kZTogc3RyaW5nKTogUHJvbWlzZTxSb29tPiB7XHJcbiAgICBpZiAoIWNvZGUgfHwgY29kZS50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBjb2RlIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gUXVlcnkgYnkgcm9vbSBjb2RlIHVzaW5nIEdTSVxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudGFibGVOYW1lLFxyXG4gICAgICAgIEluZGV4TmFtZTogJ2NvZGUtaW5kZXgnLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdjb2RlID0gOmNvZGUnLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6Y29kZSc6IGNvZGUudG9VcHBlckNhc2UoKSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBpZiAoIXJlc3VsdC5JdGVtcyB8fCByZXN1bHQuSXRlbXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZC4gUGxlYXNlIGNoZWNrIHRoZSByb29tIGNvZGUuJyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChyZXN1bHQuSXRlbXMubGVuZ3RoID4gMSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYE11bHRpcGxlIHJvb21zIGZvdW5kIGZvciBjb2RlICR7Y29kZX06YCwgcmVzdWx0Lkl0ZW1zKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ011bHRpcGxlIHJvb21zIGZvdW5kIGZvciBjb2RlLiBQbGVhc2UgY29udGFjdCBzdXBwb3J0LicpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCByb29tID0gcmVzdWx0Lkl0ZW1zWzBdIGFzIFJvb207XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiByb29tIGhhcyBleHBpcmVkXHJcbiAgICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xyXG4gICAgICBpZiAocm9vbS50dGwgJiYgcm9vbS50dGwgPCBub3cpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gaGFzIGV4cGlyZWQuIFBsZWFzZSBjcmVhdGUgYSBuZXcgcm9vbS4nKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gUmVjb3JkIHVzZXIgcGFydGljaXBhdGlvbiB3aGVuIGpvaW5pbmcgcm9vbVxyXG4gICAgICBhd2FpdCB0aGlzLnJlY29yZFJvb21QYXJ0aWNpcGF0aW9uKHVzZXJJZCwgcm9vbS5pZCk7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gam9pbmVkIHJvb206ICR7cm9vbS5pZH0gd2l0aCBjb2RlOiAke2NvZGV9YCk7XHJcbiAgICAgIHJldHVybiByb29tO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgLy8gRmFsbGJhY2sgdG8gc2NhbiBpZiBHU0kgaXMgbm90IGF2YWlsYWJsZSB5ZXRcclxuICAgICAgY29uc29sZS5sb2coJ0dTSSBub3QgYXZhaWxhYmxlLCBmYWxsaW5nIGJhY2sgdG8gc2NhbiBtZXRob2QnKTtcclxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuam9pblJvb21CeVNjYW4odXNlcklkLCBjb2RlKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgam9pblJvb21CeVNjYW4odXNlcklkOiBzdHJpbmcsIGNvZGU6IHN0cmluZyk6IFByb21pc2U8Um9vbT4ge1xyXG4gICAgLy8gRmFsbGJhY2sgbWV0aG9kIHVzaW5nIHNjYW5cclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBTY2FuQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXHJcbiAgICAgIEZpbHRlckV4cHJlc3Npb246ICdjb2RlID0gOmNvZGUnLFxyXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgJzpjb2RlJzogY29kZS50b1VwcGVyQ2FzZSgpLFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIGlmICghcmVzdWx0Lkl0ZW1zIHx8IHJlc3VsdC5JdGVtcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZC4gUGxlYXNlIGNoZWNrIHRoZSByb29tIGNvZGUuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgcm9vbSA9IHJlc3VsdC5JdGVtc1swXSBhcyBSb29tO1xyXG5cclxuICAgIC8vIENoZWNrIGlmIHJvb20gaGFzIGV4cGlyZWRcclxuICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xyXG4gICAgaWYgKHJvb20udHRsICYmIHJvb20udHRsIDwgbm93KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBoYXMgZXhwaXJlZC4gUGxlYXNlIGNyZWF0ZSBhIG5ldyByb29tLicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlY29yZCB1c2VyIHBhcnRpY2lwYXRpb24gd2hlbiBqb2luaW5nIHJvb21cclxuICAgIGF3YWl0IHRoaXMucmVjb3JkUm9vbVBhcnRpY2lwYXRpb24odXNlcklkLCByb29tLmlkKTtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gam9pbmVkIHJvb206ICR7cm9vbS5pZH0gd2l0aCBjb2RlOiAke2NvZGV9IChzY2FuIG1ldGhvZClgKTtcclxuICAgIHJldHVybiByb29tO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZWNvcmRSb29tUGFydGljaXBhdGlvbih1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHZvdGVzVGFibGUgPSBwcm9jZXNzLmVudi5WT1RFU19UQUJMRSB8fCAnJztcclxuICAgICAgaWYgKCF2b3Rlc1RhYmxlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdWT1RFU19UQUJMRSBub3QgY29uZmlndXJlZCwgc2tpcHBpbmcgcGFydGljaXBhdGlvbiB0cmFja2luZycpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gQ3JlYXRlIGEgc3BlY2lhbCBcInBhcnRpY2lwYXRpb25cIiByZWNvcmQgaW4gVk9URVMgdGFibGVcclxuICAgICAgLy8gVGhpcyBhbGxvd3MgdGhlIHJvb20gdG8gYXBwZWFyIGluIGdldE15Um9vbXMoKSBldmVuIHdpdGhvdXQgYWN0dWFsIHZvdGVzXHJcbiAgICAgIGNvbnN0IHBhcnRpY2lwYXRpb25SZWNvcmQgPSB7XHJcbiAgICAgICAgcm9vbUlkLFxyXG4gICAgICAgIHVzZXJNb3ZpZUlkOiBgJHt1c2VySWR9I0pPSU5FRGAsIC8vIFNwZWNpYWwgbWFya2VyIGZvciByb29tIHBhcnRpY2lwYXRpb25cclxuICAgICAgICB1c2VySWQsXHJcbiAgICAgICAgbW92aWVJZDogLTEsIC8vIFNwZWNpYWwgdmFsdWUgaW5kaWNhdGluZyB0aGlzIGlzIGEgcGFydGljaXBhdGlvbiByZWNvcmQsIG5vdCBhIHZvdGVcclxuICAgICAgICB2b3RlOiBmYWxzZSwgLy8gTm90IGEgcmVhbCB2b3RlXHJcbiAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgaXNQYXJ0aWNpcGF0aW9uOiB0cnVlLCAvLyBGbGFnIHRvIGRpc3Rpbmd1aXNoIGZyb20gcmVhbCB2b3Rlc1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdm90ZXNUYWJsZSxcclxuICAgICAgICBJdGVtOiBwYXJ0aWNpcGF0aW9uUmVjb3JkLFxyXG4gICAgICAgIC8vIEFsbG93IG92ZXJ3cml0aW5nIGlmIHVzZXIgam9pbnMgdGhlIHNhbWUgcm9vbSBtdWx0aXBsZSB0aW1lc1xyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgUGFydGljaXBhdGlvbiByZWNvcmRlZCBmb3IgdXNlciAke3VzZXJJZH0gaW4gcm9vbSAke3Jvb21JZH1gKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHJlY29yZGluZyBwYXJ0aWNpcGF0aW9uIGZvciB1c2VyICR7dXNlcklkfSBpbiByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgIC8vIERvbid0IGZhaWwgdGhlIGpvaW4gb3BlcmF0aW9uIGlmIHBhcnRpY2lwYXRpb24gdHJhY2tpbmcgZmFpbHNcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGdldE15Um9vbXModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPFJvb21bXT4ge1xyXG4gICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignZ2V0TXlSb29tcyBjYWxsZWQgd2l0aG91dCB1c2VySWQnKTtcclxuICAgICAgcmV0dXJuIFtdOyAvLyBSZXR1cm4gZW1wdHkgYXJyYXkgaW5zdGVhZCBvZiB0aHJvd2luZ1xyXG4gICAgfVxyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBHZXR0aW5nIHJvb21zIGZvciB1c2VyOiAke3VzZXJJZH1gKTtcclxuICAgICAgY29uc3QgYWxsUm9vbXM6IFJvb21bXSA9IFtdO1xyXG5cclxuICAgICAgLy8gMS4gR2V0IHJvb21zIHdoZXJlIHVzZXIgaXMgdGhlIGhvc3QgLSB1c2Ugc2NhbiBmb3Igbm93IHNpbmNlIEdTSSBtaWdodCBub3QgYmUgcmVhZHlcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBob3N0Um9vbXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgU2NhbkNvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdob3N0SWQgPSA6dXNlcklkJyxcclxuICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgY29uc3QgaG9zdFJvb21zID0gaG9zdFJvb21zUmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke2hvc3RSb29tcy5sZW5ndGh9IHJvb21zIHdoZXJlIHVzZXIgaXMgaG9zdGApO1xyXG4gICAgICAgIGFsbFJvb21zLnB1c2goLi4uKGhvc3RSb29tcyBhcyBSb29tW10pKTtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBmZXRjaGluZyBob3N0IHJvb21zOicsIGVycm9yKTtcclxuICAgICAgICAvLyBDb250aW51ZSB3aXRoIGVtcHR5IGhvc3Qgcm9vbXNcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gMi4gR2V0IHJvb21zIHdoZXJlIHVzZXIgaGFzIHBhcnRpY2lwYXRlZCAoam9pbmVkIG9yIHZvdGVkKVxyXG4gICAgICBjb25zdCB2b3Rlc1RhYmxlID0gcHJvY2Vzcy5lbnYuVk9URVNfVEFCTEUgfHwgJyc7XHJcbiAgICAgIGlmICh2b3Rlc1RhYmxlKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIC8vIEdldCBhbGwgcGFydGljaXBhdGlvbiByZWNvcmRzIGJ5IHRoaXMgdXNlciAtIHVzZSBzY2FuIGZvciBub3dcclxuICAgICAgICAgIGNvbnN0IHVzZXJQYXJ0aWNpcGF0aW9uUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFNjYW5Db21tYW5kKHtcclxuICAgICAgICAgICAgVGFibGVOYW1lOiB2b3Rlc1RhYmxlLFxyXG4gICAgICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAndXNlcklkID0gOnVzZXJJZCcsXHJcbiAgICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgICBjb25zdCB1c2VyUGFydGljaXBhdGlvbiA9IHVzZXJQYXJ0aWNpcGF0aW9uUmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7dXNlclBhcnRpY2lwYXRpb24ubGVuZ3RofSBwYXJ0aWNpcGF0aW9uIHJlY29yZHMgZm9yIHVzZXJgKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gR2V0IHVuaXF1ZSByb29tIElEcyBmcm9tIHBhcnRpY2lwYXRpb24gcmVjb3JkcyAoYm90aCB2b3RlcyBhbmQgam9pbnMpXHJcbiAgICAgICAgICBjb25zdCBwYXJ0aWNpcGF0ZWRSb29tSWRzID0gbmV3IFNldCh1c2VyUGFydGljaXBhdGlvbi5tYXAocmVjb3JkID0+IHJlY29yZC5yb29tSWQpKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gR2V0IHJvb20gZGV0YWlscyBmb3IgcGFydGljaXBhdGVkIHJvb21zIChleGNsdWRpbmcgYWxyZWFkeSBmZXRjaGVkIGhvc3Qgcm9vbXMpXHJcbiAgICAgICAgICBjb25zdCBob3N0Um9vbUlkcyA9IG5ldyBTZXQoYWxsUm9vbXMubWFwKHJvb20gPT4gcm9vbS5pZCkpO1xyXG4gICAgICAgICAgY29uc3QgbmV3Um9vbUlkcyA9IEFycmF5LmZyb20ocGFydGljaXBhdGVkUm9vbUlkcykuZmlsdGVyKHJvb21JZCA9PiAhaG9zdFJvb21JZHMuaGFzKHJvb21JZCkpO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHtuZXdSb29tSWRzLmxlbmd0aH0gYWRkaXRpb25hbCByb29tcyB3aGVyZSB1c2VyIHBhcnRpY2lwYXRlZGApO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBGZXRjaCByb29tIGRldGFpbHMgZm9yIHBhcnRpY2lwYXRlZCByb29tc1xyXG4gICAgICAgICAgY29uc3QgcGFydGljaXBhdGVkUm9vbXNQcm9taXNlcyA9IG5ld1Jvb21JZHMubWFwKGFzeW5jIChyb29tSWQpID0+IHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICBjb25zdCByb29tUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICAgICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgICAgICAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgICAgICAgIHJldHVybiByb29tUmVzdWx0Lkl0ZW0gYXMgUm9vbTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBmZXRjaGluZyByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgIGNvbnN0IHBhcnRpY2lwYXRlZFJvb21zID0gKGF3YWl0IFByb21pc2UuYWxsKHBhcnRpY2lwYXRlZFJvb21zUHJvbWlzZXMpKVxyXG4gICAgICAgICAgICAuZmlsdGVyKHJvb20gPT4gcm9vbSAhPT0gbnVsbCkgYXMgUm9vbVtdO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBhbGxSb29tcy5wdXNoKC4uLnBhcnRpY2lwYXRlZFJvb21zKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgcGFydGljaXBhdGVkIHJvb21zOicsIGVycm9yKTtcclxuICAgICAgICAgIC8vIENvbnRpbnVlIHdpdGggb25seSBob3N0IHJvb21zXHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignVk9URVNfVEFCTEUgbm90IGNvbmZpZ3VyZWQsIG9ubHkgc2hvd2luZyBob3N0ZWQgcm9vbXMnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gMy4gRmlsdGVyIG91dCBleHBpcmVkIHJvb21zIGFuZCByb29tcyB3aXRoIG1hdGNoZXNcclxuICAgICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XHJcbiAgICAgIGNvbnN0IGFjdGl2ZVJvb21zID0gYWxsUm9vbXMuZmlsdGVyKHJvb20gPT4gIXJvb20udHRsIHx8IHJvb20udHRsID49IG5vdyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke2FjdGl2ZVJvb21zLmxlbmd0aH0gYWN0aXZlIHJvb21zIGFmdGVyIGZpbHRlcmluZyBleHBpcmVkYCk7XHJcblxyXG4gICAgICAvLyA0LiBDaGVjayBmb3IgbWF0Y2hlcyBhbmQgZmlsdGVyIG91dCByb29tcyB3aXRoIG1hdGNoZXNcclxuICAgICAgY29uc3QgbWF0Y2hlc1RhYmxlID0gcHJvY2Vzcy5lbnYuTUFUQ0hFU19UQUJMRSB8fCAnJztcclxuICAgICAgaWYgKG1hdGNoZXNUYWJsZSkge1xyXG4gICAgICAgIGNvbnN0IHJvb21zV2l0aG91dE1hdGNoZXMgPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICBmb3IgKGNvbnN0IHJvb20gb2YgYWN0aXZlUm9vbXMpIHtcclxuICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHJvb20gaGFzIGFueSBtYXRjaGVzXHJcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgICAgICAgVGFibGVOYW1lOiBtYXRjaGVzVGFibGUsXHJcbiAgICAgICAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICAgICAgICc6cm9vbUlkJzogcm9vbS5pZCxcclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgIExpbWl0OiAxLCAvLyBXZSBvbmx5IG5lZWQgdG8ga25vdyBpZiBhbnkgbWF0Y2ggZXhpc3RzXHJcbiAgICAgICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgICAgIC8vIElmIG5vIG1hdGNoZXMgZm91bmQsIGluY2x1ZGUgdGhlIHJvb21cclxuICAgICAgICAgICAgaWYgKCFtYXRjaFJlc3VsdC5JdGVtcyB8fCBtYXRjaFJlc3VsdC5JdGVtcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICByb29tc1dpdGhvdXRNYXRjaGVzLnB1c2gocm9vbSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgY29uc29sZS5sb2coYFJvb20gJHtyb29tLmlkfSBoYXMgbWF0Y2hlcywgZXhjbHVkaW5nIGZyb20gcmVzdWx0c2ApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBjaGVja2luZyBtYXRjaGVzIGZvciByb29tICR7cm9vbS5pZH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICAvLyBJbmNsdWRlIHJvb20gaWYgd2UgY2FuJ3QgY2hlY2sgbWF0Y2hlcyAoZmFpbCBzYWZlKVxyXG4gICAgICAgICAgICByb29tc1dpdGhvdXRNYXRjaGVzLnB1c2gocm9vbSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHtyb29tc1dpdGhvdXRNYXRjaGVzLmxlbmd0aH0gYWN0aXZlIHJvb21zIHdpdGhvdXQgbWF0Y2hlcyBmb3IgdXNlciAke3VzZXJJZH1gKTtcclxuICAgICAgICByZXR1cm4gcm9vbXNXaXRob3V0TWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBuZXcgRGF0ZShiLmNyZWF0ZWRBdCkuZ2V0VGltZSgpIC0gbmV3IERhdGUoYS5jcmVhdGVkQXQpLmdldFRpbWUoKSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke2FjdGl2ZVJvb21zLmxlbmd0aH0gYWN0aXZlIHJvb21zIGZvciB1c2VyICR7dXNlcklkfSAobWF0Y2hlcyB0YWJsZSBub3QgY29uZmlndXJlZClgKTtcclxuICAgICAgcmV0dXJuIGFjdGl2ZVJvb21zLnNvcnQoKGEsIGIpID0+IG5ldyBEYXRlKGIuY3JlYXRlZEF0KS5nZXRUaW1lKCkgLSBuZXcgRGF0ZShhLmNyZWF0ZWRBdCkuZ2V0VGltZSgpKTtcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBmZXRjaGluZyB1c2VyIHJvb21zOicsIGVycm9yKTtcclxuICAgICAgLy8gUmV0dXJuIGVtcHR5IGFycmF5IGluc3RlYWQgb2YgdGhyb3dpbmcgdG8gcHJldmVudCBHcmFwaFFMIG51bGwgZXJyb3JcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0Um9vbShyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8Um9vbSB8IG51bGw+IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgS2V5OiB7IGlkOiByb29tSWQgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdC5JdGVtKSB7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJvb20gPSByZXN1bHQuSXRlbSBhcyBSb29tO1xyXG5cclxuICAgIC8vIENoZWNrIGlmIHJvb20gaGFzIGV4cGlyZWRcclxuICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xyXG4gICAgaWYgKHJvb20udHRsICYmIHJvb20udHRsIDwgbm93KSB7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByb29tO1xyXG4gIH1cclxufVxyXG5cclxuLy8gTGFtYmRhIEhhbmRsZXIgZm9yIEFwcFN5bmNcclxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXIgPSBhc3luYyAoZXZlbnQpID0+IHtcclxuICBjb25zb2xlLmxvZygnUm9vbSBMYW1iZGEgcmVjZWl2ZWQgQXBwU3luYyBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCkpO1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3Qgcm9vbVNlcnZpY2UgPSBuZXcgUm9vbVNlcnZpY2UoKTtcclxuXHJcbiAgICAvLyBFeHRyYWN0IHVzZXIgSUQgZnJvbSBBcHBTeW5jIGNvbnRleHRcclxuICAgIGNvbnN0IHVzZXJJZCA9IGV2ZW50LmlkZW50aXR5Py5jbGFpbXM/LnN1YiB8fCBldmVudC5pZGVudGl0eT8udXNlcm5hbWU7XHJcbiAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgbm90IGF1dGhlbnRpY2F0ZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBEZXRlcm1pbmUgb3BlcmF0aW9uIGZyb20gQXBwU3luYyBmaWVsZCBuYW1lXHJcbiAgICBjb25zdCBmaWVsZE5hbWUgPSBldmVudC5pbmZvPy5maWVsZE5hbWU7XHJcbiAgICBjb25zb2xlLmxvZygnRmllbGQgbmFtZTonLCBmaWVsZE5hbWUpO1xyXG4gICAgXHJcbiAgICBzd2l0Y2ggKGZpZWxkTmFtZSkge1xyXG4gICAgICBjYXNlICdjcmVhdGVSb29tJzoge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIGNyZWF0ZVJvb20gbXV0YXRpb24nKTtcclxuICAgICAgICBjb25zdCB7IGlucHV0IH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgY29uc3QgeyBtZWRpYVR5cGUsIGdlbnJlSWRzLCBtYXhQYXJ0aWNpcGFudHMgfSA9IGlucHV0O1xyXG5cclxuICAgICAgICBjb25zdCByb29tID0gYXdhaXQgcm9vbVNlcnZpY2UuY3JlYXRlUm9vbSh1c2VySWQsIG1lZGlhVHlwZSwgZ2VucmVJZHMsIG1heFBhcnRpY2lwYW50cyk7XHJcbiAgICAgICAgcmV0dXJuIHJvb207XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2pvaW5Sb29tJzoge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIGpvaW5Sb29tIG11dGF0aW9uJyk7XHJcbiAgICAgICAgY29uc3QgeyBjb2RlIH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgY29uc3Qgcm9vbSA9IGF3YWl0IHJvb21TZXJ2aWNlLmpvaW5Sb29tKHVzZXJJZCwgY29kZSk7XHJcbiAgICAgICAgcmV0dXJuIHJvb207XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2dldE15Um9vbXMnOiB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1Byb2Nlc3NpbmcgZ2V0TXlSb29tcyBxdWVyeScpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCByb29tcyA9IGF3YWl0IHJvb21TZXJ2aWNlLmdldE15Um9vbXModXNlcklkKTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBSZXR1cm5pbmcgJHtyb29tcy5sZW5ndGh9IHJvb21zIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICAgICAgcmV0dXJuIHJvb21zO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBnZXRNeVJvb21zIGhhbmRsZXI6JywgZXJyb3IpO1xyXG4gICAgICAgICAgLy8gUmV0dXJuIGVtcHR5IGFycmF5IHRvIHByZXZlbnQgR3JhcGhRTCBudWxsIGVycm9yXHJcbiAgICAgICAgICByZXR1cm4gW107XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdnZXRSb29tJzoge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIGdldFJvb20gcXVlcnknKTtcclxuICAgICAgICBjb25zdCB7IGlkIH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgY29uc3Qgcm9vbSA9IGF3YWl0IHJvb21TZXJ2aWNlLmdldFJvb20oaWQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghcm9vbSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZCBvciBoYXMgZXhwaXJlZCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gcm9vbTtcclxuICAgICAgfVxyXG5cclxuICAgICAgZGVmYXVsdDpcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdVbmtub3duIGZpZWxkIG5hbWU6JywgZmllbGROYW1lKTtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdBdmFpbGFibGUgZXZlbnQgcHJvcGVydGllczonLCBPYmplY3Qua2V5cyhldmVudCkpO1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0V2ZW50IGluZm86JywgZXZlbnQuaW5mbyk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGZpZWxkOiAke2ZpZWxkTmFtZX1gKTtcclxuICAgIH1cclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1Jvb20gTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCc7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcclxuICB9XHJcbn07Il19