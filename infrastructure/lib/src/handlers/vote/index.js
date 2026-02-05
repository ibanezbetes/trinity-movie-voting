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
            // Get room details to know maxParticipants
            const room = await this.getRoom(roomId);
            if (!room) {
                console.error(`Room ${roomId} not found when checking for match`);
                return undefined;
            }
            // Get maxParticipants from room (with backward compatibility)
            const maxParticipants = room.maxParticipants || 2; // Default to 2 for old rooms
            console.log(`Room ${roomId} requires ${maxParticipants} positive votes for a match`);
            // Get all votes for this movie in this room (excluding participation records)
            // CRITICAL: Use ConsistentRead to ensure we see the vote that was just written
            // Without this, DynamoDB's eventual consistency can cause race conditions where
            // two users voting simultaneously don't see each other's votes
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
            const positiveUserIds = new Set(positiveVotes.map(vote => vote.userId));
            const positiveVoteCount = positiveUserIds.size;
            console.log(`Found ${positiveVoteCount} unique positive votes for movie ${movieId} in room ${roomId}`);
            // NEW LOGIC: Match occurs when positive votes === maxParticipants
            // It doesn't matter how many users are in the room or have voted
            // Only the configured maxParticipants matters
            if (positiveVoteCount === maxParticipants) {
                // We have a match! Exactly maxParticipants users voted positively
                console.log(`🎉 MATCH DETECTED! ${positiveVoteCount} users (= maxParticipants) voted positively for movie ${movieId}`);
                // Check if match already exists
                const existingMatch = await this.getExistingMatch(roomId, movieId);
                if (existingMatch) {
                    console.log('Match already exists, returning existing match');
                    return existingMatch;
                }
                // Create new match
                const match = await this.createMatch(roomId, movieId, movieCandidate, Array.from(positiveUserIds));
                return match;
            }
            console.log(`No match yet. Positive votes: ${positiveVoteCount}, Required: ${maxParticipants}`);
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
    console.log('Vote Lambda received AppSync event:', JSON.stringify(event));
    try {
        // Extract user ID from AppSync context
        const userId = event.identity?.claims?.sub || event.identity?.username;
        if (!userId) {
            console.error('User not authenticated for vote');
            return { success: false }; // Return proper VoteResult instead of throwing
        }
        // Get arguments from AppSync
        const { input } = event.arguments;
        const { roomId, movieId, vote } = input;
        // Validate input
        if (!roomId) {
            console.error('Room ID is required');
            return { success: false }; // Return proper VoteResult instead of throwing
        }
        if (typeof movieId !== 'number') {
            console.error('Movie ID must be a number');
            return { success: false }; // Return proper VoteResult instead of throwing
        }
        if (typeof vote !== 'boolean') {
            console.error('Vote must be a boolean');
            return { success: false }; // Return proper VoteResult instead of throwing
        }
        const voteService = new VoteService();
        try {
            const result = await voteService.processVote(userId, roomId, movieId, vote);
            return result; // This already returns { success: true, match?: Match }
        }
        catch (error) {
            console.error('Error processing vote:', error);
            return { success: false }; // Return proper VoteResult on error
        }
    }
    catch (error) {
        console.error('Vote Lambda error:', error);
        return { success: false }; // Always return proper VoteResult, never throw
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdm90ZS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQW9IO0FBQ3BILDBEQUFxRTtBQUNyRSx3REFBb0Q7QUFDcEQscURBQStDO0FBQy9DLGdGQUFvRTtBQUNwRSwwREFBcUQ7QUFFckQseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUErRDFFLGVBQWU7QUFDZixNQUFNLFdBQVc7SUFNZjtRQUNFLElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBQ3BELElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxjQUFjLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsSUFBSSxFQUFFLENBQUM7UUFFekQsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQy9ELE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUMsQ0FB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LENBQUMsQ0FBQyx3REFBd0Q7UUFDekUsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLHdCQUF3QixFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQy9DLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQyxvQ0FBb0M7UUFDakUsQ0FBQztJQUVILENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUMzQyxPQUFPLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUMsK0NBQStDO0lBQzVFLENBQUM7QUFDSCxDQUFDLENBQUM7QUE3Q1csUUFBQSxPQUFPLFdBNkNsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBQdXRDb21tYW5kLCBRdWVyeUNvbW1hbmQsIEdldENvbW1hbmQsIERlbGV0ZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5pbXBvcnQgeyBMYW1iZGFDbGllbnQsIEludm9rZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtbGFtYmRhJztcclxuaW1wb3J0IHsgU2lnbmF0dXJlVjQgfSBmcm9tICdAYXdzLXNkay9zaWduYXR1cmUtdjQnO1xyXG5pbXBvcnQgeyBTaGEyNTYgfSBmcm9tICdAYXdzLWNyeXB0by9zaGEyNTYtanMnO1xyXG5pbXBvcnQgeyBkZWZhdWx0UHJvdmlkZXIgfSBmcm9tICdAYXdzLXNkay9jcmVkZW50aWFsLXByb3ZpZGVyLW5vZGUnO1xyXG5pbXBvcnQgeyBIdHRwUmVxdWVzdCB9IGZyb20gJ0Bhd3Mtc2RrL3Byb3RvY29sLWh0dHAnO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpO1xyXG5jb25zdCBsYW1iZGFDbGllbnQgPSBuZXcgTGFtYmRhQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5cclxuLy8gVHlwZXNcclxuaW50ZXJmYWNlIFZvdGUge1xyXG4gIHJvb21JZDogc3RyaW5nO1xyXG4gIHVzZXJNb3ZpZUlkOiBzdHJpbmc7IC8vIEZvcm1hdDogXCJ1c2VySWQjbW92aWVJZFwiXHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgbW92aWVJZDogbnVtYmVyO1xyXG4gIHZvdGU6IGJvb2xlYW47XHJcbiAgdGltZXN0YW1wOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNYXRjaCB7XHJcbiAgaWQ6IHN0cmluZztcclxuICByb29tSWQ6IHN0cmluZztcclxuICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBwb3N0ZXJQYXRoPzogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgbWF0Y2hlZFVzZXJzOiBzdHJpbmdbXTtcclxuICB0aW1lc3RhbXA6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIFJvb20ge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgY29kZTogc3RyaW5nO1xyXG4gIGhvc3RJZDogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgZ2VucmVJZHM6IG51bWJlcltdO1xyXG4gIGNhbmRpZGF0ZXM6IE1vdmllQ2FuZGlkYXRlW107XHJcbiAgY3JlYXRlZEF0OiBzdHJpbmc7XHJcbiAgdHRsOiBudW1iZXI7XHJcbiAgbWF4UGFydGljaXBhbnRzOiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNb3ZpZUNhbmRpZGF0ZSB7XHJcbiAgaWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIG92ZXJ2aWV3OiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aDogc3RyaW5nIHwgbnVsbDtcclxuICByZWxlYXNlRGF0ZTogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbn1cclxuXHJcbmludGVyZmFjZSBWb3RlRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ3ZvdGUnO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIGlucHV0OiB7XHJcbiAgICByb29tSWQ6IHN0cmluZztcclxuICAgIG1vdmllSWQ6IG51bWJlcjtcclxuICAgIHZvdGU6IGJvb2xlYW47XHJcbiAgfTtcclxufVxyXG5cclxuaW50ZXJmYWNlIFZvdGVSZXNwb25zZSB7XHJcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xyXG4gIGJvZHk6IHtcclxuICAgIHN1Y2Nlc3M6IGJvb2xlYW47XHJcbiAgICBtYXRjaD86IE1hdGNoO1xyXG4gICAgZXJyb3I/OiBzdHJpbmc7XHJcbiAgfTtcclxufVxyXG5cclxuLy8gVm90ZSBTZXJ2aWNlXHJcbmNsYXNzIFZvdGVTZXJ2aWNlIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IHZvdGVzVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IG1hdGNoZXNUYWJsZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgcm9vbXNUYWJsZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbWF0Y2hMYW1iZGFBcm46IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLnZvdGVzVGFibGUgPSBwcm9jZXNzLmVudi5WT1RFU19UQUJMRSB8fCAnJztcclxuICAgIHRoaXMubWF0Y2hlc1RhYmxlID0gcHJvY2Vzcy5lbnYuTUFUQ0hFU19UQUJMRSB8fCAnJztcclxuICAgIHRoaXMucm9vbXNUYWJsZSA9IHByb2Nlc3MuZW52LlJPT01TX1RBQkxFIHx8ICcnO1xyXG4gICAgdGhpcy5tYXRjaExhbWJkYUFybiA9IHByb2Nlc3MuZW52Lk1BVENIX0xBTUJEQV9BUk4gfHwgJyc7XHJcblxyXG4gICAgaWYgKCF0aGlzLnZvdGVzVGFibGUgfHwgIXRoaXMubWF0Y2hlc1RhYmxlIHx8ICF0aGlzLnJvb21zVGFibGUpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZXF1aXJlZCB0YWJsZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgYXJlIG1pc3NpbmcnKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIHByb2Nlc3NWb3RlKHVzZXJJZDogc3RyaW5nLCByb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCB2b3RlOiBib29sZWFuKTogUHJvbWlzZTx7IHN1Y2Nlc3M6IGJvb2xlYW47IG1hdGNoPzogTWF0Y2ggfT4ge1xyXG4gICAgLy8gVmFsaWRhdGUgcm9vbSBleGlzdHMgYW5kIGdldCByb29tIGRldGFpbHNcclxuICAgIGNvbnN0IHJvb20gPSBhd2FpdCB0aGlzLmdldFJvb20ocm9vbUlkKTtcclxuICAgIGlmICghcm9vbSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gbm90IGZvdW5kIG9yIGhhcyBleHBpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQmFzaWMgcm9vbSBtZW1iZXJzaGlwIHZhbGlkYXRpb24gLSBjaGVjayBpZiB1c2VyIGhhcyBhY2Nlc3MgdG8gdGhpcyByb29tXHJcbiAgICAvLyBGb3Igbm93LCB3ZSBhbGxvdyBhbnkgYXV0aGVudGljYXRlZCB1c2VyIHRvIHZvdGUgaW4gYW55IGFjdGl2ZSByb29tXHJcbiAgICAvLyBUT0RPOiBJbXBsZW1lbnQgcHJvcGVyIHJvb20gbWVtYmVyc2hpcCB2YWxpZGF0aW9uIGluIFRhc2sgMlxyXG4gICAgY29uc3QgaGFzUm9vbUFjY2VzcyA9IGF3YWl0IHRoaXMudmFsaWRhdGVSb29tQWNjZXNzKHVzZXJJZCwgcm9vbUlkLCByb29tKTtcclxuICAgIGlmICghaGFzUm9vbUFjY2Vzcykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgZG9lcyBub3QgaGF2ZSBhY2Nlc3MgdG8gdGhpcyByb29tJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVmFsaWRhdGUgbW92aWUgaXMgaW4gcm9vbSBjYW5kaWRhdGVzXHJcbiAgICBjb25zdCBtb3ZpZUNhbmRpZGF0ZSA9IHJvb20uY2FuZGlkYXRlcy5maW5kKGMgPT4gYy5pZCA9PT0gbW92aWVJZCk7XHJcbiAgICBpZiAoIW1vdmllQ2FuZGlkYXRlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTW92aWUgbm90IGZvdW5kIGluIHJvb20gY2FuZGlkYXRlcycpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlY29yZCB0aGUgdm90ZVxyXG4gICAgYXdhaXQgdGhpcy5yZWNvcmRWb3RlKHVzZXJJZCwgcm9vbUlkLCBtb3ZpZUlkLCB2b3RlKTtcclxuXHJcbiAgICAvLyBDaGVjayBmb3IgbWF0Y2ggaWYgdm90ZSBpcyBwb3NpdGl2ZVxyXG4gICAgbGV0IG1hdGNoOiBNYXRjaCB8IHVuZGVmaW5lZDtcclxuICAgIGlmICh2b3RlKSB7XHJcbiAgICAgIG1hdGNoID0gYXdhaXQgdGhpcy5jaGVja0Zvck1hdGNoKHJvb21JZCwgbW92aWVJZCwgbW92aWVDYW5kaWRhdGUpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIG1hdGNoIH07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHZhbGlkYXRlUm9vbUFjY2Vzcyh1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcsIHJvb206IFJvb20pOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIEJhc2ljIHZhbGlkYXRpb246IGNoZWNrIGlmIHVzZXIgaXMgdGhlIHJvb20gaG9zdCBvciBoYXMgcHJldmlvdXNseSB2b3RlZCBpbiB0aGlzIHJvb21cclxuICAgICAgaWYgKHJvb20uaG9zdElkID09PSB1c2VySWQpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gaXMgdGhlIGhvc3Qgb2Ygcm9vbSAke3Jvb21JZH0gLSBhY2Nlc3MgZ3JhbnRlZGApO1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiB1c2VyIGhhcyBwcmV2aW91c2x5IHBhcnRpY2lwYXRlZCBpbiB0aGlzIHJvb21cclxuICAgICAgY29uc3QgdXNlclZvdGVzUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEZpbHRlckV4cHJlc3Npb246ICd1c2VySWQgPSA6dXNlcklkJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICAgICc6dXNlcklkJzogdXNlcklkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgTGltaXQ6IDEsXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGlmICh1c2VyVm90ZXNSZXN1bHQuSXRlbXMgJiYgdXNlclZvdGVzUmVzdWx0Lkl0ZW1zLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gaGFzIHByZXZpb3VzbHkgdm90ZWQgaW4gcm9vbSAke3Jvb21JZH0gLSBhY2Nlc3MgZ3JhbnRlZGApO1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBGb3IgTVZQOiBBbGxvdyBhbnkgYXV0aGVudGljYXRlZCB1c2VyIHRvIGpvaW4gYW55IGFjdGl2ZSByb29tXHJcbiAgICAgIC8vIFRPRE86IEltcGxlbWVudCBwcm9wZXIgcm9vbSBtZW1iZXJzaGlwIHZhbGlkYXRpb24gd2l0aCBEeW5hbW9EQiB0YWJsZSBpbiBUYXNrIDJcclxuICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGdyYW50ZWQgYWNjZXNzIHRvIHJvb20gJHtyb29tSWR9IChNVlAgbW9kZSAtIGFsbCB1c2VycyBhbGxvd2VkKWApO1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciB2YWxpZGF0aW5nIHJvb20gYWNjZXNzIGZvciB1c2VyICR7dXNlcklkfSBpbiByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgIC8vIE9uIGVycm9yLCBhbGxvdyBhY2Nlc3MgZm9yIG5vdyAoZmFpbCBvcGVuIGZvciBNVlApXHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBnZXRSb29tKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTxSb29tIHwgbnVsbD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5yb29tc1RhYmxlLFxyXG4gICAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGlmICghcmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3Qgcm9vbSA9IHJlc3VsdC5JdGVtIGFzIFJvb207XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiByb29tIGhhcyBleHBpcmVkXHJcbiAgICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xyXG4gICAgICBpZiAocm9vbS50dGwgJiYgcm9vbS50dGwgPCBub3cpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHJvb207XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBnZXR0aW5nIHJvb206JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVjb3JkVm90ZSh1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgdm90ZTogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgdXNlck1vdmllSWQgPSBgJHt1c2VySWR9IyR7bW92aWVJZH1gO1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAgIGNvbnN0IHZvdGVSZWNvcmQ6IFZvdGUgPSB7XHJcbiAgICAgIHJvb21JZCxcclxuICAgICAgdXNlck1vdmllSWQsXHJcbiAgICAgIHVzZXJJZCxcclxuICAgICAgbW92aWVJZCxcclxuICAgICAgdm90ZSxcclxuICAgICAgdGltZXN0YW1wLFxyXG4gICAgfTtcclxuXHJcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICBJdGVtOiB2b3RlUmVjb3JkLFxyXG4gICAgICAvLyBBbGxvdyBvdmVyd3JpdGluZyBwcmV2aW91cyB2b3RlcyBmb3IgdGhlIHNhbWUgdXNlci9tb3ZpZSBjb21iaW5hdGlvblxyXG4gICAgfSkpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBWb3RlIHJlY29yZGVkOiBVc2VyICR7dXNlcklkfSB2b3RlZCAke3ZvdGUgPyAnWUVTJyA6ICdOTyd9IGZvciBtb3ZpZSAke21vdmllSWR9IGluIHJvb20gJHtyb29tSWR9YCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGNoZWNrRm9yTWF0Y2gocm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgbW92aWVDYW5kaWRhdGU6IE1vdmllQ2FuZGlkYXRlKTogUHJvbWlzZTxNYXRjaCB8IHVuZGVmaW5lZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gR2V0IHJvb20gZGV0YWlscyB0byBrbm93IG1heFBhcnRpY2lwYW50c1xyXG4gICAgICBjb25zdCByb29tID0gYXdhaXQgdGhpcy5nZXRSb29tKHJvb21JZCk7XHJcbiAgICAgIGlmICghcm9vbSkge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFJvb20gJHtyb29tSWR9IG5vdCBmb3VuZCB3aGVuIGNoZWNraW5nIGZvciBtYXRjaGApO1xyXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIEdldCBtYXhQYXJ0aWNpcGFudHMgZnJvbSByb29tICh3aXRoIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkpXHJcbiAgICAgIGNvbnN0IG1heFBhcnRpY2lwYW50cyA9IHJvb20ubWF4UGFydGljaXBhbnRzIHx8IDI7IC8vIERlZmF1bHQgdG8gMiBmb3Igb2xkIHJvb21zXHJcbiAgICAgIGNvbnNvbGUubG9nKGBSb29tICR7cm9vbUlkfSByZXF1aXJlcyAke21heFBhcnRpY2lwYW50c30gcG9zaXRpdmUgdm90ZXMgZm9yIGEgbWF0Y2hgKTtcclxuXHJcbiAgICAgIC8vIEdldCBhbGwgdm90ZXMgZm9yIHRoaXMgbW92aWUgaW4gdGhpcyByb29tIChleGNsdWRpbmcgcGFydGljaXBhdGlvbiByZWNvcmRzKVxyXG4gICAgICAvLyBDUklUSUNBTDogVXNlIENvbnNpc3RlbnRSZWFkIHRvIGVuc3VyZSB3ZSBzZWUgdGhlIHZvdGUgdGhhdCB3YXMganVzdCB3cml0dGVuXHJcbiAgICAgIC8vIFdpdGhvdXQgdGhpcywgRHluYW1vREIncyBldmVudHVhbCBjb25zaXN0ZW5jeSBjYW4gY2F1c2UgcmFjZSBjb25kaXRpb25zIHdoZXJlXHJcbiAgICAgIC8vIHR3byB1c2VycyB2b3Rpbmcgc2ltdWx0YW5lb3VzbHkgZG9uJ3Qgc2VlIGVhY2ggb3RoZXIncyB2b3Rlc1xyXG4gICAgICBjb25zdCB2b3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnbW92aWVJZCA9IDptb3ZpZUlkIEFORCB2b3RlID0gOnZvdGUgQU5EIG1vdmllSWQgPD4gOnBhcnRpY2lwYXRpb25NYXJrZXInLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzptb3ZpZUlkJzogbW92aWVJZCxcclxuICAgICAgICAgICc6dm90ZSc6IHRydWUsIC8vIE9ubHkgcG9zaXRpdmUgdm90ZXNcclxuICAgICAgICAgICc6cGFydGljaXBhdGlvbk1hcmtlcic6IC0xLCAvLyBFeGNsdWRlIHBhcnRpY2lwYXRpb24gcmVjb3Jkc1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgQ29uc2lzdGVudFJlYWQ6IHRydWUsIC8vIOKchSBGSVhFRDogRm9yY2Ugc3Ryb25nIGNvbnNpc3RlbmN5IHRvIHNlZSByZWNlbnQgd3JpdGVzXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IHBvc2l0aXZlVm90ZXMgPSB2b3Rlc1Jlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgY29uc3QgcG9zaXRpdmVVc2VySWRzID0gbmV3IFNldChwb3NpdGl2ZVZvdGVzLm1hcCh2b3RlID0+ICh2b3RlIGFzIFZvdGUpLnVzZXJJZCkpO1xyXG4gICAgICBjb25zdCBwb3NpdGl2ZVZvdGVDb3VudCA9IHBvc2l0aXZlVXNlcklkcy5zaXplO1xyXG5cclxuICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7cG9zaXRpdmVWb3RlQ291bnR9IHVuaXF1ZSBwb3NpdGl2ZSB2b3RlcyBmb3IgbW92aWUgJHttb3ZpZUlkfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG5cclxuICAgICAgLy8gTkVXIExPR0lDOiBNYXRjaCBvY2N1cnMgd2hlbiBwb3NpdGl2ZSB2b3RlcyA9PT0gbWF4UGFydGljaXBhbnRzXHJcbiAgICAgIC8vIEl0IGRvZXNuJ3QgbWF0dGVyIGhvdyBtYW55IHVzZXJzIGFyZSBpbiB0aGUgcm9vbSBvciBoYXZlIHZvdGVkXHJcbiAgICAgIC8vIE9ubHkgdGhlIGNvbmZpZ3VyZWQgbWF4UGFydGljaXBhbnRzIG1hdHRlcnNcclxuICAgICAgaWYgKHBvc2l0aXZlVm90ZUNvdW50ID09PSBtYXhQYXJ0aWNpcGFudHMpIHtcclxuICAgICAgICAvLyBXZSBoYXZlIGEgbWF0Y2ghIEV4YWN0bHkgbWF4UGFydGljaXBhbnRzIHVzZXJzIHZvdGVkIHBvc2l0aXZlbHlcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+OiSBNQVRDSCBERVRFQ1RFRCEgJHtwb3NpdGl2ZVZvdGVDb3VudH0gdXNlcnMgKD0gbWF4UGFydGljaXBhbnRzKSB2b3RlZCBwb3NpdGl2ZWx5IGZvciBtb3ZpZSAke21vdmllSWR9YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgaWYgbWF0Y2ggYWxyZWFkeSBleGlzdHNcclxuICAgICAgICBjb25zdCBleGlzdGluZ01hdGNoID0gYXdhaXQgdGhpcy5nZXRFeGlzdGluZ01hdGNoKHJvb21JZCwgbW92aWVJZCk7XHJcbiAgICAgICAgaWYgKGV4aXN0aW5nTWF0Y2gpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKCdNYXRjaCBhbHJlYWR5IGV4aXN0cywgcmV0dXJuaW5nIGV4aXN0aW5nIG1hdGNoJyk7XHJcbiAgICAgICAgICByZXR1cm4gZXhpc3RpbmdNYXRjaDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIENyZWF0ZSBuZXcgbWF0Y2hcclxuICAgICAgICBjb25zdCBtYXRjaCA9IGF3YWl0IHRoaXMuY3JlYXRlTWF0Y2gocm9vbUlkLCBtb3ZpZUlkLCBtb3ZpZUNhbmRpZGF0ZSwgQXJyYXkuZnJvbShwb3NpdGl2ZVVzZXJJZHMpKTtcclxuICAgICAgICByZXR1cm4gbWF0Y2g7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBObyBtYXRjaCB5ZXQuIFBvc2l0aXZlIHZvdGVzOiAke3Bvc2l0aXZlVm90ZUNvdW50fSwgUmVxdWlyZWQ6ICR7bWF4UGFydGljaXBhbnRzfWApO1xyXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGZvciBtYXRjaDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldEV4aXN0aW5nTWF0Y2gocm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlcik6IFByb21pc2U8TWF0Y2ggfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBLZXk6IHtcclxuICAgICAgICAgIHJvb21JZCxcclxuICAgICAgICAgIG1vdmllSWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgcmV0dXJuIHJlc3VsdC5JdGVtIGFzIE1hdGNoIHx8IG51bGw7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyBleGlzdGluZyBtYXRjaDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBjcmVhdGVNYXRjaChyb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCBtb3ZpZUNhbmRpZGF0ZTogTW92aWVDYW5kaWRhdGUsIG1hdGNoZWRVc2Vyczogc3RyaW5nW10pOiBQcm9taXNlPE1hdGNoPiB7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICBjb25zdCBtYXRjaElkID0gYCR7cm9vbUlkfSMke21vdmllSWR9YDtcclxuXHJcbiAgICBjb25zdCBtYXRjaDogTWF0Y2ggPSB7XHJcbiAgICAgIGlkOiBtYXRjaElkLFxyXG4gICAgICByb29tSWQsXHJcbiAgICAgIG1vdmllSWQsXHJcbiAgICAgIHRpdGxlOiBtb3ZpZUNhbmRpZGF0ZS50aXRsZSxcclxuICAgICAgcG9zdGVyUGF0aDogbW92aWVDYW5kaWRhdGUucG9zdGVyUGF0aCB8fCB1bmRlZmluZWQsXHJcbiAgICAgIG1lZGlhVHlwZTogbW92aWVDYW5kaWRhdGUubWVkaWFUeXBlLFxyXG4gICAgICBtYXRjaGVkVXNlcnMsXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgIH07XHJcblxyXG4gICAgLy8gU3RvcmUgT05MWSB0aGUgbWFpbiBtYXRjaCByZWNvcmQgLSBubyBkdXBsaWNhdGVzIHBlciB1c2VyXHJcbiAgICAvLyBUaGUgbWF0Y2ggaGFuZGxlciB3aWxsIGZpbHRlciBieSBtYXRjaGVkVXNlcnMgYXJyYXkgd2hlbiBxdWVyeWluZ1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgSXRlbTogbWF0Y2gsXHJcbiAgICAgICAgQ29uZGl0aW9uRXhwcmVzc2lvbjogJ2F0dHJpYnV0ZV9ub3RfZXhpc3RzKHJvb21JZCkgQU5EIGF0dHJpYnV0ZV9ub3RfZXhpc3RzKG1vdmllSWQpJywgLy8gUHJldmVudCBkdXBsaWNhdGVzXHJcbiAgICAgIH0pKTtcclxuICAgICAgY29uc29sZS5sb2coYOKchSBNYXRjaCBjcmVhdGVkOiAke21hdGNoLnRpdGxlfSBmb3IgJHttYXRjaGVkVXNlcnMubGVuZ3RofSB1c2Vyc2ApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc3QgZXJyID0gZXJyb3IgYXMgYW55O1xyXG4gICAgICBpZiAoZXJyLm5hbWUgPT09ICdDb25kaXRpb25hbENoZWNrRmFpbGVkRXhjZXB0aW9uJykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBNYXRjaCBhbHJlYWR5IGV4aXN0cyBmb3Igcm9vbSAke3Jvb21JZH0gYW5kIG1vdmllICR7bW92aWVJZH1gKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjcmVhdGluZyBtYXRjaDonLCBlcnJvcik7XHJcbiAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBDUklUSUNBTDogVHJpZ2dlciBBcHBTeW5jIHN1YnNjcmlwdGlvbiBGSVJTVCBiZWZvcmUgYW55IGNsZWFudXBcclxuICAgIC8vIFRoaXMgZW5zdXJlcyBhbGwgdXNlcnMgZ2V0IG5vdGlmaWVkIGJlZm9yZSBhbnkgY2hhbmdlc1xyXG4gICAgYXdhaXQgdGhpcy50cmlnZ2VyQXBwU3luY1N1YnNjcmlwdGlvbihtYXRjaCk7XHJcblxyXG4gICAgLy8gV2FpdCBhIG1vbWVudCB0byBlbnN1cmUgbm90aWZpY2F0aW9ucyBhcmUgc2VudFxyXG4gICAgLy8gVGhpcyBwcmV2ZW50cyBcIlJvb20gbm90IGZvdW5kXCIgZXJyb3JzIGZvciBjb25jdXJyZW50IHZvdGVzXHJcbiAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMjAwMCkpOyAvLyAyIHNlY29uZCBkZWxheVxyXG5cclxuICAgIC8vIERJU0FCTEVEOiBEbyBub3QgZGVsZXRlIHJvb20gYWZ0ZXIgbWF0Y2ggLSBsZXQgaXQgcmVtYWluIGFjdGl2ZVxyXG4gICAgLy8gVGhpcyBwcmV2ZW50cyBcIlJvb20gbm90IGZvdW5kXCIgZXJyb3JzIGZvciB1c2VycyB3aG8gdm90ZSBhZnRlciBtYXRjaCBpcyBjcmVhdGVkXHJcbiAgICAvLyBhd2FpdCB0aGlzLmRlbGV0ZVJvb20ocm9vbUlkKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coYE1hdGNoIGNyZWF0ZWQgYnV0IHJvb20gJHtyb29tSWR9IGtlcHQgYWN0aXZlIHRvIHByZXZlbnQgXCJSb29tIG5vdCBmb3VuZFwiIGVycm9yc2ApO1xyXG5cclxuICAgIHJldHVybiBtYXRjaDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZGVsZXRlUm9vbShyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gRGVsZXRlIHRoZSByb29tIGZyb20gRHluYW1vREJcclxuICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IERlbGV0ZUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5yb29tc1RhYmxlLFxyXG4gICAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBSb29tICR7cm9vbUlkfSBkZWxldGVkIGFmdGVyIG1hdGNoIGNyZWF0aW9uYCk7XHJcblxyXG4gICAgICAvLyBPcHRpb25hbGx5OiBEZWxldGUgYWxsIHZvdGVzIGZvciB0aGlzIHJvb20gdG8gZnJlZSB1cCBzcGFjZVxyXG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZVJvb21Wb3Rlcyhyb29tSWQpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZGVsZXRpbmcgcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICAvLyBEb24ndCBmYWlsIHRoZSBtYXRjaCBjcmVhdGlvbiBpZiByb29tIGRlbGV0aW9uIGZhaWxzXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGRlbGV0ZVJvb21Wb3Rlcyhyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gR2V0IGFsbCB2b3RlcyBhbmQgcGFydGljaXBhdGlvbiByZWNvcmRzIGZvciB0aGlzIHJvb21cclxuICAgICAgY29uc3Qgdm90ZXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgYWxsUmVjb3JkcyA9IHZvdGVzUmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICBcclxuICAgICAgLy8gRGVsZXRlIGFsbCByZWNvcmRzICh2b3RlcyBhbmQgcGFydGljaXBhdGlvbikgaW4gYmF0Y2hlc1xyXG4gICAgICBjb25zdCBkZWxldGVQcm9taXNlcyA9IGFsbFJlY29yZHMubWFwKHJlY29yZCA9PiBcclxuICAgICAgICBkb2NDbGllbnQuc2VuZChuZXcgRGVsZXRlQ29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICAgIEtleToge1xyXG4gICAgICAgICAgICByb29tSWQ6IHJlY29yZC5yb29tSWQsXHJcbiAgICAgICAgICAgIHVzZXJNb3ZpZUlkOiByZWNvcmQudXNlck1vdmllSWQsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pKVxyXG4gICAgICApO1xyXG5cclxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKGRlbGV0ZVByb21pc2VzKTtcclxuICAgICAgY29uc29sZS5sb2coYERlbGV0ZWQgJHthbGxSZWNvcmRzLmxlbmd0aH0gcmVjb3JkcyAodm90ZXMgYW5kIHBhcnRpY2lwYXRpb24pIGZvciByb29tICR7cm9vbUlkfWApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZGVsZXRpbmcgcmVjb3JkcyBmb3Igcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyB0cmlnZ2VyQXBwU3luY1N1YnNjcmlwdGlvbihtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnNvbGUubG9nKGDwn5SUIElOSUNJQU5ETyBCUk9BRENBU1QgSU5ESVZJRFVBTCBwYXJhIGNhZGEgdXN1YXJpbyBlbiBzYWxhOiAke21hdGNoLnJvb21JZH1gKTtcclxuICAgIGNvbnNvbGUubG9nKGDwn5GlIFVzdWFyaW9zIGEgbm90aWZpY2FyOiAke21hdGNoLm1hdGNoZWRVc2Vycy5qb2luKCcsICcpfWApO1xyXG4gICAgXHJcbiAgICBjb25zdCBlbmRwb2ludCA9IHByb2Nlc3MuZW52LkdSQVBIUUxfRU5EUE9JTlQ7XHJcbiAgICBpZiAoIWVuZHBvaW50KSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGQVRBTDogR1JBUEhRTF9FTkRQT0lOVCBubyBlc3TDoSBkZWZpbmlkbycpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTlVFVkEgRVNUUkFURUdJQTogRW52aWFyIG5vdGlmaWNhY2nDs24gaW5kaXZpZHVhbCBhIGNhZGEgdXN1YXJpb1xyXG4gICAgLy8gRXN0byBhc2VndXJhIHF1ZSBUT0RPUyBsb3MgdXN1YXJpb3MgcXVlIHBhcnRpY2lwYXJvbiBlbiBlbCBtYXRjaCByZWNpYmFuIGxhIG5vdGlmaWNhY2nDs25cclxuICAgIGNvbnN0IG5vdGlmaWNhdGlvblByb21pc2VzID0gbWF0Y2gubWF0Y2hlZFVzZXJzLm1hcChhc3luYyAodXNlcklkKSA9PiB7XHJcbiAgICAgIGF3YWl0IHRoaXMuc2VuZEluZGl2aWR1YWxVc2VyTm90aWZpY2F0aW9uKHVzZXJJZCwgbWF0Y2gsIGVuZHBvaW50KTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEVudmlhciB0b2RhcyBsYXMgbm90aWZpY2FjaW9uZXMgZW4gcGFyYWxlbG9cclxuICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQobm90aWZpY2F0aW9uUHJvbWlzZXMpO1xyXG4gICAgXHJcbiAgICAvLyBMb2cgcmVzdWx0YWRvc1xyXG4gICAgcmVzdWx0cy5mb3JFYWNoKChyZXN1bHQsIGluZGV4KSA9PiB7XHJcbiAgICAgIGNvbnN0IHVzZXJJZCA9IG1hdGNoLm1hdGNoZWRVc2Vyc1tpbmRleF07XHJcbiAgICAgIGlmIChyZXN1bHQuc3RhdHVzID09PSAnZnVsZmlsbGVkJykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgTm90aWZpY2FjacOzbiBlbnZpYWRhIGV4aXRvc2FtZW50ZSBhIHVzdWFyaW86ICR7dXNlcklkfWApO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBFcnJvciBlbnZpYW5kbyBub3RpZmljYWNpw7NuIGEgdXN1YXJpbyAke3VzZXJJZH06YCwgcmVzdWx0LnJlYXNvbik7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFRhbWJpw6luIGVudmlhciBsYSBub3RpZmljYWNpw7NuIGdlbmVyYWwgZGUgbGEgc2FsYSAocGFyYSBjb21wYXRpYmlsaWRhZClcclxuICAgIGF3YWl0IHRoaXMuc2VuZFJvb21Ob3RpZmljYXRpb24obWF0Y2gsIGVuZHBvaW50KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc2VuZEluZGl2aWR1YWxVc2VyTm90aWZpY2F0aW9uKHVzZXJJZDogc3RyaW5nLCBtYXRjaDogTWF0Y2gsIGVuZHBvaW50OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnNvbGUubG9nKGDwn5OkIEVudmlhbmRvIG5vdGlmaWNhY2nDs24gaW5kaXZpZHVhbCBhIHVzdWFyaW86ICR7dXNlcklkfWApO1xyXG4gICAgXHJcbiAgICAvLyBNdXRhY2nDs24gZXNwZWPDrWZpY2EgcGFyYSBub3RpZmljYXIgYSB1biB1c3VhcmlvIGluZGl2aWR1YWxcclxuICAgIGNvbnN0IG11dGF0aW9uID0gYFxyXG4gICAgICBtdXRhdGlvbiBQdWJsaXNoVXNlck1hdGNoKCR1c2VySWQ6IElEISwgJG1hdGNoRGF0YTogUm9vbU1hdGNoSW5wdXQhKSB7XHJcbiAgICAgICAgcHVibGlzaFVzZXJNYXRjaCh1c2VySWQ6ICR1c2VySWQsIG1hdGNoRGF0YTogJG1hdGNoRGF0YSkge1xyXG4gICAgICAgICAgcm9vbUlkXHJcbiAgICAgICAgICBtYXRjaElkXHJcbiAgICAgICAgICBtb3ZpZUlkXHJcbiAgICAgICAgICBtYXRjaGVkVXNlcnNcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIGA7XHJcblxyXG4gICAgY29uc3QgdmFyaWFibGVzID0ge1xyXG4gICAgICB1c2VySWQ6IHVzZXJJZCxcclxuICAgICAgbWF0Y2hEYXRhOiB7XHJcbiAgICAgICAgbWF0Y2hJZDogbWF0Y2guaWQsXHJcbiAgICAgICAgbW92aWVJZDogbWF0Y2gubW92aWVJZCxcclxuICAgICAgICBtb3ZpZVRpdGxlOiBtYXRjaC50aXRsZSxcclxuICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaC5wb3N0ZXJQYXRoLFxyXG4gICAgICAgIG1hdGNoZWRVc2VyczogbWF0Y2gubWF0Y2hlZFVzZXJzLFxyXG4gICAgICAgIHJvb21JZDogbWF0Y2gucm9vbUlkLCAvLyBJbmNsdWlyIHJvb21JZCBlbiBsb3MgZGF0b3NcclxuICAgICAgICB0aW1lc3RhbXA6IG1hdGNoLnRpbWVzdGFtcCxcclxuICAgICAgICBtYXRjaERldGFpbHM6IHtcclxuICAgICAgICAgIHZvdGVDb3VudDogbWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aCxcclxuICAgICAgICAgIHJlcXVpcmVkVm90ZXM6IG1hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGgsXHJcbiAgICAgICAgICBtYXRjaFR5cGU6ICd1bmFuaW1vdXMnXHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwoZW5kcG9pbnQpO1xyXG4gICAgICBjb25zdCByZXF1ZXN0ID0gbmV3IEh0dHBSZXF1ZXN0KHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICAgaG9zdDogdXJsLmhvc3RuYW1lLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaG9zdG5hbWU6IHVybC5ob3N0bmFtZSxcclxuICAgICAgICBwYXRoOiAnL2dyYXBocWwnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgcXVlcnk6IG11dGF0aW9uLCB2YXJpYWJsZXMgfSksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3Qgc2lnbmVyID0gbmV3IFNpZ25hdHVyZVY0KHtcclxuICAgICAgICBjcmVkZW50aWFsczogZGVmYXVsdFByb3ZpZGVyKCksXHJcbiAgICAgICAgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnLFxyXG4gICAgICAgIHNlcnZpY2U6ICdhcHBzeW5jJyxcclxuICAgICAgICBzaGEyNTY6IFNoYTI1NixcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBzaWduZWRSZXF1ZXN0ID0gYXdhaXQgc2lnbmVyLnNpZ24ocmVxdWVzdCk7XHJcblxyXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGVuZHBvaW50LCB7XHJcbiAgICAgICAgbWV0aG9kOiBzaWduZWRSZXF1ZXN0Lm1ldGhvZCxcclxuICAgICAgICBoZWFkZXJzOiBzaWduZWRSZXF1ZXN0LmhlYWRlcnMgYXMgYW55LFxyXG4gICAgICAgIGJvZHk6IHNpZ25lZFJlcXVlc3QuYm9keSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXNwb25zZS5qc29uKCkgYXMgeyBkYXRhPzogYW55OyBlcnJvcnM/OiBhbnlbXSB9O1xyXG4gICAgICBcclxuICAgICAgaWYgKHJlc3VsdC5lcnJvcnMpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgRXJyb3Igbm90aWZpY2FuZG8gdXN1YXJpbyAke3VzZXJJZH06YCwgSlNPTi5zdHJpbmdpZnkocmVzdWx0LmVycm9ycykpO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXBwU3luYyBlcnJvciBmb3IgdXNlciAke3VzZXJJZH06ICR7cmVzdWx0LmVycm9yc1swXT8ubWVzc2FnZX1gKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIFVzdWFyaW8gJHt1c2VySWR9IG5vdGlmaWNhZG8gZXhpdG9zYW1lbnRlYCk7XHJcbiAgICAgIH1cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBFcnJvciBlbnZpYW5kbyBub3RpZmljYWNpw7NuIGEgdXN1YXJpbyAke3VzZXJJZH06YCwgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc2VuZFJvb21Ob3RpZmljYXRpb24obWF0Y2g6IE1hdGNoLCBlbmRwb2ludDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+TpCBFbnZpYW5kbyBub3RpZmljYWNpw7NuIGdlbmVyYWwgZGUgc2FsYTogJHttYXRjaC5yb29tSWR9YCk7XHJcbiAgICBcclxuICAgIC8vIE1hbnRlbmVyIGxhIG5vdGlmaWNhY2nDs24gZ2VuZXJhbCBkZSBzYWxhIHBhcmEgY29tcGF0aWJpbGlkYWRcclxuICAgIGNvbnN0IG11dGF0aW9uID0gYFxyXG4gICAgICBtdXRhdGlvbiBQdWJsaXNoUm9vbU1hdGNoKCRyb29tSWQ6IElEISwgJG1hdGNoRGF0YTogUm9vbU1hdGNoSW5wdXQhKSB7XHJcbiAgICAgICAgcHVibGlzaFJvb21NYXRjaChyb29tSWQ6ICRyb29tSWQsIG1hdGNoRGF0YTogJG1hdGNoRGF0YSkge1xyXG4gICAgICAgICAgcm9vbUlkXHJcbiAgICAgICAgICBtYXRjaElkXHJcbiAgICAgICAgICBtb3ZpZUlkXHJcbiAgICAgICAgICBtYXRjaGVkVXNlcnNcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIGA7XHJcblxyXG4gICAgY29uc3QgdmFyaWFibGVzID0ge1xyXG4gICAgICByb29tSWQ6IG1hdGNoLnJvb21JZCxcclxuICAgICAgbWF0Y2hEYXRhOiB7XHJcbiAgICAgICAgbWF0Y2hJZDogbWF0Y2guaWQsXHJcbiAgICAgICAgbW92aWVJZDogbWF0Y2gubW92aWVJZCxcclxuICAgICAgICBtb3ZpZVRpdGxlOiBtYXRjaC50aXRsZSxcclxuICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaC5wb3N0ZXJQYXRoLFxyXG4gICAgICAgIG1hdGNoZWRVc2VyczogbWF0Y2gubWF0Y2hlZFVzZXJzLFxyXG4gICAgICAgIG1hdGNoRGV0YWlsczoge1xyXG4gICAgICAgICAgdm90ZUNvdW50OiBtYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RoLFxyXG4gICAgICAgICAgcmVxdWlyZWRWb3RlczogbWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aCxcclxuICAgICAgICAgIG1hdGNoVHlwZTogJ3VuYW5pbW91cydcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChlbmRwb2ludCk7XHJcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgSHR0cFJlcXVlc3Qoe1xyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICBob3N0OiB1cmwuaG9zdG5hbWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBob3N0bmFtZTogdXJsLmhvc3RuYW1lLFxyXG4gICAgICAgIHBhdGg6ICcvZ3JhcGhxbCcsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBxdWVyeTogbXV0YXRpb24sIHZhcmlhYmxlcyB9KSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBzaWduZXIgPSBuZXcgU2lnbmF0dXJlVjQoe1xyXG4gICAgICAgIGNyZWRlbnRpYWxzOiBkZWZhdWx0UHJvdmlkZXIoKSxcclxuICAgICAgICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScsXHJcbiAgICAgICAgc2VydmljZTogJ2FwcHN5bmMnLFxyXG4gICAgICAgIHNoYTI1NjogU2hhMjU2LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHNpZ25lZFJlcXVlc3QgPSBhd2FpdCBzaWduZXIuc2lnbihyZXF1ZXN0KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goZW5kcG9pbnQsIHtcclxuICAgICAgICBtZXRob2Q6IHNpZ25lZFJlcXVlc3QubWV0aG9kLFxyXG4gICAgICAgIGhlYWRlcnM6IHNpZ25lZFJlcXVlc3QuaGVhZGVycyBhcyBhbnksXHJcbiAgICAgICAgYm9keTogc2lnbmVkUmVxdWVzdC5ib2R5LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKSBhcyB7IGRhdGE/OiBhbnk7IGVycm9ycz86IGFueVtdIH07XHJcbiAgICAgIFxyXG4gICAgICBpZiAocmVzdWx0LmVycm9ycykge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBlbiBub3RpZmljYWNpw7NuIGRlIHNhbGE6JywgSlNPTi5zdHJpbmdpZnkocmVzdWx0LmVycm9ycykpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgTm90aWZpY2FjacOzbiBnZW5lcmFsIGRlIHNhbGEgZW52aWFkYSBleGl0b3NhbWVudGUnKTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGVudmlhbmRvIG5vdGlmaWNhY2nDs24gZ2VuZXJhbCBkZSBzYWxhOicsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZmFsbGJhY2tUb0NyZWF0ZU1hdGNoKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coJ/CflIQgVXNpbmcgZmFsbGJhY2sgY3JlYXRlTWF0Y2ggbWV0aG9kLi4uJyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBGQUxMQkFDSzogVXNlIHRoZSBvbGQgY3JlYXRlTWF0Y2ggbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XHJcbiAgICAgIGlmICh0aGlzLm1hdGNoTGFtYmRhQXJuKSB7XHJcbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZU1hdGNoJyxcclxuICAgICAgICAgIGlucHV0OiB7XHJcbiAgICAgICAgICAgIHJvb21JZDogbWF0Y2gucm9vbUlkLFxyXG4gICAgICAgICAgICBtb3ZpZUlkOiBtYXRjaC5tb3ZpZUlkLFxyXG4gICAgICAgICAgICB0aXRsZTogbWF0Y2gudGl0bGUsXHJcbiAgICAgICAgICAgIHBvc3RlclBhdGg6IG1hdGNoLnBvc3RlclBhdGgsXHJcbiAgICAgICAgICAgIG1hdGNoZWRVc2VyczogbWF0Y2gubWF0Y2hlZFVzZXJzLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjb25zb2xlLmxvZygn8J+agCBJbnZva2luZyBNYXRjaCBMYW1iZGEgd2l0aCBjcmVhdGVNYXRjaCAoZmFsbGJhY2spLi4uJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcclxuICAgICAgICAgIEZ1bmN0aW9uTmFtZTogdGhpcy5tYXRjaExhbWJkYUFybixcclxuICAgICAgICAgIEludm9jYXRpb25UeXBlOiAnUmVxdWVzdFJlc3BvbnNlJyxcclxuICAgICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKGNvbW1hbmQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChyZXNwb25zZS5QYXlsb2FkKSB7XHJcbiAgICAgICAgICBjb25zdCByZXN1bHQgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5QYXlsb2FkKSk7XHJcbiAgICAgICAgICBpZiAocmVzdWx0LnN0YXR1c0NvZGUgPT09IDIwMCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygn4pyFIEZhbGxiYWNrIGNyZWF0ZU1hdGNoIGV4ZWN1dGVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhbGxiYWNrIGNyZWF0ZU1hdGNoIHJldHVybmVkIGVycm9yOicsIHJlc3VsdC5ib2R5Py5lcnJvcik7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTdG9yZSBub3RpZmljYXRpb25zIGZvciBwb2xsaW5nIGZhbGxiYWNrXHJcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmVNYXRjaE5vdGlmaWNhdGlvbnMobWF0Y2gpO1xyXG4gICAgICBcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBpbiBmYWxsYmFjayBtZXRob2Q6JywgZXJyb3IpO1xyXG4gICAgICAvLyBTdG9yZSBub3RpZmljYXRpb25zIGZvciBwb2xsaW5nIGFzIGZpbmFsIGZhbGxiYWNrXHJcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmVNYXRjaE5vdGlmaWNhdGlvbnMobWF0Y2gpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzdG9yZU1hdGNoTm90aWZpY2F0aW9ucyhtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFN0b3JlIGluZGl2aWR1YWwgbm90aWZpY2F0aW9uIHJlY29yZHMgZm9yIGVhY2ggdXNlclxyXG4gICAgICAvLyBUaGlzIGVuYWJsZXMgcG9sbGluZy1iYXNlZCBtYXRjaCBkZXRlY3Rpb24gYXMgYSBmYWxsYmFja1xyXG4gICAgICBjb25zdCBub3RpZmljYXRpb25Qcm9taXNlcyA9IG1hdGNoLm1hdGNoZWRVc2Vycy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IG5vdGlmaWNhdGlvblJlY29yZCA9IHtcclxuICAgICAgICAgIHVzZXJJZCxcclxuICAgICAgICAgIG1hdGNoSWQ6IG1hdGNoLmlkLFxyXG4gICAgICAgICAgb3JpZ2luYWxSb29tSWQ6IG1hdGNoLnJvb21JZCwgLy8gU3RvcmUgb3JpZ2luYWwgcm9vbUlkIHNlcGFyYXRlbHlcclxuICAgICAgICAgIG9yaWdpbmFsTW92aWVJZDogbWF0Y2gubW92aWVJZCwgLy8gU3RvcmUgb3JpZ2luYWwgbW92aWVJZCBzZXBhcmF0ZWx5XHJcbiAgICAgICAgICB0aXRsZTogbWF0Y2gudGl0bGUsXHJcbiAgICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaC5wb3N0ZXJQYXRoLFxyXG4gICAgICAgICAgdGltZXN0YW1wOiBtYXRjaC50aW1lc3RhbXAsXHJcbiAgICAgICAgICBub3RpZmllZDogZmFsc2UsIC8vIEZsYWcgdG8gdHJhY2sgaWYgdXNlciBoYXMgYmVlbiBub3RpZmllZFxyXG4gICAgICAgICAgdHRsOiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICg3ICogMjQgKiA2MCAqIDYwKSwgLy8gNyBkYXlzIFRUTFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIFN0b3JlIGluIGEgbm90aWZpY2F0aW9ucyB0YWJsZSAod2UnbGwgdXNlIHRoZSBtYXRjaGVzIHRhYmxlIHdpdGggYSBzcGVjaWFsIHBhdHRlcm4pXHJcbiAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgICAgcm9vbUlkOiBgTk9USUZJQ0FUSU9OIyR7dXNlcklkfWAsIC8vIFNwZWNpYWwgcHJlZml4IGZvciBub3RpZmljYXRpb25zXHJcbiAgICAgICAgICAgIG1vdmllSWQ6IERhdGUubm93KCksIC8vIFVzZSB0aW1lc3RhbXAgYXMgc29ydCBrZXkgZm9yIHVuaXF1ZW5lc3NcclxuICAgICAgICAgICAgLi4ubm90aWZpY2F0aW9uUmVjb3JkLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBOb3RpZmljYXRpb24gc3RvcmVkIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChub3RpZmljYXRpb25Qcm9taXNlcyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfinIUgTWF0Y2ggbm90aWZpY2F0aW9ucyBzdG9yZWQgZm9yIHBvbGxpbmcgZmFsbGJhY2snKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHN0b3JpbmcgbWF0Y2ggbm90aWZpY2F0aW9uczonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIG5vdGlmeU1hdGNoQ3JlYXRlZChtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICAgICAgb3BlcmF0aW9uOiAnbWF0Y2hDcmVhdGVkJyxcclxuICAgICAgICBtYXRjaCxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlQ29tbWFuZCh7XHJcbiAgICAgICAgRnVuY3Rpb25OYW1lOiB0aGlzLm1hdGNoTGFtYmRhQXJuLFxyXG4gICAgICAgIEludm9jYXRpb25UeXBlOiAnRXZlbnQnLCAvLyBBc3luYyBpbnZvY2F0aW9uXHJcbiAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQoY29tbWFuZCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdNYXRjaCBub3RpZmljYXRpb24gc2VudCB0byBNYXRjaCBMYW1iZGEnKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBub3RpZnkgTWF0Y2ggTGFtYmRhOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG4vLyBMYW1iZGEgSGFuZGxlciBmb3IgQXBwU3luY1xyXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdWb3RlIExhbWJkYSByZWNlaXZlZCBBcHBTeW5jIGV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XHJcblxyXG4gIHRyeSB7XHJcbiAgICAvLyBFeHRyYWN0IHVzZXIgSUQgZnJvbSBBcHBTeW5jIGNvbnRleHRcclxuICAgIGNvbnN0IHVzZXJJZCA9IGV2ZW50LmlkZW50aXR5Py5jbGFpbXM/LnN1YiB8fCBldmVudC5pZGVudGl0eT8udXNlcm5hbWU7XHJcbiAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdVc2VyIG5vdCBhdXRoZW50aWNhdGVkIGZvciB2b3RlJyk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07IC8vIFJldHVybiBwcm9wZXIgVm90ZVJlc3VsdCBpbnN0ZWFkIG9mIHRocm93aW5nXHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2V0IGFyZ3VtZW50cyBmcm9tIEFwcFN5bmNcclxuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGV2ZW50LmFyZ3VtZW50cztcclxuICAgIGNvbnN0IHsgcm9vbUlkLCBtb3ZpZUlkLCB2b3RlIH0gPSBpbnB1dDtcclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCFyb29tSWQpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignUm9vbSBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSB9OyAvLyBSZXR1cm4gcHJvcGVyIFZvdGVSZXN1bHQgaW5zdGVhZCBvZiB0aHJvd2luZ1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0eXBlb2YgbW92aWVJZCAhPT0gJ251bWJlcicpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignTW92aWUgSUQgbXVzdCBiZSBhIG51bWJlcicpO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSB9OyAvLyBSZXR1cm4gcHJvcGVyIFZvdGVSZXN1bHQgaW5zdGVhZCBvZiB0aHJvd2luZ1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0eXBlb2Ygdm90ZSAhPT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1ZvdGUgbXVzdCBiZSBhIGJvb2xlYW4nKTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UgfTsgLy8gUmV0dXJuIHByb3BlciBWb3RlUmVzdWx0IGluc3RlYWQgb2YgdGhyb3dpbmdcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCB2b3RlU2VydmljZSA9IG5ldyBWb3RlU2VydmljZSgpO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2b3RlU2VydmljZS5wcm9jZXNzVm90ZSh1c2VySWQsIHJvb21JZCwgbW92aWVJZCwgdm90ZSk7XHJcbiAgICAgIHJldHVybiByZXN1bHQ7IC8vIFRoaXMgYWxyZWFkeSByZXR1cm5zIHsgc3VjY2VzczogdHJ1ZSwgbWF0Y2g/OiBNYXRjaCB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBwcm9jZXNzaW5nIHZvdGU6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSB9OyAvLyBSZXR1cm4gcHJvcGVyIFZvdGVSZXN1bHQgb24gZXJyb3JcclxuICAgIH1cclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1ZvdGUgTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07IC8vIEFsd2F5cyByZXR1cm4gcHJvcGVyIFZvdGVSZXN1bHQsIG5ldmVyIHRocm93XHJcbiAgfVxyXG59OyJdfQ==