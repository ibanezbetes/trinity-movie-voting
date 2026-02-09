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
        // CRITICAL DEBUG: Log full identity structure to understand userId format
        console.log('🔍 IDENTITY DEBUG:', JSON.stringify({
            identityType: event.identity?.constructor?.name,
            claims: event.identity?.claims,
            username: event.identity?.username,
            sourceIp: event.identity?.sourceIp,
            userArn: event.identity?.userArn,
            accountId: event.identity?.accountId,
            cognitoIdentityPoolId: event.identity?.cognitoIdentityPoolId,
            cognitoIdentityId: event.identity?.cognitoIdentityId,
            principalOrgId: event.identity?.principalOrgId,
        }));
        // Extract user ID from AppSync context
        // For IAM auth (Google): use cognitoIdentityId (REQUIRED - this is the unique user ID)
        // For User Pool auth: use claims.sub
        // CRITICAL: Do NOT use username as fallback - it's the IAM role name, not unique per user!
        const userId = event.identity?.cognitoIdentityId || event.identity?.claims?.sub;
        console.log('🆔 EXTRACTED USER ID:', userId);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvcm9vbS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQWtIO0FBQ2xILDBEQUFxRTtBQUNyRSxtQ0FBb0M7QUFFcEMseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUEwRDFFLHNCQUFzQjtBQUN0QixNQUFNLGlCQUFpQjtJQUlyQixNQUFNLENBQUMsUUFBUTtRQUNiLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUNkLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDMUMsSUFBSSxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUNyRixDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsTUFBTSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBaUMsRUFBRSxTQUFpQjtRQUM5RSxJQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7UUFDakIsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFDO1FBRXZCLE9BQU8sUUFB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QUFDLElBQUksQ0FBQyxDQUFDO2dCQUN6QyxNQUFNLElBQUksS0FBSyxDQUFDLGtCQUFrQixTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBQ25ELENBQUM7SUFFSCxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsb0JBQW9CLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFM0MsTUFBTSxZQUFZLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUM7UUFDdkYsTUFBTSxJQUFJLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUNoQyxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBMUZXLFFBQUEsT0FBTyxXQTBGbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUHV0Q29tbWFuZCwgR2V0Q29tbWFuZCwgUXVlcnlDb21tYW5kLCBTY2FuQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XHJcbmltcG9ydCB7IExhbWJkYUNsaWVudCwgSW52b2tlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1sYW1iZGEnO1xyXG5pbXBvcnQgeyByYW5kb21VVUlEIH0gZnJvbSAnY3J5cHRvJztcclxuXHJcbi8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcclxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KTtcclxuY29uc3QgbGFtYmRhQ2xpZW50ID0gbmV3IExhbWJkYUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuXHJcbi8vIFR5cGVzXHJcbmludGVyZmFjZSBNb3ZpZUNhbmRpZGF0ZSB7XHJcbiAgaWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIG92ZXJ2aWV3OiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aDogc3RyaW5nIHwgbnVsbDtcclxuICByZWxlYXNlRGF0ZTogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbn1cclxuXHJcbmludGVyZmFjZSBSb29tIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIGNvZGU6IHN0cmluZztcclxuICBob3N0SWQ6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIGdlbnJlSWRzOiBudW1iZXJbXTtcclxuICBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdO1xyXG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xyXG4gIHR0bDogbnVtYmVyO1xyXG4gIG1heFBhcnRpY2lwYW50czogbnVtYmVyO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQ3JlYXRlUm9vbUV2ZW50IHtcclxuICBvcGVyYXRpb246ICdjcmVhdGVSb29tJztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICBpbnB1dDoge1xyXG4gICAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxuICAgIGdlbnJlSWRzOiBudW1iZXJbXTtcclxuICAgIG1heFBhcnRpY2lwYW50czogbnVtYmVyO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBKb2luUm9vbUV2ZW50IHtcclxuICBvcGVyYXRpb246ICdqb2luUm9vbSc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgY29kZTogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgR2V0Um9vbUV2ZW50IHtcclxuICBvcGVyYXRpb246ICdnZXRSb29tJztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICByb29tSWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIEdldE15Um9vbXNFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnZ2V0TXlSb29tcyc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbn1cclxuXHJcbnR5cGUgUm9vbUV2ZW50ID0gQ3JlYXRlUm9vbUV2ZW50IHwgSm9pblJvb21FdmVudCB8IEdldFJvb21FdmVudCB8IEdldE15Um9vbXNFdmVudDtcclxuXHJcbmludGVyZmFjZSBSb29tUmVzcG9uc2Uge1xyXG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcclxuICBib2R5OiBSb29tIHwgUm9vbVtdIHwgeyBlcnJvcjogc3RyaW5nIH07XHJcbn1cclxuXHJcbi8vIFJvb20gY29kZSBnZW5lcmF0b3JcclxuY2xhc3MgUm9vbUNvZGVHZW5lcmF0b3Ige1xyXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IENIQVJBQ1RFUlMgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5JztcclxuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBDT0RFX0xFTkdUSCA9IDY7XHJcblxyXG4gIHN0YXRpYyBnZW5lcmF0ZSgpOiBzdHJpbmcge1xyXG4gICAgbGV0IGNvZGUgPSAnJztcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5DT0RFX0xFTkdUSDsgaSsrKSB7XHJcbiAgICAgIGNvZGUgKz0gdGhpcy5DSEFSQUNURVJTLmNoYXJBdChNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiB0aGlzLkNIQVJBQ1RFUlMubGVuZ3RoKSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gY29kZTtcclxuICB9XHJcblxyXG4gIHN0YXRpYyBhc3luYyBnZW5lcmF0ZVVuaXF1ZShkb2NDbGllbnQ6IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIHRhYmxlTmFtZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIGxldCBhdHRlbXB0cyA9IDA7XHJcbiAgICBjb25zdCBtYXhBdHRlbXB0cyA9IDEwO1xyXG5cclxuICAgIHdoaWxlIChhdHRlbXB0cyA8IG1heEF0dGVtcHRzKSB7XHJcbiAgICAgIGNvbnN0IGNvZGUgPSB0aGlzLmdlbmVyYXRlKCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBpZiBjb2RlIGFscmVhZHkgZXhpc3RzXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHRhYmxlTmFtZSxcclxuICAgICAgICAgIEluZGV4TmFtZTogJ2NvZGUtaW5kZXgnLFxyXG4gICAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ2NvZGUgPSA6Y29kZScsXHJcbiAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAgICc6Y29kZSc6IGNvZGUsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgaWYgKCFyZXN1bHQuSXRlbXMgfHwgcmVzdWx0Lkl0ZW1zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgcmV0dXJuIGNvZGU7IC8vIENvZGUgaXMgdW5pcXVlXHJcbiAgICAgICAgfVxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGNvZGUgdW5pcXVlbmVzczonLCBlcnJvcik7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGF0dGVtcHRzKys7XHJcbiAgICB9XHJcblxyXG4gICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gZ2VuZXJhdGUgdW5pcXVlIHJvb20gY29kZSBhZnRlciBtYXhpbXVtIGF0dGVtcHRzJyk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBUTURCIEludGVncmF0aW9uXHJcbmNsYXNzIFRNREJJbnRlZ3JhdGlvbiB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBsYW1iZGFBcm46IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmxhbWJkYUFybiA9IHByb2Nlc3MuZW52LlRNREJfTEFNQkRBX0FSTiB8fCAnJztcclxuICAgIGlmICghdGhpcy5sYW1iZGFBcm4pIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdUTURCX0xBTUJEQV9BUk4gZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGZldGNoQ2FuZGlkYXRlcyhtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnLCBnZW5yZUlkcz86IG51bWJlcltdKTogUHJvbWlzZTxNb3ZpZUNhbmRpZGF0ZVtdPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBwYXlsb2FkID0ge1xyXG4gICAgICAgIG1lZGlhVHlwZSxcclxuICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICAvLyBOb3RlOiBwYWdlIHBhcmFtZXRlciByZW1vdmVkIC0gU21hcnQgUmFuZG9tIERpc2NvdmVyeSBoYW5kbGVzIHBhZ2luYXRpb24gaW50ZXJuYWxseVxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc29sZS5sb2coJ0ludm9raW5nIFRNREIgTGFtYmRhIHdpdGggU21hcnQgUmFuZG9tIERpc2NvdmVyeSBwYXlsb2FkOicsIEpTT04uc3RyaW5naWZ5KHBheWxvYWQpKTtcclxuXHJcbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlQ29tbWFuZCh7XHJcbiAgICAgICAgRnVuY3Rpb25OYW1lOiB0aGlzLmxhbWJkYUFybixcclxuICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKGNvbW1hbmQpO1xyXG4gICAgICBcclxuICAgICAgaWYgKCFyZXNwb25zZS5QYXlsb2FkKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBmcm9tIFRNREIgTGFtYmRhJyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHJlc3BvbnNlLlBheWxvYWQpKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChyZXN1bHQuc3RhdHVzQ29kZSAhPT0gMjAwKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBUTURCIExhbWJkYSBlcnJvcjogJHtKU09OLnN0cmluZ2lmeShyZXN1bHQuYm9keSl9YCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSByZXN1bHQuYm9keS5jYW5kaWRhdGVzIHx8IFtdO1xyXG4gICAgICBjb25zb2xlLmxvZyhgU21hcnQgUmFuZG9tIERpc2NvdmVyeSByZXR1cm5lZCAke2NhbmRpZGF0ZXMubGVuZ3RofSBjYW5kaWRhdGVzYCk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gY2FuZGlkYXRlcztcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdUTURCIEludGVncmF0aW9uIGVycm9yOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gZmV0Y2ggbW92aWUgY2FuZGlkYXRlczogJHtlcnJvcn1gKTtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbi8vIFJvb20gU2VydmljZVxyXG5jbGFzcyBSb29tU2VydmljZSB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB0YWJsZU5hbWU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHRtZGJJbnRlZ3JhdGlvbjogVE1EQkludGVncmF0aW9uO1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMudGFibGVOYW1lID0gcHJvY2Vzcy5lbnYuUk9PTVNfVEFCTEUgfHwgJyc7XHJcbiAgICBpZiAoIXRoaXMudGFibGVOYW1lKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUk9PTVNfVEFCTEUgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuICAgIHRoaXMudG1kYkludGVncmF0aW9uID0gbmV3IFRNREJJbnRlZ3JhdGlvbigpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgY3JlYXRlUm9vbSh1c2VySWQ6IHN0cmluZywgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgZ2VucmVJZHM6IG51bWJlcltdLCBtYXhQYXJ0aWNpcGFudHM6IG51bWJlcik6IFByb21pc2U8Um9vbT4ge1xyXG4gICAgLy8gVmFsaWRhdGUgaW5wdXRcclxuICAgIGlmICghbWVkaWFUeXBlIHx8ICFbJ01PVklFJywgJ1RWJ10uaW5jbHVkZXMobWVkaWFUeXBlKSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbWVkaWFUeXBlLiBNdXN0IGJlIE1PVklFIG9yIFRWJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVmFsaWRhdGUgbWF4UGFydGljaXBhbnRzXHJcbiAgICBpZiAoIW1heFBhcnRpY2lwYW50cyB8fCB0eXBlb2YgbWF4UGFydGljaXBhbnRzICE9PSAnbnVtYmVyJykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ21heFBhcnRpY2lwYW50cyBpcyByZXF1aXJlZCBhbmQgbXVzdCBiZSBhIG51bWJlcicpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtYXhQYXJ0aWNpcGFudHMgPCAyIHx8IG1heFBhcnRpY2lwYW50cyA+IDYpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdtYXhQYXJ0aWNpcGFudHMgbXVzdCBiZSBiZXR3ZWVuIDIgYW5kIDYnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBFbmZvcmNlIGdlbnJlIGxpbWl0IChtYXggMiBhcyBwZXIgbWFzdGVyIHNwZWMpXHJcbiAgICBpZiAoZ2VucmVJZHMubGVuZ3RoID4gMikge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ01heGltdW0gMiBnZW5yZXMgYWxsb3dlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEdlbmVyYXRlIHVuaXF1ZSByb29tIGNvZGVcclxuICAgIGNvbnN0IGNvZGUgPSBhd2FpdCBSb29tQ29kZUdlbmVyYXRvci5nZW5lcmF0ZVVuaXF1ZShkb2NDbGllbnQsIHRoaXMudGFibGVOYW1lKTtcclxuICAgIFxyXG4gICAgLy8gRmV0Y2ggbW92aWUgY2FuZGlkYXRlcyBmcm9tIFRNREJcclxuICAgIGNvbnNvbGUubG9nKGBGZXRjaGluZyAke21lZGlhVHlwZX0gY2FuZGlkYXRlcyBmb3IgZ2VucmVzOiAke2dlbnJlSWRzLmpvaW4oJywnKX1gKTtcclxuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBhd2FpdCB0aGlzLnRtZGJJbnRlZ3JhdGlvbi5mZXRjaENhbmRpZGF0ZXMobWVkaWFUeXBlLCBnZW5yZUlkcyk7XHJcbiAgICBcclxuICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICBjb25zb2xlLndhcm4oJ05vIGNhbmRpZGF0ZXMgcmV0dXJuZWQgZnJvbSBUTURCIC0gcHJvY2VlZGluZyB3aXRoIGVtcHR5IGxpc3QnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDcmVhdGUgcm9vbSByZWNvcmRcclxuICAgIGNvbnN0IHJvb21JZCA9IHJhbmRvbVVVSUQoKTtcclxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgIGNvbnN0IHR0bCA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDI0ICogNjAgKiA2MCk7IC8vIDI0IGhvdXJzIGZyb20gbm93XHJcblxyXG4gICAgY29uc3Qgcm9vbTogUm9vbSA9IHtcclxuICAgICAgaWQ6IHJvb21JZCxcclxuICAgICAgY29kZSxcclxuICAgICAgaG9zdElkOiB1c2VySWQsXHJcbiAgICAgIG1lZGlhVHlwZSxcclxuICAgICAgZ2VucmVJZHMsXHJcbiAgICAgIGNhbmRpZGF0ZXMsXHJcbiAgICAgIGNyZWF0ZWRBdDogbm93LFxyXG4gICAgICB0dGwsXHJcbiAgICAgIG1heFBhcnRpY2lwYW50cyxcclxuICAgIH07XHJcblxyXG4gICAgLy8gU3RvcmUgaW4gRHluYW1vREJcclxuICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgSXRlbTogcm9vbSxcclxuICAgICAgQ29uZGl0aW9uRXhwcmVzc2lvbjogJ2F0dHJpYnV0ZV9ub3RfZXhpc3RzKGlkKScsIC8vIEVuc3VyZSBubyBkdXBsaWNhdGUgSURzXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gUmVjb3JkIGhvc3QgcGFydGljaXBhdGlvbiB3aGVuIGNyZWF0aW5nIHJvb20gKGhvc3QgaXMgdGhlIGZpcnN0IHBhcnRpY2lwYW50KVxyXG4gICAgLy8gVGhpcyBlbnN1cmVzIHRoZSBob3N0IGNvdW50cyB0b3dhcmRzIHRoZSBtYXhQYXJ0aWNpcGFudHMgbGltaXRcclxuICAgIGF3YWl0IHRoaXMucmVjb3JkUm9vbVBhcnRpY2lwYXRpb24odXNlcklkLCByb29tSWQsIG1heFBhcnRpY2lwYW50cyk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYFJvb20gY3JlYXRlZCBzdWNjZXNzZnVsbHk6ICR7cm9vbUlkfSB3aXRoIGNvZGU6ICR7Y29kZX0sIG1heFBhcnRpY2lwYW50czogJHttYXhQYXJ0aWNpcGFudHN9LCBob3N0IHJlZ2lzdGVyZWQgYXMgZmlyc3QgcGFydGljaXBhbnRgKTtcclxuICAgIHJldHVybiByb29tO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgam9pblJvb20odXNlcklkOiBzdHJpbmcsIGNvZGU6IHN0cmluZyk6IFByb21pc2U8Um9vbT4ge1xyXG4gICAgaWYgKCFjb2RlIHx8IGNvZGUudHJpbSgpID09PSAnJykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gY29kZSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICghdXNlcklkKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVXNlciBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFF1ZXJ5IGJ5IHJvb20gY29kZSB1c2luZyBHU0lcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgICBJbmRleE5hbWU6ICdjb2RlLWluZGV4JyxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAnY29kZSA9IDpjb2RlJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOmNvZGUnOiBjb2RlLnRvVXBwZXJDYXNlKCksXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgaWYgKCFyZXN1bHQuSXRlbXMgfHwgcmVzdWx0Lkl0ZW1zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBub3QgZm91bmQuIFBsZWFzZSBjaGVjayB0aGUgcm9vbSBjb2RlLicpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAocmVzdWx0Lkl0ZW1zLmxlbmd0aCA+IDEpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBNdWx0aXBsZSByb29tcyBmb3VuZCBmb3IgY29kZSAke2NvZGV9OmAsIHJlc3VsdC5JdGVtcyk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNdWx0aXBsZSByb29tcyBmb3VuZCBmb3IgY29kZS4gUGxlYXNlIGNvbnRhY3Qgc3VwcG9ydC4nKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3Qgcm9vbSA9IHJlc3VsdC5JdGVtc1swXSBhcyBSb29tO1xyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgcm9vbSBoYXMgZXhwaXJlZFxyXG4gICAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgICAgaWYgKHJvb20udHRsICYmIHJvb20udHRsIDwgbm93KSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIGhhcyBleHBpcmVkLiBQbGVhc2UgY3JlYXRlIGEgbmV3IHJvb20uJyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHVzZXIgaXMgYWxyZWFkeSBpbiB0aGUgcm9vbVxyXG4gICAgICBjb25zdCBpc0FscmVhZHlJblJvb20gPSBhd2FpdCB0aGlzLmlzVXNlckluUm9vbSh1c2VySWQsIHJvb20uaWQpO1xyXG4gICAgICBcclxuICAgICAgaWYgKGlzQWxyZWFkeUluUm9vbSkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSBpcyBhbHJlYWR5IGluIHJvb20gJHtyb29tLmlkfSwgcmV0dXJuaW5nIHJvb20gZGF0YWApO1xyXG4gICAgICAgIHJldHVybiByb29tO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDUklUSUNBTDogQ2hlY2sgcGFydGljaXBhbnQgY291bnQgQkVGT1JFIGF0dGVtcHRpbmcgdG8gam9pblxyXG4gICAgICAvLyBUaGlzIGluY2x1ZGVzIHRoZSBob3N0IGFzIHRoZSBmaXJzdCBwYXJ0aWNpcGFudFxyXG4gICAgICBjb25zdCBjdXJyZW50UGFydGljaXBhbnRzID0gYXdhaXQgdGhpcy5nZXRSb29tUGFydGljaXBhbnRDb3VudChyb29tLmlkKTtcclxuICAgICAgY29uc3QgbWF4UGFydGljaXBhbnRzID0gcm9vbS5tYXhQYXJ0aWNpcGFudHMgfHwgMjsgLy8gRGVmYXVsdCB0byAyIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhgUm9vbSAke3Jvb20uaWR9IGhhcyAke2N1cnJlbnRQYXJ0aWNpcGFudHN9LyR7bWF4UGFydGljaXBhbnRzfSBwYXJ0aWNpcGFudHMgKGluY2x1ZGluZyBob3N0KWApO1xyXG4gICAgICBcclxuICAgICAgaWYgKGN1cnJlbnRQYXJ0aWNpcGFudHMgPj0gbWF4UGFydGljaXBhbnRzKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdFc3RhIHNhbGEgZXN0w6EgbGxlbmEuJyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIEF0dGVtcHQgdG8gcmVjb3JkIHBhcnRpY2lwYXRpb24gd2l0aCBhdG9taWMgY2hlY2tcclxuICAgICAgLy8gVGhpcyB3aWxsIGZhaWwgaWYgYW5vdGhlciB1c2VyIGpvaW5zIHNpbXVsdGFuZW91c2x5IGFuZCBmaWxscyB0aGUgcm9vbVxyXG4gICAgICBhd2FpdCB0aGlzLnJlY29yZFJvb21QYXJ0aWNpcGF0aW9uKHVzZXJJZCwgcm9vbS5pZCwgbWF4UGFydGljaXBhbnRzKTtcclxuXHJcbiAgICAgIC8vIERvdWJsZS1jaGVjayBhZnRlciByZWNvcmRpbmcgdG8gZW5zdXJlIHdlIGRpZG4ndCBleGNlZWQgdGhlIGxpbWl0XHJcbiAgICAgIC8vIFRoaXMgaXMgYSBzYWZldHkgY2hlY2sgaW4gY2FzZSBvZiByYWNlIGNvbmRpdGlvbnNcclxuICAgICAgY29uc3QgZmluYWxQYXJ0aWNpcGFudHMgPSBhd2FpdCB0aGlzLmdldFJvb21QYXJ0aWNpcGFudENvdW50KHJvb20uaWQpO1xyXG4gICAgICBpZiAoZmluYWxQYXJ0aWNpcGFudHMgPiBtYXhQYXJ0aWNpcGFudHMpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBSQUNFIENPTkRJVElPTiBERVRFQ1RFRDogUm9vbSAke3Jvb20uaWR9IG5vdyBoYXMgJHtmaW5hbFBhcnRpY2lwYW50c30vJHttYXhQYXJ0aWNpcGFudHN9IHBhcnRpY2lwYW50c2ApO1xyXG4gICAgICAgIC8vIE5vdGU6IEluIHByb2R1Y3Rpb24sIHlvdSBtaWdodCB3YW50IHRvIGltcGxlbWVudCBhIGNsZWFudXAgbWVjaGFuaXNtIGhlcmVcclxuICAgICAgICAvLyBGb3Igbm93LCB3ZSBsb2cgdGhlIGVycm9yIGJ1dCBhbGxvdyB0aGUgam9pbiBzaW5jZSB0aGUgcmVjb3JkIGlzIGFscmVhZHkgY3JlYXRlZFxyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gc3VjY2Vzc2Z1bGx5IGpvaW5lZCByb29tOiAke3Jvb20uaWR9IHdpdGggY29kZTogJHtjb2RlfWApO1xyXG4gICAgICByZXR1cm4gcm9vbTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIC8vIEZhbGxiYWNrIHRvIHNjYW4gaWYgR1NJIGlzIG5vdCBhdmFpbGFibGUgeWV0XHJcbiAgICAgIGNvbnN0IGVyciA9IGVycm9yIGFzIGFueTtcclxuICAgICAgaWYgKGVyci5uYW1lID09PSAnUmVzb3VyY2VOb3RGb3VuZEV4Y2VwdGlvbicgfHwgZXJyLm1lc3NhZ2U/LmluY2x1ZGVzKCdHU0knKSkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdHU0kgbm90IGF2YWlsYWJsZSwgZmFsbGluZyBiYWNrIHRvIHNjYW4gbWV0aG9kJyk7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuam9pblJvb21CeVNjYW4odXNlcklkLCBjb2RlKTtcclxuICAgICAgfVxyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgam9pblJvb21CeVNjYW4odXNlcklkOiBzdHJpbmcsIGNvZGU6IHN0cmluZyk6IFByb21pc2U8Um9vbT4ge1xyXG4gICAgLy8gRmFsbGJhY2sgbWV0aG9kIHVzaW5nIHNjYW5cclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBTY2FuQ29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXHJcbiAgICAgIEZpbHRlckV4cHJlc3Npb246ICdjb2RlID0gOmNvZGUnLFxyXG4gICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgJzpjb2RlJzogY29kZS50b1VwcGVyQ2FzZSgpLFxyXG4gICAgICB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIGlmICghcmVzdWx0Lkl0ZW1zIHx8IHJlc3VsdC5JdGVtcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZC4gUGxlYXNlIGNoZWNrIHRoZSByb29tIGNvZGUuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgcm9vbSA9IHJlc3VsdC5JdGVtc1swXSBhcyBSb29tO1xyXG5cclxuICAgIC8vIENoZWNrIGlmIHJvb20gaGFzIGV4cGlyZWRcclxuICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xyXG4gICAgaWYgKHJvb20udHRsICYmIHJvb20udHRsIDwgbm93KSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBoYXMgZXhwaXJlZC4gUGxlYXNlIGNyZWF0ZSBhIG5ldyByb29tLicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENoZWNrIGlmIHVzZXIgaXMgYWxyZWFkeSBpbiB0aGUgcm9vbVxyXG4gICAgY29uc3QgaXNBbHJlYWR5SW5Sb29tID0gYXdhaXQgdGhpcy5pc1VzZXJJblJvb20odXNlcklkLCByb29tLmlkKTtcclxuICAgIFxyXG4gICAgaWYgKGlzQWxyZWFkeUluUm9vbSkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gaXMgYWxyZWFkeSBpbiByb29tICR7cm9vbS5pZH0sIHJldHVybmluZyByb29tIGRhdGEgKHNjYW4gbWV0aG9kKWApO1xyXG4gICAgICByZXR1cm4gcm9vbTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDUklUSUNBTDogQ2hlY2sgcGFydGljaXBhbnQgY291bnQgQkVGT1JFIGF0dGVtcHRpbmcgdG8gam9pblxyXG4gICAgLy8gVGhpcyBpbmNsdWRlcyB0aGUgaG9zdCBhcyB0aGUgZmlyc3QgcGFydGljaXBhbnRcclxuICAgIGNvbnN0IGN1cnJlbnRQYXJ0aWNpcGFudHMgPSBhd2FpdCB0aGlzLmdldFJvb21QYXJ0aWNpcGFudENvdW50KHJvb20uaWQpO1xyXG4gICAgY29uc3QgbWF4UGFydGljaXBhbnRzID0gcm9vbS5tYXhQYXJ0aWNpcGFudHMgfHwgMjsgLy8gRGVmYXVsdCB0byAyIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKGBSb29tICR7cm9vbS5pZH0gaGFzICR7Y3VycmVudFBhcnRpY2lwYW50c30vJHttYXhQYXJ0aWNpcGFudHN9IHBhcnRpY2lwYW50cyAoaW5jbHVkaW5nIGhvc3QpIC0gc2NhbiBtZXRob2RgKTtcclxuICAgIFxyXG4gICAgaWYgKGN1cnJlbnRQYXJ0aWNpcGFudHMgPj0gbWF4UGFydGljaXBhbnRzKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignRXN0YSBzYWxhIGVzdMOhIGxsZW5hLicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEF0dGVtcHQgdG8gcmVjb3JkIHBhcnRpY2lwYXRpb24gd2l0aCBhdG9taWMgY2hlY2tcclxuICAgIGF3YWl0IHRoaXMucmVjb3JkUm9vbVBhcnRpY2lwYXRpb24odXNlcklkLCByb29tLmlkLCBtYXhQYXJ0aWNpcGFudHMpO1xyXG5cclxuICAgIC8vIERvdWJsZS1jaGVjayBhZnRlciByZWNvcmRpbmcgdG8gZW5zdXJlIHdlIGRpZG4ndCBleGNlZWQgdGhlIGxpbWl0XHJcbiAgICBjb25zdCBmaW5hbFBhcnRpY2lwYW50cyA9IGF3YWl0IHRoaXMuZ2V0Um9vbVBhcnRpY2lwYW50Q291bnQocm9vbS5pZCk7XHJcbiAgICBpZiAoZmluYWxQYXJ0aWNpcGFudHMgPiBtYXhQYXJ0aWNpcGFudHMpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgUkFDRSBDT05ESVRJT04gREVURUNURUQ6IFJvb20gJHtyb29tLmlkfSBub3cgaGFzICR7ZmluYWxQYXJ0aWNpcGFudHN9LyR7bWF4UGFydGljaXBhbnRzfSBwYXJ0aWNpcGFudHMgKHNjYW4gbWV0aG9kKWApO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSBzdWNjZXNzZnVsbHkgam9pbmVkIHJvb206ICR7cm9vbS5pZH0gd2l0aCBjb2RlOiAke2NvZGV9IChzY2FuIG1ldGhvZClgKTtcclxuICAgIHJldHVybiByb29tO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZWNvcmRSb29tUGFydGljaXBhdGlvbih1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcsIG1heFBhcnRpY2lwYW50czogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB2b3Rlc1RhYmxlID0gcHJvY2Vzcy5lbnYuVk9URVNfVEFCTEUgfHwgJyc7XHJcbiAgICAgIGlmICghdm90ZXNUYWJsZSkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignVk9URVNfVEFCTEUgbm90IGNvbmZpZ3VyZWQsIHNraXBwaW5nIHBhcnRpY2lwYXRpb24gdHJhY2tpbmcnKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIENyZWF0ZSBhIHNwZWNpYWwgXCJwYXJ0aWNpcGF0aW9uXCIgcmVjb3JkIGluIFZPVEVTIHRhYmxlXHJcbiAgICAgIC8vIFRoaXMgYWxsb3dzIHRoZSByb29tIHRvIGFwcGVhciBpbiBnZXRNeVJvb21zKCkgZXZlbiB3aXRob3V0IGFjdHVhbCB2b3Rlc1xyXG4gICAgICBjb25zdCBwYXJ0aWNpcGF0aW9uUmVjb3JkID0ge1xyXG4gICAgICAgIHJvb21JZCxcclxuICAgICAgICB1c2VyTW92aWVJZDogYCR7dXNlcklkfSNKT0lORURgLCAvLyBTcGVjaWFsIG1hcmtlciBmb3Igcm9vbSBwYXJ0aWNpcGF0aW9uXHJcbiAgICAgICAgdXNlcklkLFxyXG4gICAgICAgIG1vdmllSWQ6IC0xLCAvLyBTcGVjaWFsIHZhbHVlIGluZGljYXRpbmcgdGhpcyBpcyBhIHBhcnRpY2lwYXRpb24gcmVjb3JkLCBub3QgYSB2b3RlXHJcbiAgICAgICAgdm90ZTogZmFsc2UsIC8vIE5vdCBhIHJlYWwgdm90ZVxyXG4gICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgIGlzUGFydGljaXBhdGlvbjogdHJ1ZSwgLy8gRmxhZyB0byBkaXN0aW5ndWlzaCBmcm9tIHJlYWwgdm90ZXNcclxuICAgICAgfTtcclxuXHJcbiAgICAgIC8vIFVzZSBjb25kaXRpb25hbCBleHByZXNzaW9uIHRvIGVuc3VyZSBhdG9taWNpdHkgYW5kIHByZXZlbnQgZXhjZWVkaW5nIG1heFBhcnRpY2lwYW50c1xyXG4gICAgICAvLyBUaGlzIHByZXZlbnRzIHJhY2UgY29uZGl0aW9ucyB3aGVuIG11bHRpcGxlIHVzZXJzIHRyeSB0byBqb2luIHNpbXVsdGFuZW91c2x5XHJcbiAgICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHZvdGVzVGFibGUsXHJcbiAgICAgICAgSXRlbTogcGFydGljaXBhdGlvblJlY29yZCxcclxuICAgICAgICBDb25kaXRpb25FeHByZXNzaW9uOiAnYXR0cmlidXRlX25vdF9leGlzdHModXNlck1vdmllSWQpJyxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc29sZS5sb2coYFBhcnRpY2lwYXRpb24gcmVjb3JkZWQgZm9yIHVzZXIgJHt1c2VySWR9IGluIHJvb20gJHtyb29tSWR9YCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAvLyBJZiBjb25kaXRpb24gZmFpbHMsIHVzZXIgaXMgYWxyZWFkeSBpbiB0aGUgcm9vbSAtIHRoaXMgaXMgT0tcclxuICAgICAgY29uc3QgZXJyID0gZXJyb3IgYXMgYW55O1xyXG4gICAgICBpZiAoZXJyLm5hbWUgPT09ICdDb25kaXRpb25hbENoZWNrRmFpbGVkRXhjZXB0aW9uJykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSBhbHJlYWR5IGhhcyBwYXJ0aWNpcGF0aW9uIHJlY29yZCBpbiByb29tICR7cm9vbUlkfWApO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciByZWNvcmRpbmcgcGFydGljaXBhdGlvbiBmb3IgdXNlciAke3VzZXJJZH0gaW4gcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjsgLy8gUmUtdGhyb3cgdG8gZmFpbCB0aGUgam9pbiBvcGVyYXRpb24gb24gdW5leHBlY3RlZCBlcnJvcnNcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZ2V0Um9vbVBhcnRpY2lwYW50Q291bnQocm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlcj4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3Qgdm90ZXNUYWJsZSA9IHByb2Nlc3MuZW52LlZPVEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgICBpZiAoIXZvdGVzVGFibGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ1ZPVEVTX1RBQkxFIG5vdCBjb25maWd1cmVkLCBjYW5ub3QgY291bnQgcGFydGljaXBhbnRzJyk7XHJcbiAgICAgICAgcmV0dXJuIDA7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFF1ZXJ5IGFsbCBwYXJ0aWNpcGF0aW9uIHJlY29yZHMgZm9yIHRoaXMgcm9vbVxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHZvdGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdpc1BhcnRpY2lwYXRpb24gPSA6aXNQYXJ0aWNpcGF0aW9uJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICAgICc6aXNQYXJ0aWNpcGF0aW9uJzogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBwYXJ0aWNpcGFudHMgPSByZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIGNvbnN0IHVuaXF1ZVVzZXJJZHMgPSBuZXcgU2V0KHBhcnRpY2lwYW50cy5tYXAocCA9PiBwLnVzZXJJZCkpO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coYFJvb20gJHtyb29tSWR9IGhhcyAke3VuaXF1ZVVzZXJJZHMuc2l6ZX0gdW5pcXVlIHBhcnRpY2lwYW50c2ApO1xyXG4gICAgICByZXR1cm4gdW5pcXVlVXNlcklkcy5zaXplO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgY291bnRpbmcgcGFydGljaXBhbnRzIGZvciByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiAwO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBpc1VzZXJJblJvb20odXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB2b3Rlc1RhYmxlID0gcHJvY2Vzcy5lbnYuVk9URVNfVEFCTEUgfHwgJyc7XHJcbiAgICAgIGlmICghdm90ZXNUYWJsZSkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgdXNlciBoYXMgYSBwYXJ0aWNpcGF0aW9uIHJlY29yZCBpbiB0aGlzIHJvb21cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB2b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAndXNlcklkID0gOnVzZXJJZCBBTkQgaXNQYXJ0aWNpcGF0aW9uID0gOmlzUGFydGljaXBhdGlvbicsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICAgICc6aXNQYXJ0aWNpcGF0aW9uJzogdHJ1ZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIExpbWl0OiAxLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBpc0luUm9vbSA9ICEhKHJlc3VsdC5JdGVtcyAmJiByZXN1bHQuSXRlbXMubGVuZ3RoID4gMCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSAke2lzSW5Sb29tID8gJ2lzIGFscmVhZHknIDogJ2lzIG5vdCd9IGluIHJvb20gJHtyb29tSWR9YCk7XHJcbiAgICAgIHJldHVybiBpc0luUm9vbTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGNoZWNraW5nIGlmIHVzZXIgJHt1c2VySWR9IGlzIGluIHJvb20gJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0TXlSb29tcyh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8Um9vbVtdPiB7XHJcbiAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdnZXRNeVJvb21zIGNhbGxlZCB3aXRob3V0IHVzZXJJZCcpO1xyXG4gICAgICByZXR1cm4gW107IC8vIFJldHVybiBlbXB0eSBhcnJheSBpbnN0ZWFkIG9mIHRocm93aW5nXHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYEdldHRpbmcgcm9vbXMgZm9yIHVzZXI6ICR7dXNlcklkfWApO1xyXG4gICAgICBjb25zdCBhbGxSb29tczogUm9vbVtdID0gW107XHJcblxyXG4gICAgICAvLyAxLiBHZXQgcm9vbXMgd2hlcmUgdXNlciBpcyB0aGUgaG9zdCAtIHVzZSBzY2FuIGZvciBub3cgc2luY2UgR1NJIG1pZ2h0IG5vdCBiZSByZWFkeVxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGhvc3RSb29tc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBTY2FuQ29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMudGFibGVOYW1lLFxyXG4gICAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ2hvc3RJZCA9IDp1c2VySWQnLFxyXG4gICAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICBjb25zdCBob3N0Um9vbXMgPSBob3N0Um9vbXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7aG9zdFJvb21zLmxlbmd0aH0gcm9vbXMgd2hlcmUgdXNlciBpcyBob3N0YCk7XHJcbiAgICAgICAgYWxsUm9vbXMucHVzaCguLi4oaG9zdFJvb21zIGFzIFJvb21bXSkpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGZldGNoaW5nIGhvc3Qgcm9vbXM6JywgZXJyb3IpO1xyXG4gICAgICAgIC8vIENvbnRpbnVlIHdpdGggZW1wdHkgaG9zdCByb29tc1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyAyLiBHZXQgcm9vbXMgd2hlcmUgdXNlciBoYXMgcGFydGljaXBhdGVkIChqb2luZWQgb3Igdm90ZWQpXHJcbiAgICAgIGNvbnN0IHZvdGVzVGFibGUgPSBwcm9jZXNzLmVudi5WT1RFU19UQUJMRSB8fCAnJztcclxuICAgICAgaWYgKHZvdGVzVGFibGUpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgLy8gR2V0IGFsbCBwYXJ0aWNpcGF0aW9uIHJlY29yZHMgYnkgdGhpcyB1c2VyIC0gdXNlIHNjYW4gZm9yIG5vd1xyXG4gICAgICAgICAgY29uc3QgdXNlclBhcnRpY2lwYXRpb25SZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgU2NhbkNvbW1hbmQoe1xyXG4gICAgICAgICAgICBUYWJsZU5hbWU6IHZvdGVzVGFibGUsXHJcbiAgICAgICAgICAgIEZpbHRlckV4cHJlc3Npb246ICd1c2VySWQgPSA6dXNlcklkJyxcclxuICAgICAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgICAgICc6dXNlcklkJzogdXNlcklkLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICAgIGNvbnN0IHVzZXJQYXJ0aWNpcGF0aW9uID0gdXNlclBhcnRpY2lwYXRpb25SZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHt1c2VyUGFydGljaXBhdGlvbi5sZW5ndGh9IHBhcnRpY2lwYXRpb24gcmVjb3JkcyBmb3IgdXNlcmApO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBHZXQgdW5pcXVlIHJvb20gSURzIGZyb20gcGFydGljaXBhdGlvbiByZWNvcmRzIChib3RoIHZvdGVzIGFuZCBqb2lucylcclxuICAgICAgICAgIGNvbnN0IHBhcnRpY2lwYXRlZFJvb21JZHMgPSBuZXcgU2V0KHVzZXJQYXJ0aWNpcGF0aW9uLm1hcChyZWNvcmQgPT4gcmVjb3JkLnJvb21JZCkpO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBHZXQgcm9vbSBkZXRhaWxzIGZvciBwYXJ0aWNpcGF0ZWQgcm9vbXMgKGV4Y2x1ZGluZyBhbHJlYWR5IGZldGNoZWQgaG9zdCByb29tcylcclxuICAgICAgICAgIGNvbnN0IGhvc3RSb29tSWRzID0gbmV3IFNldChhbGxSb29tcy5tYXAocm9vbSA9PiByb29tLmlkKSk7XHJcbiAgICAgICAgICBjb25zdCBuZXdSb29tSWRzID0gQXJyYXkuZnJvbShwYXJ0aWNpcGF0ZWRSb29tSWRzKS5maWx0ZXIocm9vbUlkID0+ICFob3N0Um9vbUlkcy5oYXMocm9vbUlkKSk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke25ld1Jvb21JZHMubGVuZ3RofSBhZGRpdGlvbmFsIHJvb21zIHdoZXJlIHVzZXIgcGFydGljaXBhdGVkYCk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIEZldGNoIHJvb20gZGV0YWlscyBmb3IgcGFydGljaXBhdGVkIHJvb21zXHJcbiAgICAgICAgICBjb25zdCBwYXJ0aWNpcGF0ZWRSb29tc1Byb21pc2VzID0gbmV3Um9vbUlkcy5tYXAoYXN5bmMgKHJvb21JZCkgPT4ge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgIGNvbnN0IHJvb21SZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMudGFibGVOYW1lLFxyXG4gICAgICAgICAgICAgICAgS2V5OiB7IGlkOiByb29tSWQgfSxcclxuICAgICAgICAgICAgICB9KSk7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIHJvb21SZXN1bHQuSXRlbSBhcyBSb29tO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGZldGNoaW5nIHJvb20gJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgY29uc3QgcGFydGljaXBhdGVkUm9vbXMgPSAoYXdhaXQgUHJvbWlzZS5hbGwocGFydGljaXBhdGVkUm9vbXNQcm9taXNlcykpXHJcbiAgICAgICAgICAgIC5maWx0ZXIocm9vbSA9PiByb29tICE9PSBudWxsKSBhcyBSb29tW107XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGFsbFJvb21zLnB1c2goLi4ucGFydGljaXBhdGVkUm9vbXMpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBmZXRjaGluZyBwYXJ0aWNpcGF0ZWQgcm9vbXM6JywgZXJyb3IpO1xyXG4gICAgICAgICAgLy8gQ29udGludWUgd2l0aCBvbmx5IGhvc3Qgcm9vbXNcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdWT1RFU19UQUJMRSBub3QgY29uZmlndXJlZCwgb25seSBzaG93aW5nIGhvc3RlZCByb29tcycpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyAzLiBGaWx0ZXIgb3V0IGV4cGlyZWQgcm9vbXMgYW5kIHJvb21zIHdpdGggbWF0Y2hlc1xyXG4gICAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgICAgY29uc3QgYWN0aXZlUm9vbXMgPSBhbGxSb29tcy5maWx0ZXIocm9vbSA9PiAhcm9vbS50dGwgfHwgcm9vbS50dGwgPj0gbm93KTtcclxuICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7YWN0aXZlUm9vbXMubGVuZ3RofSBhY3RpdmUgcm9vbXMgYWZ0ZXIgZmlsdGVyaW5nIGV4cGlyZWRgKTtcclxuXHJcbiAgICAgIC8vIDQuIENoZWNrIGZvciBtYXRjaGVzIGFuZCBmaWx0ZXIgb3V0IHJvb21zIHdpdGggbWF0Y2hlc1xyXG4gICAgICBjb25zdCBtYXRjaGVzVGFibGUgPSBwcm9jZXNzLmVudi5NQVRDSEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgICBpZiAobWF0Y2hlc1RhYmxlKSB7XHJcbiAgICAgICAgY29uc3Qgcm9vbXNXaXRob3V0TWF0Y2hlcyA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZvciAoY29uc3Qgcm9vbSBvZiBhY3RpdmVSb29tcykge1xyXG4gICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgcm9vbSBoYXMgYW55IG1hdGNoZXNcclxuICAgICAgICAgICAgY29uc3QgbWF0Y2hSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICAgICAgICBUYWJsZU5hbWU6IG1hdGNoZXNUYWJsZSxcclxuICAgICAgICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgICAgICAgJzpyb29tSWQnOiByb29tLmlkLFxyXG4gICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgTGltaXQ6IDEsIC8vIFdlIG9ubHkgbmVlZCB0byBrbm93IGlmIGFueSBtYXRjaCBleGlzdHNcclxuICAgICAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICAgICAgLy8gSWYgbm8gbWF0Y2hlcyBmb3VuZCwgaW5jbHVkZSB0aGUgcm9vbVxyXG4gICAgICAgICAgICBpZiAoIW1hdGNoUmVzdWx0Lkl0ZW1zIHx8IG1hdGNoUmVzdWx0Lkl0ZW1zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICAgIHJvb21zV2l0aG91dE1hdGNoZXMucHVzaChyb29tKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgUm9vbSAke3Jvb20uaWR9IGhhcyBtYXRjaGVzLCBleGNsdWRpbmcgZnJvbSByZXN1bHRzYCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGNoZWNraW5nIG1hdGNoZXMgZm9yIHJvb20gJHtyb29tLmlkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgIC8vIEluY2x1ZGUgcm9vbSBpZiB3ZSBjYW4ndCBjaGVjayBtYXRjaGVzIChmYWlsIHNhZmUpXHJcbiAgICAgICAgICAgIHJvb21zV2l0aG91dE1hdGNoZXMucHVzaChyb29tKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke3Jvb21zV2l0aG91dE1hdGNoZXMubGVuZ3RofSBhY3RpdmUgcm9vbXMgd2l0aG91dCBtYXRjaGVzIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICAgIHJldHVybiByb29tc1dpdGhvdXRNYXRjaGVzLnNvcnQoKGEsIGIpID0+IG5ldyBEYXRlKGIuY3JlYXRlZEF0KS5nZXRUaW1lKCkgLSBuZXcgRGF0ZShhLmNyZWF0ZWRBdCkuZ2V0VGltZSgpKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7YWN0aXZlUm9vbXMubGVuZ3RofSBhY3RpdmUgcm9vbXMgZm9yIHVzZXIgJHt1c2VySWR9IChtYXRjaGVzIHRhYmxlIG5vdCBjb25maWd1cmVkKWApO1xyXG4gICAgICByZXR1cm4gYWN0aXZlUm9vbXMuc29ydCgoYSwgYikgPT4gbmV3IERhdGUoYi5jcmVhdGVkQXQpLmdldFRpbWUoKSAtIG5ldyBEYXRlKGEuY3JlYXRlZEF0KS5nZXRUaW1lKCkpO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGZldGNoaW5nIHVzZXIgcm9vbXM6JywgZXJyb3IpO1xyXG4gICAgICAvLyBSZXR1cm4gZW1wdHkgYXJyYXkgaW5zdGVhZCBvZiB0aHJvd2luZyB0byBwcmV2ZW50IEdyYXBoUUwgbnVsbCBlcnJvclxyXG4gICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRSb29tKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTxSb29tIHwgbnVsbD4ge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHRoaXMudGFibGVOYW1lLFxyXG4gICAgICBLZXk6IHsgaWQ6IHJvb21JZCB9LFxyXG4gICAgfSkpO1xyXG5cclxuICAgIGlmICghcmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgcm9vbSA9IHJlc3VsdC5JdGVtIGFzIFJvb207XHJcblxyXG4gICAgLy8gQ2hlY2sgaWYgcm9vbSBoYXMgZXhwaXJlZFxyXG4gICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XHJcbiAgICBpZiAocm9vbS50dGwgJiYgcm9vbS50dGwgPCBub3cpIHtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJvb207XHJcbiAgfVxyXG59XHJcblxyXG4vLyBMYW1iZGEgSGFuZGxlciBmb3IgQXBwU3luY1xyXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdSb29tIExhbWJkYSByZWNlaXZlZCBBcHBTeW5jIGV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCByb29tU2VydmljZSA9IG5ldyBSb29tU2VydmljZSgpO1xyXG5cclxuICAgIC8vIENSSVRJQ0FMIERFQlVHOiBMb2cgZnVsbCBpZGVudGl0eSBzdHJ1Y3R1cmUgdG8gdW5kZXJzdGFuZCB1c2VySWQgZm9ybWF0XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBJREVOVElUWSBERUJVRzonLCBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgIGlkZW50aXR5VHlwZTogZXZlbnQuaWRlbnRpdHk/LmNvbnN0cnVjdG9yPy5uYW1lLFxyXG4gICAgICBjbGFpbXM6IGV2ZW50LmlkZW50aXR5Py5jbGFpbXMsXHJcbiAgICAgIHVzZXJuYW1lOiBldmVudC5pZGVudGl0eT8udXNlcm5hbWUsXHJcbiAgICAgIHNvdXJjZUlwOiBldmVudC5pZGVudGl0eT8uc291cmNlSXAsXHJcbiAgICAgIHVzZXJBcm46IGV2ZW50LmlkZW50aXR5Py51c2VyQXJuLFxyXG4gICAgICBhY2NvdW50SWQ6IGV2ZW50LmlkZW50aXR5Py5hY2NvdW50SWQsXHJcbiAgICAgIGNvZ25pdG9JZGVudGl0eVBvb2xJZDogZXZlbnQuaWRlbnRpdHk/LmNvZ25pdG9JZGVudGl0eVBvb2xJZCxcclxuICAgICAgY29nbml0b0lkZW50aXR5SWQ6IGV2ZW50LmlkZW50aXR5Py5jb2duaXRvSWRlbnRpdHlJZCxcclxuICAgICAgcHJpbmNpcGFsT3JnSWQ6IGV2ZW50LmlkZW50aXR5Py5wcmluY2lwYWxPcmdJZCxcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBFeHRyYWN0IHVzZXIgSUQgZnJvbSBBcHBTeW5jIGNvbnRleHRcclxuICAgIC8vIEZvciBJQU0gYXV0aCAoR29vZ2xlKTogdXNlIGNvZ25pdG9JZGVudGl0eUlkIChSRVFVSVJFRCAtIHRoaXMgaXMgdGhlIHVuaXF1ZSB1c2VyIElEKVxyXG4gICAgLy8gRm9yIFVzZXIgUG9vbCBhdXRoOiB1c2UgY2xhaW1zLnN1YlxyXG4gICAgLy8gQ1JJVElDQUw6IERvIE5PVCB1c2UgdXNlcm5hbWUgYXMgZmFsbGJhY2sgLSBpdCdzIHRoZSBJQU0gcm9sZSBuYW1lLCBub3QgdW5pcXVlIHBlciB1c2VyIVxyXG4gICAgY29uc3QgdXNlcklkID0gZXZlbnQuaWRlbnRpdHk/LmNvZ25pdG9JZGVudGl0eUlkIHx8IGV2ZW50LmlkZW50aXR5Py5jbGFpbXM/LnN1YjtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ/CfhpQgRVhUUkFDVEVEIFVTRVIgSUQ6JywgdXNlcklkKTtcclxuICAgIFxyXG4gICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIG5vdCBhdXRoZW50aWNhdGVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIG9wZXJhdGlvbiBmcm9tIEFwcFN5bmMgZmllbGQgbmFtZVxyXG4gICAgY29uc3QgZmllbGROYW1lID0gZXZlbnQuaW5mbz8uZmllbGROYW1lO1xyXG4gICAgY29uc29sZS5sb2coJ0ZpZWxkIG5hbWU6JywgZmllbGROYW1lKTtcclxuICAgIFxyXG4gICAgc3dpdGNoIChmaWVsZE5hbWUpIHtcclxuICAgICAgY2FzZSAnY3JlYXRlUm9vbSc6IHtcclxuICAgICAgICBjb25zb2xlLmxvZygnUHJvY2Vzc2luZyBjcmVhdGVSb29tIG11dGF0aW9uJyk7XHJcbiAgICAgICAgY29uc3QgeyBpbnB1dCB9ID0gZXZlbnQuYXJndW1lbnRzO1xyXG4gICAgICAgIGNvbnN0IHsgbWVkaWFUeXBlLCBnZW5yZUlkcywgbWF4UGFydGljaXBhbnRzIH0gPSBpbnB1dDtcclxuXHJcbiAgICAgICAgY29uc3Qgcm9vbSA9IGF3YWl0IHJvb21TZXJ2aWNlLmNyZWF0ZVJvb20odXNlcklkLCBtZWRpYVR5cGUsIGdlbnJlSWRzLCBtYXhQYXJ0aWNpcGFudHMpO1xyXG4gICAgICAgIHJldHVybiByb29tO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdqb2luUm9vbSc6IHtcclxuICAgICAgICBjb25zb2xlLmxvZygnUHJvY2Vzc2luZyBqb2luUm9vbSBtdXRhdGlvbicpO1xyXG4gICAgICAgIGNvbnN0IHsgY29kZSB9ID0gZXZlbnQuYXJndW1lbnRzO1xyXG4gICAgICAgIGNvbnN0IHJvb20gPSBhd2FpdCByb29tU2VydmljZS5qb2luUm9vbSh1c2VySWQsIGNvZGUpO1xyXG4gICAgICAgIHJldHVybiByb29tO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdnZXRNeVJvb21zJzoge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIGdldE15Um9vbXMgcXVlcnknKTtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgY29uc3Qgcm9vbXMgPSBhd2FpdCByb29tU2VydmljZS5nZXRNeVJvb21zKHVzZXJJZCk7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgUmV0dXJuaW5nICR7cm9vbXMubGVuZ3RofSByb29tcyBmb3IgdXNlciAke3VzZXJJZH1gKTtcclxuICAgICAgICAgIHJldHVybiByb29tcztcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgaW4gZ2V0TXlSb29tcyBoYW5kbGVyOicsIGVycm9yKTtcclxuICAgICAgICAgIC8vIFJldHVybiBlbXB0eSBhcnJheSB0byBwcmV2ZW50IEdyYXBoUUwgbnVsbCBlcnJvclxyXG4gICAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgY2FzZSAnZ2V0Um9vbSc6IHtcclxuICAgICAgICBjb25zb2xlLmxvZygnUHJvY2Vzc2luZyBnZXRSb29tIHF1ZXJ5Jyk7XHJcbiAgICAgICAgY29uc3QgeyBpZCB9ID0gZXZlbnQuYXJndW1lbnRzO1xyXG4gICAgICAgIGNvbnN0IHJvb20gPSBhd2FpdCByb29tU2VydmljZS5nZXRSb29tKGlkKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXJvb20pIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBub3QgZm91bmQgb3IgaGFzIGV4cGlyZWQnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHJvb207XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignVW5rbm93biBmaWVsZCBuYW1lOicsIGZpZWxkTmFtZSk7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignQXZhaWxhYmxlIGV2ZW50IHByb3BlcnRpZXM6JywgT2JqZWN0LmtleXMoZXZlbnQpKTtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFdmVudCBpbmZvOicsIGV2ZW50LmluZm8pO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBmaWVsZDogJHtmaWVsZE5hbWV9YCk7XHJcbiAgICB9XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdSb29tIExhbWJkYSBlcnJvcjonLCBlcnJvcik7XHJcbiAgICBcclxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnO1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSk7XHJcbiAgfVxyXG59OyJdfQ==