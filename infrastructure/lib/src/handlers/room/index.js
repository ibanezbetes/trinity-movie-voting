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
        // Record user participation when creating room (host automatically participates)
        await this.recordRoomParticipation(userId, roomId);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvcm9vbS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQWtIO0FBQ2xILDBEQUFxRTtBQUNyRSxtQ0FBb0M7QUFFcEMseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUF3RDFFLHNCQUFzQjtBQUN0QixNQUFNLGlCQUFpQjtJQUlyQixNQUFNLENBQUMsUUFBUTtRQUNiLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUNkLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDMUMsSUFBSSxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUNyRixDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsTUFBTSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBaUMsRUFBRSxTQUFpQjtRQUM5RSxJQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7UUFDakIsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFDO1FBRXZCLE9BQU8sUUFB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LEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUUzQyxNQUFNLFlBQVksR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQztRQUN2RixNQUFNLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQ2hDLENBQUM7QUFDSCxDQUFDLENBQUM7QUF2RVcsUUFBQSxPQUFPLFdBdUVsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBQdXRDb21tYW5kLCBHZXRDb21tYW5kLCBRdWVyeUNvbW1hbmQsIFNjYW5Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcclxuaW1wb3J0IHsgTGFtYmRhQ2xpZW50LCBJbnZva2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSc7XHJcbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpO1xyXG5jb25zdCBsYW1iZGFDbGllbnQgPSBuZXcgTGFtYmRhQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5cclxuLy8gVHlwZXNcclxuaW50ZXJmYWNlIE1vdmllQ2FuZGlkYXRlIHtcclxuICBpZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgb3ZlcnZpZXc6IHN0cmluZztcclxuICBwb3N0ZXJQYXRoOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJlbGVhc2VEYXRlOiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxufVxyXG5cclxuaW50ZXJmYWNlIFJvb20ge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgY29kZTogc3RyaW5nO1xyXG4gIGhvc3RJZDogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgZ2VucmVJZHM6IG51bWJlcltdO1xyXG4gIGNhbmRpZGF0ZXM6IE1vdmllQ2FuZGlkYXRlW107XHJcbiAgY3JlYXRlZEF0OiBzdHJpbmc7XHJcbiAgdHRsOiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBDcmVhdGVSb29tRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2NyZWF0ZVJvb20nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIGlucHV0OiB7XHJcbiAgICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gICAgZ2VucmVJZHM6IG51bWJlcltdO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBKb2luUm9vbUV2ZW50IHtcclxuICBvcGVyYXRpb246ICdqb2luUm9vbSc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgY29kZTogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgR2V0Um9vbUV2ZW50IHtcclxuICBvcGVyYXRpb246ICdnZXRSb29tJztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICByb29tSWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIEdldE15Um9vbXNFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnZ2V0TXlSb29tcyc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbn1cclxuXHJcbnR5cGUgUm9vbUV2ZW50ID0gQ3JlYXRlUm9vbUV2ZW50IHwgSm9pblJvb21FdmVudCB8IEdldFJvb21FdmVudCB8IEdldE15Um9vbXNFdmVudDtcclxuXHJcbmludGVyZmFjZSBSb29tUmVzcG9uc2Uge1xyXG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcclxuICBib2R5OiBSb29tIHwgUm9vbVtdIHwgeyBlcnJvcjogc3RyaW5nIH07XHJcbn1cclxuXHJcbi8vIFJvb20gY29kZSBnZW5lcmF0b3JcclxuY2xhc3MgUm9vbUNvZGVHZW5lcmF0b3Ige1xyXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IENIQVJBQ1RFUlMgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5JztcclxuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBDT0RFX0xFTkdUSCA9IDY7XHJcblxyXG4gIHN0YXRpYyBnZW5lcmF0ZSgpOiBzdHJpbmcge1xyXG4gICAgbGV0IGNvZGUgPSAnJztcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5DT0RFX0xFTkdUSDsgaSsrKSB7XHJcbiAgICAgIGNvZGUgKz0gdGhpcy5DSEFSQUNURVJTLmNoYXJBdChNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiB0aGlzLkNIQVJBQ1RFUlMubGVuZ3RoKSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gY29kZTtcclxuICB9XHJcblxyXG4gIHN0YXRpYyBhc3luYyBnZW5lcmF0ZVVuaXF1ZShkb2NDbGllbnQ6IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIHRhYmxlTmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIGxldCBhdHRlbXB0cyA9IDA7XHJcbiAgICBjb25zdCBtYXhBdHRlbXB0cyA9IDEwO1xyXG5cclxuICAgIHdoaWxlIChhdHRlbXB0cyA8IG1heEF0dGVtcHRzKSB7XHJcbiAgICAgIGNvbnN0IGNvZGUgPSB0aGlzLmdlbmVyYXRlKCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBpZiBjb2RlIGFscmVhZHkgZXhpc3RzXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHRhYmxlTmFtZSxcclxuICAgICAgICAgIEluZGV4TmFtZTogJ2NvZGUtaW5kZXgnLFxyXG4gICAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ2NvZGUgPSA6Y29kZScsXHJcbiAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAgICc6Y29kZSc6IGNvZGUsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgaWYgKCFyZXN1bHQuSXRlbXMgfHwgcmVzdWx0Lkl0ZW1zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgcmV0dXJuIGNvZGU7IC8vIENvZGUgaXMgdW5pcXVlXHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGNvZGUgdW5pcXVlbmVzczonLCBlcnJvcik7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGF0dGVtcHRzKys7XHJcbiAgICB9XHJcblxyXG4gICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gZ2VuZXJhdGUgdW5pcXVlIHJvb20gY29kZSBhZnRlciBtYXhpbXVtIGF0dGVtcHRzJyk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBUTURCIEludGVncmF0aW9uXHJcbmNsYXNzIFRNREJJbnRlZ3JhdGlvbiB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBsYW1iZGFBcm46IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmxhbWJkYUFybiA9IHByb2Nlc3MuZW52LlRNREJfTEFNQkRBX0FSTiB8fCAnJztcclxuICAgIGlmICghdGhpcy5sYW1iZGFBcm4pIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdUTURCX0xBTUJEQV9BUk4gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGZldGNoQ2FuZGlkYXRlcyhtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnLCBnZW5yZUlkcz86IG51bWJlcltdKTogUHJvbWlzZTxNb3ZpZUNhbmRpZGF0ZVtdPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBwYXlsb2FkID0ge1xyXG4gICAgICAgIG1lZGlhVHlwZSxcclxuICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICAvLyBOb3RlOiBwYWdlIHBhcmFtZXRlciByZW1vdmVkIC0gU21hcnQgUmFuZG9tIERpc2NvdmVyeSBoYW5kbGVzIHBhZ2luYXRpb24gaW50ZXJuYWxseVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc29sZS5sb2coJ0ludm9raW5nIFRNREIgTGFtYmRhIHdpdGggU21hcnQgUmFuZG9tIERpc2NvdmVyeSBwYXlsb2FkOicsIEpTT04uc3RyaW5naWZ5KHBheWxvYWQpKTtcclxuXHJcbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlQ29tbWFuZCh7XHJcbiAgICAgICAgRnVuY3Rpb25OYW1lOiB0aGlzLmxhbWJkYUFybixcclxuICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKGNvbW1hbmQpO1xyXG4gICAgICBcclxuICAgICAgaWYgKCFyZXNwb25zZS5QYXlsb2FkKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBmcm9tIFRNREIgTGFtYmRhJyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHJlc3BvbnNlLlBheWxvYWQpKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChyZXN1bHQuc3RhdHVzQ29kZSAhPT0gMjAwKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUTURCIExhbWJkYSBlcnJvcjogJHtKU09OLnN0cmluZ2lmeShyZXN1bHQuYm9keSl9YCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSByZXN1bHQuYm9keS5jYW5kaWRhdGVzIHx8IFtdO1xyXG4gICAgICBjb25zb2xlLmxvZyhgU21hcnQgUmFuZG9tIERpc2NvdmVyeSByZXR1cm5lZCAke2NhbmRpZGF0ZXMubGVuZ3RofSBjYW5kaWRhdGVzYCk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gY2FuZGlkYXRlcztcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdUTURCIEludGVncmF0aW9uIGVycm9yOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gZmV0Y2ggbW92aWUgY2FuZGlkYXRlczogJHtlcnJvcn1gKTtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbi8vIFJvb20gU2VydmljZVxyXG5jbGFzcyBSb29tU2VydmljZSB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB0YWJsZU5hbWU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHRtZGJJbnRlZ3JhdGlvbjogVE1EQkludGVncmF0aW9uO1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMudGFibGVOYW1lID0gcHJvY2Vzcy5lbnYuUk9PTVNfVEFCTEUgfHwgJyc7XHJcbiAgICBpZiAoIXRoaXMudGFibGVOYW1lKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUk9PTVNfVEFCTEUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuICAgIHRoaXMudG1kYkludGVncmF0aW9uID0gbmV3IFRNREJJbnRlZ3JhdGlvbigpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgY3JlYXRlUm9vbSh1c2VySWQ6IHN0cmluZywgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgZ2VucmVJZHM6IG51bWJlcltdKTogUHJvbWlzZTxSb29tPiB7XHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCFtZWRpYVR5cGUgfHwgIVsnTU9WSUUnLCAnVFYnXS5pbmNsdWRlcyhtZWRpYVR5cGUpKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBtZWRpYVR5cGUuIE11c3QgYmUgTU9WSUUgb3IgVFYnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBFbmZvcmNlIGdlbnJlIGxpbWl0IChtYXggMiBhcyBwZXIgbWFzdGVyIHNwZWMpXHJcbiAgICBpZiAoZ2VucmVJZHMubGVuZ3RoID4gMikge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ01heGltdW0gMiBnZW5yZXMgYWxsb3dlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEdlbmVyYXRlIHVuaXF1ZSByb29tIGNvZGVcclxuICAgIGNvbnN0IGNvZGUgPSBhd2FpdCBSb29tQ29kZUdlbmVyYXRvci5nZW5lcmF0ZVVuaXF1ZShkb2NDbGllbnQsIHRoaXMudGFibGVOYW1lKTtcclxuICAgIFxyXG4gICAgLy8gRmV0Y2ggbW92aWUgY2FuZGlkYXRlcyBmcm9tIFRNREJcclxuICAgIGNvbnNvbGUubG9nKGBGZXRjaGluZyAke21lZGlhVHlwZX0gY2FuZGlkYXRlcyBmb3IgZ2VucmVzOiAke2dlbnJlSWRzLmpvaW4oJywnKX1gKTtcclxuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBhd2FpdCB0aGlzLnRtZGJJbnRlZ3JhdGlvbi5mZXRjaENhbmRpZGF0ZXMobWVkaWFUeXBlLCBnZW5yZUlkcyk7XHJcbiAgICBcclxuICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICBjb25zb2xlLndhcm4oJ05vIGNhbmRpZGF0ZXMgcmV0dXJuZWQgZnJvbSBUTURCIC0gcHJvY2VlZGluZyB3aXRoIGVtcHR5IGxpc3QnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDcmVhdGUgcm9vbSByZWNvcmRcclxuICAgIGNvbnN0IHJvb21JZCA9IHJhbmRvbVVVSUQoKTtcclxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgIGNvbnN0IHR0bCA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDI0ICogNjAgKiA2MCk7IC8vIDI0IGhvdXJzIGZyb20gbm93XHJcblxyXG4gICAgY29uc3Qgcm9vbTogUm9vbSA9IHtcclxuICAgICAgaWQ6IHJvb21JZCxcclxuICAgICAgY29kZSxcclxuICAgICAgaG9zdElkOiB1c2VySWQsXHJcbiAgICAgIG1lZGlhVHlwZSxcclxuICAgICAgZ2VucmVJZHMsXHJcbiAgICAgIGNhbmRpZGF0ZXMsXHJcbiAgICAgIGNyZWF0ZWRBdDogbm93LFxyXG4gICAgICB0dGwsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFN0b3JlIGluIER5bmFtb0RCXHJcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXHJcbiAgICAgIEl0ZW06IHJvb20sXHJcbiAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfbm90X2V4aXN0cyhpZCknLCAvLyBFbnN1cmUgbm8gZHVwbGljYXRlIElEc1xyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFJlY29yZCB1c2VyIHBhcnRpY2lwYXRpb24gd2hlbiBjcmVhdGluZyByb29tIChob3N0IGF1dG9tYXRpY2FsbHkgcGFydGljaXBhdGVzKVxyXG4gICAgYXdhaXQgdGhpcy5yZWNvcmRSb29tUGFydGljaXBhdGlvbih1c2VySWQsIHJvb21JZCk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYFJvb20gY3JlYXRlZCBzdWNjZXNzZnVsbHk6ICR7cm9vbUlkfSB3aXRoIGNvZGU6ICR7Y29kZX1gKTtcclxuICAgIHJldHVybiByb29tO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgam9pblJvb20odXNlcklkOiBzdHJpbmcsIGNvZGU6IHN0cmluZyk6IFByb21pc2U8Um9vbT4ge1xyXG4gICAgaWYgKCFjb2RlIHx8IGNvZGUudHJpbSgpID09PSAnJykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gY29kZSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICghdXNlcklkKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVXNlciBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFF1ZXJ5IGJ5IHJvb20gY29kZSB1c2luZyBHU0lcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgICBJbmRleE5hbWU6ICdjb2RlLWluZGV4JyxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAnY29kZSA9IDpjb2RlJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOmNvZGUnOiBjb2RlLnRvVXBwZXJDYXNlKCksXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgaWYgKCFyZXN1bHQuSXRlbXMgfHwgcmVzdWx0Lkl0ZW1zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBub3QgZm91bmQuIFBsZWFzZSBjaGVjayB0aGUgcm9vbSBjb2RlLicpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAocmVzdWx0Lkl0ZW1zLmxlbmd0aCA+IDEpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBNdWx0aXBsZSByb29tcyBmb3VuZCBmb3IgY29kZSAke2NvZGV9OmAsIHJlc3VsdC5JdGVtcyk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNdWx0aXBsZSByb29tcyBmb3VuZCBmb3IgY29kZS4gUGxlYXNlIGNvbnRhY3Qgc3VwcG9ydC4nKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3Qgcm9vbSA9IHJlc3VsdC5JdGVtc1swXSBhcyBSb29tO1xyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgcm9vbSBoYXMgZXhwaXJlZFxyXG4gICAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgICAgaWYgKHJvb20udHRsICYmIHJvb20udHRsIDwgbm93KSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIGhhcyBleHBpcmVkLiBQbGVhc2UgY3JlYXRlIGEgbmV3IHJvb20uJyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFJlY29yZCB1c2VyIHBhcnRpY2lwYXRpb24gd2hlbiBqb2luaW5nIHJvb21cclxuICAgICAgYXdhaXQgdGhpcy5yZWNvcmRSb29tUGFydGljaXBhdGlvbih1c2VySWQsIHJvb20uaWQpO1xyXG5cclxuICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGpvaW5lZCByb29tOiAke3Jvb20uaWR9IHdpdGggY29kZTogJHtjb2RlfWApO1xyXG4gICAgICByZXR1cm4gcm9vbTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIC8vIEZhbGxiYWNrIHRvIHNjYW4gaWYgR1NJIGlzIG5vdCBhdmFpbGFibGUgeWV0XHJcbiAgICAgIGNvbnNvbGUubG9nKCdHU0kgbm90IGF2YWlsYWJsZSwgZmFsbGluZyBiYWNrIHRvIHNjYW4gbWV0aG9kJyk7XHJcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmpvaW5Sb29tQnlTY2FuKHVzZXJJZCwgY29kZSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGpvaW5Sb29tQnlTY2FuKHVzZXJJZDogc3RyaW5nLCBjb2RlOiBzdHJpbmcpOiBQcm9taXNlPFJvb20+IHtcclxuICAgIC8vIEZhbGxiYWNrIG1ldGhvZCB1c2luZyBzY2FuXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgU2NhbkNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHRoaXMudGFibGVOYW1lLFxyXG4gICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnY29kZSA9IDpjb2RlJyxcclxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICc6Y29kZSc6IGNvZGUudG9VcHBlckNhc2UoKSxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdC5JdGVtcyB8fCByZXN1bHQuSXRlbXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBub3QgZm91bmQuIFBsZWFzZSBjaGVjayB0aGUgcm9vbSBjb2RlLicpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJvb20gPSByZXN1bHQuSXRlbXNbMF0gYXMgUm9vbTtcclxuXHJcbiAgICAvLyBDaGVjayBpZiByb29tIGhhcyBleHBpcmVkXHJcbiAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgIGlmIChyb29tLnR0bCAmJiByb29tLnR0bCA8IG5vdykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gaGFzIGV4cGlyZWQuIFBsZWFzZSBjcmVhdGUgYSBuZXcgcm9vbS4nKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSZWNvcmQgdXNlciBwYXJ0aWNpcGF0aW9uIHdoZW4gam9pbmluZyByb29tXHJcbiAgICBhd2FpdCB0aGlzLnJlY29yZFJvb21QYXJ0aWNpcGF0aW9uKHVzZXJJZCwgcm9vbS5pZCk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGpvaW5lZCByb29tOiAke3Jvb20uaWR9IHdpdGggY29kZTogJHtjb2RlfSAoc2NhbiBtZXRob2QpYCk7XHJcbiAgICByZXR1cm4gcm9vbTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVjb3JkUm9vbVBhcnRpY2lwYXRpb24odXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB2b3Rlc1RhYmxlID0gcHJvY2Vzcy5lbnYuVk9URVNfVEFCTEUgfHwgJyc7XHJcbiAgICAgIGlmICghdm90ZXNUYWJsZSkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignVk9URVNfVEFCTEUgbm90IGNvbmZpZ3VyZWQsIHNraXBwaW5nIHBhcnRpY2lwYXRpb24gdHJhY2tpbmcnKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIENyZWF0ZSBhIHNwZWNpYWwgXCJwYXJ0aWNpcGF0aW9uXCIgcmVjb3JkIGluIFZPVEVTIHRhYmxlXHJcbiAgICAgIC8vIFRoaXMgYWxsb3dzIHRoZSByb29tIHRvIGFwcGVhciBpbiBnZXRNeVJvb21zKCkgZXZlbiB3aXRob3V0IGFjdHVhbCB2b3Rlc1xyXG4gICAgICBjb25zdCBwYXJ0aWNpcGF0aW9uUmVjb3JkID0ge1xyXG4gICAgICAgIHJvb21JZCxcclxuICAgICAgICB1c2VyTW92aWVJZDogYCR7dXNlcklkfSNKT0lORURgLCAvLyBTcGVjaWFsIG1hcmtlciBmb3Igcm9vbSBwYXJ0aWNpcGF0aW9uXHJcbiAgICAgICAgdXNlcklkLFxyXG4gICAgICAgIG1vdmllSWQ6IC0xLCAvLyBTcGVjaWFsIHZhbHVlIGluZGljYXRpbmcgdGhpcyBpcyBhIHBhcnRpY2lwYXRpb24gcmVjb3JkLCBub3QgYSB2b3RlXHJcbiAgICAgICAgdm90ZTogZmFsc2UsIC8vIE5vdCBhIHJlYWwgdm90ZVxyXG4gICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgIGlzUGFydGljaXBhdGlvbjogdHJ1ZSwgLy8gRmxhZyB0byBkaXN0aW5ndWlzaCBmcm9tIHJlYWwgdm90ZXNcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHZvdGVzVGFibGUsXHJcbiAgICAgICAgSXRlbTogcGFydGljaXBhdGlvblJlY29yZCxcclxuICAgICAgICAvLyBBbGxvdyBvdmVyd3JpdGluZyBpZiB1c2VyIGpvaW5zIHRoZSBzYW1lIHJvb20gbXVsdGlwbGUgdGltZXNcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc29sZS5sb2coYFBhcnRpY2lwYXRpb24gcmVjb3JkZWQgZm9yIHVzZXIgJHt1c2VySWR9IGluIHJvb20gJHtyb29tSWR9YCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciByZWNvcmRpbmcgcGFydGljaXBhdGlvbiBmb3IgdXNlciAke3VzZXJJZH0gaW4gcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICAvLyBEb24ndCBmYWlsIHRoZSBqb2luIG9wZXJhdGlvbiBpZiBwYXJ0aWNpcGF0aW9uIHRyYWNraW5nIGZhaWxzXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRNeVJvb21zKHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxSb29tW10+IHtcclxuICAgIGlmICghdXNlcklkKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ2dldE15Um9vbXMgY2FsbGVkIHdpdGhvdXQgdXNlcklkJyk7XHJcbiAgICAgIHJldHVybiBbXTsgLy8gUmV0dXJuIGVtcHR5IGFycmF5IGluc3RlYWQgb2YgdGhyb3dpbmdcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgR2V0dGluZyByb29tcyBmb3IgdXNlcjogJHt1c2VySWR9YCk7XHJcbiAgICAgIGNvbnN0IGFsbFJvb21zOiBSb29tW10gPSBbXTtcclxuXHJcbiAgICAgIC8vIDEuIEdldCByb29tcyB3aGVyZSB1c2VyIGlzIHRoZSBob3N0IC0gdXNlIHNjYW4gZm9yIG5vdyBzaW5jZSBHU0kgbWlnaHQgbm90IGJlIHJlYWR5XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgaG9zdFJvb21zUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFNjYW5Db21tYW5kKHtcclxuICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXHJcbiAgICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnaG9zdElkID0gOnVzZXJJZCcsXHJcbiAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAgICc6dXNlcklkJzogdXNlcklkLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIGNvbnN0IGhvc3RSb29tcyA9IGhvc3RSb29tc1Jlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHtob3N0Um9vbXMubGVuZ3RofSByb29tcyB3aGVyZSB1c2VyIGlzIGhvc3RgKTtcclxuICAgICAgICBhbGxSb29tcy5wdXNoKC4uLihob3N0Um9vbXMgYXMgUm9vbVtdKSk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgaG9zdCByb29tczonLCBlcnJvcik7XHJcbiAgICAgICAgLy8gQ29udGludWUgd2l0aCBlbXB0eSBob3N0IHJvb21zXHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIDIuIEdldCByb29tcyB3aGVyZSB1c2VyIGhhcyBwYXJ0aWNpcGF0ZWQgKGpvaW5lZCBvciB2b3RlZClcclxuICAgICAgY29uc3Qgdm90ZXNUYWJsZSA9IHByb2Nlc3MuZW52LlZPVEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgICBpZiAodm90ZXNUYWJsZSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAvLyBHZXQgYWxsIHBhcnRpY2lwYXRpb24gcmVjb3JkcyBieSB0aGlzIHVzZXIgLSB1c2Ugc2NhbiBmb3Igbm93XHJcbiAgICAgICAgICBjb25zdCB1c2VyUGFydGljaXBhdGlvblJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBTY2FuQ29tbWFuZCh7XHJcbiAgICAgICAgICAgIFRhYmxlTmFtZTogdm90ZXNUYWJsZSxcclxuICAgICAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ3VzZXJJZCA9IDp1c2VySWQnLFxyXG4gICAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgICAgY29uc3QgdXNlclBhcnRpY2lwYXRpb24gPSB1c2VyUGFydGljaXBhdGlvblJlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke3VzZXJQYXJ0aWNpcGF0aW9uLmxlbmd0aH0gcGFydGljaXBhdGlvbiByZWNvcmRzIGZvciB1c2VyYCk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIEdldCB1bmlxdWUgcm9vbSBJRHMgZnJvbSBwYXJ0aWNpcGF0aW9uIHJlY29yZHMgKGJvdGggdm90ZXMgYW5kIGpvaW5zKVxyXG4gICAgICAgICAgY29uc3QgcGFydGljaXBhdGVkUm9vbUlkcyA9IG5ldyBTZXQodXNlclBhcnRpY2lwYXRpb24ubWFwKHJlY29yZCA9PiByZWNvcmQucm9vbUlkKSk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIEdldCByb29tIGRldGFpbHMgZm9yIHBhcnRpY2lwYXRlZCByb29tcyAoZXhjbHVkaW5nIGFscmVhZHkgZmV0Y2hlZCBob3N0IHJvb21zKVxyXG4gICAgICAgICAgY29uc3QgaG9zdFJvb21JZHMgPSBuZXcgU2V0KGFsbFJvb21zLm1hcChyb29tID0+IHJvb20uaWQpKTtcclxuICAgICAgICAgIGNvbnN0IG5ld1Jvb21JZHMgPSBBcnJheS5mcm9tKHBhcnRpY2lwYXRlZFJvb21JZHMpLmZpbHRlcihyb29tSWQgPT4gIWhvc3RSb29tSWRzLmhhcyhyb29tSWQpKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7bmV3Um9vbUlkcy5sZW5ndGh9IGFkZGl0aW9uYWwgcm9vbXMgd2hlcmUgdXNlciBwYXJ0aWNpcGF0ZWRgKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gRmV0Y2ggcm9vbSBkZXRhaWxzIGZvciBwYXJ0aWNpcGF0ZWQgcm9vbXNcclxuICAgICAgICAgIGNvbnN0IHBhcnRpY2lwYXRlZFJvb21zUHJvbWlzZXMgPSBuZXdSb29tSWRzLm1hcChhc3luYyAocm9vbUlkKSA9PiB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgY29uc3Qgcm9vbVJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXHJcbiAgICAgICAgICAgICAgICBLZXk6IHsgaWQ6IHJvb21JZCB9LFxyXG4gICAgICAgICAgICAgIH0pKTtcclxuICAgICAgICAgICAgICByZXR1cm4gcm9vbVJlc3VsdC5JdGVtIGFzIFJvb207XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZmV0Y2hpbmcgcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICBjb25zdCBwYXJ0aWNpcGF0ZWRSb29tcyA9IChhd2FpdCBQcm9taXNlLmFsbChwYXJ0aWNpcGF0ZWRSb29tc1Byb21pc2VzKSlcclxuICAgICAgICAgICAgLmZpbHRlcihyb29tID0+IHJvb20gIT09IG51bGwpIGFzIFJvb21bXTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgYWxsUm9vbXMucHVzaCguLi5wYXJ0aWNpcGF0ZWRSb29tcyk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGZldGNoaW5nIHBhcnRpY2lwYXRlZCByb29tczonLCBlcnJvcik7XHJcbiAgICAgICAgICAvLyBDb250aW51ZSB3aXRoIG9ubHkgaG9zdCByb29tc1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ1ZPVEVTX1RBQkxFIG5vdCBjb25maWd1cmVkLCBvbmx5IHNob3dpbmcgaG9zdGVkIHJvb21zJyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIDMuIEZpbHRlciBvdXQgZXhwaXJlZCByb29tcyBhbmQgcm9vbXMgd2l0aCBtYXRjaGVzXHJcbiAgICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xyXG4gICAgICBjb25zdCBhY3RpdmVSb29tcyA9IGFsbFJvb21zLmZpbHRlcihyb29tID0+ICFyb29tLnR0bCB8fCByb29tLnR0bCA+PSBub3cpO1xyXG4gICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHthY3RpdmVSb29tcy5sZW5ndGh9IGFjdGl2ZSByb29tcyBhZnRlciBmaWx0ZXJpbmcgZXhwaXJlZGApO1xyXG5cclxuICAgICAgLy8gNC4gQ2hlY2sgZm9yIG1hdGNoZXMgYW5kIGZpbHRlciBvdXQgcm9vbXMgd2l0aCBtYXRjaGVzXHJcbiAgICAgIGNvbnN0IG1hdGNoZXNUYWJsZSA9IHByb2Nlc3MuZW52Lk1BVENIRVNfVEFCTEUgfHwgJyc7XHJcbiAgICAgIGlmIChtYXRjaGVzVGFibGUpIHtcclxuICAgICAgICBjb25zdCByb29tc1dpdGhvdXRNYXRjaGVzID0gW107XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yIChjb25zdCByb29tIG9mIGFjdGl2ZVJvb21zKSB7XHJcbiAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBDaGVjayBpZiByb29tIGhhcyBhbnkgbWF0Y2hlc1xyXG4gICAgICAgICAgICBjb25zdCBtYXRjaFJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgICAgICAgIFRhYmxlTmFtZTogbWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAgICAgICAnOnJvb21JZCc6IHJvb20uaWQsXHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICBMaW1pdDogMSwgLy8gV2Ugb25seSBuZWVkIHRvIGtub3cgaWYgYW55IG1hdGNoIGV4aXN0c1xyXG4gICAgICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgICAgICAvLyBJZiBubyBtYXRjaGVzIGZvdW5kLCBpbmNsdWRlIHRoZSByb29tXHJcbiAgICAgICAgICAgIGlmICghbWF0Y2hSZXN1bHQuSXRlbXMgfHwgbWF0Y2hSZXN1bHQuSXRlbXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgcm9vbXNXaXRob3V0TWF0Y2hlcy5wdXNoKHJvb20pO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBSb29tICR7cm9vbS5pZH0gaGFzIG1hdGNoZXMsIGV4Y2x1ZGluZyBmcm9tIHJlc3VsdHNgKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgY2hlY2tpbmcgbWF0Y2hlcyBmb3Igcm9vbSAke3Jvb20uaWR9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgLy8gSW5jbHVkZSByb29tIGlmIHdlIGNhbid0IGNoZWNrIG1hdGNoZXMgKGZhaWwgc2FmZSlcclxuICAgICAgICAgICAgcm9vbXNXaXRob3V0TWF0Y2hlcy5wdXNoKHJvb20pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7cm9vbXNXaXRob3V0TWF0Y2hlcy5sZW5ndGh9IGFjdGl2ZSByb29tcyB3aXRob3V0IG1hdGNoZXMgZm9yIHVzZXIgJHt1c2VySWR9YCk7XHJcbiAgICAgICAgcmV0dXJuIHJvb21zV2l0aG91dE1hdGNoZXMuc29ydCgoYSwgYikgPT4gbmV3IERhdGUoYi5jcmVhdGVkQXQpLmdldFRpbWUoKSAtIG5ldyBEYXRlKGEuY3JlYXRlZEF0KS5nZXRUaW1lKCkpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHthY3RpdmVSb29tcy5sZW5ndGh9IGFjdGl2ZSByb29tcyBmb3IgdXNlciAke3VzZXJJZH0gKG1hdGNoZXMgdGFibGUgbm90IGNvbmZpZ3VyZWQpYCk7XHJcbiAgICAgIHJldHVybiBhY3RpdmVSb29tcy5zb3J0KChhLCBiKSA9PiBuZXcgRGF0ZShiLmNyZWF0ZWRBdCkuZ2V0VGltZSgpIC0gbmV3IERhdGUoYS5jcmVhdGVkQXQpLmdldFRpbWUoKSk7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgdXNlciByb29tczonLCBlcnJvcik7XHJcbiAgICAgIC8vIFJldHVybiBlbXB0eSBhcnJheSBpbnN0ZWFkIG9mIHRocm93aW5nIHRvIHByZXZlbnQgR3JhcGhRTCBudWxsIGVycm9yXHJcbiAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGdldFJvb20ocm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPFJvb20gfCBudWxsPiB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXHJcbiAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgaWYgKCFyZXN1bHQuSXRlbSkge1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByb29tID0gcmVzdWx0Lkl0ZW0gYXMgUm9vbTtcclxuXHJcbiAgICAvLyBDaGVjayBpZiByb29tIGhhcyBleHBpcmVkXHJcbiAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgIGlmIChyb29tLnR0bCAmJiByb29tLnR0bCA8IG5vdykge1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcm9vbTtcclxuICB9XHJcbn1cclxuXHJcbi8vIExhbWJkYSBIYW5kbGVyIGZvciBBcHBTeW5jXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyID0gYXN5bmMgKGV2ZW50KSA9PiB7XHJcbiAgY29uc29sZS5sb2coJ1Jvb20gTGFtYmRhIHJlY2VpdmVkIEFwcFN5bmMgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHJvb21TZXJ2aWNlID0gbmV3IFJvb21TZXJ2aWNlKCk7XHJcblxyXG4gICAgLy8gRXh0cmFjdCB1c2VyIElEIGZyb20gQXBwU3luYyBjb250ZXh0XHJcbiAgICBjb25zdCB1c2VySWQgPSBldmVudC5pZGVudGl0eT8uY2xhaW1zPy5zdWIgfHwgZXZlbnQuaWRlbnRpdHk/LnVzZXJuYW1lO1xyXG4gICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIG5vdCBhdXRoZW50aWNhdGVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIG9wZXJhdGlvbiBmcm9tIEFwcFN5bmMgZmllbGQgbmFtZVxyXG4gICAgY29uc3QgZmllbGROYW1lID0gZXZlbnQuaW5mbz8uZmllbGROYW1lO1xyXG4gICAgY29uc29sZS5sb2coJ0ZpZWxkIG5hbWU6JywgZmllbGROYW1lKTtcclxuICAgIFxyXG4gICAgc3dpdGNoIChmaWVsZE5hbWUpIHtcclxuICAgICAgY2FzZSAnY3JlYXRlUm9vbSc6IHtcclxuICAgICAgICBjb25zb2xlLmxvZygnUHJvY2Vzc2luZyBjcmVhdGVSb29tIG11dGF0aW9uJyk7XHJcbiAgICAgICAgY29uc3QgeyBpbnB1dCB9ID0gZXZlbnQuYXJndW1lbnRzO1xyXG4gICAgICAgIGNvbnN0IHsgbWVkaWFUeXBlLCBnZW5yZUlkcyB9ID0gaW5wdXQ7XHJcblxyXG4gICAgICAgIGNvbnN0IHJvb20gPSBhd2FpdCByb29tU2VydmljZS5jcmVhdGVSb29tKHVzZXJJZCwgbWVkaWFUeXBlLCBnZW5yZUlkcyk7XHJcbiAgICAgICAgcmV0dXJuIHJvb207XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2pvaW5Sb29tJzoge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIGpvaW5Sb29tIG11dGF0aW9uJyk7XHJcbiAgICAgICAgY29uc3QgeyBjb2RlIH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgY29uc3Qgcm9vbSA9IGF3YWl0IHJvb21TZXJ2aWNlLmpvaW5Sb29tKHVzZXJJZCwgY29kZSk7XHJcbiAgICAgICAgcmV0dXJuIHJvb207XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2dldE15Um9vbXMnOiB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1Byb2Nlc3NpbmcgZ2V0TXlSb29tcyBxdWVyeScpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCByb29tcyA9IGF3YWl0IHJvb21TZXJ2aWNlLmdldE15Um9vbXModXNlcklkKTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBSZXR1cm5pbmcgJHtyb29tcy5sZW5ndGh9IHJvb21zIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICAgICAgcmV0dXJuIHJvb21zO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBnZXRNeVJvb21zIGhhbmRsZXI6JywgZXJyb3IpO1xyXG4gICAgICAgICAgLy8gUmV0dXJuIGVtcHR5IGFycmF5IHRvIHByZXZlbnQgR3JhcGhRTCBudWxsIGVycm9yXHJcbiAgICAgICAgICByZXR1cm4gW107XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdnZXRSb29tJzoge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIGdldFJvb20gcXVlcnknKTtcclxuICAgICAgICBjb25zdCB7IGlkIH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgY29uc3Qgcm9vbSA9IGF3YWl0IHJvb21TZXJ2aWNlLmdldFJvb20oaWQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghcm9vbSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZCBvciBoYXMgZXhwaXJlZCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gcm9vbTtcclxuICAgICAgfVxyXG5cclxuICAgICAgZGVmYXVsdDpcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdVbmtub3duIGZpZWxkIG5hbWU6JywgZmllbGROYW1lKTtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdBdmFpbGFibGUgZXZlbnQgcHJvcGVydGllczonLCBPYmplY3Qua2V5cyhldmVudCkpO1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0V2ZW50IGluZm86JywgZXZlbnQuaW5mbyk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGZpZWxkOiAke2ZpZWxkTmFtZX1gKTtcclxuICAgIH1cclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1Jvb20gTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCc7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcclxuICB9XHJcbn07Il19