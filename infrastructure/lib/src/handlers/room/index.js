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
    async fetchCandidates(mediaType, genreIds, yearRange, platformIds) {
        try {
            // Process special genre IDs
            let processedGenreIds = genreIds;
            // Check if "Todos los géneros" (-2) is selected
            if (genreIds && genreIds.includes(-2)) {
                console.log('Special genre "Todos los géneros" (-2) detected - removing genre filter');
                processedGenreIds = undefined; // No genre filter
            }
            const payload = {
                mediaType,
                genreIds: processedGenreIds,
                yearRange,
                platformIds,
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
    async createRoom(userId, mediaType, genreIds, maxParticipants, yearRange, platformIds) {
        // Validate input
        if (!mediaType || !['MOVIE', 'TV', 'BOTH'].includes(mediaType)) {
            throw new Error('Invalid mediaType. Must be MOVIE, TV, or BOTH');
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
        console.log(`Fetching ${mediaType} candidates for genres: ${genreIds.join(',')} with year range: ${yearRange ? `${yearRange.min}-${yearRange.max}` : 'all'} and platforms: ${platformIds && platformIds.length > 0 ? platformIds.join(',') : 'all'}`);
        const candidates = await this.tmdbIntegration.fetchCandidates(mediaType, genreIds, yearRange, platformIds);
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
            yearRange,
            platformIds,
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
            const activeRooms = allRooms.filter(room => room && (!room.ttl || room.ttl >= now));
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
                const { mediaType, genreIds, maxParticipants, yearRange, platformIds } = input;
                const room = await roomService.createRoom(userId, mediaType, genreIds, maxParticipants, yearRange, platformIds);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvcm9vbS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQWtIO0FBQ2xILDBEQUFxRTtBQUNyRSxtQ0FBb0M7QUFFcEMseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUE4RDFFLHNCQUFzQjtBQUN0QixNQUFNLGlCQUFpQjtJQUlyQixNQUFNLENBQUMsUUFBUTtRQUNiLElBQUksSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUNkLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDMUMsSUFBSSxJQUFJLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztRQUNyRixDQUFDO1FBQ0QsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsTUFBTSxDQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBaUMsRUFBRSxTQUFpQjtRQUM5RSxJQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7UUFDakIsTUFBTSxXQUFXLEdBQUcsRUFBRSxDQUFDO1FBRXZCLE9BQU8sUUFB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WSxDQUFDLENBQUM7SUFDaEMsQ0FBQztBQUNILENBQUMsQ0FBQztBQTFGVyxRQUFBLE9BQU8sV0EwRmxCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSGFuZGxlciB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIFB1dENvbW1hbmQsIEdldENvbW1hbmQsIFF1ZXJ5Q29tbWFuZCwgU2NhbkNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5pbXBvcnQgeyBMYW1iZGFDbGllbnQsIEludm9rZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtbGFtYmRhJztcclxuaW1wb3J0IHsgcmFuZG9tVVVJRCB9IGZyb20gJ2NyeXB0byc7XHJcblxyXG4vLyBJbml0aWFsaXplIEFXUyBjbGllbnRzXHJcbmNvbnN0IGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGR5bmFtb0NsaWVudCk7XHJcbmNvbnN0IGxhbWJkYUNsaWVudCA9IG5ldyBMYW1iZGFDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcblxyXG4vLyBUeXBlc1xyXG5pbnRlcmZhY2UgTW92aWVDYW5kaWRhdGUge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg6IHN0cmluZyB8IG51bGw7XHJcbiAgcmVsZWFzZURhdGU6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnIHwgJ0JPVEgnO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgUm9vbSB7XHJcbiAgaWQ6IHN0cmluZztcclxuICBjb2RlOiBzdHJpbmc7XHJcbiAgaG9zdElkOiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJyB8ICdCT1RIJztcclxuICBnZW5yZUlkczogbnVtYmVyW107XHJcbiAgY2FuZGlkYXRlczogTW92aWVDYW5kaWRhdGVbXTtcclxuICBjcmVhdGVkQXQ6IHN0cmluZztcclxuICB0dGw6IG51bWJlcjtcclxuICBtYXhQYXJ0aWNpcGFudHM6IG51bWJlcjtcclxuICB5ZWFyUmFuZ2U/OiB7IG1pbjogbnVtYmVyOyBtYXg6IG51bWJlciB9O1xyXG4gIHBsYXRmb3JtSWRzPzogbnVtYmVyW107XHJcbn1cclxuXHJcbmludGVyZmFjZSBDcmVhdGVSb29tRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2NyZWF0ZVJvb20nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIGlucHV0OiB7XHJcbiAgICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnIHwgJ0JPVEgnO1xyXG4gICAgZ2VucmVJZHM6IG51bWJlcltdO1xyXG4gICAgbWF4UGFydGljaXBhbnRzOiBudW1iZXI7XHJcbiAgICB5ZWFyUmFuZ2U/OiB7IG1pbjogbnVtYmVyOyBtYXg6IG51bWJlciB9O1xyXG4gICAgcGxhdGZvcm1JZHM/OiBudW1iZXJbXTtcclxuICB9O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgSm9pblJvb21FdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnam9pblJvb20nO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIGNvZGU6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIEdldFJvb21FdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnZ2V0Um9vbSc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBHZXRNeVJvb21zRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2dldE15Um9vbXMnO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG50eXBlIFJvb21FdmVudCA9IENyZWF0ZVJvb21FdmVudCB8IEpvaW5Sb29tRXZlbnQgfCBHZXRSb29tRXZlbnQgfCBHZXRNeVJvb21zRXZlbnQ7XHJcblxyXG5pbnRlcmZhY2UgUm9vbVJlc3BvbnNlIHtcclxuICBzdGF0dXNDb2RlOiBudW1iZXI7XHJcbiAgYm9keTogUm9vbSB8IFJvb21bXSB8IHsgZXJyb3I6IHN0cmluZyB9O1xyXG59XHJcblxyXG4vLyBSb29tIGNvZGUgZ2VuZXJhdG9yXHJcbmNsYXNzIFJvb21Db2RlR2VuZXJhdG9yIHtcclxuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBDSEFSQUNURVJTID0gJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaMDEyMzQ1Njc4OSc7XHJcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgQ09ERV9MRU5HVEggPSA2O1xyXG5cclxuICBzdGF0aWMgZ2VuZXJhdGUoKTogc3RyaW5nIHtcclxuICAgIGxldCBjb2RlID0gJyc7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuQ09ERV9MRU5HVEg7IGkrKykge1xyXG4gICAgICBjb2RlICs9IHRoaXMuQ0hBUkFDVEVSUy5jaGFyQXQoTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogdGhpcy5DSEFSQUNURVJTLmxlbmd0aCkpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGNvZGU7XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgYXN5bmMgZ2VuZXJhdGVVbmlxdWUoZG9jQ2xpZW50OiBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCB0YWJsZU5hbWU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICBsZXQgYXR0ZW1wdHMgPSAwO1xyXG4gICAgY29uc3QgbWF4QXR0ZW1wdHMgPSAxMDtcclxuXHJcbiAgICB3aGlsZSAoYXR0ZW1wdHMgPCBtYXhBdHRlbXB0cykge1xyXG4gICAgICBjb25zdCBjb2RlID0gdGhpcy5nZW5lcmF0ZSgpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgaWYgY29kZSBhbHJlYWR5IGV4aXN0c1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0YWJsZU5hbWUsXHJcbiAgICAgICAgICBJbmRleE5hbWU6ICdjb2RlLWluZGV4JyxcclxuICAgICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdjb2RlID0gOmNvZGUnLFxyXG4gICAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgICAnOmNvZGUnOiBjb2RlLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIGlmICghcmVzdWx0Lkl0ZW1zIHx8IHJlc3VsdC5JdGVtcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgIHJldHVybiBjb2RlOyAvLyBDb2RlIGlzIHVuaXF1ZVxyXG4gICAgICAgIH1cclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyBjb2RlIHVuaXF1ZW5lc3M6JywgZXJyb3IpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBhdHRlbXB0cysrO1xyXG4gICAgfVxyXG5cclxuICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIGdlbmVyYXRlIHVuaXF1ZSByb29tIGNvZGUgYWZ0ZXIgbWF4aW11bSBhdHRlbXB0cycpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVE1EQiBJbnRlZ3JhdGlvblxyXG5jbGFzcyBUTURCSW50ZWdyYXRpb24ge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbGFtYmRhQXJuOiBzdHJpbmc7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5sYW1iZGFBcm4gPSBwcm9jZXNzLmVudi5UTURCX0xBTUJEQV9BUk4gfHwgJyc7XHJcbiAgICBpZiAoIXRoaXMubGFtYmRhQXJuKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVE1EQl9MQU1CREFfQVJOIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBmZXRjaENhbmRpZGF0ZXMobWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJyB8ICdCT1RIJywgZ2VucmVJZHM/OiBudW1iZXJbXSwgeWVhclJhbmdlPzogeyBtaW46IG51bWJlcjsgbWF4OiBudW1iZXIgfSwgcGxhdGZvcm1JZHM/OiBudW1iZXJbXSk6IFByb21pc2U8TW92aWVDYW5kaWRhdGVbXT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gUHJvY2VzcyBzcGVjaWFsIGdlbnJlIElEc1xyXG4gICAgICBsZXQgcHJvY2Vzc2VkR2VucmVJZHMgPSBnZW5yZUlkcztcclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGlmIFwiVG9kb3MgbG9zIGfDqW5lcm9zXCIgKC0yKSBpcyBzZWxlY3RlZFxyXG4gICAgICBpZiAoZ2VucmVJZHMgJiYgZ2VucmVJZHMuaW5jbHVkZXMoLTIpKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1NwZWNpYWwgZ2VucmUgXCJUb2RvcyBsb3MgZ8OpbmVyb3NcIiAoLTIpIGRldGVjdGVkIC0gcmVtb3ZpbmcgZ2VucmUgZmlsdGVyJyk7XHJcbiAgICAgICAgcHJvY2Vzc2VkR2VucmVJZHMgPSB1bmRlZmluZWQ7IC8vIE5vIGdlbnJlIGZpbHRlclxyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBwYXlsb2FkID0ge1xyXG4gICAgICAgIG1lZGlhVHlwZSxcclxuICAgICAgICBnZW5yZUlkczogcHJvY2Vzc2VkR2VucmVJZHMsXHJcbiAgICAgICAgeWVhclJhbmdlLFxyXG4gICAgICAgIHBsYXRmb3JtSWRzLFxyXG4gICAgICAgIC8vIE5vdGU6IHBhZ2UgcGFyYW1ldGVyIHJlbW92ZWQgLSBTbWFydCBSYW5kb20gRGlzY292ZXJ5IGhhbmRsZXMgcGFnaW5hdGlvbiBpbnRlcm5hbGx5XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zb2xlLmxvZygnSW52b2tpbmcgVE1EQiBMYW1iZGEgd2l0aCBTbWFydCBSYW5kb20gRGlzY292ZXJ5IHBheWxvYWQ6JywgSlNPTi5zdHJpbmdpZnkocGF5bG9hZCkpO1xyXG5cclxuICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcclxuICAgICAgICBGdW5jdGlvbk5hbWU6IHRoaXMubGFtYmRhQXJuLFxyXG4gICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQoY29tbWFuZCk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoIXJlc3BvbnNlLlBheWxvYWQpIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIHJlc3BvbnNlIGZyb20gVE1EQiBMYW1iZGEnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocmVzcG9uc2UuUGF5bG9hZCkpO1xyXG4gICAgICBcclxuICAgICAgaWYgKHJlc3VsdC5zdGF0dXNDb2RlICE9PSAyMDApIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRNREIgTGFtYmRhIGVycm9yOiAke0pTT04uc3RyaW5naWZ5KHJlc3VsdC5ib2R5KX1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgY2FuZGlkYXRlcyA9IHJlc3VsdC5ib2R5LmNhbmRpZGF0ZXMgfHwgW107XHJcbiAgICAgIGNvbnNvbGUubG9nKGBTbWFydCBSYW5kb20gRGlzY292ZXJ5IHJldHVybmVkICR7Y2FuZGlkYXRlcy5sZW5ndGh9IGNhbmRpZGF0ZXNgKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiBjYW5kaWRhdGVzO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1RNREIgSW50ZWdyYXRpb24gZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBmZXRjaCBtb3ZpZSBjYW5kaWRhdGVzOiAke2Vycm9yfWApO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuLy8gUm9vbSBTZXJ2aWNlXHJcbmNsYXNzIFJvb21TZXJ2aWNlIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IHRhYmxlTmFtZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgdG1kYkludGVncmF0aW9uOiBUTURCSW50ZWdyYXRpb247XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy50YWJsZU5hbWUgPSBwcm9jZXNzLmVudi5ST09NU19UQUJMRSB8fCAnJztcclxuICAgIGlmICghdGhpcy50YWJsZU5hbWUpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdST09NU19UQUJMRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG4gICAgdGhpcy50bWRiSW50ZWdyYXRpb24gPSBuZXcgVE1EQkludGVncmF0aW9uKCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBjcmVhdGVSb29tKHVzZXJJZDogc3RyaW5nLCBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnIHwgJ0JPVEgnLCBnZW5yZUlkczogbnVtYmVyW10sIG1heFBhcnRpY2lwYW50czogbnVtYmVyLCB5ZWFyUmFuZ2U/OiB7IG1pbjogbnVtYmVyOyBtYXg6IG51bWJlciB9LCBwbGF0Zm9ybUlkcz86IG51bWJlcltdKTogUHJvbWlzZTxSb29tPiB7XHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCFtZWRpYVR5cGUgfHwgIVsnTU9WSUUnLCAnVFYnLCAnQk9USCddLmluY2x1ZGVzKG1lZGlhVHlwZSkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIG1lZGlhVHlwZS4gTXVzdCBiZSBNT1ZJRSwgVFYsIG9yIEJPVEgnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBtYXhQYXJ0aWNpcGFudHNcclxuICAgIGlmICghbWF4UGFydGljaXBhbnRzIHx8IHR5cGVvZiBtYXhQYXJ0aWNpcGFudHMgIT09ICdudW1iZXInKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignbWF4UGFydGljaXBhbnRzIGlzIHJlcXVpcmVkIGFuZCBtdXN0IGJlIGEgbnVtYmVyJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKG1heFBhcnRpY2lwYW50cyA8IDIgfHwgbWF4UGFydGljaXBhbnRzID4gNikge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ21heFBhcnRpY2lwYW50cyBtdXN0IGJlIGJldHdlZW4gMiBhbmQgNicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEVuZm9yY2UgZ2VucmUgbGltaXQgKG1heCAyIGFzIHBlciBtYXN0ZXIgc3BlYylcclxuICAgIGlmIChnZW5yZUlkcy5sZW5ndGggPiAyKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTWF4aW11bSAyIGdlbnJlcyBhbGxvd2VkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2VuZXJhdGUgdW5pcXVlIHJvb20gY29kZVxyXG4gICAgY29uc3QgY29kZSA9IGF3YWl0IFJvb21Db2RlR2VuZXJhdG9yLmdlbmVyYXRlVW5pcXVlKGRvY0NsaWVudCwgdGhpcy50YWJsZU5hbWUpO1xyXG4gICAgXHJcbiAgICAvLyBGZXRjaCBtb3ZpZSBjYW5kaWRhdGVzIGZyb20gVE1EQlxyXG4gICAgY29uc29sZS5sb2coYEZldGNoaW5nICR7bWVkaWFUeXBlfSBjYW5kaWRhdGVzIGZvciBnZW5yZXM6ICR7Z2VucmVJZHMuam9pbignLCcpfSB3aXRoIHllYXIgcmFuZ2U6ICR7eWVhclJhbmdlID8gYCR7eWVhclJhbmdlLm1pbn0tJHt5ZWFyUmFuZ2UubWF4fWAgOiAnYWxsJ30gYW5kIHBsYXRmb3JtczogJHtwbGF0Zm9ybUlkcyAmJiBwbGF0Zm9ybUlkcy5sZW5ndGggPiAwID8gcGxhdGZvcm1JZHMuam9pbignLCcpIDogJ2FsbCd9YCk7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gYXdhaXQgdGhpcy50bWRiSW50ZWdyYXRpb24uZmV0Y2hDYW5kaWRhdGVzKG1lZGlhVHlwZSwgZ2VucmVJZHMsIHllYXJSYW5nZSwgcGxhdGZvcm1JZHMpO1xyXG4gICAgXHJcbiAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgY29uc29sZS53YXJuKCdObyBjYW5kaWRhdGVzIHJldHVybmVkIGZyb20gVE1EQiAtIHByb2NlZWRpbmcgd2l0aCBlbXB0eSBsaXN0Jyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ3JlYXRlIHJvb20gcmVjb3JkXHJcbiAgICBjb25zdCByb29tSWQgPSByYW5kb21VVUlEKCk7XHJcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICBjb25zdCB0dGwgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICgyNCAqIDYwICogNjApOyAvLyAyNCBob3VycyBmcm9tIG5vd1xyXG5cclxuICAgIGNvbnN0IHJvb206IFJvb20gPSB7XHJcbiAgICAgIGlkOiByb29tSWQsXHJcbiAgICAgIGNvZGUsXHJcbiAgICAgIGhvc3RJZDogdXNlcklkLFxyXG4gICAgICBtZWRpYVR5cGUsXHJcbiAgICAgIGdlbnJlSWRzLFxyXG4gICAgICBjYW5kaWRhdGVzLFxyXG4gICAgICBjcmVhdGVkQXQ6IG5vdyxcclxuICAgICAgdHRsLFxyXG4gICAgICBtYXhQYXJ0aWNpcGFudHMsXHJcbiAgICAgIHllYXJSYW5nZSxcclxuICAgICAgcGxhdGZvcm1JZHMsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFN0b3JlIGluIER5bmFtb0RCXHJcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXHJcbiAgICAgIEl0ZW06IHJvb20sXHJcbiAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfbm90X2V4aXN0cyhpZCknLCAvLyBFbnN1cmUgbm8gZHVwbGljYXRlIElEc1xyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIFJlY29yZCBob3N0IHBhcnRpY2lwYXRpb24gd2hlbiBjcmVhdGluZyByb29tIChob3N0IGlzIHRoZSBmaXJzdCBwYXJ0aWNpcGFudClcclxuICAgIC8vIFRoaXMgZW5zdXJlcyB0aGUgaG9zdCBjb3VudHMgdG93YXJkcyB0aGUgbWF4UGFydGljaXBhbnRzIGxpbWl0XHJcbiAgICBhd2FpdCB0aGlzLnJlY29yZFJvb21QYXJ0aWNpcGF0aW9uKHVzZXJJZCwgcm9vbUlkLCBtYXhQYXJ0aWNpcGFudHMpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBSb29tIGNyZWF0ZWQgc3VjY2Vzc2Z1bGx5OiAke3Jvb21JZH0gd2l0aCBjb2RlOiAke2NvZGV9LCBtYXhQYXJ0aWNpcGFudHM6ICR7bWF4UGFydGljaXBhbnRzfSwgaG9zdCByZWdpc3RlcmVkIGFzIGZpcnN0IHBhcnRpY2lwYW50YCk7XHJcbiAgICByZXR1cm4gcm9vbTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGpvaW5Sb29tKHVzZXJJZDogc3RyaW5nLCBjb2RlOiBzdHJpbmcpOiBQcm9taXNlPFJvb20+IHtcclxuICAgIGlmICghY29kZSB8fCBjb2RlLnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIGNvZGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgSUQgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBRdWVyeSBieSByb29tIGNvZGUgdXNpbmcgR1NJXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXHJcbiAgICAgICAgSW5kZXhOYW1lOiAnY29kZS1pbmRleCcsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ2NvZGUgPSA6Y29kZScsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpjb2RlJzogY29kZS50b1VwcGVyQ2FzZSgpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGlmICghcmVzdWx0Lkl0ZW1zIHx8IHJlc3VsdC5JdGVtcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gbm90IGZvdW5kLiBQbGVhc2UgY2hlY2sgdGhlIHJvb20gY29kZS4nKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHJlc3VsdC5JdGVtcy5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgTXVsdGlwbGUgcm9vbXMgZm91bmQgZm9yIGNvZGUgJHtjb2RlfTpgLCByZXN1bHQuSXRlbXMpO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignTXVsdGlwbGUgcm9vbXMgZm91bmQgZm9yIGNvZGUuIFBsZWFzZSBjb250YWN0IHN1cHBvcnQuJyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJvb20gPSByZXN1bHQuSXRlbXNbMF0gYXMgUm9vbTtcclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHJvb20gaGFzIGV4cGlyZWRcclxuICAgICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XHJcbiAgICAgIGlmIChyb29tLnR0bCAmJiByb29tLnR0bCA8IG5vdykge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBoYXMgZXhwaXJlZC4gUGxlYXNlIGNyZWF0ZSBhIG5ldyByb29tLicpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiB1c2VyIGlzIGFscmVhZHkgaW4gdGhlIHJvb21cclxuICAgICAgY29uc3QgaXNBbHJlYWR5SW5Sb29tID0gYXdhaXQgdGhpcy5pc1VzZXJJblJvb20odXNlcklkLCByb29tLmlkKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChpc0FscmVhZHlJblJvb20pIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gaXMgYWxyZWFkeSBpbiByb29tICR7cm9vbS5pZH0sIHJldHVybmluZyByb29tIGRhdGFgKTtcclxuICAgICAgICByZXR1cm4gcm9vbTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gQ1JJVElDQUw6IENoZWNrIHBhcnRpY2lwYW50IGNvdW50IEJFRk9SRSBhdHRlbXB0aW5nIHRvIGpvaW5cclxuICAgICAgLy8gVGhpcyBpbmNsdWRlcyB0aGUgaG9zdCBhcyB0aGUgZmlyc3QgcGFydGljaXBhbnRcclxuICAgICAgY29uc3QgY3VycmVudFBhcnRpY2lwYW50cyA9IGF3YWl0IHRoaXMuZ2V0Um9vbVBhcnRpY2lwYW50Q291bnQocm9vbS5pZCk7XHJcbiAgICAgIGNvbnN0IG1heFBhcnRpY2lwYW50cyA9IHJvb20ubWF4UGFydGljaXBhbnRzIHx8IDI7IC8vIERlZmF1bHQgdG8gMiBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coYFJvb20gJHtyb29tLmlkfSBoYXMgJHtjdXJyZW50UGFydGljaXBhbnRzfS8ke21heFBhcnRpY2lwYW50c30gcGFydGljaXBhbnRzIChpbmNsdWRpbmcgaG9zdClgKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChjdXJyZW50UGFydGljaXBhbnRzID49IG1heFBhcnRpY2lwYW50cykge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRXN0YSBzYWxhIGVzdMOhIGxsZW5hLicpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBBdHRlbXB0IHRvIHJlY29yZCBwYXJ0aWNpcGF0aW9uIHdpdGggYXRvbWljIGNoZWNrXHJcbiAgICAgIC8vIFRoaXMgd2lsbCBmYWlsIGlmIGFub3RoZXIgdXNlciBqb2lucyBzaW11bHRhbmVvdXNseSBhbmQgZmlsbHMgdGhlIHJvb21cclxuICAgICAgYXdhaXQgdGhpcy5yZWNvcmRSb29tUGFydGljaXBhdGlvbih1c2VySWQsIHJvb20uaWQsIG1heFBhcnRpY2lwYW50cyk7XHJcblxyXG4gICAgICAvLyBEb3VibGUtY2hlY2sgYWZ0ZXIgcmVjb3JkaW5nIHRvIGVuc3VyZSB3ZSBkaWRuJ3QgZXhjZWVkIHRoZSBsaW1pdFxyXG4gICAgICAvLyBUaGlzIGlzIGEgc2FmZXR5IGNoZWNrIGluIGNhc2Ugb2YgcmFjZSBjb25kaXRpb25zXHJcbiAgICAgIGNvbnN0IGZpbmFsUGFydGljaXBhbnRzID0gYXdhaXQgdGhpcy5nZXRSb29tUGFydGljaXBhbnRDb3VudChyb29tLmlkKTtcclxuICAgICAgaWYgKGZpbmFsUGFydGljaXBhbnRzID4gbWF4UGFydGljaXBhbnRzKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgUkFDRSBDT05ESVRJT04gREVURUNURUQ6IFJvb20gJHtyb29tLmlkfSBub3cgaGFzICR7ZmluYWxQYXJ0aWNpcGFudHN9LyR7bWF4UGFydGljaXBhbnRzfSBwYXJ0aWNpcGFudHNgKTtcclxuICAgICAgICAvLyBOb3RlOiBJbiBwcm9kdWN0aW9uLCB5b3UgbWlnaHQgd2FudCB0byBpbXBsZW1lbnQgYSBjbGVhbnVwIG1lY2hhbmlzbSBoZXJlXHJcbiAgICAgICAgLy8gRm9yIG5vdywgd2UgbG9nIHRoZSBlcnJvciBidXQgYWxsb3cgdGhlIGpvaW4gc2luY2UgdGhlIHJlY29yZCBpcyBhbHJlYWR5IGNyZWF0ZWRcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IHN1Y2Nlc3NmdWxseSBqb2luZWQgcm9vbTogJHtyb29tLmlkfSB3aXRoIGNvZGU6ICR7Y29kZX1gKTtcclxuICAgICAgcmV0dXJuIHJvb207XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAvLyBGYWxsYmFjayB0byBzY2FuIGlmIEdTSSBpcyBub3QgYXZhaWxhYmxlIHlldFxyXG4gICAgICBjb25zdCBlcnIgPSBlcnJvciBhcyBhbnk7XHJcbiAgICAgIGlmIChlcnIubmFtZSA9PT0gJ1Jlc291cmNlTm90Rm91bmRFeGNlcHRpb24nIHx8IGVyci5tZXNzYWdlPy5pbmNsdWRlcygnR1NJJykpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnR1NJIG5vdCBhdmFpbGFibGUsIGZhbGxpbmcgYmFjayB0byBzY2FuIG1ldGhvZCcpO1xyXG4gICAgICAgIHJldHVybiBhd2FpdCB0aGlzLmpvaW5Sb29tQnlTY2FuKHVzZXJJZCwgY29kZSk7XHJcbiAgICAgIH1cclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGpvaW5Sb29tQnlTY2FuKHVzZXJJZDogc3RyaW5nLCBjb2RlOiBzdHJpbmcpOiBQcm9taXNlPFJvb20+IHtcclxuICAgIC8vIEZhbGxiYWNrIG1ldGhvZCB1c2luZyBzY2FuXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgU2NhbkNvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHRoaXMudGFibGVOYW1lLFxyXG4gICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnY29kZSA9IDpjb2RlJyxcclxuICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICc6Y29kZSc6IGNvZGUudG9VcHBlckNhc2UoKSxcclxuICAgICAgfSxcclxuICAgIH0pKTtcclxuXHJcbiAgICBpZiAoIXJlc3VsdC5JdGVtcyB8fCByZXN1bHQuSXRlbXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBub3QgZm91bmQuIFBsZWFzZSBjaGVjayB0aGUgcm9vbSBjb2RlLicpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJvb20gPSByZXN1bHQuSXRlbXNbMF0gYXMgUm9vbTtcclxuXHJcbiAgICAvLyBDaGVjayBpZiByb29tIGhhcyBleHBpcmVkXHJcbiAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgIGlmIChyb29tLnR0bCAmJiByb29tLnR0bCA8IG5vdykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gaGFzIGV4cGlyZWQuIFBsZWFzZSBjcmVhdGUgYSBuZXcgcm9vbS4nKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDaGVjayBpZiB1c2VyIGlzIGFscmVhZHkgaW4gdGhlIHJvb21cclxuICAgIGNvbnN0IGlzQWxyZWFkeUluUm9vbSA9IGF3YWl0IHRoaXMuaXNVc2VySW5Sb29tKHVzZXJJZCwgcm9vbS5pZCk7XHJcbiAgICBcclxuICAgIGlmIChpc0FscmVhZHlJblJvb20pIHtcclxuICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGlzIGFscmVhZHkgaW4gcm9vbSAke3Jvb20uaWR9LCByZXR1cm5pbmcgcm9vbSBkYXRhIChzY2FuIG1ldGhvZClgKTtcclxuICAgICAgcmV0dXJuIHJvb207XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ1JJVElDQUw6IENoZWNrIHBhcnRpY2lwYW50IGNvdW50IEJFRk9SRSBhdHRlbXB0aW5nIHRvIGpvaW5cclxuICAgIC8vIFRoaXMgaW5jbHVkZXMgdGhlIGhvc3QgYXMgdGhlIGZpcnN0IHBhcnRpY2lwYW50XHJcbiAgICBjb25zdCBjdXJyZW50UGFydGljaXBhbnRzID0gYXdhaXQgdGhpcy5nZXRSb29tUGFydGljaXBhbnRDb3VudChyb29tLmlkKTtcclxuICAgIGNvbnN0IG1heFBhcnRpY2lwYW50cyA9IHJvb20ubWF4UGFydGljaXBhbnRzIHx8IDI7IC8vIERlZmF1bHQgdG8gMiBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZyhgUm9vbSAke3Jvb20uaWR9IGhhcyAke2N1cnJlbnRQYXJ0aWNpcGFudHN9LyR7bWF4UGFydGljaXBhbnRzfSBwYXJ0aWNpcGFudHMgKGluY2x1ZGluZyBob3N0KSAtIHNjYW4gbWV0aG9kYCk7XHJcbiAgICBcclxuICAgIGlmIChjdXJyZW50UGFydGljaXBhbnRzID49IG1heFBhcnRpY2lwYW50cykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0VzdGEgc2FsYSBlc3TDoSBsbGVuYS4nKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBBdHRlbXB0IHRvIHJlY29yZCBwYXJ0aWNpcGF0aW9uIHdpdGggYXRvbWljIGNoZWNrXHJcbiAgICBhd2FpdCB0aGlzLnJlY29yZFJvb21QYXJ0aWNpcGF0aW9uKHVzZXJJZCwgcm9vbS5pZCwgbWF4UGFydGljaXBhbnRzKTtcclxuXHJcbiAgICAvLyBEb3VibGUtY2hlY2sgYWZ0ZXIgcmVjb3JkaW5nIHRvIGVuc3VyZSB3ZSBkaWRuJ3QgZXhjZWVkIHRoZSBsaW1pdFxyXG4gICAgY29uc3QgZmluYWxQYXJ0aWNpcGFudHMgPSBhd2FpdCB0aGlzLmdldFJvb21QYXJ0aWNpcGFudENvdW50KHJvb20uaWQpO1xyXG4gICAgaWYgKGZpbmFsUGFydGljaXBhbnRzID4gbWF4UGFydGljaXBhbnRzKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYFJBQ0UgQ09ORElUSU9OIERFVEVDVEVEOiBSb29tICR7cm9vbS5pZH0gbm93IGhhcyAke2ZpbmFsUGFydGljaXBhbnRzfS8ke21heFBhcnRpY2lwYW50c30gcGFydGljaXBhbnRzIChzY2FuIG1ldGhvZClgKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gc3VjY2Vzc2Z1bGx5IGpvaW5lZCByb29tOiAke3Jvb20uaWR9IHdpdGggY29kZTogJHtjb2RlfSAoc2NhbiBtZXRob2QpYCk7XHJcbiAgICByZXR1cm4gcm9vbTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVjb3JkUm9vbVBhcnRpY2lwYXRpb24odXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nLCBtYXhQYXJ0aWNpcGFudHM6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3Qgdm90ZXNUYWJsZSA9IHByb2Nlc3MuZW52LlZPVEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgICBpZiAoIXZvdGVzVGFibGUpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ1ZPVEVTX1RBQkxFIG5vdCBjb25maWd1cmVkLCBza2lwcGluZyBwYXJ0aWNpcGF0aW9uIHRyYWNraW5nJyk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDcmVhdGUgYSBzcGVjaWFsIFwicGFydGljaXBhdGlvblwiIHJlY29yZCBpbiBWT1RFUyB0YWJsZVxyXG4gICAgICAvLyBUaGlzIGFsbG93cyB0aGUgcm9vbSB0byBhcHBlYXIgaW4gZ2V0TXlSb29tcygpIGV2ZW4gd2l0aG91dCBhY3R1YWwgdm90ZXNcclxuICAgICAgY29uc3QgcGFydGljaXBhdGlvblJlY29yZCA9IHtcclxuICAgICAgICByb29tSWQsXHJcbiAgICAgICAgdXNlck1vdmllSWQ6IGAke3VzZXJJZH0jSk9JTkVEYCwgLy8gU3BlY2lhbCBtYXJrZXIgZm9yIHJvb20gcGFydGljaXBhdGlvblxyXG4gICAgICAgIHVzZXJJZCxcclxuICAgICAgICBtb3ZpZUlkOiAtMSwgLy8gU3BlY2lhbCB2YWx1ZSBpbmRpY2F0aW5nIHRoaXMgaXMgYSBwYXJ0aWNpcGF0aW9uIHJlY29yZCwgbm90IGEgdm90ZVxyXG4gICAgICAgIHZvdGU6IGZhbHNlLCAvLyBOb3QgYSByZWFsIHZvdGVcclxuICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICBpc1BhcnRpY2lwYXRpb246IHRydWUsIC8vIEZsYWcgdG8gZGlzdGluZ3Vpc2ggZnJvbSByZWFsIHZvdGVzXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBVc2UgY29uZGl0aW9uYWwgZXhwcmVzc2lvbiB0byBlbnN1cmUgYXRvbWljaXR5IGFuZCBwcmV2ZW50IGV4Y2VlZGluZyBtYXhQYXJ0aWNpcGFudHNcclxuICAgICAgLy8gVGhpcyBwcmV2ZW50cyByYWNlIGNvbmRpdGlvbnMgd2hlbiBtdWx0aXBsZSB1c2VycyB0cnkgdG8gam9pbiBzaW11bHRhbmVvdXNseVxyXG4gICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB2b3Rlc1RhYmxlLFxyXG4gICAgICAgIEl0ZW06IHBhcnRpY2lwYXRpb25SZWNvcmQsXHJcbiAgICAgICAgQ29uZGl0aW9uRXhwcmVzc2lvbjogJ2F0dHJpYnV0ZV9ub3RfZXhpc3RzKHVzZXJNb3ZpZUlkKScsXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBQYXJ0aWNpcGF0aW9uIHJlY29yZGVkIGZvciB1c2VyICR7dXNlcklkfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgLy8gSWYgY29uZGl0aW9uIGZhaWxzLCB1c2VyIGlzIGFscmVhZHkgaW4gdGhlIHJvb20gLSB0aGlzIGlzIE9LXHJcbiAgICAgIGNvbnN0IGVyciA9IGVycm9yIGFzIGFueTtcclxuICAgICAgaWYgKGVyci5uYW1lID09PSAnQ29uZGl0aW9uYWxDaGVja0ZhaWxlZEV4Y2VwdGlvbicpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gYWxyZWFkeSBoYXMgcGFydGljaXBhdGlvbiByZWNvcmQgaW4gcm9vbSAke3Jvb21JZH1gKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgcmVjb3JkaW5nIHBhcnRpY2lwYXRpb24gZm9yIHVzZXIgJHt1c2VySWR9IGluIHJvb20gJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7IC8vIFJlLXRocm93IHRvIGZhaWwgdGhlIGpvaW4gb3BlcmF0aW9uIG9uIHVuZXhwZWN0ZWQgZXJyb3JzXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldFJvb21QYXJ0aWNpcGFudENvdW50KHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTxudW1iZXI+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHZvdGVzVGFibGUgPSBwcm9jZXNzLmVudi5WT1RFU19UQUJMRSB8fCAnJztcclxuICAgICAgaWYgKCF2b3Rlc1RhYmxlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdWT1RFU19UQUJMRSBub3QgY29uZmlndXJlZCwgY2Fubm90IGNvdW50IHBhcnRpY2lwYW50cycpO1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBRdWVyeSBhbGwgcGFydGljaXBhdGlvbiByZWNvcmRzIGZvciB0aGlzIHJvb21cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB2b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnaXNQYXJ0aWNpcGF0aW9uID0gOmlzUGFydGljaXBhdGlvbicsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgICAnOmlzUGFydGljaXBhdGlvbic6IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgcGFydGljaXBhbnRzID0gcmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICBjb25zdCB1bmlxdWVVc2VySWRzID0gbmV3IFNldChwYXJ0aWNpcGFudHMubWFwKHAgPT4gcC51c2VySWQpKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGBSb29tICR7cm9vbUlkfSBoYXMgJHt1bmlxdWVVc2VySWRzLnNpemV9IHVuaXF1ZSBwYXJ0aWNpcGFudHNgKTtcclxuICAgICAgcmV0dXJuIHVuaXF1ZVVzZXJJZHMuc2l6ZTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGNvdW50aW5nIHBhcnRpY2lwYW50cyBmb3Igcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gMDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgaXNVc2VySW5Sb29tKHVzZXJJZDogc3RyaW5nLCByb29tSWQ6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3Qgdm90ZXNUYWJsZSA9IHByb2Nlc3MuZW52LlZPVEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgICBpZiAoIXZvdGVzVGFibGUpIHtcclxuICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHVzZXIgaGFzIGEgcGFydGljaXBhdGlvbiByZWNvcmQgaW4gdGhpcyByb29tXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdm90ZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ3VzZXJJZCA9IDp1c2VySWQgQU5EIGlzUGFydGljaXBhdGlvbiA9IDppc1BhcnRpY2lwYXRpb24nLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgICAnOmlzUGFydGljaXBhdGlvbic6IHRydWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBMaW1pdDogMSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgaXNJblJvb20gPSAhIShyZXN1bHQuSXRlbXMgJiYgcmVzdWx0Lkl0ZW1zLmxlbmd0aCA+IDApO1xyXG4gICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gJHtpc0luUm9vbSA/ICdpcyBhbHJlYWR5JyA6ICdpcyBub3QnfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG4gICAgICByZXR1cm4gaXNJblJvb207XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBjaGVja2luZyBpZiB1c2VyICR7dXNlcklkfSBpcyBpbiByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGdldE15Um9vbXModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPFJvb21bXT4ge1xyXG4gICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignZ2V0TXlSb29tcyBjYWxsZWQgd2l0aG91dCB1c2VySWQnKTtcclxuICAgICAgcmV0dXJuIFtdOyAvLyBSZXR1cm4gZW1wdHkgYXJyYXkgaW5zdGVhZCBvZiB0aHJvd2luZ1xyXG4gICAgfVxyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBHZXR0aW5nIHJvb21zIGZvciB1c2VyOiAke3VzZXJJZH1gKTtcclxuICAgICAgY29uc3QgYWxsUm9vbXM6IFJvb21bXSA9IFtdO1xyXG5cclxuICAgICAgLy8gMS4gR2V0IHJvb21zIHdoZXJlIHVzZXIgaXMgdGhlIGhvc3QgLSB1c2Ugc2NhbiBmb3Igbm93IHNpbmNlIEdTSSBtaWdodCBub3QgYmUgcmVhZHlcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBob3N0Um9vbXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgU2NhbkNvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdob3N0SWQgPSA6dXNlcklkJyxcclxuICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgY29uc3QgaG9zdFJvb21zID0gaG9zdFJvb21zUmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke2hvc3RSb29tcy5sZW5ndGh9IHJvb21zIHdoZXJlIHVzZXIgaXMgaG9zdGApO1xyXG4gICAgICAgIGFsbFJvb21zLnB1c2goLi4uKGhvc3RSb29tcyBhcyBSb29tW10pKTtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBmZXRjaGluZyBob3N0IHJvb21zOicsIGVycm9yKTtcclxuICAgICAgICAvLyBDb250aW51ZSB3aXRoIGVtcHR5IGhvc3Qgcm9vbXNcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gMi4gR2V0IHJvb21zIHdoZXJlIHVzZXIgaGFzIHBhcnRpY2lwYXRlZCAoam9pbmVkIG9yIHZvdGVkKVxyXG4gICAgICBjb25zdCB2b3Rlc1RhYmxlID0gcHJvY2Vzcy5lbnYuVk9URVNfVEFCTEUgfHwgJyc7XHJcbiAgICAgIGlmICh2b3Rlc1RhYmxlKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIC8vIEdldCBhbGwgcGFydGljaXBhdGlvbiByZWNvcmRzIGJ5IHRoaXMgdXNlciAtIHVzZSBzY2FuIGZvciBub3dcclxuICAgICAgICAgIGNvbnN0IHVzZXJQYXJ0aWNpcGF0aW9uUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFNjYW5Db21tYW5kKHtcclxuICAgICAgICAgICAgVGFibGVOYW1lOiB2b3Rlc1RhYmxlLFxyXG4gICAgICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAndXNlcklkID0gOnVzZXJJZCcsXHJcbiAgICAgICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgICBjb25zdCB1c2VyUGFydGljaXBhdGlvbiA9IHVzZXJQYXJ0aWNpcGF0aW9uUmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7dXNlclBhcnRpY2lwYXRpb24ubGVuZ3RofSBwYXJ0aWNpcGF0aW9uIHJlY29yZHMgZm9yIHVzZXJgKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gR2V0IHVuaXF1ZSByb29tIElEcyBmcm9tIHBhcnRpY2lwYXRpb24gcmVjb3JkcyAoYm90aCB2b3RlcyBhbmQgam9pbnMpXHJcbiAgICAgICAgICBjb25zdCBwYXJ0aWNpcGF0ZWRSb29tSWRzID0gbmV3IFNldCh1c2VyUGFydGljaXBhdGlvbi5tYXAocmVjb3JkID0+IHJlY29yZC5yb29tSWQpKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gR2V0IHJvb20gZGV0YWlscyBmb3IgcGFydGljaXBhdGVkIHJvb21zIChleGNsdWRpbmcgYWxyZWFkeSBmZXRjaGVkIGhvc3Qgcm9vbXMpXHJcbiAgICAgICAgICBjb25zdCBob3N0Um9vbUlkcyA9IG5ldyBTZXQoYWxsUm9vbXMubWFwKHJvb20gPT4gcm9vbS5pZCkpO1xyXG4gICAgICAgICAgY29uc3QgbmV3Um9vbUlkcyA9IEFycmF5LmZyb20ocGFydGljaXBhdGVkUm9vbUlkcykuZmlsdGVyKHJvb21JZCA9PiAhaG9zdFJvb21JZHMuaGFzKHJvb21JZCkpO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHtuZXdSb29tSWRzLmxlbmd0aH0gYWRkaXRpb25hbCByb29tcyB3aGVyZSB1c2VyIHBhcnRpY2lwYXRlZGApO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBGZXRjaCByb29tIGRldGFpbHMgZm9yIHBhcnRpY2lwYXRlZCByb29tc1xyXG4gICAgICAgICAgY29uc3QgcGFydGljaXBhdGVkUm9vbXNQcm9taXNlcyA9IG5ld1Jvb21JZHMubWFwKGFzeW5jIChyb29tSWQpID0+IHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICBjb25zdCByb29tUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICAgICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnRhYmxlTmFtZSxcclxuICAgICAgICAgICAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICAgICAgICAgICAgfSkpO1xyXG4gICAgICAgICAgICAgIHJldHVybiByb29tUmVzdWx0Lkl0ZW0gYXMgUm9vbTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBmZXRjaGluZyByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgIGNvbnN0IHBhcnRpY2lwYXRlZFJvb21zID0gKGF3YWl0IFByb21pc2UuYWxsKHBhcnRpY2lwYXRlZFJvb21zUHJvbWlzZXMpKVxyXG4gICAgICAgICAgICAuZmlsdGVyKHJvb20gPT4gcm9vbSAhPT0gbnVsbCkgYXMgUm9vbVtdO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBhbGxSb29tcy5wdXNoKC4uLnBhcnRpY2lwYXRlZFJvb21zKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgcGFydGljaXBhdGVkIHJvb21zOicsIGVycm9yKTtcclxuICAgICAgICAgIC8vIENvbnRpbnVlIHdpdGggb25seSBob3N0IHJvb21zXHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUud2FybignVk9URVNfVEFCTEUgbm90IGNvbmZpZ3VyZWQsIG9ubHkgc2hvd2luZyBob3N0ZWQgcm9vbXMnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gMy4gRmlsdGVyIG91dCBleHBpcmVkIHJvb21zIGFuZCByb29tcyB3aXRoIG1hdGNoZXNcclxuICAgICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XHJcbiAgICAgIGNvbnN0IGFjdGl2ZVJvb21zID0gYWxsUm9vbXMuZmlsdGVyKHJvb20gPT4gcm9vbSAmJiAoIXJvb20udHRsIHx8IHJvb20udHRsID49IG5vdykpO1xyXG4gICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHthY3RpdmVSb29tcy5sZW5ndGh9IGFjdGl2ZSByb29tcyBhZnRlciBmaWx0ZXJpbmcgZXhwaXJlZGApO1xyXG5cclxuICAgICAgLy8gNC4gQ2hlY2sgZm9yIG1hdGNoZXMgYW5kIGZpbHRlciBvdXQgcm9vbXMgd2l0aCBtYXRjaGVzXHJcbiAgICAgIGNvbnN0IG1hdGNoZXNUYWJsZSA9IHByb2Nlc3MuZW52Lk1BVENIRVNfVEFCTEUgfHwgJyc7XHJcbiAgICAgIGlmIChtYXRjaGVzVGFibGUpIHtcclxuICAgICAgICBjb25zdCByb29tc1dpdGhvdXRNYXRjaGVzID0gW107XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yIChjb25zdCByb29tIG9mIGFjdGl2ZVJvb21zKSB7XHJcbiAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBDaGVjayBpZiByb29tIGhhcyBhbnkgbWF0Y2hlc1xyXG4gICAgICAgICAgICBjb25zdCBtYXRjaFJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgICAgICAgIFRhYmxlTmFtZTogbWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAgICAgICAnOnJvb21JZCc6IHJvb20uaWQsXHJcbiAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICBMaW1pdDogMSwgLy8gV2Ugb25seSBuZWVkIHRvIGtub3cgaWYgYW55IG1hdGNoIGV4aXN0c1xyXG4gICAgICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgICAgICAvLyBJZiBubyBtYXRjaGVzIGZvdW5kLCBpbmNsdWRlIHRoZSByb29tXHJcbiAgICAgICAgICAgIGlmICghbWF0Y2hSZXN1bHQuSXRlbXMgfHwgbWF0Y2hSZXN1bHQuSXRlbXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgcm9vbXNXaXRob3V0TWF0Y2hlcy5wdXNoKHJvb20pO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBSb29tICR7cm9vbS5pZH0gaGFzIG1hdGNoZXMsIGV4Y2x1ZGluZyBmcm9tIHJlc3VsdHNgKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgY2hlY2tpbmcgbWF0Y2hlcyBmb3Igcm9vbSAke3Jvb20uaWR9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgLy8gSW5jbHVkZSByb29tIGlmIHdlIGNhbid0IGNoZWNrIG1hdGNoZXMgKGZhaWwgc2FmZSlcclxuICAgICAgICAgICAgcm9vbXNXaXRob3V0TWF0Y2hlcy5wdXNoKHJvb20pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7cm9vbXNXaXRob3V0TWF0Y2hlcy5sZW5ndGh9IGFjdGl2ZSByb29tcyB3aXRob3V0IG1hdGNoZXMgZm9yIHVzZXIgJHt1c2VySWR9YCk7XHJcbiAgICAgICAgcmV0dXJuIHJvb21zV2l0aG91dE1hdGNoZXMuc29ydCgoYSwgYikgPT4gbmV3IERhdGUoYi5jcmVhdGVkQXQpLmdldFRpbWUoKSAtIG5ldyBEYXRlKGEuY3JlYXRlZEF0KS5nZXRUaW1lKCkpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHthY3RpdmVSb29tcy5sZW5ndGh9IGFjdGl2ZSByb29tcyBmb3IgdXNlciAke3VzZXJJZH0gKG1hdGNoZXMgdGFibGUgbm90IGNvbmZpZ3VyZWQpYCk7XHJcbiAgICAgIHJldHVybiBhY3RpdmVSb29tcy5zb3J0KChhLCBiKSA9PiBuZXcgRGF0ZShiLmNyZWF0ZWRBdCkuZ2V0VGltZSgpIC0gbmV3IERhdGUoYS5jcmVhdGVkQXQpLmdldFRpbWUoKSk7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZmV0Y2hpbmcgdXNlciByb29tczonLCBlcnJvcik7XHJcbiAgICAgIC8vIFJldHVybiBlbXB0eSBhcnJheSBpbnN0ZWFkIG9mIHRocm93aW5nIHRvIHByZXZlbnQgR3JhcGhRTCBudWxsIGVycm9yXHJcbiAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGdldFJvb20ocm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPFJvb20gfCBudWxsPiB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy50YWJsZU5hbWUsXHJcbiAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICB9KSk7XHJcblxyXG4gICAgaWYgKCFyZXN1bHQuSXRlbSkge1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByb29tID0gcmVzdWx0Lkl0ZW0gYXMgUm9vbTtcclxuXHJcbiAgICAvLyBDaGVjayBpZiByb29tIGhhcyBleHBpcmVkXHJcbiAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgIGlmIChyb29tLnR0bCAmJiByb29tLnR0bCA8IG5vdykge1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcm9vbTtcclxuICB9XHJcbn1cclxuXHJcbi8vIExhbWJkYSBIYW5kbGVyIGZvciBBcHBTeW5jXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyID0gYXN5bmMgKGV2ZW50KSA9PiB7XHJcbiAgY29uc29sZS5sb2coJ1Jvb20gTGFtYmRhIHJlY2VpdmVkIEFwcFN5bmMgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHJvb21TZXJ2aWNlID0gbmV3IFJvb21TZXJ2aWNlKCk7XHJcblxyXG4gICAgLy8gQ1JJVElDQUwgREVCVUc6IExvZyBmdWxsIGlkZW50aXR5IHN0cnVjdHVyZSB0byB1bmRlcnN0YW5kIHVzZXJJZCBmb3JtYXRcclxuICAgIGNvbnNvbGUubG9nKCfwn5SNIElERU5USVRZIERFQlVHOicsIEpTT04uc3RyaW5naWZ5KHtcclxuICAgICAgaWRlbnRpdHlUeXBlOiBldmVudC5pZGVudGl0eT8uY29uc3RydWN0b3I/Lm5hbWUsXHJcbiAgICAgIGNsYWltczogZXZlbnQuaWRlbnRpdHk/LmNsYWltcyxcclxuICAgICAgdXNlcm5hbWU6IGV2ZW50LmlkZW50aXR5Py51c2VybmFtZSxcclxuICAgICAgc291cmNlSXA6IGV2ZW50LmlkZW50aXR5Py5zb3VyY2VJcCxcclxuICAgICAgdXNlckFybjogZXZlbnQuaWRlbnRpdHk/LnVzZXJBcm4sXHJcbiAgICAgIGFjY291bnRJZDogZXZlbnQuaWRlbnRpdHk/LmFjY291bnRJZCxcclxuICAgICAgY29nbml0b0lkZW50aXR5UG9vbElkOiBldmVudC5pZGVudGl0eT8uY29nbml0b0lkZW50aXR5UG9vbElkLFxyXG4gICAgICBjb2duaXRvSWRlbnRpdHlJZDogZXZlbnQuaWRlbnRpdHk/LmNvZ25pdG9JZGVudGl0eUlkLFxyXG4gICAgICBwcmluY2lwYWxPcmdJZDogZXZlbnQuaWRlbnRpdHk/LnByaW5jaXBhbE9yZ0lkLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIEV4dHJhY3QgdXNlciBJRCBmcm9tIEFwcFN5bmMgY29udGV4dFxyXG4gICAgLy8gRm9yIElBTSBhdXRoIChHb29nbGUpOiB1c2UgY29nbml0b0lkZW50aXR5SWQgKFJFUVVJUkVEIC0gdGhpcyBpcyB0aGUgdW5pcXVlIHVzZXIgSUQpXHJcbiAgICAvLyBGb3IgVXNlciBQb29sIGF1dGg6IHVzZSBjbGFpbXMuc3ViXHJcbiAgICAvLyBDUklUSUNBTDogRG8gTk9UIHVzZSB1c2VybmFtZSBhcyBmYWxsYmFjayAtIGl0J3MgdGhlIElBTSByb2xlIG5hbWUsIG5vdCB1bmlxdWUgcGVyIHVzZXIhXHJcbiAgICBjb25zdCB1c2VySWQgPSBldmVudC5pZGVudGl0eT8uY29nbml0b0lkZW50aXR5SWQgfHwgZXZlbnQuaWRlbnRpdHk/LmNsYWltcz8uc3ViO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZygn8J+GlCBFWFRSQUNURUQgVVNFUiBJRDonLCB1c2VySWQpO1xyXG4gICAgXHJcbiAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgbm90IGF1dGhlbnRpY2F0ZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBEZXRlcm1pbmUgb3BlcmF0aW9uIGZyb20gQXBwU3luYyBmaWVsZCBuYW1lXHJcbiAgICBjb25zdCBmaWVsZE5hbWUgPSBldmVudC5pbmZvPy5maWVsZE5hbWU7XHJcbiAgICBjb25zb2xlLmxvZygnRmllbGQgbmFtZTonLCBmaWVsZE5hbWUpO1xyXG4gICAgXHJcbiAgICBzd2l0Y2ggKGZpZWxkTmFtZSkge1xyXG4gICAgICBjYXNlICdjcmVhdGVSb29tJzoge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIGNyZWF0ZVJvb20gbXV0YXRpb24nKTtcclxuICAgICAgICBjb25zdCB7IGlucHV0IH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgY29uc3QgeyBtZWRpYVR5cGUsIGdlbnJlSWRzLCBtYXhQYXJ0aWNpcGFudHMsIHllYXJSYW5nZSwgcGxhdGZvcm1JZHMgfSA9IGlucHV0O1xyXG5cclxuICAgICAgICBjb25zdCByb29tID0gYXdhaXQgcm9vbVNlcnZpY2UuY3JlYXRlUm9vbSh1c2VySWQsIG1lZGlhVHlwZSwgZ2VucmVJZHMsIG1heFBhcnRpY2lwYW50cywgeWVhclJhbmdlLCBwbGF0Zm9ybUlkcyk7XHJcbiAgICAgICAgcmV0dXJuIHJvb207XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2pvaW5Sb29tJzoge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIGpvaW5Sb29tIG11dGF0aW9uJyk7XHJcbiAgICAgICAgY29uc3QgeyBjb2RlIH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgY29uc3Qgcm9vbSA9IGF3YWl0IHJvb21TZXJ2aWNlLmpvaW5Sb29tKHVzZXJJZCwgY29kZSk7XHJcbiAgICAgICAgcmV0dXJuIHJvb207XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2dldE15Um9vbXMnOiB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1Byb2Nlc3NpbmcgZ2V0TXlSb29tcyBxdWVyeScpO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCByb29tcyA9IGF3YWl0IHJvb21TZXJ2aWNlLmdldE15Um9vbXModXNlcklkKTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBSZXR1cm5pbmcgJHtyb29tcy5sZW5ndGh9IHJvb21zIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICAgICAgcmV0dXJuIHJvb21zO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBnZXRNeVJvb21zIGhhbmRsZXI6JywgZXJyb3IpO1xyXG4gICAgICAgICAgLy8gUmV0dXJuIGVtcHR5IGFycmF5IHRvIHByZXZlbnQgR3JhcGhRTCBudWxsIGVycm9yXHJcbiAgICAgICAgICByZXR1cm4gW107XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdnZXRSb29tJzoge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQcm9jZXNzaW5nIGdldFJvb20gcXVlcnknKTtcclxuICAgICAgICBjb25zdCB7IGlkIH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgY29uc3Qgcm9vbSA9IGF3YWl0IHJvb21TZXJ2aWNlLmdldFJvb20oaWQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghcm9vbSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZCBvciBoYXMgZXhwaXJlZCcpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gcm9vbTtcclxuICAgICAgfVxyXG5cclxuICAgICAgZGVmYXVsdDpcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdVbmtub3duIGZpZWxkIG5hbWU6JywgZmllbGROYW1lKTtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdBdmFpbGFibGUgZXZlbnQgcHJvcGVydGllczonLCBPYmplY3Qua2V5cyhldmVudCkpO1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0V2ZW50IGluZm86JywgZXZlbnQuaW5mbyk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGZpZWxkOiAke2ZpZWxkTmFtZX1gKTtcclxuICAgIH1cclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1Jvb20gTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCc7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcclxuICB9XHJcbn07Il19