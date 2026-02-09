"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_lambda_1 = require("@aws-sdk/client-lambda");
const signature_v4_1 = require("@aws-sdk/signature-v4");
const sha256_js_1 = require("@aws-crypto/sha256-js");
const credential_provider_node_1 = require("@aws-sdk/credential-provider-node");
const protocol_http_1 = require("@aws-sdk/protocol-http");
// Initialize AWS clients
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
const lambdaClient = new client_lambda_1.LambdaClient({ region: process.env.AWS_REGION });
// Vote Service
class VoteService {
    constructor() {
        this.votesTable = process.env.VOTES_TABLE || '';
        this.matchesTable = process.env.MATCHES_TABLE || '';
        this.roomsTable = process.env.ROOMS_TABLE || '';
        this.matchLambdaArn = process.env.MATCH_LAMBDA_ARN || '';
        if (!this.votesTable || !this.matchesTable || !this.roomsTable) {
            throw new Error('Required table environment variables are missing');
        }
    }
    async processVote(userId, roomId, movieId, vote) {
        // Validate room exists and get room details
        const room = await this.getRoom(roomId);
        if (!room) {
            throw new Error('Room not found or has expired');
        }
        // Basic room membership validation - check if user has access to this room
        // For now, we allow any authenticated user to vote in any active room
        // TODO: Implement proper room membership validation in Task 2
        const hasRoomAccess = await this.validateRoomAccess(userId, roomId, room);
        if (!hasRoomAccess) {
            throw new Error('User does not have access to this room');
        }
        // Validate movie is in room candidates
        const movieCandidate = room.candidates.find(c => c.id === movieId);
        if (!movieCandidate) {
            throw new Error('Movie not found in room candidates');
        }
        // Record the vote
        await this.recordVote(userId, roomId, movieId, vote);
        // Check for match if vote is positive
        let match;
        if (vote) {
            match = await this.checkForMatch(roomId, movieId, movieCandidate);
        }
        return { success: true, match };
    }
    async validateRoomAccess(userId, roomId, room) {
        try {
            // Basic validation: check if user is the room host or has previously voted in this room
            if (room.hostId === userId) {
                console.log(`User ${userId} is the host of room ${roomId} - access granted`);
                return true;
            }
            // Check if user has previously participated in this room
            const userVotesResult = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.votesTable,
                KeyConditionExpression: 'roomId = :roomId',
                FilterExpression: 'userId = :userId',
                ExpressionAttributeValues: {
                    ':roomId': roomId,
                    ':userId': userId,
                },
                Limit: 1,
            }));
            if (userVotesResult.Items && userVotesResult.Items.length > 0) {
                console.log(`User ${userId} has previously voted in room ${roomId} - access granted`);
                return true;
            }
            // For MVP: Allow any authenticated user to join any active room
            // TODO: Implement proper room membership validation with DynamoDB table in Task 2
            console.log(`User ${userId} granted access to room ${roomId} (MVP mode - all users allowed)`);
            return true;
        }
        catch (error) {
            console.error(`Error validating room access for user ${userId} in room ${roomId}:`, error);
            // On error, allow access for now (fail open for MVP)
            return true;
        }
    }
    async getRoom(roomId) {
        try {
            const result = await docClient.send(new lib_dynamodb_1.GetCommand({
                TableName: this.roomsTable,
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
        catch (error) {
            console.error('Error getting room:', error);
            return null;
        }
    }
    async recordVote(userId, roomId, movieId, vote) {
        const userMovieId = `${userId}#${movieId}`;
        const timestamp = new Date().toISOString();
        const voteRecord = {
            roomId,
            userMovieId,
            userId,
            movieId,
            vote,
            timestamp,
        };
        await docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: this.votesTable,
            Item: voteRecord,
            // Allow overwriting previous votes for the same user/movie combination
        }));
        console.log(`Vote recorded: User ${userId} voted ${vote ? 'YES' : 'NO'} for movie ${movieId} in room ${roomId}`);
    }
    async checkForMatch(roomId, movieId, movieCandidate) {
        try {
            console.log(`🔍 MATCH CHECK STARTED for movie ${movieId} in room ${roomId}`);
            // Get room details to know maxParticipants
            const room = await this.getRoom(roomId);
            if (!room) {
                console.error(`❌ Room ${roomId} not found when checking for match`);
                return undefined;
            }
            // Get maxParticipants from room (with backward compatibility)
            const maxParticipants = room.maxParticipants || 2; // Default to 2 for old rooms
            console.log(`📊 Room ${roomId} requires ${maxParticipants} positive votes for a match`);
            // Get all votes for this movie in this room (excluding participation records)
            // CRITICAL: Use ConsistentRead to ensure we see the vote that was just written
            // Without this, DynamoDB's eventual consistency can cause race conditions where
            // two users voting simultaneously don't see each other's votes
            console.log(`🔎 Querying votes table for roomId=${roomId}, movieId=${movieId}`);
            const votesResult = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.votesTable,
                KeyConditionExpression: 'roomId = :roomId',
                FilterExpression: 'movieId = :movieId AND vote = :vote AND movieId <> :participationMarker',
                ExpressionAttributeValues: {
                    ':roomId': roomId,
                    ':movieId': movieId,
                    ':vote': true, // Only positive votes
                    ':participationMarker': -1, // Exclude participation records
                },
                ConsistentRead: true, // ✅ FIXED: Force strong consistency to see recent writes
            }));
            const positiveVotes = votesResult.Items || [];
            console.log(`📋 Raw positive votes retrieved: ${positiveVotes.length} items`);
            console.log(`📋 Vote details:`, JSON.stringify(positiveVotes, null, 2));
            const positiveUserIds = new Set(positiveVotes.map(vote => vote.userId));
            const positiveVoteCount = positiveUserIds.size;
            console.log(`✅ Found ${positiveVoteCount} unique positive votes for movie ${movieId} in room ${roomId}`);
            console.log(`👥 User IDs who voted YES:`, Array.from(positiveUserIds));
            // NEW LOGIC: Match occurs when positive votes === maxParticipants
            // It doesn't matter how many users are in the room or have voted
            // Only the configured maxParticipants matters
            if (positiveVoteCount === maxParticipants) {
                // We have a match! Exactly maxParticipants users voted positively
                console.log(`🎉 MATCH DETECTED! ${positiveVoteCount} users (= maxParticipants) voted positively for movie ${movieId}`);
                console.log(`🎉 Matched users:`, Array.from(positiveUserIds));
                // Check if match already exists
                const existingMatch = await this.getExistingMatch(roomId, movieId);
                if (existingMatch) {
                    console.log('⚠️ Match already exists, returning existing match');
                    return existingMatch;
                }
                // Create new match
                console.log(`🆕 Creating new match for movie ${movieId} in room ${roomId}`);
                const match = await this.createMatch(roomId, movieId, movieCandidate, Array.from(positiveUserIds));
                return match;
            }
            console.log(`⏳ No match yet. Positive votes: ${positiveVoteCount}, Required: ${maxParticipants}`);
            return undefined;
        }
        catch (error) {
            console.error('Error checking for match:', error);
            return undefined;
        }
    }
    async getExistingMatch(roomId, movieId) {
        try {
            const result = await docClient.send(new lib_dynamodb_1.GetCommand({
                TableName: this.matchesTable,
                Key: {
                    roomId,
                    movieId,
                },
            }));
            return result.Item || null;
        }
        catch (error) {
            console.error('Error checking existing match:', error);
            return null;
        }
    }
    async createMatch(roomId, movieId, movieCandidate, matchedUsers) {
        const timestamp = new Date().toISOString();
        const matchId = `${roomId}#${movieId}`;
        const match = {
            id: matchId,
            roomId,
            movieId,
            title: movieCandidate.title,
            posterPath: movieCandidate.posterPath || undefined,
            mediaType: movieCandidate.mediaType,
            matchedUsers,
            timestamp,
        };
        // Store ONLY the main match record - no duplicates per user
        // The match handler will filter by matchedUsers array when querying
        try {
            await docClient.send(new lib_dynamodb_1.PutCommand({
                TableName: this.matchesTable,
                Item: match,
                ConditionExpression: 'attribute_not_exists(roomId) AND attribute_not_exists(movieId)', // Prevent duplicates
            }));
            console.log(`✅ Match created: ${match.title} for ${matchedUsers.length} users`);
        }
        catch (error) {
            const err = error;
            if (err.name === 'ConditionalCheckFailedException') {
                console.log(`Match already exists for room ${roomId} and movie ${movieId}`);
            }
            else {
                console.error('Error creating match:', error);
                throw error;
            }
        }
        // CRITICAL: Trigger AppSync subscription FIRST before any cleanup
        // This ensures all users get notified before any changes
        await this.triggerAppSyncSubscription(match);
        // Wait a moment to ensure notifications are sent
        // This prevents "Room not found" errors for concurrent votes
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        // DISABLED: Do not delete room after match - let it remain active
        // This prevents "Room not found" errors for users who vote after match is created
        // await this.deleteRoom(roomId);
        console.log(`Match created but room ${roomId} kept active to prevent "Room not found" errors`);
        return match;
    }
    async deleteRoom(roomId) {
        try {
            // Delete the room from DynamoDB
            await docClient.send(new lib_dynamodb_1.DeleteCommand({
                TableName: this.roomsTable,
                Key: { id: roomId },
            }));
            console.log(`Room ${roomId} deleted after match creation`);
            // Optionally: Delete all votes for this room to free up space
            await this.deleteRoomVotes(roomId);
        }
        catch (error) {
            console.error(`Error deleting room ${roomId}:`, error);
            // Don't fail the match creation if room deletion fails
        }
    }
    async deleteRoomVotes(roomId) {
        try {
            // Get all votes and participation records for this room
            const votesResult = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.votesTable,
                KeyConditionExpression: 'roomId = :roomId',
                ExpressionAttributeValues: {
                    ':roomId': roomId,
                },
            }));
            const allRecords = votesResult.Items || [];
            // Delete all records (votes and participation) in batches
            const deletePromises = allRecords.map(record => docClient.send(new lib_dynamodb_1.DeleteCommand({
                TableName: this.votesTable,
                Key: {
                    roomId: record.roomId,
                    userMovieId: record.userMovieId,
                },
            })));
            await Promise.allSettled(deletePromises);
            console.log(`Deleted ${allRecords.length} records (votes and participation) for room ${roomId}`);
        }
        catch (error) {
            console.error(`Error deleting records for room ${roomId}:`, error);
        }
    }
    async triggerAppSyncSubscription(match) {
        console.log(`🔔 INICIANDO BROADCAST INDIVIDUAL para cada usuario en sala: ${match.roomId}`);
        console.log(`👥 Usuarios a notificar: ${match.matchedUsers.join(', ')}`);
        const endpoint = process.env.GRAPHQL_ENDPOINT;
        if (!endpoint) {
            console.error('❌ FATAL: GRAPHQL_ENDPOINT no está definido');
            return;
        }
        // NUEVA ESTRATEGIA: Enviar notificación individual a cada usuario
        // Esto asegura que TODOS los usuarios que participaron en el match reciban la notificación
        const notificationPromises = match.matchedUsers.map(async (userId) => {
            await this.sendIndividualUserNotification(userId, match, endpoint);
        });
        // Enviar todas las notificaciones en paralelo
        const results = await Promise.allSettled(notificationPromises);
        // Log resultados
        results.forEach((result, index) => {
            const userId = match.matchedUsers[index];
            if (result.status === 'fulfilled') {
                console.log(`✅ Notificación enviada exitosamente a usuario: ${userId}`);
            }
            else {
                console.error(`❌ Error enviando notificación a usuario ${userId}:`, result.reason);
            }
        });
        // También enviar la notificación general de la sala (para compatibilidad)
        await this.sendRoomNotification(match, endpoint);
    }
    async sendIndividualUserNotification(userId, match, endpoint) {
        console.log(`📤 Enviando notificación individual a usuario: ${userId}`);
        // Mutación específica para notificar a un usuario individual
        const mutation = `
      mutation PublishUserMatch($userId: ID!, $matchData: RoomMatchInput!) {
        publishUserMatch(userId: $userId, matchData: $matchData) {
          roomId
          matchId
          movieId
          matchedUsers
        }
      }
    `;
        const variables = {
            userId: userId,
            matchData: {
                matchId: match.id,
                movieId: match.movieId,
                movieTitle: match.title,
                posterPath: match.posterPath,
                matchedUsers: match.matchedUsers,
                roomId: match.roomId, // Incluir roomId en los datos
                timestamp: match.timestamp,
                matchDetails: {
                    voteCount: match.matchedUsers.length,
                    requiredVotes: match.matchedUsers.length,
                    matchType: 'unanimous'
                }
            }
        };
        try {
            const url = new URL(endpoint);
            const request = new protocol_http_1.HttpRequest({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    host: url.hostname,
                },
                hostname: url.hostname,
                path: '/graphql',
                body: JSON.stringify({ query: mutation, variables }),
            });
            const signer = new signature_v4_1.SignatureV4({
                credentials: (0, credential_provider_node_1.defaultProvider)(),
                region: process.env.AWS_REGION || 'us-east-1',
                service: 'appsync',
                sha256: sha256_js_1.Sha256,
            });
            const signedRequest = await signer.sign(request);
            const response = await fetch(endpoint, {
                method: signedRequest.method,
                headers: signedRequest.headers,
                body: signedRequest.body,
            });
            const result = await response.json();
            if (result.errors) {
                console.error(`❌ Error notificando usuario ${userId}:`, JSON.stringify(result.errors));
                throw new Error(`AppSync error for user ${userId}: ${result.errors[0]?.message}`);
            }
            else {
                console.log(`✅ Usuario ${userId} notificado exitosamente`);
            }
        }
        catch (error) {
            console.error(`❌ Error enviando notificación a usuario ${userId}:`, error);
            throw error;
        }
    }
    async sendRoomNotification(match, endpoint) {
        console.log(`📤 Enviando notificación general de sala: ${match.roomId}`);
        // Mantener la notificación general de sala para compatibilidad
        const mutation = `
      mutation PublishRoomMatch($roomId: ID!, $matchData: RoomMatchInput!) {
        publishRoomMatch(roomId: $roomId, matchData: $matchData) {
          roomId
          matchId
          movieId
          matchedUsers
        }
      }
    `;
        const variables = {
            roomId: match.roomId,
            matchData: {
                matchId: match.id,
                movieId: match.movieId,
                movieTitle: match.title,
                posterPath: match.posterPath,
                matchedUsers: match.matchedUsers,
                roomId: match.roomId, // Incluir roomId para consistencia con userMatch
                timestamp: match.timestamp, // Incluir timestamp para consistencia con userMatch
                matchDetails: {
                    voteCount: match.matchedUsers.length,
                    requiredVotes: match.matchedUsers.length,
                    matchType: 'unanimous'
                }
            }
        };
        try {
            const url = new URL(endpoint);
            const request = new protocol_http_1.HttpRequest({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    host: url.hostname,
                },
                hostname: url.hostname,
                path: '/graphql',
                body: JSON.stringify({ query: mutation, variables }),
            });
            const signer = new signature_v4_1.SignatureV4({
                credentials: (0, credential_provider_node_1.defaultProvider)(),
                region: process.env.AWS_REGION || 'us-east-1',
                service: 'appsync',
                sha256: sha256_js_1.Sha256,
            });
            const signedRequest = await signer.sign(request);
            const response = await fetch(endpoint, {
                method: signedRequest.method,
                headers: signedRequest.headers,
                body: signedRequest.body,
            });
            const result = await response.json();
            if (result.errors) {
                console.error('❌ Error en notificación de sala:', JSON.stringify(result.errors));
            }
            else {
                console.log('✅ Notificación general de sala enviada exitosamente');
            }
        }
        catch (error) {
            console.error('❌ Error enviando notificación general de sala:', error);
        }
    }
    async fallbackToCreateMatch(match) {
        try {
            console.log('🔄 Using fallback createMatch method...');
            // FALLBACK: Use the old createMatch method for backward compatibility
            if (this.matchLambdaArn) {
                const payload = {
                    operation: 'createMatch',
                    input: {
                        roomId: match.roomId,
                        movieId: match.movieId,
                        title: match.title,
                        posterPath: match.posterPath,
                        matchedUsers: match.matchedUsers,
                    },
                };
                console.log('🚀 Invoking Match Lambda with createMatch (fallback)...');
                const command = new client_lambda_1.InvokeCommand({
                    FunctionName: this.matchLambdaArn,
                    InvocationType: 'RequestResponse',
                    Payload: JSON.stringify(payload),
                });
                const response = await lambdaClient.send(command);
                if (response.Payload) {
                    const result = JSON.parse(new TextDecoder().decode(response.Payload));
                    if (result.statusCode === 200) {
                        console.log('✅ Fallback createMatch executed successfully');
                    }
                    else {
                        console.error('❌ Fallback createMatch returned error:', result.body?.error);
                    }
                }
            }
            // Store notifications for polling fallback
            await this.storeMatchNotifications(match);
        }
        catch (error) {
            console.error('❌ Error in fallback method:', error);
            // Store notifications for polling as final fallback
            await this.storeMatchNotifications(match);
        }
    }
    async storeMatchNotifications(match) {
        try {
            // Store individual notification records for each user
            // This enables polling-based match detection as a fallback
            const notificationPromises = match.matchedUsers.map(async (userId) => {
                const notificationRecord = {
                    userId,
                    matchId: match.id,
                    originalRoomId: match.roomId, // Store original roomId separately
                    originalMovieId: match.movieId, // Store original movieId separately
                    title: match.title,
                    posterPath: match.posterPath,
                    timestamp: match.timestamp,
                    notified: false, // Flag to track if user has been notified
                    ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days TTL
                };
                // Store in a notifications table (we'll use the matches table with a special pattern)
                await docClient.send(new lib_dynamodb_1.PutCommand({
                    TableName: this.matchesTable,
                    Item: {
                        roomId: `NOTIFICATION#${userId}`, // Special prefix for notifications
                        movieId: Date.now(), // Use timestamp as sort key for uniqueness
                        ...notificationRecord,
                    },
                }));
                console.log(`Notification stored for user ${userId}`);
            });
            await Promise.allSettled(notificationPromises);
            console.log('✅ Match notifications stored for polling fallback');
        }
        catch (error) {
            console.error('Error storing match notifications:', error);
        }
    }
    async notifyMatchCreated(match) {
        try {
            const payload = {
                operation: 'matchCreated',
                match,
            };
            const command = new client_lambda_1.InvokeCommand({
                FunctionName: this.matchLambdaArn,
                InvocationType: 'Event', // Async invocation
                Payload: JSON.stringify(payload),
            });
            await lambdaClient.send(command);
            console.log('Match notification sent to Match Lambda');
        }
        catch (error) {
            console.error('Failed to notify Match Lambda:', error);
            throw error;
        }
    }
}
// Lambda Handler for AppSync
const handler = async (event) => {
    console.log('🚀 Vote Lambda received AppSync event:', JSON.stringify(event));
    try {
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
        console.log('🆔 USER ID TYPE:', typeof userId);
        console.log('🆔 USER ID LENGTH:', userId?.length);
        console.log('🆔 USERNAME (for reference only):', event.identity?.username);
        if (!userId) {
            console.error('❌ User not authenticated for vote - no cognitoIdentityId or claims.sub found');
            return { success: false }; // Return proper VoteResult instead of throwing
        }
        if (!userId) {
            console.error('❌ User not authenticated for vote - no cognitoIdentityId or claims.sub found');
            return { success: false }; // Return proper VoteResult instead of throwing
        }
        // Get arguments from AppSync
        const { input } = event.arguments;
        const { roomId, movieId, vote } = input;
        console.log('📥 VOTE INPUT:', JSON.stringify({ roomId, movieId, vote, userId }));
        // Validate input
        if (!roomId) {
            console.error('❌ Room ID is required');
            return { success: false }; // Return proper VoteResult instead of throwing
        }
        if (typeof movieId !== 'number') {
            console.error('❌ Movie ID must be a number');
            return { success: false }; // Return proper VoteResult instead of throwing
        }
        if (typeof vote !== 'boolean') {
            console.error('❌ Vote must be a boolean');
            return { success: false }; // Return proper VoteResult instead of throwing
        }
        const voteService = new VoteService();
        try {
            console.log(`📝 Processing vote: User ${userId} voting ${vote ? 'YES' : 'NO'} for movie ${movieId} in room ${roomId}`);
            const result = await voteService.processVote(userId, roomId, movieId, vote);
            console.log(`✅ Vote processed successfully:`, JSON.stringify(result));
            return result; // This already returns { success: true, match?: Match }
        }
        catch (error) {
            console.error('❌ Error processing vote:', error);
            return { success: false }; // Return proper VoteResult on error
        }
    }
    catch (error) {
        console.error('❌ Vote Lambda error:', error);
        return { success: false }; // Always return proper VoteResult, never throw
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdm90ZS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQW9IO0FBQ3BILDBEQUFxRTtBQUNyRSx3REFBb0Q7QUFDcEQscURBQStDO0FBQy9DLGdGQUFvRTtBQUNwRSwwREFBcUQ7QUFFckQseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUErRDFFLGVBQWU7QUFDZixNQUFNLFdBQVc7SUFNZjtRQUNFLElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBQ3BELElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxjQUFjLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsSUFBSSxFQUFFLENBQUM7UUFFekQsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQy9ELE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUMsQ0FB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QztZQUN0RSxPQUFPLE1BQU0sQ0FBQyxDQUFDLHdEQUF3RDtRQUN6RSxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsMEJBQTBCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDakQsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLG9DQUFvQztRQUNqRSxDQUFDO0lBRUgsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLHNCQUFzQixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzdDLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQywrQ0FBK0M7SUFDNUUsQ0FBQztBQUNILENBQUMsQ0FBQztBQTVFVyxRQUFBLE9BQU8sV0E0RWxCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSGFuZGxlciB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIFB1dENvbW1hbmQsIFF1ZXJ5Q29tbWFuZCwgR2V0Q29tbWFuZCwgRGVsZXRlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XHJcbmltcG9ydCB7IExhbWJkYUNsaWVudCwgSW52b2tlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1sYW1iZGEnO1xyXG5pbXBvcnQgeyBTaWduYXR1cmVWNCB9IGZyb20gJ0Bhd3Mtc2RrL3NpZ25hdHVyZS12NCc7XHJcbmltcG9ydCB7IFNoYTI1NiB9IGZyb20gJ0Bhd3MtY3J5cHRvL3NoYTI1Ni1qcyc7XHJcbmltcG9ydCB7IGRlZmF1bHRQcm92aWRlciB9IGZyb20gJ0Bhd3Mtc2RrL2NyZWRlbnRpYWwtcHJvdmlkZXItbm9kZSc7XHJcbmltcG9ydCB7IEh0dHBSZXF1ZXN0IH0gZnJvbSAnQGF3cy1zZGsvcHJvdG9jb2wtaHR0cCc7XHJcblxyXG4vLyBJbml0aWFsaXplIEFXUyBjbGllbnRzXHJcbmNvbnN0IGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGR5bmFtb0NsaWVudCk7XHJcbmNvbnN0IGxhbWJkYUNsaWVudCA9IG5ldyBMYW1iZGFDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcblxyXG4vLyBUeXBlc1xyXG5pbnRlcmZhY2UgVm90ZSB7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgdXNlck1vdmllSWQ6IHN0cmluZzsgLy8gRm9ybWF0OiBcInVzZXJJZCNtb3ZpZUlkXCJcclxuICB1c2VySWQ6IHN0cmluZztcclxuICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgdm90ZTogYm9vbGVhbjtcclxuICB0aW1lc3RhbXA6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIE1hdGNoIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHJvb21JZDogc3RyaW5nO1xyXG4gIG1vdmllSWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg/OiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxuICBtYXRjaGVkVXNlcnM6IHN0cmluZ1tdO1xyXG4gIHRpbWVzdGFtcDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgUm9vbSB7XHJcbiAgaWQ6IHN0cmluZztcclxuICBjb2RlOiBzdHJpbmc7XHJcbiAgaG9zdElkOiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxuICBnZW5yZUlkczogbnVtYmVyW107XHJcbiAgY2FuZGlkYXRlczogTW92aWVDYW5kaWRhdGVbXTtcclxuICBjcmVhdGVkQXQ6IHN0cmluZztcclxuICB0dGw6IG51bWJlcjtcclxuICBtYXhQYXJ0aWNpcGFudHM6IG51bWJlcjtcclxufVxyXG5cclxuaW50ZXJmYWNlIE1vdmllQ2FuZGlkYXRlIHtcclxuICBpZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgb3ZlcnZpZXc6IHN0cmluZztcclxuICBwb3N0ZXJQYXRoOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJlbGVhc2VEYXRlOiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxufVxyXG5cclxuaW50ZXJmYWNlIFZvdGVFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAndm90ZSc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgaW5wdXQ6IHtcclxuICAgIHJvb21JZDogc3RyaW5nO1xyXG4gICAgbW92aWVJZDogbnVtYmVyO1xyXG4gICAgdm90ZTogYm9vbGVhbjtcclxuICB9O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVm90ZVJlc3BvbnNlIHtcclxuICBzdGF0dXNDb2RlOiBudW1iZXI7XHJcbiAgYm9keToge1xyXG4gICAgc3VjY2VzczogYm9vbGVhbjtcclxuICAgIG1hdGNoPzogTWF0Y2g7XHJcbiAgICBlcnJvcj86IHN0cmluZztcclxuICB9O1xyXG59XHJcblxyXG4vLyBWb3RlIFNlcnZpY2VcclxuY2xhc3MgVm90ZVNlcnZpY2Uge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgdm90ZXNUYWJsZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbWF0Y2hlc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSByb29tc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBtYXRjaExhbWJkYUFybjogc3RyaW5nO1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMudm90ZXNUYWJsZSA9IHByb2Nlc3MuZW52LlZPVEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUgPSBwcm9jZXNzLmVudi5NQVRDSEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgdGhpcy5yb29tc1RhYmxlID0gcHJvY2Vzcy5lbnYuUk9PTVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLm1hdGNoTGFtYmRhQXJuID0gcHJvY2Vzcy5lbnYuTUFUQ0hfTEFNQkRBX0FSTiB8fCAnJztcclxuXHJcbiAgICBpZiAoIXRoaXMudm90ZXNUYWJsZSB8fCAhdGhpcy5tYXRjaGVzVGFibGUgfHwgIXRoaXMucm9vbXNUYWJsZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlcXVpcmVkIHRhYmxlIGVudmlyb25tZW50IHZhcmlhYmxlcyBhcmUgbWlzc2luZycpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcHJvY2Vzc1ZvdGUodXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIsIHZvdGU6IGJvb2xlYW4pOiBQcm9taXNlPHsgc3VjY2VzczogYm9vbGVhbjsgbWF0Y2g/OiBNYXRjaCB9PiB7XHJcbiAgICAvLyBWYWxpZGF0ZSByb29tIGV4aXN0cyBhbmQgZ2V0IHJvb20gZGV0YWlsc1xyXG4gICAgY29uc3Qgcm9vbSA9IGF3YWl0IHRoaXMuZ2V0Um9vbShyb29tSWQpO1xyXG4gICAgaWYgKCFyb29tKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBub3QgZm91bmQgb3IgaGFzIGV4cGlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBCYXNpYyByb29tIG1lbWJlcnNoaXAgdmFsaWRhdGlvbiAtIGNoZWNrIGlmIHVzZXIgaGFzIGFjY2VzcyB0byB0aGlzIHJvb21cclxuICAgIC8vIEZvciBub3csIHdlIGFsbG93IGFueSBhdXRoZW50aWNhdGVkIHVzZXIgdG8gdm90ZSBpbiBhbnkgYWN0aXZlIHJvb21cclxuICAgIC8vIFRPRE86IEltcGxlbWVudCBwcm9wZXIgcm9vbSBtZW1iZXJzaGlwIHZhbGlkYXRpb24gaW4gVGFzayAyXHJcbiAgICBjb25zdCBoYXNSb29tQWNjZXNzID0gYXdhaXQgdGhpcy52YWxpZGF0ZVJvb21BY2Nlc3ModXNlcklkLCByb29tSWQsIHJvb20pO1xyXG4gICAgaWYgKCFoYXNSb29tQWNjZXNzKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVXNlciBkb2VzIG5vdCBoYXZlIGFjY2VzcyB0byB0aGlzIHJvb20nKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBtb3ZpZSBpcyBpbiByb29tIGNhbmRpZGF0ZXNcclxuICAgIGNvbnN0IG1vdmllQ2FuZGlkYXRlID0gcm9vbS5jYW5kaWRhdGVzLmZpbmQoYyA9PiBjLmlkID09PSBtb3ZpZUlkKTtcclxuICAgIGlmICghbW92aWVDYW5kaWRhdGUpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNb3ZpZSBub3QgZm91bmQgaW4gcm9vbSBjYW5kaWRhdGVzJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUmVjb3JkIHRoZSB2b3RlXHJcbiAgICBhd2FpdCB0aGlzLnJlY29yZFZvdGUodXNlcklkLCByb29tSWQsIG1vdmllSWQsIHZvdGUpO1xyXG5cclxuICAgIC8vIENoZWNrIGZvciBtYXRjaCBpZiB2b3RlIGlzIHBvc2l0aXZlXHJcbiAgICBsZXQgbWF0Y2g6IE1hdGNoIHwgdW5kZWZpbmVkO1xyXG4gICAgaWYgKHZvdGUpIHtcclxuICAgICAgbWF0Y2ggPSBhd2FpdCB0aGlzLmNoZWNrRm9yTWF0Y2gocm9vbUlkLCBtb3ZpZUlkLCBtb3ZpZUNhbmRpZGF0ZSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbWF0Y2ggfTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgdmFsaWRhdGVSb29tQWNjZXNzKHVzZXJJZDogc3RyaW5nLCByb29tSWQ6IHN0cmluZywgcm9vbTogUm9vbSk6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gQmFzaWMgdmFsaWRhdGlvbjogY2hlY2sgaWYgdXNlciBpcyB0aGUgcm9vbSBob3N0IG9yIGhhcyBwcmV2aW91c2x5IHZvdGVkIGluIHRoaXMgcm9vbVxyXG4gICAgICBpZiAocm9vbS5ob3N0SWQgPT09IHVzZXJJZCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSBpcyB0aGUgaG9zdCBvZiByb29tICR7cm9vbUlkfSAtIGFjY2VzcyBncmFudGVkYCk7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHVzZXIgaGFzIHByZXZpb3VzbHkgcGFydGljaXBhdGVkIGluIHRoaXMgcm9vbVxyXG4gICAgICBjb25zdCB1c2VyVm90ZXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ3VzZXJJZCA9IDp1c2VySWQnLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBMaW1pdDogMSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgaWYgKHVzZXJWb3Rlc1Jlc3VsdC5JdGVtcyAmJiB1c2VyVm90ZXNSZXN1bHQuSXRlbXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSBoYXMgcHJldmlvdXNseSB2b3RlZCBpbiByb29tICR7cm9vbUlkfSAtIGFjY2VzcyBncmFudGVkYCk7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIEZvciBNVlA6IEFsbG93IGFueSBhdXRoZW50aWNhdGVkIHVzZXIgdG8gam9pbiBhbnkgYWN0aXZlIHJvb21cclxuICAgICAgLy8gVE9ETzogSW1wbGVtZW50IHByb3BlciByb29tIG1lbWJlcnNoaXAgdmFsaWRhdGlvbiB3aXRoIER5bmFtb0RCIHRhYmxlIGluIFRhc2sgMlxyXG4gICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gZ3JhbnRlZCBhY2Nlc3MgdG8gcm9vbSAke3Jvb21JZH0gKE1WUCBtb2RlIC0gYWxsIHVzZXJzIGFsbG93ZWQpYCk7XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHZhbGlkYXRpbmcgcm9vbSBhY2Nlc3MgZm9yIHVzZXIgJHt1c2VySWR9IGluIHJvb20gJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgICAgLy8gT24gZXJyb3IsIGFsbG93IGFjY2VzcyBmb3Igbm93IChmYWlsIG9wZW4gZm9yIE1WUClcclxuICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldFJvb20ocm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPFJvb20gfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnJvb21zVGFibGUsXHJcbiAgICAgICAgS2V5OiB7IGlkOiByb29tSWQgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgaWYgKCFyZXN1bHQuSXRlbSkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCByb29tID0gcmVzdWx0Lkl0ZW0gYXMgUm9vbTtcclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHJvb20gaGFzIGV4cGlyZWRcclxuICAgICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XHJcbiAgICAgIGlmIChyb29tLnR0bCAmJiByb29tLnR0bCA8IG5vdykge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gcm9vbTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdldHRpbmcgcm9vbTonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZWNvcmRWb3RlKHVzZXJJZDogc3RyaW5nLCByb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCB2b3RlOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB1c2VyTW92aWVJZCA9IGAke3VzZXJJZH0jJHttb3ZpZUlkfWA7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gICAgY29uc3Qgdm90ZVJlY29yZDogVm90ZSA9IHtcclxuICAgICAgcm9vbUlkLFxyXG4gICAgICB1c2VyTW92aWVJZCxcclxuICAgICAgdXNlcklkLFxyXG4gICAgICBtb3ZpZUlkLFxyXG4gICAgICB2b3RlLFxyXG4gICAgICB0aW1lc3RhbXAsXHJcbiAgICB9O1xyXG5cclxuICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgIEl0ZW06IHZvdGVSZWNvcmQsXHJcbiAgICAgIC8vIEFsbG93IG92ZXJ3cml0aW5nIHByZXZpb3VzIHZvdGVzIGZvciB0aGUgc2FtZSB1c2VyL21vdmllIGNvbWJpbmF0aW9uXHJcbiAgICB9KSk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYFZvdGUgcmVjb3JkZWQ6IFVzZXIgJHt1c2VySWR9IHZvdGVkICR7dm90ZSA/ICdZRVMnIDogJ05PJ30gZm9yIG1vdmllICR7bW92aWVJZH0gaW4gcm9vbSAke3Jvb21JZH1gKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgY2hlY2tGb3JNYXRjaChyb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCBtb3ZpZUNhbmRpZGF0ZTogTW92aWVDYW5kaWRhdGUpOiBQcm9taXNlPE1hdGNoIHwgdW5kZWZpbmVkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZyhg8J+UjSBNQVRDSCBDSEVDSyBTVEFSVEVEIGZvciBtb3ZpZSAke21vdmllSWR9IGluIHJvb20gJHtyb29tSWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBHZXQgcm9vbSBkZXRhaWxzIHRvIGtub3cgbWF4UGFydGljaXBhbnRzXHJcbiAgICAgIGNvbnN0IHJvb20gPSBhd2FpdCB0aGlzLmdldFJvb20ocm9vbUlkKTtcclxuICAgICAgaWYgKCFyb29tKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIFJvb20gJHtyb29tSWR9IG5vdCBmb3VuZCB3aGVuIGNoZWNraW5nIGZvciBtYXRjaGApO1xyXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIEdldCBtYXhQYXJ0aWNpcGFudHMgZnJvbSByb29tICh3aXRoIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkpXHJcbiAgICAgIGNvbnN0IG1heFBhcnRpY2lwYW50cyA9IHJvb20ubWF4UGFydGljaXBhbnRzIHx8IDI7IC8vIERlZmF1bHQgdG8gMiBmb3Igb2xkIHJvb21zXHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OKIFJvb20gJHtyb29tSWR9IHJlcXVpcmVzICR7bWF4UGFydGljaXBhbnRzfSBwb3NpdGl2ZSB2b3RlcyBmb3IgYSBtYXRjaGApO1xyXG5cclxuICAgICAgLy8gR2V0IGFsbCB2b3RlcyBmb3IgdGhpcyBtb3ZpZSBpbiB0aGlzIHJvb20gKGV4Y2x1ZGluZyBwYXJ0aWNpcGF0aW9uIHJlY29yZHMpXHJcbiAgICAgIC8vIENSSVRJQ0FMOiBVc2UgQ29uc2lzdGVudFJlYWQgdG8gZW5zdXJlIHdlIHNlZSB0aGUgdm90ZSB0aGF0IHdhcyBqdXN0IHdyaXR0ZW5cclxuICAgICAgLy8gV2l0aG91dCB0aGlzLCBEeW5hbW9EQidzIGV2ZW50dWFsIGNvbnNpc3RlbmN5IGNhbiBjYXVzZSByYWNlIGNvbmRpdGlvbnMgd2hlcmVcclxuICAgICAgLy8gdHdvIHVzZXJzIHZvdGluZyBzaW11bHRhbmVvdXNseSBkb24ndCBzZWUgZWFjaCBvdGhlcidzIHZvdGVzXHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5SOIFF1ZXJ5aW5nIHZvdGVzIHRhYmxlIGZvciByb29tSWQ9JHtyb29tSWR9LCBtb3ZpZUlkPSR7bW92aWVJZH1gKTtcclxuICAgICAgY29uc3Qgdm90ZXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ21vdmllSWQgPSA6bW92aWVJZCBBTkQgdm90ZSA9IDp2b3RlIEFORCBtb3ZpZUlkIDw+IDpwYXJ0aWNpcGF0aW9uTWFya2VyJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICAgICc6bW92aWVJZCc6IG1vdmllSWQsXHJcbiAgICAgICAgICAnOnZvdGUnOiB0cnVlLCAvLyBPbmx5IHBvc2l0aXZlIHZvdGVzXHJcbiAgICAgICAgICAnOnBhcnRpY2lwYXRpb25NYXJrZXInOiAtMSwgLy8gRXhjbHVkZSBwYXJ0aWNpcGF0aW9uIHJlY29yZHNcclxuICAgICAgICB9LFxyXG4gICAgICAgIENvbnNpc3RlbnRSZWFkOiB0cnVlLCAvLyDinIUgRklYRUQ6IEZvcmNlIHN0cm9uZyBjb25zaXN0ZW5jeSB0byBzZWUgcmVjZW50IHdyaXRlc1xyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBwb3NpdGl2ZVZvdGVzID0gdm90ZXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OLIFJhdyBwb3NpdGl2ZSB2b3RlcyByZXRyaWV2ZWQ6ICR7cG9zaXRpdmVWb3Rlcy5sZW5ndGh9IGl0ZW1zYCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OLIFZvdGUgZGV0YWlsczpgLCBKU09OLnN0cmluZ2lmeShwb3NpdGl2ZVZvdGVzLCBudWxsLCAyKSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBwb3NpdGl2ZVVzZXJJZHMgPSBuZXcgU2V0KHBvc2l0aXZlVm90ZXMubWFwKHZvdGUgPT4gKHZvdGUgYXMgVm90ZSkudXNlcklkKSk7XHJcbiAgICAgIGNvbnN0IHBvc2l0aXZlVm90ZUNvdW50ID0gcG9zaXRpdmVVc2VySWRzLnNpemU7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhg4pyFIEZvdW5kICR7cG9zaXRpdmVWb3RlQ291bnR9IHVuaXF1ZSBwb3NpdGl2ZSB2b3RlcyBmb3IgbW92aWUgJHttb3ZpZUlkfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG4gICAgICBjb25zb2xlLmxvZyhg8J+RpSBVc2VyIElEcyB3aG8gdm90ZWQgWUVTOmAsIEFycmF5LmZyb20ocG9zaXRpdmVVc2VySWRzKSk7XHJcblxyXG4gICAgICAvLyBORVcgTE9HSUM6IE1hdGNoIG9jY3VycyB3aGVuIHBvc2l0aXZlIHZvdGVzID09PSBtYXhQYXJ0aWNpcGFudHNcclxuICAgICAgLy8gSXQgZG9lc24ndCBtYXR0ZXIgaG93IG1hbnkgdXNlcnMgYXJlIGluIHRoZSByb29tIG9yIGhhdmUgdm90ZWRcclxuICAgICAgLy8gT25seSB0aGUgY29uZmlndXJlZCBtYXhQYXJ0aWNpcGFudHMgbWF0dGVyc1xyXG4gICAgICBpZiAocG9zaXRpdmVWb3RlQ291bnQgPT09IG1heFBhcnRpY2lwYW50cykge1xyXG4gICAgICAgIC8vIFdlIGhhdmUgYSBtYXRjaCEgRXhhY3RseSBtYXhQYXJ0aWNpcGFudHMgdXNlcnMgdm90ZWQgcG9zaXRpdmVseVxyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn46JIE1BVENIIERFVEVDVEVEISAke3Bvc2l0aXZlVm90ZUNvdW50fSB1c2VycyAoPSBtYXhQYXJ0aWNpcGFudHMpIHZvdGVkIHBvc2l0aXZlbHkgZm9yIG1vdmllICR7bW92aWVJZH1gKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+OiSBNYXRjaGVkIHVzZXJzOmAsIEFycmF5LmZyb20ocG9zaXRpdmVVc2VySWRzKSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgaWYgbWF0Y2ggYWxyZWFkeSBleGlzdHNcclxuICAgICAgICBjb25zdCBleGlzdGluZ01hdGNoID0gYXdhaXQgdGhpcy5nZXRFeGlzdGluZ01hdGNoKHJvb21JZCwgbW92aWVJZCk7XHJcbiAgICAgICAgaWYgKGV4aXN0aW5nTWF0Y2gpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKCfimqDvuI8gTWF0Y2ggYWxyZWFkeSBleGlzdHMsIHJldHVybmluZyBleGlzdGluZyBtYXRjaCcpO1xyXG4gICAgICAgICAgcmV0dXJuIGV4aXN0aW5nTWF0Y2g7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBDcmVhdGUgbmV3IG1hdGNoXHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfhpUgQ3JlYXRpbmcgbmV3IG1hdGNoIGZvciBtb3ZpZSAke21vdmllSWR9IGluIHJvb20gJHtyb29tSWR9YCk7XHJcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBhd2FpdCB0aGlzLmNyZWF0ZU1hdGNoKHJvb21JZCwgbW92aWVJZCwgbW92aWVDYW5kaWRhdGUsIEFycmF5LmZyb20ocG9zaXRpdmVVc2VySWRzKSk7XHJcbiAgICAgICAgcmV0dXJuIG1hdGNoO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhg4o+zIE5vIG1hdGNoIHlldC4gUG9zaXRpdmUgdm90ZXM6ICR7cG9zaXRpdmVWb3RlQ291bnR9LCBSZXF1aXJlZDogJHttYXhQYXJ0aWNpcGFudHN9YCk7XHJcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgY2hlY2tpbmcgZm9yIG1hdGNoOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZ2V0RXhpc3RpbmdNYXRjaChyb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyKTogUHJvbWlzZTxNYXRjaCB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgIEtleToge1xyXG4gICAgICAgICAgcm9vbUlkLFxyXG4gICAgICAgICAgbW92aWVJZCxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICByZXR1cm4gcmVzdWx0Lkl0ZW0gYXMgTWF0Y2ggfHwgbnVsbDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGV4aXN0aW5nIG1hdGNoOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGNyZWF0ZU1hdGNoKHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIsIG1vdmllQ2FuZGlkYXRlOiBNb3ZpZUNhbmRpZGF0ZSwgbWF0Y2hlZFVzZXJzOiBzdHJpbmdbXSk6IFByb21pc2U8TWF0Y2g+IHtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgIGNvbnN0IG1hdGNoSWQgPSBgJHtyb29tSWR9IyR7bW92aWVJZH1gO1xyXG5cclxuICAgIGNvbnN0IG1hdGNoOiBNYXRjaCA9IHtcclxuICAgICAgaWQ6IG1hdGNoSWQsXHJcbiAgICAgIHJvb21JZCxcclxuICAgICAgbW92aWVJZCxcclxuICAgICAgdGl0bGU6IG1vdmllQ2FuZGlkYXRlLnRpdGxlLFxyXG4gICAgICBwb3N0ZXJQYXRoOiBtb3ZpZUNhbmRpZGF0ZS5wb3N0ZXJQYXRoIHx8IHVuZGVmaW5lZCxcclxuICAgICAgbWVkaWFUeXBlOiBtb3ZpZUNhbmRpZGF0ZS5tZWRpYVR5cGUsXHJcbiAgICAgIG1hdGNoZWRVc2VycyxcclxuICAgICAgdGltZXN0YW1wLFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBTdG9yZSBPTkxZIHRoZSBtYWluIG1hdGNoIHJlY29yZCAtIG5vIGR1cGxpY2F0ZXMgcGVyIHVzZXJcclxuICAgIC8vIFRoZSBtYXRjaCBoYW5kbGVyIHdpbGwgZmlsdGVyIGJ5IG1hdGNoZWRVc2VycyBhcnJheSB3aGVuIHF1ZXJ5aW5nXHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBJdGVtOiBtYXRjaCxcclxuICAgICAgICBDb25kaXRpb25FeHByZXNzaW9uOiAnYXR0cmlidXRlX25vdF9leGlzdHMocm9vbUlkKSBBTkQgYXR0cmlidXRlX25vdF9leGlzdHMobW92aWVJZCknLCAvLyBQcmV2ZW50IGR1cGxpY2F0ZXNcclxuICAgICAgfSkpO1xyXG4gICAgICBjb25zb2xlLmxvZyhg4pyFIE1hdGNoIGNyZWF0ZWQ6ICR7bWF0Y2gudGl0bGV9IGZvciAke21hdGNoZWRVc2Vycy5sZW5ndGh9IHVzZXJzYCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zdCBlcnIgPSBlcnJvciBhcyBhbnk7XHJcbiAgICAgIGlmIChlcnIubmFtZSA9PT0gJ0NvbmRpdGlvbmFsQ2hlY2tGYWlsZWRFeGNlcHRpb24nKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYE1hdGNoIGFscmVhZHkgZXhpc3RzIGZvciByb29tICR7cm9vbUlkfSBhbmQgbW92aWUgJHttb3ZpZUlkfWApO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNyZWF0aW5nIG1hdGNoOicsIGVycm9yKTtcclxuICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIENSSVRJQ0FMOiBUcmlnZ2VyIEFwcFN5bmMgc3Vic2NyaXB0aW9uIEZJUlNUIGJlZm9yZSBhbnkgY2xlYW51cFxyXG4gICAgLy8gVGhpcyBlbnN1cmVzIGFsbCB1c2VycyBnZXQgbm90aWZpZWQgYmVmb3JlIGFueSBjaGFuZ2VzXHJcbiAgICBhd2FpdCB0aGlzLnRyaWdnZXJBcHBTeW5jU3Vic2NyaXB0aW9uKG1hdGNoKTtcclxuXHJcbiAgICAvLyBXYWl0IGEgbW9tZW50IHRvIGVuc3VyZSBub3RpZmljYXRpb25zIGFyZSBzZW50XHJcbiAgICAvLyBUaGlzIHByZXZlbnRzIFwiUm9vbSBub3QgZm91bmRcIiBlcnJvcnMgZm9yIGNvbmN1cnJlbnQgdm90ZXNcclxuICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAyMDAwKSk7IC8vIDIgc2Vjb25kIGRlbGF5XHJcblxyXG4gICAgLy8gRElTQUJMRUQ6IERvIG5vdCBkZWxldGUgcm9vbSBhZnRlciBtYXRjaCAtIGxldCBpdCByZW1haW4gYWN0aXZlXHJcbiAgICAvLyBUaGlzIHByZXZlbnRzIFwiUm9vbSBub3QgZm91bmRcIiBlcnJvcnMgZm9yIHVzZXJzIHdobyB2b3RlIGFmdGVyIG1hdGNoIGlzIGNyZWF0ZWRcclxuICAgIC8vIGF3YWl0IHRoaXMuZGVsZXRlUm9vbShyb29tSWQpO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZyhgTWF0Y2ggY3JlYXRlZCBidXQgcm9vbSAke3Jvb21JZH0ga2VwdCBhY3RpdmUgdG8gcHJldmVudCBcIlJvb20gbm90IGZvdW5kXCIgZXJyb3JzYCk7XHJcblxyXG4gICAgcmV0dXJuIG1hdGNoO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBkZWxldGVSb29tKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBEZWxldGUgdGhlIHJvb20gZnJvbSBEeW5hbW9EQlxyXG4gICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgRGVsZXRlQ29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnJvb21zVGFibGUsXHJcbiAgICAgICAgS2V5OiB7IGlkOiByb29tSWQgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc29sZS5sb2coYFJvb20gJHtyb29tSWR9IGRlbGV0ZWQgYWZ0ZXIgbWF0Y2ggY3JlYXRpb25gKTtcclxuXHJcbiAgICAgIC8vIE9wdGlvbmFsbHk6IERlbGV0ZSBhbGwgdm90ZXMgZm9yIHRoaXMgcm9vbSB0byBmcmVlIHVwIHNwYWNlXHJcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlUm9vbVZvdGVzKHJvb21JZCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBkZWxldGluZyByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgIC8vIERvbid0IGZhaWwgdGhlIG1hdGNoIGNyZWF0aW9uIGlmIHJvb20gZGVsZXRpb24gZmFpbHNcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZGVsZXRlUm9vbVZvdGVzKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBHZXQgYWxsIHZvdGVzIGFuZCBwYXJ0aWNpcGF0aW9uIHJlY29yZHMgZm9yIHRoaXMgcm9vbVxyXG4gICAgICBjb25zdCB2b3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBhbGxSZWNvcmRzID0gdm90ZXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIFxyXG4gICAgICAvLyBEZWxldGUgYWxsIHJlY29yZHMgKHZvdGVzIGFuZCBwYXJ0aWNpcGF0aW9uKSBpbiBiYXRjaGVzXHJcbiAgICAgIGNvbnN0IGRlbGV0ZVByb21pc2VzID0gYWxsUmVjb3Jkcy5tYXAocmVjb3JkID0+IFxyXG4gICAgICAgIGRvY0NsaWVudC5zZW5kKG5ldyBEZWxldGVDb21tYW5kKHtcclxuICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgICAgS2V5OiB7XHJcbiAgICAgICAgICAgIHJvb21JZDogcmVjb3JkLnJvb21JZCxcclxuICAgICAgICAgICAgdXNlck1vdmllSWQ6IHJlY29yZC51c2VyTW92aWVJZCxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSkpXHJcbiAgICAgICk7XHJcblxyXG4gICAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoZGVsZXRlUHJvbWlzZXMpO1xyXG4gICAgICBjb25zb2xlLmxvZyhgRGVsZXRlZCAke2FsbFJlY29yZHMubGVuZ3RofSByZWNvcmRzICh2b3RlcyBhbmQgcGFydGljaXBhdGlvbikgZm9yIHJvb20gJHtyb29tSWR9YCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBkZWxldGluZyByZWNvcmRzIGZvciByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHRyaWdnZXJBcHBTeW5jU3Vic2NyaXB0aW9uKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc29sZS5sb2coYPCflJQgSU5JQ0lBTkRPIEJST0FEQ0FTVCBJTkRJVklEVUFMIHBhcmEgY2FkYSB1c3VhcmlvIGVuIHNhbGE6ICR7bWF0Y2gucm9vbUlkfWApO1xyXG4gICAgY29uc29sZS5sb2coYPCfkaUgVXN1YXJpb3MgYSBub3RpZmljYXI6ICR7bWF0Y2gubWF0Y2hlZFVzZXJzLmpvaW4oJywgJyl9YCk7XHJcbiAgICBcclxuICAgIGNvbnN0IGVuZHBvaW50ID0gcHJvY2Vzcy5lbnYuR1JBUEhRTF9FTkRQT0lOVDtcclxuICAgIGlmICghZW5kcG9pbnQpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEZBVEFMOiBHUkFQSFFMX0VORFBPSU5UIG5vIGVzdMOhIGRlZmluaWRvJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICAvLyBOVUVWQSBFU1RSQVRFR0lBOiBFbnZpYXIgbm90aWZpY2FjacOzbiBpbmRpdmlkdWFsIGEgY2FkYSB1c3VhcmlvXHJcbiAgICAvLyBFc3RvIGFzZWd1cmEgcXVlIFRPRE9TIGxvcyB1c3VhcmlvcyBxdWUgcGFydGljaXBhcm9uIGVuIGVsIG1hdGNoIHJlY2liYW4gbGEgbm90aWZpY2FjacOzblxyXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uUHJvbWlzZXMgPSBtYXRjaC5tYXRjaGVkVXNlcnMubWFwKGFzeW5jICh1c2VySWQpID0+IHtcclxuICAgICAgYXdhaXQgdGhpcy5zZW5kSW5kaXZpZHVhbFVzZXJOb3RpZmljYXRpb24odXNlcklkLCBtYXRjaCwgZW5kcG9pbnQpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRW52aWFyIHRvZGFzIGxhcyBub3RpZmljYWNpb25lcyBlbiBwYXJhbGVsb1xyXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChub3RpZmljYXRpb25Qcm9taXNlcyk7XHJcbiAgICBcclxuICAgIC8vIExvZyByZXN1bHRhZG9zXHJcbiAgICByZXN1bHRzLmZvckVhY2goKHJlc3VsdCwgaW5kZXgpID0+IHtcclxuICAgICAgY29uc3QgdXNlcklkID0gbWF0Y2gubWF0Y2hlZFVzZXJzW2luZGV4XTtcclxuICAgICAgaWYgKHJlc3VsdC5zdGF0dXMgPT09ICdmdWxmaWxsZWQnKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBOb3RpZmljYWNpw7NuIGVudmlhZGEgZXhpdG9zYW1lbnRlIGEgdXN1YXJpbzogJHt1c2VySWR9YCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIEVycm9yIGVudmlhbmRvIG5vdGlmaWNhY2nDs24gYSB1c3VhcmlvICR7dXNlcklkfTpgLCByZXN1bHQucmVhc29uKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gVGFtYmnDqW4gZW52aWFyIGxhIG5vdGlmaWNhY2nDs24gZ2VuZXJhbCBkZSBsYSBzYWxhIChwYXJhIGNvbXBhdGliaWxpZGFkKVxyXG4gICAgYXdhaXQgdGhpcy5zZW5kUm9vbU5vdGlmaWNhdGlvbihtYXRjaCwgZW5kcG9pbnQpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzZW5kSW5kaXZpZHVhbFVzZXJOb3RpZmljYXRpb24odXNlcklkOiBzdHJpbmcsIG1hdGNoOiBNYXRjaCwgZW5kcG9pbnQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc29sZS5sb2coYPCfk6QgRW52aWFuZG8gbm90aWZpY2FjacOzbiBpbmRpdmlkdWFsIGEgdXN1YXJpbzogJHt1c2VySWR9YCk7XHJcbiAgICBcclxuICAgIC8vIE11dGFjacOzbiBlc3BlY8OtZmljYSBwYXJhIG5vdGlmaWNhciBhIHVuIHVzdWFyaW8gaW5kaXZpZHVhbFxyXG4gICAgY29uc3QgbXV0YXRpb24gPSBgXHJcbiAgICAgIG11dGF0aW9uIFB1Ymxpc2hVc2VyTWF0Y2goJHVzZXJJZDogSUQhLCAkbWF0Y2hEYXRhOiBSb29tTWF0Y2hJbnB1dCEpIHtcclxuICAgICAgICBwdWJsaXNoVXNlck1hdGNoKHVzZXJJZDogJHVzZXJJZCwgbWF0Y2hEYXRhOiAkbWF0Y2hEYXRhKSB7XHJcbiAgICAgICAgICByb29tSWRcclxuICAgICAgICAgIG1hdGNoSWRcclxuICAgICAgICAgIG1vdmllSWRcclxuICAgICAgICAgIG1hdGNoZWRVc2Vyc1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgYDtcclxuXHJcbiAgICBjb25zdCB2YXJpYWJsZXMgPSB7XHJcbiAgICAgIHVzZXJJZDogdXNlcklkLFxyXG4gICAgICBtYXRjaERhdGE6IHtcclxuICAgICAgICBtYXRjaElkOiBtYXRjaC5pZCxcclxuICAgICAgICBtb3ZpZUlkOiBtYXRjaC5tb3ZpZUlkLFxyXG4gICAgICAgIG1vdmllVGl0bGU6IG1hdGNoLnRpdGxlLFxyXG4gICAgICAgIHBvc3RlclBhdGg6IG1hdGNoLnBvc3RlclBhdGgsXHJcbiAgICAgICAgbWF0Y2hlZFVzZXJzOiBtYXRjaC5tYXRjaGVkVXNlcnMsXHJcbiAgICAgICAgcm9vbUlkOiBtYXRjaC5yb29tSWQsIC8vIEluY2x1aXIgcm9vbUlkIGVuIGxvcyBkYXRvc1xyXG4gICAgICAgIHRpbWVzdGFtcDogbWF0Y2gudGltZXN0YW1wLFxyXG4gICAgICAgIG1hdGNoRGV0YWlsczoge1xyXG4gICAgICAgICAgdm90ZUNvdW50OiBtYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RoLFxyXG4gICAgICAgICAgcmVxdWlyZWRWb3RlczogbWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aCxcclxuICAgICAgICAgIG1hdGNoVHlwZTogJ3VuYW5pbW91cydcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChlbmRwb2ludCk7XHJcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgSHR0cFJlcXVlc3Qoe1xyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICBob3N0OiB1cmwuaG9zdG5hbWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBob3N0bmFtZTogdXJsLmhvc3RuYW1lLFxyXG4gICAgICAgIHBhdGg6ICcvZ3JhcGhxbCcsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBxdWVyeTogbXV0YXRpb24sIHZhcmlhYmxlcyB9KSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBzaWduZXIgPSBuZXcgU2lnbmF0dXJlVjQoe1xyXG4gICAgICAgIGNyZWRlbnRpYWxzOiBkZWZhdWx0UHJvdmlkZXIoKSxcclxuICAgICAgICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScsXHJcbiAgICAgICAgc2VydmljZTogJ2FwcHN5bmMnLFxyXG4gICAgICAgIHNoYTI1NjogU2hhMjU2LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHNpZ25lZFJlcXVlc3QgPSBhd2FpdCBzaWduZXIuc2lnbihyZXF1ZXN0KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goZW5kcG9pbnQsIHtcclxuICAgICAgICBtZXRob2Q6IHNpZ25lZFJlcXVlc3QubWV0aG9kLFxyXG4gICAgICAgIGhlYWRlcnM6IHNpZ25lZFJlcXVlc3QuaGVhZGVycyBhcyBhbnksXHJcbiAgICAgICAgYm9keTogc2lnbmVkUmVxdWVzdC5ib2R5LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKSBhcyB7IGRhdGE/OiBhbnk7IGVycm9ycz86IGFueVtdIH07XHJcbiAgICAgIFxyXG4gICAgICBpZiAocmVzdWx0LmVycm9ycykge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBFcnJvciBub3RpZmljYW5kbyB1c3VhcmlvICR7dXNlcklkfTpgLCBKU09OLnN0cmluZ2lmeShyZXN1bHQuZXJyb3JzKSk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBcHBTeW5jIGVycm9yIGZvciB1c2VyICR7dXNlcklkfTogJHtyZXN1bHQuZXJyb3JzWzBdPy5tZXNzYWdlfWApO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgVXN1YXJpbyAke3VzZXJJZH0gbm90aWZpY2FkbyBleGl0b3NhbWVudGVgKTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihg4p2MIEVycm9yIGVudmlhbmRvIG5vdGlmaWNhY2nDs24gYSB1c3VhcmlvICR7dXNlcklkfTpgLCBlcnJvcik7XHJcbiAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzZW5kUm9vbU5vdGlmaWNhdGlvbihtYXRjaDogTWF0Y2gsIGVuZHBvaW50OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnNvbGUubG9nKGDwn5OkIEVudmlhbmRvIG5vdGlmaWNhY2nDs24gZ2VuZXJhbCBkZSBzYWxhOiAke21hdGNoLnJvb21JZH1gKTtcclxuICAgIFxyXG4gICAgLy8gTWFudGVuZXIgbGEgbm90aWZpY2FjacOzbiBnZW5lcmFsIGRlIHNhbGEgcGFyYSBjb21wYXRpYmlsaWRhZFxyXG4gICAgY29uc3QgbXV0YXRpb24gPSBgXHJcbiAgICAgIG11dGF0aW9uIFB1Ymxpc2hSb29tTWF0Y2goJHJvb21JZDogSUQhLCAkbWF0Y2hEYXRhOiBSb29tTWF0Y2hJbnB1dCEpIHtcclxuICAgICAgICBwdWJsaXNoUm9vbU1hdGNoKHJvb21JZDogJHJvb21JZCwgbWF0Y2hEYXRhOiAkbWF0Y2hEYXRhKSB7XHJcbiAgICAgICAgICByb29tSWRcclxuICAgICAgICAgIG1hdGNoSWRcclxuICAgICAgICAgIG1vdmllSWRcclxuICAgICAgICAgIG1hdGNoZWRVc2Vyc1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgYDtcclxuXHJcbiAgICBjb25zdCB2YXJpYWJsZXMgPSB7XHJcbiAgICAgIHJvb21JZDogbWF0Y2gucm9vbUlkLFxyXG4gICAgICBtYXRjaERhdGE6IHtcclxuICAgICAgICBtYXRjaElkOiBtYXRjaC5pZCxcclxuICAgICAgICBtb3ZpZUlkOiBtYXRjaC5tb3ZpZUlkLFxyXG4gICAgICAgIG1vdmllVGl0bGU6IG1hdGNoLnRpdGxlLFxyXG4gICAgICAgIHBvc3RlclBhdGg6IG1hdGNoLnBvc3RlclBhdGgsXHJcbiAgICAgICAgbWF0Y2hlZFVzZXJzOiBtYXRjaC5tYXRjaGVkVXNlcnMsXHJcbiAgICAgICAgcm9vbUlkOiBtYXRjaC5yb29tSWQsIC8vIEluY2x1aXIgcm9vbUlkIHBhcmEgY29uc2lzdGVuY2lhIGNvbiB1c2VyTWF0Y2hcclxuICAgICAgICB0aW1lc3RhbXA6IG1hdGNoLnRpbWVzdGFtcCwgLy8gSW5jbHVpciB0aW1lc3RhbXAgcGFyYSBjb25zaXN0ZW5jaWEgY29uIHVzZXJNYXRjaFxyXG4gICAgICAgIG1hdGNoRGV0YWlsczoge1xyXG4gICAgICAgICAgdm90ZUNvdW50OiBtYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RoLFxyXG4gICAgICAgICAgcmVxdWlyZWRWb3RlczogbWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aCxcclxuICAgICAgICAgIG1hdGNoVHlwZTogJ3VuYW5pbW91cydcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChlbmRwb2ludCk7XHJcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgSHR0cFJlcXVlc3Qoe1xyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICBob3N0OiB1cmwuaG9zdG5hbWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBob3N0bmFtZTogdXJsLmhvc3RuYW1lLFxyXG4gICAgICAgIHBhdGg6ICcvZ3JhcGhxbCcsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBxdWVyeTogbXV0YXRpb24sIHZhcmlhYmxlcyB9KSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBzaWduZXIgPSBuZXcgU2lnbmF0dXJlVjQoe1xyXG4gICAgICAgIGNyZWRlbnRpYWxzOiBkZWZhdWx0UHJvdmlkZXIoKSxcclxuICAgICAgICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScsXHJcbiAgICAgICAgc2VydmljZTogJ2FwcHN5bmMnLFxyXG4gICAgICAgIHNoYTI1NjogU2hhMjU2LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHNpZ25lZFJlcXVlc3QgPSBhd2FpdCBzaWduZXIuc2lnbihyZXF1ZXN0KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goZW5kcG9pbnQsIHtcclxuICAgICAgICBtZXRob2Q6IHNpZ25lZFJlcXVlc3QubWV0aG9kLFxyXG4gICAgICAgIGhlYWRlcnM6IHNpZ25lZFJlcXVlc3QuaGVhZGVycyBhcyBhbnksXHJcbiAgICAgICAgYm9keTogc2lnbmVkUmVxdWVzdC5ib2R5LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKSBhcyB7IGRhdGE/OiBhbnk7IGVycm9ycz86IGFueVtdIH07XHJcbiAgICAgIFxyXG4gICAgICBpZiAocmVzdWx0LmVycm9ycykge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBlbiBub3RpZmljYWNpw7NuIGRlIHNhbGE6JywgSlNPTi5zdHJpbmdpZnkocmVzdWx0LmVycm9ycykpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgTm90aWZpY2FjacOzbiBnZW5lcmFsIGRlIHNhbGEgZW52aWFkYSBleGl0b3NhbWVudGUnKTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGVudmlhbmRvIG5vdGlmaWNhY2nDs24gZ2VuZXJhbCBkZSBzYWxhOicsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZmFsbGJhY2tUb0NyZWF0ZU1hdGNoKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coJ/CflIQgVXNpbmcgZmFsbGJhY2sgY3JlYXRlTWF0Y2ggbWV0aG9kLi4uJyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBGQUxMQkFDSzogVXNlIHRoZSBvbGQgY3JlYXRlTWF0Y2ggbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XHJcbiAgICAgIGlmICh0aGlzLm1hdGNoTGFtYmRhQXJuKSB7XHJcbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZU1hdGNoJyxcclxuICAgICAgICAgIGlucHV0OiB7XHJcbiAgICAgICAgICAgIHJvb21JZDogbWF0Y2gucm9vbUlkLFxyXG4gICAgICAgICAgICBtb3ZpZUlkOiBtYXRjaC5tb3ZpZUlkLFxyXG4gICAgICAgICAgICB0aXRsZTogbWF0Y2gudGl0bGUsXHJcbiAgICAgICAgICAgIHBvc3RlclBhdGg6IG1hdGNoLnBvc3RlclBhdGgsXHJcbiAgICAgICAgICAgIG1hdGNoZWRVc2VyczogbWF0Y2gubWF0Y2hlZFVzZXJzLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjb25zb2xlLmxvZygn8J+agCBJbnZva2luZyBNYXRjaCBMYW1iZGEgd2l0aCBjcmVhdGVNYXRjaCAoZmFsbGJhY2spLi4uJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcclxuICAgICAgICAgIEZ1bmN0aW9uTmFtZTogdGhpcy5tYXRjaExhbWJkYUFybixcclxuICAgICAgICAgIEludm9jYXRpb25UeXBlOiAnUmVxdWVzdFJlc3BvbnNlJyxcclxuICAgICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKGNvbW1hbmQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChyZXNwb25zZS5QYXlsb2FkKSB7XHJcbiAgICAgICAgICBjb25zdCByZXN1bHQgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5QYXlsb2FkKSk7XHJcbiAgICAgICAgICBpZiAocmVzdWx0LnN0YXR1c0NvZGUgPT09IDIwMCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygn4pyFIEZhbGxiYWNrIGNyZWF0ZU1hdGNoIGV4ZWN1dGVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhbGxiYWNrIGNyZWF0ZU1hdGNoIHJldHVybmVkIGVycm9yOicsIHJlc3VsdC5ib2R5Py5lcnJvcik7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTdG9yZSBub3RpZmljYXRpb25zIGZvciBwb2xsaW5nIGZhbGxiYWNrXHJcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmVNYXRjaE5vdGlmaWNhdGlvbnMobWF0Y2gpO1xyXG4gICAgICBcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBpbiBmYWxsYmFjayBtZXRob2Q6JywgZXJyb3IpO1xyXG4gICAgICAvLyBTdG9yZSBub3RpZmljYXRpb25zIGZvciBwb2xsaW5nIGFzIGZpbmFsIGZhbGxiYWNrXHJcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmVNYXRjaE5vdGlmaWNhdGlvbnMobWF0Y2gpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzdG9yZU1hdGNoTm90aWZpY2F0aW9ucyhtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFN0b3JlIGluZGl2aWR1YWwgbm90aWZpY2F0aW9uIHJlY29yZHMgZm9yIGVhY2ggdXNlclxyXG4gICAgICAvLyBUaGlzIGVuYWJsZXMgcG9sbGluZy1iYXNlZCBtYXRjaCBkZXRlY3Rpb24gYXMgYSBmYWxsYmFja1xyXG4gICAgICBjb25zdCBub3RpZmljYXRpb25Qcm9taXNlcyA9IG1hdGNoLm1hdGNoZWRVc2Vycy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IG5vdGlmaWNhdGlvblJlY29yZCA9IHtcclxuICAgICAgICAgIHVzZXJJZCxcclxuICAgICAgICAgIG1hdGNoSWQ6IG1hdGNoLmlkLFxyXG4gICAgICAgICAgb3JpZ2luYWxSb29tSWQ6IG1hdGNoLnJvb21JZCwgLy8gU3RvcmUgb3JpZ2luYWwgcm9vbUlkIHNlcGFyYXRlbHlcclxuICAgICAgICAgIG9yaWdpbmFsTW92aWVJZDogbWF0Y2gubW92aWVJZCwgLy8gU3RvcmUgb3JpZ2luYWwgbW92aWVJZCBzZXBhcmF0ZWx5XHJcbiAgICAgICAgICB0aXRsZTogbWF0Y2gudGl0bGUsXHJcbiAgICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaC5wb3N0ZXJQYXRoLFxyXG4gICAgICAgICAgdGltZXN0YW1wOiBtYXRjaC50aW1lc3RhbXAsXHJcbiAgICAgICAgICBub3RpZmllZDogZmFsc2UsIC8vIEZsYWcgdG8gdHJhY2sgaWYgdXNlciBoYXMgYmVlbiBub3RpZmllZFxyXG4gICAgICAgICAgdHRsOiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICg3ICogMjQgKiA2MCAqIDYwKSwgLy8gNyBkYXlzIFRUTFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIFN0b3JlIGluIGEgbm90aWZpY2F0aW9ucyB0YWJsZSAod2UnbGwgdXNlIHRoZSBtYXRjaGVzIHRhYmxlIHdpdGggYSBzcGVjaWFsIHBhdHRlcm4pXHJcbiAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgICAgcm9vbUlkOiBgTk9USUZJQ0FUSU9OIyR7dXNlcklkfWAsIC8vIFNwZWNpYWwgcHJlZml4IGZvciBub3RpZmljYXRpb25zXHJcbiAgICAgICAgICAgIG1vdmllSWQ6IERhdGUubm93KCksIC8vIFVzZSB0aW1lc3RhbXAgYXMgc29ydCBrZXkgZm9yIHVuaXF1ZW5lc3NcclxuICAgICAgICAgICAgLi4ubm90aWZpY2F0aW9uUmVjb3JkLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBOb3RpZmljYXRpb24gc3RvcmVkIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChub3RpZmljYXRpb25Qcm9taXNlcyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfinIUgTWF0Y2ggbm90aWZpY2F0aW9ucyBzdG9yZWQgZm9yIHBvbGxpbmcgZmFsbGJhY2snKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHN0b3JpbmcgbWF0Y2ggbm90aWZpY2F0aW9uczonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIG5vdGlmeU1hdGNoQ3JlYXRlZChtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICAgICAgb3BlcmF0aW9uOiAnbWF0Y2hDcmVhdGVkJyxcclxuICAgICAgICBtYXRjaCxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlQ29tbWFuZCh7XHJcbiAgICAgICAgRnVuY3Rpb25OYW1lOiB0aGlzLm1hdGNoTGFtYmRhQXJuLFxyXG4gICAgICAgIEludm9jYXRpb25UeXBlOiAnRXZlbnQnLCAvLyBBc3luYyBpbnZvY2F0aW9uXHJcbiAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQoY29tbWFuZCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdNYXRjaCBub3RpZmljYXRpb24gc2VudCB0byBNYXRjaCBMYW1iZGEnKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBub3RpZnkgTWF0Y2ggTGFtYmRhOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG4vLyBMYW1iZGEgSGFuZGxlciBmb3IgQXBwU3luY1xyXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCfwn5qAIFZvdGUgTGFtYmRhIHJlY2VpdmVkIEFwcFN5bmMgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIC8vIENSSVRJQ0FMIERFQlVHOiBMb2cgZnVsbCBpZGVudGl0eSBzdHJ1Y3R1cmUgdG8gdW5kZXJzdGFuZCB1c2VySWQgZm9ybWF0XHJcbiAgICBjb25zb2xlLmxvZygn8J+UjSBJREVOVElUWSBERUJVRzonLCBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICAgIGlkZW50aXR5VHlwZTogZXZlbnQuaWRlbnRpdHk/LmNvbnN0cnVjdG9yPy5uYW1lLFxyXG4gICAgICBjbGFpbXM6IGV2ZW50LmlkZW50aXR5Py5jbGFpbXMsXHJcbiAgICAgIHVzZXJuYW1lOiBldmVudC5pZGVudGl0eT8udXNlcm5hbWUsXHJcbiAgICAgIHNvdXJjZUlwOiBldmVudC5pZGVudGl0eT8uc291cmNlSXAsXHJcbiAgICAgIHVzZXJBcm46IGV2ZW50LmlkZW50aXR5Py51c2VyQXJuLFxyXG4gICAgICBhY2NvdW50SWQ6IGV2ZW50LmlkZW50aXR5Py5hY2NvdW50SWQsXHJcbiAgICAgIGNvZ25pdG9JZGVudGl0eVBvb2xJZDogZXZlbnQuaWRlbnRpdHk/LmNvZ25pdG9JZGVudGl0eVBvb2xJZCxcclxuICAgICAgY29nbml0b0lkZW50aXR5SWQ6IGV2ZW50LmlkZW50aXR5Py5jb2duaXRvSWRlbnRpdHlJZCxcclxuICAgICAgcHJpbmNpcGFsT3JnSWQ6IGV2ZW50LmlkZW50aXR5Py5wcmluY2lwYWxPcmdJZCxcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBFeHRyYWN0IHVzZXIgSUQgZnJvbSBBcHBTeW5jIGNvbnRleHRcclxuICAgIC8vIEZvciBJQU0gYXV0aCAoR29vZ2xlKTogdXNlIGNvZ25pdG9JZGVudGl0eUlkIChSRVFVSVJFRCAtIHRoaXMgaXMgdGhlIHVuaXF1ZSB1c2VyIElEKVxyXG4gICAgLy8gRm9yIFVzZXIgUG9vbCBhdXRoOiB1c2UgY2xhaW1zLnN1YlxyXG4gICAgLy8gQ1JJVElDQUw6IERvIE5PVCB1c2UgdXNlcm5hbWUgYXMgZmFsbGJhY2sgLSBpdCdzIHRoZSBJQU0gcm9sZSBuYW1lLCBub3QgdW5pcXVlIHBlciB1c2VyIVxyXG4gICAgY29uc3QgdXNlcklkID0gZXZlbnQuaWRlbnRpdHk/LmNvZ25pdG9JZGVudGl0eUlkIHx8IGV2ZW50LmlkZW50aXR5Py5jbGFpbXM/LnN1YjtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ/CfhpQgRVhUUkFDVEVEIFVTRVIgSUQ6JywgdXNlcklkKTtcclxuICAgIGNvbnNvbGUubG9nKCfwn4aUIFVTRVIgSUQgVFlQRTonLCB0eXBlb2YgdXNlcklkKTtcclxuICAgIGNvbnNvbGUubG9nKCfwn4aUIFVTRVIgSUQgTEVOR1RIOicsIHVzZXJJZD8ubGVuZ3RoKTtcclxuICAgIGNvbnNvbGUubG9nKCfwn4aUIFVTRVJOQU1FIChmb3IgcmVmZXJlbmNlIG9ubHkpOicsIGV2ZW50LmlkZW50aXR5Py51c2VybmFtZSk7XHJcbiAgICBcclxuICAgIGlmICghdXNlcklkKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBVc2VyIG5vdCBhdXRoZW50aWNhdGVkIGZvciB2b3RlIC0gbm8gY29nbml0b0lkZW50aXR5SWQgb3IgY2xhaW1zLnN1YiBmb3VuZCcpO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSB9OyAvLyBSZXR1cm4gcHJvcGVyIFZvdGVSZXN1bHQgaW5zdGVhZCBvZiB0aHJvd2luZ1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgVXNlciBub3QgYXV0aGVudGljYXRlZCBmb3Igdm90ZSAtIG5vIGNvZ25pdG9JZGVudGl0eUlkIG9yIGNsYWltcy5zdWIgZm91bmQnKTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UgfTsgLy8gUmV0dXJuIHByb3BlciBWb3RlUmVzdWx0IGluc3RlYWQgb2YgdGhyb3dpbmdcclxuICAgIH1cclxuXHJcbiAgICAvLyBHZXQgYXJndW1lbnRzIGZyb20gQXBwU3luY1xyXG4gICAgY29uc3QgeyBpbnB1dCB9ID0gZXZlbnQuYXJndW1lbnRzO1xyXG4gICAgY29uc3QgeyByb29tSWQsIG1vdmllSWQsIHZvdGUgfSA9IGlucHV0O1xyXG5cclxuICAgIGNvbnNvbGUubG9nKCfwn5OlIFZPVEUgSU5QVVQ6JywgSlNPTi5zdHJpbmdpZnkoeyByb29tSWQsIG1vdmllSWQsIHZvdGUsIHVzZXJJZCB9KSk7XHJcblxyXG4gICAgLy8gVmFsaWRhdGUgaW5wdXRcclxuICAgIGlmICghcm9vbUlkKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBSb29tIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07IC8vIFJldHVybiBwcm9wZXIgVm90ZVJlc3VsdCBpbnN0ZWFkIG9mIHRocm93aW5nXHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHR5cGVvZiBtb3ZpZUlkICE9PSAnbnVtYmVyJykge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgTW92aWUgSUQgbXVzdCBiZSBhIG51bWJlcicpO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSB9OyAvLyBSZXR1cm4gcHJvcGVyIFZvdGVSZXN1bHQgaW5zdGVhZCBvZiB0aHJvd2luZ1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0eXBlb2Ygdm90ZSAhPT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBWb3RlIG11c3QgYmUgYSBib29sZWFuJyk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07IC8vIFJldHVybiBwcm9wZXIgVm90ZVJlc3VsdCBpbnN0ZWFkIG9mIHRocm93aW5nXHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgdm90ZVNlcnZpY2UgPSBuZXcgVm90ZVNlcnZpY2UoKTtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYPCfk50gUHJvY2Vzc2luZyB2b3RlOiBVc2VyICR7dXNlcklkfSB2b3RpbmcgJHt2b3RlID8gJ1lFUycgOiAnTk8nfSBmb3IgbW92aWUgJHttb3ZpZUlkfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2b3RlU2VydmljZS5wcm9jZXNzVm90ZSh1c2VySWQsIHJvb21JZCwgbW92aWVJZCwgdm90ZSk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDinIUgVm90ZSBwcm9jZXNzZWQgc3VjY2Vzc2Z1bGx5OmAsIEpTT04uc3RyaW5naWZ5KHJlc3VsdCkpO1xyXG4gICAgICByZXR1cm4gcmVzdWx0OyAvLyBUaGlzIGFscmVhZHkgcmV0dXJucyB7IHN1Y2Nlc3M6IHRydWUsIG1hdGNoPzogTWF0Y2ggfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIHByb2Nlc3Npbmcgdm90ZTonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07IC8vIFJldHVybiBwcm9wZXIgVm90ZVJlc3VsdCBvbiBlcnJvclxyXG4gICAgfVxyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcign4p2MIFZvdGUgTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07IC8vIEFsd2F5cyByZXR1cm4gcHJvcGVyIFZvdGVSZXN1bHQsIG5ldmVyIHRocm93XHJcbiAgfVxyXG59OyJdfQ==