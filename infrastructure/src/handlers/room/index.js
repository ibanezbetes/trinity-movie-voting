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
        // Record host participation when creating room (host is the first participant)
        // This ensures the host counts towards the maxParticipants limit
        await this.recordRoomParticipation(userId, roomId, maxParticipants);
        console.log(`Room created successfully: ${roomId} with code: ${code}, maxParticipants: ${maxParticipants}, host registered as first participant`);
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
            // Check if user is already in the room
            const isAlreadyInRoom = await this.isUserInRoom(userId, room.id);
            if (isAlreadyInRoom) {
                console.log(`User ${userId} is already in room ${room.id}, returning room data`);
                return room;
            }
            // CRITICAL: Check participant count BEFORE attempting to join
            // This includes the host as the first participant
            const currentParticipants = await this.getRoomParticipantCount(room.id);
            const maxParticipants = room.maxParticipants || 2; // Default to 2 for backward compatibility
            console.log(`Room ${room.id} has ${currentParticipants}/${maxParticipants} participants (including host)`);
            if (currentParticipants >= maxParticipants) {
                throw new Error('Esta sala está llena.');
            }
            // Attempt to record participation with atomic check
            // This will fail if another user joins simultaneously and fills the room
            await this.recordRoomParticipation(userId, room.id, maxParticipants);
            // Double-check after recording to ensure we didn't exceed the limit
            // This is a safety check in case of race conditions
            const finalParticipants = await this.getRoomParticipantCount(room.id);
            if (finalParticipants > maxParticipants) {
                console.error(`RACE CONDITION DETECTED: Room ${room.id} now has ${finalParticipants}/${maxParticipants} participants`);
                // Note: In production, you might want to implement a cleanup mechanism here
                // For now, we log the error but allow the join since the record is already created
            }
            console.log(`User ${userId} successfully joined room: ${room.id} with code: ${code}`);
            return room;
        }
        catch (error) {
            // Fallback to scan if GSI is not available yet
            const err = error;
            if (err.name === 'ResourceNotFoundException' || err.message?.includes('GSI')) {
                console.log('GSI not available, falling back to scan method');
                return await this.joinRoomByScan(userId, code);
            }
            throw error;
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
        // Check if user is already in the room
        const isAlreadyInRoom = await this.isUserInRoom(userId, room.id);
        if (isAlreadyInRoom) {
            console.log(`User ${userId} is already in room ${room.id}, returning room data (scan method)`);
            return room;
        }
        // CRITICAL: Check participant count BEFORE attempting to join
        // This includes the host as the first participant
        const currentParticipants = await this.getRoomParticipantCount(room.id);
        const maxParticipants = room.maxParticipants || 2; // Default to 2 for backward compatibility
        console.log(`Room ${room.id} has ${currentParticipants}/${maxParticipants} participants (including host) - scan method`);
        if (currentParticipants >= maxParticipants) {
            throw new Error('Esta sala está llena.');
        }
        // Attempt to record participation with atomic check
        await this.recordRoomParticipation(userId, room.id, maxParticipants);
        // Double-check after recording to ensure we didn't exceed the limit
        const finalParticipants = await this.getRoomParticipantCount(room.id);
        if (finalParticipants > maxParticipants) {
            console.error(`RACE CONDITION DETECTED: Room ${room.id} now has ${finalParticipants}/${maxParticipants} participants (scan method)`);
        }
        console.log(`User ${userId} successfully joined room: ${room.id} with code: ${code} (scan method)`);
        return room;
    }
    async recordRoomParticipation(userId, roomId, maxParticipants) {
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
            // Use conditional expression to ensure atomicity and prevent exceeding maxParticipants
            // This prevents race conditions when multiple users try to join simultaneously
            await docClient.send(new lib_dynamodb_1.PutCommand({
                TableName: votesTable,
                Item: participationRecord,
                ConditionExpression: 'attribute_not_exists(userMovieId)',
            }));
            console.log(`Participation recorded for user ${userId} in room ${roomId}`);
        }
        catch (error) {
            // If condition fails, user is already in the room - this is OK
            const err = error;
            if (err.name === 'ConditionalCheckFailedException') {
                console.log(`User ${userId} already has participation record in room ${roomId}`);
                return;
            }
            console.error(`Error recording participation for user ${userId} in room ${roomId}:`, error);
            throw error; // Re-throw to fail the join operation on unexpected errors
        }
    }
    async getRoomParticipantCount(roomId) {
        try {
            const votesTable = process.env.VOTES_TABLE || '';
            if (!votesTable) {
                console.warn('VOTES_TABLE not configured, cannot count participants');
                return 0;
            }
            // Query all participation records for this room
            const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: votesTable,
                KeyConditionExpression: 'roomId = :roomId',
                FilterExpression: 'isParticipation = :isParticipation',
                ExpressionAttributeValues: {
                    ':roomId': roomId,
                    ':isParticipation': true,
                },
            }));
            const participants = result.Items || [];
            const uniqueUserIds = new Set(participants.map(p => p.userId));
            console.log(`Room ${roomId} has ${uniqueUserIds.size} unique participants`);
            return uniqueUserIds.size;
        }
        catch (error) {
            console.error(`Error counting participants for room ${roomId}:`, error);
            return 0;
        }
    }
    async isUserInRoom(userId, roomId) {
        try {
            const votesTable = process.env.VOTES_TABLE || '';
            if (!votesTable) {
                return false;
            }
            // Check if user has a participation record in this room
            const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: votesTable,
                KeyConditionExpression: 'roomId = :roomId',
                FilterExpression: 'userId = :userId AND isParticipation = :isParticipation',
                ExpressionAttributeValues: {
                    ':roomId': roomId,
                    ':userId': userId,
                    ':isParticipation': true,
                },
                Limit: 1,
            }));
            const isInRoom = !!(result.Items && result.Items.length > 0);
            console.log(`User ${userId} ${isInRoom ? 'is already' : 'is not'} in room ${roomId}`);
            return isInRoom;
        }
        catch (error) {
            console.error(`Error checking if user ${userId} is in room ${roomId}:`, error);
            return false;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvcm9vbS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQWtIO0FBQ2xILDBEQUFxRTtBQUNyRSxtQ0FBb0M7QUFFcEMseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUEwRDFFLHNCQUFzQjtBQUN0QixNQUFNLGlCQUFpQjtJQUlyQixNQUFNLENBQUMsUUFBUTtRQUNiLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUNkLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDMUMsSUFBSSxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUNyRixDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsTUFBTSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBaUMsRUFBRSxTQUFpQjtRQUM5RSxJQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7UUFDakIsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFDO1FBRXZCLE9BQU8sUUFB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Q0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBRTNDLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztvQkFDVixNQUFNLElBQUksS0FBSyxDQUFDLCtCQUErQixDQUFDLENBQUM7Z0JBQ25ELENBQUM7Z0JBRUQsT0FBTyxJQUFJLENBQUM7WUFDZCxDQUFDO1lBRUQ7Z0JBQ0UsT0FBTyxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsRUFBRSxTQUFTLENBQUMsQ0FBQztnQkFDaEQsT0FBTyxDQUFDLEtBQUssQ0FBQyw2QkFBNkIsRUFBRSxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7Z0JBQ2pFLE9BQU8sQ0FBQyxLQUFLLENBQUMsYUFBYSxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDekMsTUFBTSxJQUFJLEtBQUssQ0FBQyxrQkFBa0IsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNuRCxDQUFDO0lBRUgsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLG9CQUFvQixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRTNDLE1BQU0sWUFBWSxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLHdCQUF3QixDQUFDO1FBQ3ZGLE1BQU0sSUFBSSxLQUFLLENBQUMsWUFBWSxDQUFDLENBQUM7SUFDaEMsQ0FBQztBQUNILENBQUMsQ0FBQztBQXZFVyxRQUFBLE9BQU8sV0F1RWxCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSGFuZGxlciB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIFB1dENvbW1hbmQsIEdldENvbW1hbmQsIFF1ZXJ5Q29tbWFuZCwgU2NhbkNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5pbXBvcnQgeyBMYW1iZGFDbGllbnQsIEludm9rZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtbGFtYmRhJztcclxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XHJcblxyXG4vLyBJbml0aWFsaXplIEFXUyBjbGllbnRzXHJcbmNvbnN0IGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGR5bmFtb0NsaWVudCk7XHJcbmNvbnN0IGxhbWJkYUNsaWVudCA9IG5ldyBMYW1iZGFDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcblxyXG4vLyBUeXBlc1xyXG5pbnRlcmZhY2UgTW92aWVDYW5kaWRhdGUge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg6IHN0cmluZyB8IG51bGw7XHJcbiAgcmVsZWFzZURhdGU6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgUm9vbSB7XHJcbiAgaWQ6IHN0cmluZztcclxuICBjb2RlOiBzdHJpbmc7XHJcbiAgaG9zdElkOiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxuICBnZW5yZUlkczogbnVtYmVyW107XHJcbiAgY2FuZGlkYXRlczogTW92aWVDYW5kaWRhdGVbXTtcclxuICBjcmVhdGVkQXQ6IHN0cmluZztcclxuICB0dGw6IG51bWJlcjtcclxuICBtYXhQYXJ0aWNpcGFudHM6IG51bWJlcjtcclxufVxyXG5cclxuaW50ZXJmYWNlIENyZWF0ZVJvb21FdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnY3JlYXRlUm9vbSc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgaW5wdXQ6IHtcclxuICAgIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgICBnZW5yZUlkczogbnVtYmVyW107XHJcbiAgICBtYXhQYXJ0aWNpcGFudHM6IG51bWJlcjtcclxuICB9O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgSm9pblJvb21FdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnam9pblJvb20nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIGNvZGU6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIEdldFJvb21FdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnZ2V0Um9vbSc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBHZXRNeVJvb21zRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2dldE15Um9vbXMnO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG50eXBlIFJvb21FdmVudCA9IENyZWF0ZVJvb21FdmVudCB8IEpvaW5Sb29tRXZlbnQgfCBHZXRSb29tRXZlbnQgfCBHZXRNeVJvb21zRXZlbnQ7XHJcblxyXG5pbnRlcmZhY2UgUm9vbVJlc3BvbnNlIHtcclxuICBzdGF0dXNDb2RlOiBudW1iZXI7XHJcbiAgYm9keTogUm9vbSB8IFJvb21bXSB8IHsgZXJyb3I6IHN0cmluZyB9O1xyXG59XHJcblxyXG4vLyBSb29tIGNvZGUgZ2VuZXJhdG9yXHJcbmNsYXNzIFJvb21Db2RlR2VuZXJhdG9yIHtcclxuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBDSEFSQUNURVJTID0gJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaMDEyMzQ1Njc4OSc7XHJcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgQ09ERV9MRU5HVEggPSA2O1xyXG5cclxuICBzdGF0aWMgZ2VuZXJhdGUoKTogc3RyaW5nIHtcclxuICAgIGxldCBjb2RlID0gJyc7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuQ09ERV9MRU5HVEg7IGkrKykge1xyXG4gICAgICBjb2RlICs9IHRoaXMuQ0hBUkFDVEVSUy5jaGFyQXQoTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogdGhpcy5DSEFSQUNURVJTLmxlbmd0aCkpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGNvZGU7XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgYXN5bmMgZ2VuZXJhdGVVbmlxdWUoZG9jQ2xpZW50OiBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCB0YWJsZU5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICBsZXQgYXR0ZW1wdHMgPSAwO1xyXG4gICAgY29uc3QgbWF4QXR0ZW1wdHMgPSAxMDtcclxuXHJcbiAgICB3aGlsZSAoYXR0ZW1wdHMgPCBtYXhBdHRlbXB0cykge1xyXG4gICAgICBjb25zdCBjb2RlID0gdGhpcy5nZW5lcmF0ZSgpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgaWYgY29kZSBhbHJlYWR5IGV4aXN0c1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0YWJsZU5hbWUsXHJcbiAgICAgICAgICBJbmRleE5hbWU6ICdjb2RlLWluZGV4JyxcclxuICAgICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdjb2RlID0gOmNvZGUnLFxyXG4gICAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgICAnOmNvZGUnOiBjb2RlLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIGlmICghcmVzdWx0Lkl0ZW1zIHx8IHJlc3VsdC5JdGVtcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgIHJldHVybiBjb2RlOyAvLyBDb2RlIGlzIHVuaXF1ZVxyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyBjb2RlIHVuaXF1ZW5lc3M6JywgZXJyb3IpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBhdHRlbXB0cysrO1xyXG4gICAgfVxyXG5cclxuICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIGdlbmVyYXRlIHVuaXF1ZSByb29tIGNvZGUgYWZ0ZXIgbWF4aW11bSBhdHRlbXB0cycpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVE1EQiBJbnRlZ3JhdGlvblxyXG5jbGFzcyBUTURCSW50ZWdyYXRpb24ge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbGFtYmRhQXJuOiBzdHJpbmc7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5sYW1iZGFBcm4gPSBwcm9jZXNzLmVudi5UTURCX0xBTUJEQV9BUk4gfHwgJyc7XHJcbiAgICBpZiAoIXRoaXMubGFtYmRhQXJuKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVE1EQl9MQU1CREFfQVJOIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBmZXRjaENhbmRpZGF0ZXMobWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgZ2VucmVJZHM/OiBudW1iZXJbXSk6IFByb21pc2U8TW92aWVDYW5kaWRhdGVbXT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgICBtZWRpYVR5cGUsXHJcbiAgICAgICAgZ2VucmVJZHMsXHJcbiAgICAgICAgLy8gTm90ZTogcGFnZSBwYXJhbWV0ZXIgcmVtb3ZlZCAtIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgaGFuZGxlcyBwYWdpbmF0aW9uIGludGVybmFsbHlcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKCdJbnZva2luZyBUTURCIExhbWJkYSB3aXRoIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgcGF5bG9hZDonLCBKU09OLnN0cmluZ2lmeShwYXlsb2FkKSk7XHJcblxyXG4gICAgICBjb25zdCBjb21tYW5kID0gbmV3IEludm9rZUNvbW1hbmQoe1xyXG4gICAgICAgIEZ1bmN0aW9uTmFtZTogdGhpcy5sYW1iZGFBcm4sXHJcbiAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChjb21tYW5kKTtcclxuICAgICAgXHJcbiAgICAgIGlmICghcmVzcG9uc2UuUGF5bG9hZCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gcmVzcG9uc2UgZnJvbSBUTURCIExhbWJkYScpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5QYXlsb2FkKSk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAocmVzdWx0LnN0YXR1c0NvZGUgIT09IDIwMCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVE1EQiBMYW1iZGEgZXJyb3I6ICR7SlNPTi5zdHJpbmdpZnkocmVzdWx0LmJvZHkpfWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBjYW5kaWRhdGVzID0gcmVzdWx0LmJvZHkuY2FuZGlkYXRlcyB8fCBbXTtcclxuICAgICAgY29uc29sZS5sb2coYFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgcmV0dXJuZWQgJHtjYW5kaWRhdGVzLmxlbmd0aH0gY2FuZGlkYXRlc2ApO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIGNhbmRpZGF0ZXM7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignVE1EQiBJbnRlZ3JhdGlvbiBlcnJvcjonLCBlcnJvcik7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGZldGNoIG1vdmllIGNhbmRpZGF0ZXM6ICR7ZXJyb3J9YCk7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG4vLyBSb29tIFNlcnZpY2VcclxuY2xhc3MgUm9vbVNlcnZpY2Uge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgdGFibGVOYW1lOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB0bWRiSW50ZWdyYXRpb246IFRNREJJbnRlZ3JhdGlvbjtcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLnRhYmxlTmFtZSA9IHByb2Nlc3MuZW52LlJPT01TX1RBQkxFIHx8ICcnO1xyXG4gICAgaWYgKCF0aGlzLnRhYmxlTmFtZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JPT01TX1RBQkxFIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcbiAgICB0aGlzLnRtZGJJbnRlZ3JhdGlvbiA9IG5ldyBUTURCSW50ZWdyYXRpb24oKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGNyZWF0ZVJvb20odXNlcklkOiBzdHJpbmcsIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVicsIGdlbnJlSWRzOiBudW1iZXJbXSwgbWF4UGFydGljaXBhbnRzOiBudW1iZXIpOiBQcm9taXNlPFJvb20+IHtcclxuICAgIC8vIFZhbGlkYXRlIGlucHV0XHJcbiAgICBpZiAoIW1lZGlhVHlwZSB8fCAhWydNT1ZJRScsICdUViddLmluY2x1ZGVzKG1lZGlhVHlwZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIG1lZGlhVHlwZS4gTXVzdCBiZSBNT1ZJRSBvciBUVicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFZhbGlkYXRlIG1heFBhcnRpY2lwYW50c1xyXG4gICAgaWYgKCFtYXhQYXJ0aWNpcGFudHMgfHwgdHlwZW9mIG1heFBhcnRpY2lwYW50cyAhPT0gJ251bWJlcicpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdtYXhQYXJ0aWNpcGFudHMgaXMgcmVxdWlyZWQgYW5kIG11c3QgYmUgYSBudW1iZXInKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobWF4UGFydGljaXBhbnRzIDwgMiB8fCBtYXhQYXJ0aWNpcGFudHMgPiA2KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignbWF4UGFydGljaXBhbnRzIG11c3QgYmUgYmV0d2VlbiAyIGFuZCA2Jyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRW5mb3JjZSBnZW5yZSBsaW1pdCAobWF4IDIgYXMgcGVyIG1hc3RlciBzcGVjKVxyXG4gICAgaWYgKGdlbnJlSWRzLmxlbmd0aCA+IDIpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNYXhpbXVtIDIgZ2VucmVzIGFsbG93ZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBHZW5lcmF0ZSB1bmlxdWUgcm9vbSBjb2RlXHJcbiAgICBjb25zdCBjb2RlID0gYXdhaXQgUm9vbUNvZGVHZW5lcmF0b3IuZ2VuZXJhdGVVbmlxdWUoZG9jQ2xpZW50LCB0aGlzLnRhYmxlTmFtZSk7XHJcbiAgICBcclxuICAgIC8vIEZldGNoIG1vdmllIGNhbmRpZGF0ZXMgZnJvbSBUTURCXHJcbiAgICBjb25zb2xlLmxvZyhgRmV0Y2hpbmcgJHttZWRpYVR5cGV9IGNhbmRpZGF0ZXMgZm9yIGdlbnJlczogJHtnZW5yZUlkcy5qb2luKCcsJyl9YCk7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gYXdhaXQgdGhpcy50bWRiSW50ZWdyYXRpb24uZmV0Y2hDYW5kaWRhdGVzKG1lZGlhVHlwZSwgZ2VucmVJZHMpO1xyXG4gICAgXHJcbiAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgY29uc29sZS53YXJuKCdObyBjYW5kaWRhdGVzIHJldHVybmVkIGZyb20gVE1EQiAtIHByb2NlZWRpbmcgd2l0aCBlbXB0eSBsaXN0Jyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ3JlYXRlIHJvb20gcmVjb3JkXHJcbiAgICBjb25zdCByb29tSWQgPSByYW5kb21VVUlEKCk7XHJcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICBjb25zdCB0dGwgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICgyNCAqIDYwICogNjApOyAvLyAyNCBob3VycyBmcm9tIG5vd1xyXG5cclxuICAgIGNvbnN0IHJvb206IFJvb20gPSB7XHJcbiAgICAgIGlkOiByb29tSWQsXHJcbiAgICAgIGNvZGUsXHJcbiAgICAgIGhvc3RJZDogdXNlcklkLFxyXG4gICAgICBtZWRpYVR5cGUsXHJcbiAgICAgIGdlbnJlSWRzLFxyXG4gICAgICBjYW5kaWRhdGVzLFxyXG4gICAgICBjcmVhdGVkQXQ6IG5vdyxcclxuICAgICAgdHRsLFxyXG4gICAgICBtYXhQYXJ0aWNpcGFudHMsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFN0b3JlIGluIER5bmFtb0RCXHJcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXHJcbiAgICAgIEl0ZW06IHJvb20sXHJcbiAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfbm90X2V4aXN0cyhpZCknLCAvLyBFbnN1cmUgbm8gZHVwbGljYXRlIElEc1xyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFJlY29yZCBob3N0IHBhcnRpY2lwYXRpb24gd2hlbiBjcmVhdGluZyByb29tIChob3N0IGlzIHRoZSBmaXJzdCBwYXJ0aWNpcGFudClcclxuICAgIC8vIFRoaXMgZW5zdXJlcyB0aGUgaG9zdCBjb3VudHMgdG93YXJkcyB0aGUgbWF4UGFydGljaXBhbnRzIGxpbWl0XHJcbiAgICBhd2FpdCB0aGlzLnJlY29yZFJvb21QYXJ0aWNpcGF0aW9uKHVzZXJJZCwgcm9vbUlkLCBtYXhQYXJ0aWNpcGFudHMpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBSb29tIGNyZWF0ZWQgc3VjY2Vzc2Z1bGx5OiAke3Jvb21JZH0gd2l0aCBjb2RlOiAke2NvZGV9LCBtYXhQYXJ0aWNpcGFudHM6ICR7bWF4UGFydGljaXBhbnRzfSwgaG9zdCByZWdpc3RlcmVkIGFzIGZpcnN0IHBhcnRpY2lwYW50YCk7XHJcbiAgICByZXR1cm4gcm9vbTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGpvaW5Sb29tKHVzZXJJZDogc3RyaW5nLCBjb2RlOiBzdHJpbmcpOiBQcm9taXNlPFJvb20+IHtcclxuICAgIGlmICghY29kZSB8fCBjb2RlLnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIGNvZGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgSUQgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBRdWVyeSBieSByb29tIGNvZGUgdXNpbmcgR1NJXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXHJcbiAgICAgICAgSW5kZXhOYW1lOiAnY29kZS1pbmRleCcsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ2NvZGUgPSA6Y29kZScsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpjb2RlJzogY29kZS50b1VwcGVyQ2FzZSgpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGlmICghcmVzdWx0Lkl0ZW1zIHx8IHJlc3VsdC5JdGVtcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gbm90IGZvdW5kLiBQbGVhc2UgY2hlY2sgdGhlIHJvb20gY29kZS4nKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHJlc3VsdC5JdGVtcy5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgTXVsdGlwbGUgcm9vbXMgZm91bmQgZm9yIGNvZGUgJHtjb2RlfTpgLCByZXN1bHQuSXRlbXMpO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignTXVsdGlwbGUgcm9vbXMgZm91bmQgZm9yIGNvZGUuIFBsZWFzZSBjb250YWN0IHN1cHBvcnQuJyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJvb20gPSByZXN1bHQuSXRlbXNbMF0gYXMgUm9vbTtcclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHJvb20gaGFzIGV4cGlyZWRcclxuICAgICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XHJcbiAgICAgIGlmIChyb29tLnR0bCAmJiByb29tLnR0bCA8IG5vdykge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBoYXMgZXhwaXJlZC4gUGxlYXNlIGNyZWF0ZSBhIG5ldyByb29tLicpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiB1c2VyIGlzIGFscmVhZHkgaW4gdGhlIHJvb21cclxuICAgICAgY29uc3QgaXNBbHJlYWR5SW5Sb29tID0gYXdhaXQgdGhpcy5pc1VzZXJJblJvb20odXNlcklkLCByb29tLmlkKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChpc0FscmVhZHlJblJvb20pIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gaXMgYWxyZWFkeSBpbiByb29tICR7cm9vbS5pZH0sIHJldHVybmluZyByb29tIGRhdGFgKTtcclxuICAgICAgICByZXR1cm4gcm9vbTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gQ1JJVElDQUw6IENoZWNrIHBhcnRpY2lwYW50IGNvdW50IEJFRk9SRSBhdHRlbXB0aW5nIHRvIGpvaW5cclxuICAgICAgLy8gVGhpcyBpbmNsdWRlcyB0aGUgaG9zdCBhcyB0aGUgZmlyc3QgcGFydGljaXBhbnRcclxuICAgICAgY29uc3QgY3VycmVudFBhcnRpY2lwYW50cyA9IGF3YWl0IHRoaXMuZ2V0Um9vbVBhcnRpY2lwYW50Q291bnQocm9vbS5pZCk7XHJcbiAgICAgIGNvbnN0IG1heFBhcnRpY2lwYW50cyA9IHJvb20ubWF4UGFydGljaXBhbnRzIHx8IDI7IC8vIERlZmF1bHQgdG8gMiBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coYFJvb20gJHtyb29tLmlkfSBoYXMgJHtjdXJyZW50UGFydGljaXBhbnRzfS8ke21heFBhcnRpY2lwYW50c30gcGFydGljaXBhbnRzIChpbmNsdWRpbmcgaG9zdClgKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChjdXJyZW50UGFydGljaXBhbnRzID49IG1heFBhcnRpY2lwYW50cykge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRXN0YSBzYWxhIGVzdMOhIGxsZW5hLicpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBBdHRlbXB0IHRvIHJlY29yZCBwYXJ0aWNpcGF0aW9uIHdpdGggYXRvbWljIGNoZWNrXHJcbiAgICAgIC8vIFRoaXMgd2lsbCBmYWlsIGlmIGFub3RoZXIgdXNlciBqb2lucyBzaW11bHRhbmVvdXNseSBhbmQgZmlsbHMgdGhlIHJvb21cclxuICAgICAgYXdhaXQgdGhpcy5yZWNvcmRSb29tUGFydGljaXBhdGlvbih1c2VySWQsIHJvb20uaWQsIG1heFBhcnRpY2lwYW50cyk7XHJcblxyXG4gICAgICAvLyBEb3VibGUtY2hlY2sgYWZ0ZXIgcmVjb3JkaW5nIHRvIGVuc3VyZSB3ZSBkaWRuJ3QgZXhjZWVkIHRoZSBsaW1pdFxyXG4gICAgICAvLyBUaGlzIGlzIGEgc2FmZXR5IGNoZWNrIGluIGNhc2Ugb2YgcmFjZSBjb25kaXRpb25zXHJcbiAgICAgIGNvbnN0IGZpbmFsUGFydGljaXBhbnRzID0gYXdhaXQgdGhpcy5nZXRSb29tUGFydGljaXBhbnRDb3VudChyb29tLmlkKTtcclxuICAgICAgaWYgKGZpbmFsUGFydGljaXBhbnRzID4gbWF4UGFydGljaXBhbnRzKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgUkFDRSBDT05ESVRJT04gREVURUNURUQ6IFJvb20gJHtyb29tLmlkfSBub3cgaGFzICR7ZmluYWxQYXJ0aWNpcGFudHN9LyR7bWF4UGFydGljaXBhbnRzfSBwYXJ0aWNpcGFudHNgKTtcclxuICAgICAgICAvLyBOb3RlOiBJbiBwcm9kdWN0aW9uLCB5b3UgbWlnaHQgd2FudCB0byBpbXBsZW1lbnQgYSBjbGVhbnVwIG1lY2hhbmlzbSBoZXJlXHJcbiAgICAgICAgLy8gRm9yIG5vdywgd2UgbG9nIHRoZSBlcnJvciBidXQgYWxsb3cgdGhlIGpvaW4gc2luY2UgdGhlIHJlY29yZCBpcyBhbHJlYWR5IGNyZWF0ZWRcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IHN1Y2Nlc3NmdWxseSBqb2luZWQgcm9vbTogJHtyb29tLmlkfSB3aXRoIGNvZGU6ICR7Y29kZX1gKTtcclxuICAgICAgcmV0dXJuIHJvb207XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAvLyBGYWxsYmFjayB0byBzY2FuIGlmIEdTSSBpcyBub3QgYXZhaWxhYmxlIHlldFxyXG4gICAgICBjb25zdCBlcnIgPSBlcnJvciBhcyBhbnk7XHJcbiAgICAgIGlmIChlcnIubmFtZSA9PT0gJ1Jlc291cmNlTm90Rm91bmRFeGNlcHRpb24nIHx8IGVyci5tZXNzYWdlPy5pbmNsdWRlcygnR1NJJykpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnR1NJIG5vdCBhdmFpbGFibGUsIGZhbGxpbmcgYmFjayB0byBzY2FuIG1ldGhvZCcpO1xyXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmpvaW5Sb29tQnlTY2FuKHVzZXJJZCwgY29kZSk7XHJcbiAgICAgIH1cclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGpvaW5Sb29tQnlTY2FuKHVzZXJJZDogc3RyaW5nLCBjb2RlOiBzdHJpbmcpOiBQcm9taXNlPFJvb20+IHtcclxuICAgIC8vIEZhbGxiYWNrIG1ldGhvZCB1c2luZyBzY2FuXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgU2NhbkNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHRoaXMudGFibGVOYW1lLFxyXG4gICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnY29kZSA9IDpjb2RlJyxcclxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICc6Y29kZSc6IGNvZGUudG9VcHBlckNhc2UoKSxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdC5JdGVtcyB8fCByZXN1bHQuSXRlbXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBub3QgZm91bmQuIFBsZWFzZSBjaGVjayB0aGUgcm9vbSBjb2RlLicpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJvb20gPSByZXN1bHQuSXRlbXNbMF0gYXMgUm9vbTtcclxuXHJcbiAgICAvLyBDaGVjayBpZiByb29tIGhhcyBleHBpcmVkXHJcbiAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgIGlmIChyb29tLnR0bCAmJiByb29tLnR0bCA8IG5vdykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gaGFzIGV4cGlyZWQuIFBsZWFzZSBjcmVhdGUgYSBuZXcgcm9vbS4nKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDaGVjayBpZiB1c2VyIGlzIGFscmVhZHkgaW4gdGhlIHJvb21cclxuICAgIGNvbnN0IGlzQWxyZWFkeUluUm9vbSA9IGF3YWl0IHRoaXMuaXNVc2VySW5Sb29tKHVzZXJJZCwgcm9vbS5pZCk7XHJcbiAgICBcclxuICAgIGlmIChpc0FscmVhZHlJblJvb20pIHtcclxuICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGlzIGFscmVhZHkgaW4gcm9vbSAke3Jvb20uaWR9LCByZXR1cm5pbmcgcm9vbSBkYXRhIChzY2FuIG1ldGhvZClgKTtcclxuICAgICAgcmV0dXJuIHJvb207XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ1JJVElDQUw6IENoZWNrIHBhcnRpY2lwYW50IGNvdW50IEJFRk9SRSBhdHRlbXB0aW5nIHRvIGpvaW5cclxuICAgIC8vIFRoaXMgaW5jbHVkZXMgdGhlIGhvc3QgYXMgdGhlIGZpcnN0IHBhcnRpY2lwYW50XHJcbiAgICBjb25zdCBjdXJyZW50UGFydGljaXBhbnRzID0gYXdhaXQgdGhpcy5nZXRSb29tUGFydGljaXBhbnRDb3VudChyb29tLmlkKTtcclxuICAgIGNvbnN0IG1heFBhcnRpY2lwYW50cyA9IHJvb20ubWF4UGFydGljaXBhbnRzIHx8IDI7IC8vIERlZmF1bHQgdG8gMiBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZyhgUm9vbSAke3Jvb20uaWR9IGhhcyAke2N1cnJlbnRQYXJ0aWNpcGFudHN9LyR7bWF4UGFydGljaXBhbnRzfSBwYXJ0aWNpcGFudHMgKGluY2x1ZGluZyBob3N0KSAtIHNjYW4gbWV0aG9kYCk7XHJcbiAgICBcclxuICAgIGlmIChjdXJyZW50UGFydGljaXBhbnRzID49IG1heFBhcnRpY2lwYW50cykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0VzdGEgc2FsYSBlc3TDoSBsbGVuYS4nKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBBdHRlbXB0IHRvIHJlY29yZCBwYXJ0aWNpcGF0aW9uIHdpdGggYXRvbWljIGNoZWNrXHJcbiAgICBhd2FpdCB0aGlzLnJlY29yZFJvb21QYXJ0aWNpcGF0aW9uKHVzZXJJZCwgcm9vbS5pZCwgbWF4UGFydGljaXBhbnRzKTtcclxuXHJcbiAgICAvLyBEb3VibGUtY2hlY2sgYWZ0ZXIgcmVjb3JkaW5nIHRvIGVuc3VyZSB3ZSBkaWRuJ3QgZXhjZWVkIHRoZSBsaW1pdFxyXG4gICAgY29uc3QgZmluYWxQYXJ0aWNpcGFudHMgPSBhd2FpdCB0aGlzLmdldFJvb21QYXJ0aWNpcGFudENvdW50KHJvb20uaWQpO1xyXG4gICAgaWYgKGZpbmFsUGFydGljaXBhbnRzID4gbWF4UGFydGljaXBhbnRzKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYFJBQ0UgQ09ORElUSU9OIERFVEVDVEVEOiBSb29tICR7cm9vbS5pZH0gbm93IGhhcyAke2ZpbmFsUGFydGljaXBhbnRzfS8ke21heFBhcnRpY2lwYW50c30gcGFydGljaXBhbnRzIChzY2FuIG1ldGhvZClgKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gc3VjY2Vzc2Z1bGx5IGpvaW5lZCByb29tOiAke3Jvb20uaWR9IHdpdGggY29kZTogJHtjb2RlfSAoc2NhbiBtZXRob2QpYCk7XHJcbiAgICByZXR1cm4gcm9vbTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVjb3JkUm9vbVBhcnRpY2lwYXRpb24odXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nLCBtYXhQYXJ0aWNpcGFudHM6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3Qgdm90ZXNUYWJsZSA9IHByb2Nlc3MuZW52LlZPVEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgICBpZiAoIXZvdGVzVGFibGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ1ZPVEVTX1RBQkxFIG5vdCBjb25maWd1cmVkLCBza2lwcGluZyBwYXJ0aWNpcGF0aW9uIHRyYWNraW5nJyk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDcmVhdGUgYSBzcGVjaWFsIFwicGFydGljaXBhdGlvblwiIHJlY29yZCBpbiBWT1RFUyB0YWJsZVxyXG4gICAgICAvLyBUaGlzIGFsbG93cyB0aGUgcm9vbSB0byBhcHBlYXIgaW4gZ2V0TXlSb29tcygpIGV2ZW4gd2l0aG91dCBhY3R1YWwgdm90ZXNcclxuICAgICAgY29uc3QgcGFydGljaXBhdGlvblJlY29yZCA9IHtcclxuICAgICAgICByb29tSWQsXHJcbiAgICAgICAgdXNlck1vdmllSWQ6IGAke3VzZXJJZH0jSk9JTkVEYCwgLy8gU3BlY2lhbCBtYXJrZXIgZm9yIHJvb20gcGFydGljaXBhdGlvblxyXG4gICAgICAgIHVzZXJJZCxcclxuICAgICAgICBtb3ZpZUlkOiAtMSwgLy8gU3BlY2lhbCB2YWx1ZSBpbmRpY2F0aW5nIHRoaXMgaXMgYSBwYXJ0aWNpcGF0aW9uIHJlY29yZCwgbm90IGEgdm90ZVxyXG4gICAgICAgIHZvdGU6IGZhbHNlLCAvLyBOb3QgYSByZWFsIHZvdGVcclxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICBpc1BhcnRpY2lwYXRpb246IHRydWUsIC8vIEZsYWcgdG8gZGlzdGluZ3Vpc2ggZnJvbSByZWFsIHZvdGVzXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBVc2UgY29uZGl0aW9uYWwgZXhwcmVzc2lvbiB0byBlbnN1cmUgYXRvbWljaXR5IGFuZCBwcmV2ZW50IGV4Y2VlZGluZyBtYXhQYXJ0aWNpcGFudHNcclxuICAgICAgLy8gVGhpcyBwcmV2ZW50cyByYWNlIGNvbmRpdGlvbnMgd2hlbiBtdWx0aXBsZSB1c2VycyB0cnkgdG8gam9pbiBzaW11bHRhbmVvdXNseVxyXG4gICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB2b3Rlc1RhYmxlLFxyXG4gICAgICAgIEl0ZW06IHBhcnRpY2lwYXRpb25SZWNvcmQsXHJcbiAgICAgICAgQ29uZGl0aW9uRXhwcmVzc2lvbjogJ2F0dHJpYnV0ZV9ub3RfZXhpc3RzKHVzZXJNb3ZpZUlkKScsXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBQYXJ0aWNpcGF0aW9uIHJlY29yZGVkIGZvciB1c2VyICR7dXNlcklkfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgLy8gSWYgY29uZGl0aW9uIGZhaWxzLCB1c2VyIGlzIGFscmVhZHkgaW4gdGhlIHJvb20gLSB0aGlzIGlzIE9LXHJcbiAgICAgIGNvbnN0IGVyciA9IGVycm9yIGFzIGFueTtcclxuICAgICAgaWYgKGVyci5uYW1lID09PSAnQ29uZGl0aW9uYWxDaGVja0ZhaWxlZEV4Y2VwdGlvbicpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gYWxyZWFkeSBoYXMgcGFydGljaXBhdGlvbiByZWNvcmQgaW4gcm9vbSAke3Jvb21JZH1gKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgcmVjb3JkaW5nIHBhcnRpY2lwYXRpb24gZm9yIHVzZXIgJHt1c2VySWR9IGluIHJvb20gJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7IC8vIFJlLXRocm93IHRvIGZhaWwgdGhlIGpvaW4gb3BlcmF0aW9uIG9uIHVuZXhwZWN0ZWQgZXJyb3JzXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldFJvb21QYXJ0aWNpcGFudENvdW50KHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXI+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHZvdGVzVGFibGUgPSBwcm9jZXNzLmVudi5WT1RFU19UQUJMRSB8fCAnJztcclxuICAgICAgaWYgKCF2b3Rlc1RhYmxlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdWT1RFU19UQUJMRSBub3QgY29uZmlndXJlZCwgY2Fubm90IGNvdW50IHBhcnRpY2lwYW50cycpO1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBRdWVyeSBhbGwgcGFydGljaXBhdGlvbiByZWNvcmRzIGZvciB0aGlzIHJvb21cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB2b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnaXNQYXJ0aWNpcGF0aW9uID0gOmlzUGFydGljaXBhdGlvbicsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgICAnOmlzUGFydGljaXBhdGlvbic6IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgcGFydGljaXBhbnRzID0gcmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICBjb25zdCB1bmlxdWVVc2VySWRzID0gbmV3IFNldChwYXJ0aWNpcGFudHMubWFwKHAgPT4gcC51c2VySWQpKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGBSb29tICR7cm9vbUlkfSBoYXMgJHt1bmlxdWVVc2VySWRzLnNpemV9IHVuaXF1ZSBwYXJ0aWNpcGFudHNgKTtcclxuICAgICAgcmV0dXJuIHVuaXF1ZVVzZXJJZHMuc2l6ZTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGNvdW50aW5nIHBhcnRpY2lwYW50cyBmb3Igcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgaXNVc2VySW5Sb29tKHVzZXJJZDogc3RyaW5nLCByb29tSWQ6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3Qgdm90ZXNUYWJsZSA9IHByb2Nlc3MuZW52LlZPVEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgICBpZiAoIXZvdGVzVGFibGUpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHVzZXIgaGFzIGEgcGFydGljaXBhdGlvbiByZWNvcmQgaW4gdGhpcyByb29tXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdm90ZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ3VzZXJJZCA9IDp1c2VySWQgQU5EIGlzUGFydGljaXBhdGlvbiA9IDppc1BhcnRpY2lwYXRpb24nLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgICAnOmlzUGFydGljaXBhdGlvbic6IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBMaW1pdDogMSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgaXNJblJvb20gPSAhIShyZXN1bHQuSXRlbXMgJiYgcmVzdWx0Lkl0ZW1zLmxlbmd0aCA+IDApO1xyXG4gICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gJHtpc0luUm9vbSA/ICdpcyBhbHJlYWR5JyA6ICdpcyBub3QnfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG4gICAgICByZXR1cm4gaXNJblJvb207XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBjaGVja2luZyBpZiB1c2VyICR7dXNlcklkfSBpcyBpbiByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGdldE15Um9vbXModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPFJvb21bXT4ge1xyXG4gICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignZ2V0TXlSb29tcyBjYWxsZWQgd2l0aG91dCB1c2VySWQnKTtcclxuICAgICAgcmV0dXJuIFtdOyAvLyBSZXR1cm4gZW1wdHkgYXJyYXkgaW5zdGVhZCBvZiB0aHJvd2luZ1xyXG4gICAgfVxyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBHZXR0aW5nIHJvb21zIGZvciB1c2VyOiAke3VzZXJJZH1gKTtcclxuICAgICAgY29uc3QgYWxsUm9vbXM6IFJvb21bXSA9IFtdO1xyXG5cclxuICAgICAgLy8gMS4gR2V0IHJvb21zIHdoZXJlIHVzZXIgaXMgdGhlIGhvc3QgLSB1c2Ugc2NhbiBmb3Igbm93IHNpbmNlIEdTSSBtaWdodCBub3QgYmUgcmVhZHlcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBob3N0Um9vbXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgU2NhbkNvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdob3N0SWQgPSA6dXNlcklkJyxcclxuICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgY29uc3QgaG9zdFJvb21zID0gaG9zdFJvb21zUmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke2hvc3RSb29tcy5sZW5ndGh9IHJvb21zIHdoZXJlIHVzZXIgaXMgaG9zdGApO1xyXG4gICAgICAgIGFsbFJvb21zLnB1c2goLi4uKGhvc3RSb29tcyBhcyBSb29tW10pKTtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBmZXRjaGluZyBob3N0IHJvb21zOicsIGVycm9yKTtcclxuICAgICAgICAvLyBDb250aW51ZSB3aXRoIGVtcHR5IGhvc3Qgcm9vbXNcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gMi4gR2V0IHJvb21zIHdoZXJlIHVzZXIgaGFzIHBhcnRpY2lwYXRlZCAoam9pbmVkIG9yIHZvdGVkKVxyXG4gICAgICBjb25zdCB2b3Rlc1RhYmxlID0gcHJvY2Vzcy5lbnYuVk9URVNfVEFCTEUgfHwgJyc7XHJcbiAgICAgIGlmICh2b3Rlc1RhYmxlKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIC8vIEdldCBhbGwgcGFydGljaXBhdGlvbiByZWNvcmRzIGJ5IHRoaXMgdXNlciAtIHVzZSBzY2FuIGZvciBub3dcclxuICAgICAgICAgIGNvbnN0IHVzZXJQYXJ0aWNpcGF0aW9uUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFNjYW5Db21tYW5kKHtcclxuICAgICAgICAgICAgVGFibGVOYW1lOiB2b3Rlc1RhYmxlLFxyXG4gICAgICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAndXNlcklkID0gOnVzZXJJZCcsXHJcbiAgICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgICBjb25zdCB1c2VyUGFydGljaXBhdGlvbiA9IHVzZXJQYXJ0aWNpcGF0aW9uUmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7dXNlclBhcnRpY2lwYXRpb24ubGVuZ3RofSBwYXJ0aWNpcGF0aW9uIHJlY29yZHMgZm9yIHVzZXJgKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gR2V0IHVuaXF1ZSByb29tIElEcyBmcm9tIHBhcnRpY2lwYXRpb24gcmVjb3JkcyAoYm90aCB2b3RlcyBhbmQgam9pbnMpXHJcbiAgICAgICAgICBjb25zdCBwYXJ0aWNpcGF0ZWRSb29tSWRzID0gbmV3IFNldCh1c2VyUGFydGljaXBhdGlvbi5tYXAocmVjb3JkID0+IHJlY29yZC5yb29tSWQpKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gR2V0IHJvb20gZGV0YWlscyBmb3IgcGFydGljaXBhdGVkIHJvb21zIChleGNsdWRpbmcgYWxyZWFkeSBmZXRjaGVkIGhvc3Qgcm9vbXMpXHJcbiAgICAgICAgICBjb25zdCBob3N0Um9vbUlkcyA9IG5ldyBTZXQoYWxsUm9vbXMubWFwKHJvb20gPT4gcm9vbS5pZCkpO1xyXG4gICAgICAgICAgY29uc3QgbmV3Um9vbUlkcyA9IEFycmF5LmZyb20ocGFydGljaXBhdGVkUm9vbUlkcykuZmlsdGVyKHJvb21JZCA9PiAhaG9zdFJvb21JZHMuaGFzKHJvb21JZCkpO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHtuZXdSb29tSWRzLmxlbmd0aH0gYWRkaXRpb25hbCByb29tcyB3aGVyZSB1c2VyIHBhcnRpY2lwYXRlZGApO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBGZXRjaCByb29tIGRldGFpbHMgZm9yIHBhcnRpY2lwYXRlZCByb29tc1xyXG4gICAgICAgICAgY29uc3QgcGFydGljaXBhdGVkUm9vbXNQcm9taXNlcyA9IG5ld1Jvb21JZHMubWFwKGFzeW5jIChyb29tSWQpID0+IHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICBjb25zdCByb29tUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICAgICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgICAgICAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgICAgICAgIHJldHVybiByb29tUmVzdWx0Lkl0ZW0gYXMgUm9vbTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBmZXRjaGluZyByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgIGNvbnN0IHBhcnRpY2lwYXRlZFJvb21zID0gKGF3YWl0IFByb21pc2UuYWxsKHBhcnRpY2lwYXRlZFJvb21zUHJvbWlzZXMpKVxyXG4gICAgICAgICAgICAuZmlsdGVyKHJvb20gPT4gcm9vbSAhPT0gbnVsbCkgYXMgUm9vbVtdO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBhbGxSb29tcy5wdXNoKC4uLnBhcnRpY2lwYXRlZFJvb21zKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgcGFydGljaXBhdGVkIHJvb21zOicsIGVycm9yKTtcclxuICAgICAgICAgIC8vIENvbnRpbnVlIHdpdGggb25seSBob3N0IHJvb21zXHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignVk9URVNfVEFCTEUgbm90IGNvbmZpZ3VyZWQsIG9ubHkgc2hvd2luZyBob3N0ZWQgcm9vbXMnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gMy4gRmlsdGVyIG91dCBleHBpcmVkIHJvb21zIGFuZCByb29tcyB3aXRoIG1hdGNoZXNcclxuICAgICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XHJcbiAgICAgIGNvbnN0IGFjdGl2ZVJvb21zID0gYWxsUm9vbXMuZmlsdGVyKHJvb20gPT4gIXJvb20udHRsIHx8IHJvb20udHRsID49IG5vdyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke2FjdGl2ZVJvb21zLmxlbmd0aH0gYWN0aXZlIHJvb21zIGFmdGVyIGZpbHRlcmluZyBleHBpcmVkYCk7XHJcblxyXG4gICAgICAvLyA0LiBDaGVjayBmb3IgbWF0Y2hlcyBhbmQgZmlsdGVyIG91dCByb29tcyB3aXRoIG1hdGNoZXNcclxuICAgICAgY29uc3QgbWF0Y2hlc1RhYmxlID0gcHJvY2Vzcy5lbnYuTUFUQ0hFU19UQUJMRSB8fCAnJztcclxuICAgICAgaWYgKG1hdGNoZXNUYWJsZSkge1xyXG4gICAgICAgIGNvbnN0IHJvb21zV2l0aG91dE1hdGNoZXMgPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICBmb3IgKGNvbnN0IHJvb20gb2YgYWN0aXZlUm9vbXMpIHtcclxuICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIHJvb20gaGFzIGFueSBtYXRjaGVzXHJcbiAgICAgICAgICAgIGNvbnN0IG1hdGNoUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgICAgICAgVGFibGVOYW1lOiBtYXRjaGVzVGFibGUsXHJcbiAgICAgICAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICAgICAgICc6cm9vbUlkJzogcm9vbS5pZCxcclxuICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgIExpbWl0OiAxLCAvLyBXZSBvbmx5IG5lZWQgdG8ga25vdyBpZiBhbnkgbWF0Y2ggZXhpc3RzXHJcbiAgICAgICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgICAgIC8vIElmIG5vIG1hdGNoZXMgZm91bmQsIGluY2x1ZGUgdGhlIHJvb21cclxuICAgICAgICAgICAgaWYgKCFtYXRjaFJlc3VsdC5JdGVtcyB8fCBtYXRjaFJlc3VsdC5JdGVtcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgICByb29tc1dpdGhvdXRNYXRjaGVzLnB1c2gocm9vbSk7XHJcbiAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgY29uc29sZS5sb2coYFJvb20gJHtyb29tLmlkfSBoYXMgbWF0Y2hlcywgZXhjbHVkaW5nIGZyb20gcmVzdWx0c2ApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBjaGVja2luZyBtYXRjaGVzIGZvciByb29tICR7cm9vbS5pZH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICAvLyBJbmNsdWRlIHJvb20gaWYgd2UgY2FuJ3QgY2hlY2sgbWF0Y2hlcyAoZmFpbCBzYWZlKVxyXG4gICAgICAgICAgICByb29tc1dpdGhvdXRNYXRjaGVzLnB1c2gocm9vbSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHtyb29tc1dpdGhvdXRNYXRjaGVzLmxlbmd0aH0gYWN0aXZlIHJvb21zIHdpdGhvdXQgbWF0Y2hlcyBmb3IgdXNlciAke3VzZXJJZH1gKTtcclxuICAgICAgICByZXR1cm4gcm9vbXNXaXRob3V0TWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBuZXcgRGF0ZShiLmNyZWF0ZWRBdCkuZ2V0VGltZSgpIC0gbmV3IERhdGUoYS5jcmVhdGVkQXQpLmdldFRpbWUoKSk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke2FjdGl2ZVJvb21zLmxlbmd0aH0gYWN0aXZlIHJvb21zIGZvciB1c2VyICR7dXNlcklkfSAobWF0Y2hlcyB0YWJsZSBub3QgY29uZmlndXJlZClgKTtcclxuICAgICAgcmV0dXJuIGFjdGl2ZVJvb21zLnNvcnQoKGEsIGIpID0+IG5ldyBEYXRlKGIuY3JlYXRlZEF0KS5nZXRUaW1lKCkgLSBuZXcgRGF0ZShhLmNyZWF0ZWRBdCkuZ2V0VGltZSgpKTtcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBmZXRjaGluZyB1c2VyIHJvb21zOicsIGVycm9yKTtcclxuICAgICAgLy8gUmV0dXJuIGVtcHR5IGFycmF5IGluc3RlYWQgb2YgdGhyb3dpbmcgdG8gcHJldmVudCBHcmFwaFFMIG51bGwgZXJyb3JcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0Um9vbShyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8Um9vbSB8IG51bGw+IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgS2V5OiB7IGlkOiByb29tSWQgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdC5JdGVtKSB7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJvb20gPSByZXN1bHQuSXRlbSBhcyBSb29tO1xyXG5cclxuICAgIC8vIENoZWNrIGlmIHJvb20gaGFzIGV4cGlyZWRcclxuICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xyXG4gICAgaWYgKHJvb20udHRsICYmIHJvb20udHRsIDwgbm93KSB7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByb29tO1xyXG4gIH1cclxufVxyXG5cclxuLy8gTGFtYmRhIEhhbmRsZXIgZm9yIEFwcFN5bmNcclxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXIgPSBhc3luYyAoZXZlbnQpID0+IHtcclxuICBjb25zb2xlLmxvZygnUm9vbSBMYW1iZGEgcmVjZWl2ZWQgQXBwU3luYyBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCkpO1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3Qgcm9vbVNlcnZpY2UgPSBuZXcgUm9vbVNlcnZpY2UoKTtcclxuXHJcbiAgICAvLyBFeHRyYWN0IHVzZXIgSUQgZnJvbSBBcHBTeW5jIGNvbnRleHRcclxuICAgIGNvbnN0IHVzZXJJZCA9IGV2ZW50LmlkZW50aXR5Py5jbGFpbXM/LnN1YiB8fCBldmVudC5pZGVudGl0eT8udXNlcm5hbWU7XHJcbiAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgbm90IGF1dGhlbnRpY2F0ZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBEZXRlcm1pbmUgb3BlcmF0aW9uIGZyb20gQXBwU3luYyBmaWVsZCBuYW1lXHJcbiAgICBjb25zdCBmaWVsZE5hbWUgPSBldmVudC5pbmZvPy5maWVsZE5hbWU7XHJcbiAgICBjb25zb2xlLmxvZygnRmllbGQgbmFtZTonLCBmaWVsZE5hbWUpO1xyXG4gICAgXHJcbiAgICBzd2l0Y2ggKGZpZWxkTmFtZSkge1xyXG4gICAgICBjYXNlICdjcmVhdGVSb29tJzoge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIGNyZWF0ZVJvb20gbXV0YXRpb24nKTtcclxuICAgICAgICBjb25zdCB7IGlucHV0IH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgY29uc3QgeyBtZWRpYVR5cGUsIGdlbnJlSWRzLCBtYXhQYXJ0aWNpcGFudHMgfSA9IGlucHV0O1xyXG5cclxuICAgICAgICBjb25zdCByb29tID0gYXdhaXQgcm9vbVNlcnZpY2UuY3JlYXRlUm9vbSh1c2VySWQsIG1lZGlhVHlwZSwgZ2VucmVJZHMsIG1heFBhcnRpY2lwYW50cyk7XHJcbiAgICAgICAgcmV0dXJuIHJvb207XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2pvaW5Sb29tJzoge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIGpvaW5Sb29tIG11dGF0aW9uJyk7XHJcbiAgICAgICAgY29uc3QgeyBjb2RlIH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgY29uc3Qgcm9vbSA9IGF3YWl0IHJvb21TZXJ2aWNlLmpvaW5Sb29tKHVzZXJJZCwgY29kZSk7XHJcbiAgICAgICAgcmV0dXJuIHJvb207XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2dldE15Um9vbXMnOiB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1Byb2Nlc3NpbmcgZ2V0TXlSb29tcyBxdWVyeScpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCByb29tcyA9IGF3YWl0IHJvb21TZXJ2aWNlLmdldE15Um9vbXModXNlcklkKTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBSZXR1cm5pbmcgJHtyb29tcy5sZW5ndGh9IHJvb21zIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICAgICAgcmV0dXJuIHJvb21zO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBnZXRNeVJvb21zIGhhbmRsZXI6JywgZXJyb3IpO1xyXG4gICAgICAgICAgLy8gUmV0dXJuIGVtcHR5IGFycmF5IHRvIHByZXZlbnQgR3JhcGhRTCBudWxsIGVycm9yXHJcbiAgICAgICAgICByZXR1cm4gW107XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdnZXRSb29tJzoge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIGdldFJvb20gcXVlcnknKTtcclxuICAgICAgICBjb25zdCB7IGlkIH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgY29uc3Qgcm9vbSA9IGF3YWl0IHJvb21TZXJ2aWNlLmdldFJvb20oaWQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghcm9vbSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZCBvciBoYXMgZXhwaXJlZCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gcm9vbTtcclxuICAgICAgfVxyXG5cclxuICAgICAgZGVmYXVsdDpcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdVbmtub3duIGZpZWxkIG5hbWU6JywgZmllbGROYW1lKTtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdBdmFpbGFibGUgZXZlbnQgcHJvcGVydGllczonLCBPYmplY3Qua2V5cyhldmVudCkpO1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0V2ZW50IGluZm86JywgZXZlbnQuaW5mbyk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGZpZWxkOiAke2ZpZWxkTmFtZX1gKTtcclxuICAgIH1cclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1Jvb20gTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCc7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcclxuICB9XHJcbn07Il19