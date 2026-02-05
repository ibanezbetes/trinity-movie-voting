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
            // Get all votes for this movie in this room (excluding participation records)
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
            }));
            const positiveVotes = votesResult.Items || [];
            console.log(`Found ${positiveVotes.length} positive votes for movie ${movieId} in room ${roomId}`);
            // Get all unique users who have voted in this room (excluding participation records)
            const allVotesResult = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.votesTable,
                KeyConditionExpression: 'roomId = :roomId',
                FilterExpression: 'movieId <> :participationMarker', // Exclude participation records
                ExpressionAttributeValues: {
                    ':roomId': roomId,
                    ':participationMarker': -1,
                },
            }));
            const allVotes = allVotesResult.Items || [];
            const uniqueUsers = new Set(allVotes.map(vote => vote.userId));
            const totalUsers = uniqueUsers.size;
            console.log(`Total unique users who have voted in room: ${totalUsers}`);
            // Check if all users voted positively for this movie
            const positiveUserIds = new Set(positiveVotes.map(vote => vote.userId));
            if (positiveUserIds.size === totalUsers && totalUsers > 1) {
                // We have a match! All users voted positively
                console.log(`MATCH DETECTED! All ${totalUsers} users voted positively for movie ${movieId}`);
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
            console.log(`No match yet. Positive votes: ${positiveUserIds.size}, Total users: ${totalUsers}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdm90ZS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQW9IO0FBQ3BILDBEQUFxRTtBQUNyRSx3REFBb0Q7QUFDcEQscURBQStDO0FBQy9DLGdGQUFvRTtBQUNwRSwwREFBcUQ7QUFFckQseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUE4RDFFLGVBQWU7QUFDZixNQUFNLFdBQVc7SUFNZjtRQUNFLElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBQ3BELElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxjQUFjLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsSUFBSSxFQUFFLENBQUM7UUFFekQsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQy9ELE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUMsQ0FB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LEdBQUcsTUFBTSxXQUFXLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO1lBQzVFLE9BQU8sTUFBTSxDQUFDLENBQUMsd0RBQXdEO1FBQ3pFLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyx3QkFBd0IsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUMvQyxPQUFPLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUMsb0NBQW9DO1FBQ2pFLENBQUM7SUFFSCxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsb0JBQW9CLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDM0MsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLCtDQUErQztJQUM1RSxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBN0NXLFFBQUEsT0FBTyxXQTZDbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUHV0Q29tbWFuZCwgUXVlcnlDb21tYW5kLCBHZXRDb21tYW5kLCBEZWxldGVDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcclxuaW1wb3J0IHsgTGFtYmRhQ2xpZW50LCBJbnZva2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSc7XHJcbmltcG9ydCB7IFNpZ25hdHVyZVY0IH0gZnJvbSAnQGF3cy1zZGsvc2lnbmF0dXJlLXY0JztcclxuaW1wb3J0IHsgU2hhMjU2IH0gZnJvbSAnQGF3cy1jcnlwdG8vc2hhMjU2LWpzJztcclxuaW1wb3J0IHsgZGVmYXVsdFByb3ZpZGVyIH0gZnJvbSAnQGF3cy1zZGsvY3JlZGVudGlhbC1wcm92aWRlci1ub2RlJztcclxuaW1wb3J0IHsgSHR0cFJlcXVlc3QgfSBmcm9tICdAYXdzLXNkay9wcm90b2NvbC1odHRwJztcclxuXHJcbi8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcclxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KTtcclxuY29uc3QgbGFtYmRhQ2xpZW50ID0gbmV3IExhbWJkYUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuXHJcbi8vIFR5cGVzXHJcbmludGVyZmFjZSBWb3RlIHtcclxuICByb29tSWQ6IHN0cmluZztcclxuICB1c2VyTW92aWVJZDogc3RyaW5nOyAvLyBGb3JtYXQ6IFwidXNlcklkI21vdmllSWRcIlxyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIG1vdmllSWQ6IG51bWJlcjtcclxuICB2b3RlOiBib29sZWFuO1xyXG4gIHRpbWVzdGFtcDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTWF0Y2gge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgbW92aWVJZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aD86IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIG1hdGNoZWRVc2Vyczogc3RyaW5nW107XHJcbiAgdGltZXN0YW1wOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBSb29tIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIGNvZGU6IHN0cmluZztcclxuICBob3N0SWQ6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIGdlbnJlSWRzOiBudW1iZXJbXTtcclxuICBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdO1xyXG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xyXG4gIHR0bDogbnVtYmVyO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTW92aWVDYW5kaWRhdGUge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg6IHN0cmluZyB8IG51bGw7XHJcbiAgcmVsZWFzZURhdGU6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVm90ZUV2ZW50IHtcclxuICBvcGVyYXRpb246ICd2b3RlJztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICBpbnB1dDoge1xyXG4gICAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgICB2b3RlOiBib29sZWFuO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBWb3RlUmVzcG9uc2Uge1xyXG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcclxuICBib2R5OiB7XHJcbiAgICBzdWNjZXNzOiBib29sZWFuO1xyXG4gICAgbWF0Y2g/OiBNYXRjaDtcclxuICAgIGVycm9yPzogc3RyaW5nO1xyXG4gIH07XHJcbn1cclxuXHJcbi8vIFZvdGUgU2VydmljZVxyXG5jbGFzcyBWb3RlU2VydmljZSB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB2b3Rlc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBtYXRjaGVzVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHJvb21zVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IG1hdGNoTGFtYmRhQXJuOiBzdHJpbmc7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy52b3Rlc1RhYmxlID0gcHJvY2Vzcy5lbnYuVk9URVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLm1hdGNoZXNUYWJsZSA9IHByb2Nlc3MuZW52Lk1BVENIRVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLnJvb21zVGFibGUgPSBwcm9jZXNzLmVudi5ST09NU19UQUJMRSB8fCAnJztcclxuICAgIHRoaXMubWF0Y2hMYW1iZGFBcm4gPSBwcm9jZXNzLmVudi5NQVRDSF9MQU1CREFfQVJOIHx8ICcnO1xyXG5cclxuICAgIGlmICghdGhpcy52b3Rlc1RhYmxlIHx8ICF0aGlzLm1hdGNoZXNUYWJsZSB8fCAhdGhpcy5yb29tc1RhYmxlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVxdWlyZWQgdGFibGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGFyZSBtaXNzaW5nJyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBwcm9jZXNzVm90ZSh1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgdm90ZTogYm9vbGVhbik6IFByb21pc2U8eyBzdWNjZXNzOiBib29sZWFuOyBtYXRjaD86IE1hdGNoIH0+IHtcclxuICAgIC8vIFZhbGlkYXRlIHJvb20gZXhpc3RzIGFuZCBnZXQgcm9vbSBkZXRhaWxzXHJcbiAgICBjb25zdCByb29tID0gYXdhaXQgdGhpcy5nZXRSb29tKHJvb21JZCk7XHJcbiAgICBpZiAoIXJvb20pIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZCBvciBoYXMgZXhwaXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEJhc2ljIHJvb20gbWVtYmVyc2hpcCB2YWxpZGF0aW9uIC0gY2hlY2sgaWYgdXNlciBoYXMgYWNjZXNzIHRvIHRoaXMgcm9vbVxyXG4gICAgLy8gRm9yIG5vdywgd2UgYWxsb3cgYW55IGF1dGhlbnRpY2F0ZWQgdXNlciB0byB2b3RlIGluIGFueSBhY3RpdmUgcm9vbVxyXG4gICAgLy8gVE9ETzogSW1wbGVtZW50IHByb3BlciByb29tIG1lbWJlcnNoaXAgdmFsaWRhdGlvbiBpbiBUYXNrIDJcclxuICAgIGNvbnN0IGhhc1Jvb21BY2Nlc3MgPSBhd2FpdCB0aGlzLnZhbGlkYXRlUm9vbUFjY2Vzcyh1c2VySWQsIHJvb21JZCwgcm9vbSk7XHJcbiAgICBpZiAoIWhhc1Jvb21BY2Nlc3MpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIGRvZXMgbm90IGhhdmUgYWNjZXNzIHRvIHRoaXMgcm9vbScpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFZhbGlkYXRlIG1vdmllIGlzIGluIHJvb20gY2FuZGlkYXRlc1xyXG4gICAgY29uc3QgbW92aWVDYW5kaWRhdGUgPSByb29tLmNhbmRpZGF0ZXMuZmluZChjID0+IGMuaWQgPT09IG1vdmllSWQpO1xyXG4gICAgaWYgKCFtb3ZpZUNhbmRpZGF0ZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ01vdmllIG5vdCBmb3VuZCBpbiByb29tIGNhbmRpZGF0ZXMnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSZWNvcmQgdGhlIHZvdGVcclxuICAgIGF3YWl0IHRoaXMucmVjb3JkVm90ZSh1c2VySWQsIHJvb21JZCwgbW92aWVJZCwgdm90ZSk7XHJcblxyXG4gICAgLy8gQ2hlY2sgZm9yIG1hdGNoIGlmIHZvdGUgaXMgcG9zaXRpdmVcclxuICAgIGxldCBtYXRjaDogTWF0Y2ggfCB1bmRlZmluZWQ7XHJcbiAgICBpZiAodm90ZSkge1xyXG4gICAgICBtYXRjaCA9IGF3YWl0IHRoaXMuY2hlY2tGb3JNYXRjaChyb29tSWQsIG1vdmllSWQsIG1vdmllQ2FuZGlkYXRlKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBtYXRjaCB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyB2YWxpZGF0ZVJvb21BY2Nlc3ModXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nLCByb29tOiBSb29tKTogUHJvbWlzZTxib29sZWFuPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBCYXNpYyB2YWxpZGF0aW9uOiBjaGVjayBpZiB1c2VyIGlzIHRoZSByb29tIGhvc3Qgb3IgaGFzIHByZXZpb3VzbHkgdm90ZWQgaW4gdGhpcyByb29tXHJcbiAgICAgIGlmIChyb29tLmhvc3RJZCA9PT0gdXNlcklkKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGlzIHRoZSBob3N0IG9mIHJvb20gJHtyb29tSWR9IC0gYWNjZXNzIGdyYW50ZWRgKTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgdXNlciBoYXMgcHJldmlvdXNseSBwYXJ0aWNpcGF0ZWQgaW4gdGhpcyByb29tXHJcbiAgICAgIGNvbnN0IHVzZXJWb3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAndXNlcklkID0gOnVzZXJJZCcsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIExpbWl0OiAxLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBpZiAodXNlclZvdGVzUmVzdWx0Lkl0ZW1zICYmIHVzZXJWb3Rlc1Jlc3VsdC5JdGVtcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGhhcyBwcmV2aW91c2x5IHZvdGVkIGluIHJvb20gJHtyb29tSWR9IC0gYWNjZXNzIGdyYW50ZWRgKTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gRm9yIE1WUDogQWxsb3cgYW55IGF1dGhlbnRpY2F0ZWQgdXNlciB0byBqb2luIGFueSBhY3RpdmUgcm9vbVxyXG4gICAgICAvLyBUT0RPOiBJbXBsZW1lbnQgcHJvcGVyIHJvb20gbWVtYmVyc2hpcCB2YWxpZGF0aW9uIHdpdGggRHluYW1vREIgdGFibGUgaW4gVGFzayAyXHJcbiAgICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSBncmFudGVkIGFjY2VzcyB0byByb29tICR7cm9vbUlkfSAoTVZQIG1vZGUgLSBhbGwgdXNlcnMgYWxsb3dlZClgKTtcclxuICAgICAgcmV0dXJuIHRydWU7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgdmFsaWRhdGluZyByb29tIGFjY2VzcyBmb3IgdXNlciAke3VzZXJJZH0gaW4gcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICAvLyBPbiBlcnJvciwgYWxsb3cgYWNjZXNzIGZvciBub3cgKGZhaWwgb3BlbiBmb3IgTVZQKVxyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZ2V0Um9vbShyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8Um9vbSB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMucm9vbXNUYWJsZSxcclxuICAgICAgICBLZXk6IHsgaWQ6IHJvb21JZCB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBpZiAoIXJlc3VsdC5JdGVtKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJvb20gPSByZXN1bHQuSXRlbSBhcyBSb29tO1xyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgcm9vbSBoYXMgZXhwaXJlZFxyXG4gICAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgICAgaWYgKHJvb20udHRsICYmIHJvb20udHRsIDwgbm93KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHJldHVybiByb29tO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2V0dGluZyByb29tOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlY29yZFZvdGUodXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIsIHZvdGU6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHVzZXJNb3ZpZUlkID0gYCR7dXNlcklkfSMke21vdmllSWR9YDtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuXHJcbiAgICBjb25zdCB2b3RlUmVjb3JkOiBWb3RlID0ge1xyXG4gICAgICByb29tSWQsXHJcbiAgICAgIHVzZXJNb3ZpZUlkLFxyXG4gICAgICB1c2VySWQsXHJcbiAgICAgIG1vdmllSWQsXHJcbiAgICAgIHZvdGUsXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgIH07XHJcblxyXG4gICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgSXRlbTogdm90ZVJlY29yZCxcclxuICAgICAgLy8gQWxsb3cgb3ZlcndyaXRpbmcgcHJldmlvdXMgdm90ZXMgZm9yIHRoZSBzYW1lIHVzZXIvbW92aWUgY29tYmluYXRpb25cclxuICAgIH0pKTtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgVm90ZSByZWNvcmRlZDogVXNlciAke3VzZXJJZH0gdm90ZWQgJHt2b3RlID8gJ1lFUycgOiAnTk8nfSBmb3IgbW92aWUgJHttb3ZpZUlkfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBjaGVja0Zvck1hdGNoKHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIsIG1vdmllQ2FuZGlkYXRlOiBNb3ZpZUNhbmRpZGF0ZSk6IFByb21pc2U8TWF0Y2ggfCB1bmRlZmluZWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIEdldCBhbGwgdm90ZXMgZm9yIHRoaXMgbW92aWUgaW4gdGhpcyByb29tIChleGNsdWRpbmcgcGFydGljaXBhdGlvbiByZWNvcmRzKVxyXG4gICAgICBjb25zdCB2b3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnbW92aWVJZCA9IDptb3ZpZUlkIEFORCB2b3RlID0gOnZvdGUgQU5EIG1vdmllSWQgPD4gOnBhcnRpY2lwYXRpb25NYXJrZXInLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzptb3ZpZUlkJzogbW92aWVJZCxcclxuICAgICAgICAgICc6dm90ZSc6IHRydWUsIC8vIE9ubHkgcG9zaXRpdmUgdm90ZXNcclxuICAgICAgICAgICc6cGFydGljaXBhdGlvbk1hcmtlcic6IC0xLCAvLyBFeGNsdWRlIHBhcnRpY2lwYXRpb24gcmVjb3Jkc1xyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IHBvc2l0aXZlVm90ZXMgPSB2b3Rlc1Jlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7cG9zaXRpdmVWb3Rlcy5sZW5ndGh9IHBvc2l0aXZlIHZvdGVzIGZvciBtb3ZpZSAke21vdmllSWR9IGluIHJvb20gJHtyb29tSWR9YCk7XHJcblxyXG4gICAgICAvLyBHZXQgYWxsIHVuaXF1ZSB1c2VycyB3aG8gaGF2ZSB2b3RlZCBpbiB0aGlzIHJvb20gKGV4Y2x1ZGluZyBwYXJ0aWNpcGF0aW9uIHJlY29yZHMpXHJcbiAgICAgIGNvbnN0IGFsbFZvdGVzUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdtb3ZpZUlkIDw+IDpwYXJ0aWNpcGF0aW9uTWFya2VyJywgLy8gRXhjbHVkZSBwYXJ0aWNpcGF0aW9uIHJlY29yZHNcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICAgICc6cGFydGljaXBhdGlvbk1hcmtlcic6IC0xLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IGFsbFZvdGVzID0gYWxsVm90ZXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIGNvbnN0IHVuaXF1ZVVzZXJzID0gbmV3IFNldChhbGxWb3Rlcy5tYXAodm90ZSA9PiAodm90ZSBhcyBWb3RlKS51c2VySWQpKTtcclxuICAgICAgY29uc3QgdG90YWxVc2VycyA9IHVuaXF1ZVVzZXJzLnNpemU7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgVG90YWwgdW5pcXVlIHVzZXJzIHdobyBoYXZlIHZvdGVkIGluIHJvb206ICR7dG90YWxVc2Vyc31gKTtcclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIGFsbCB1c2VycyB2b3RlZCBwb3NpdGl2ZWx5IGZvciB0aGlzIG1vdmllXHJcbiAgICAgIGNvbnN0IHBvc2l0aXZlVXNlcklkcyA9IG5ldyBTZXQocG9zaXRpdmVWb3Rlcy5tYXAodm90ZSA9PiAodm90ZSBhcyBWb3RlKS51c2VySWQpKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChwb3NpdGl2ZVVzZXJJZHMuc2l6ZSA9PT0gdG90YWxVc2VycyAmJiB0b3RhbFVzZXJzID4gMSkge1xyXG4gICAgICAgIC8vIFdlIGhhdmUgYSBtYXRjaCEgQWxsIHVzZXJzIHZvdGVkIHBvc2l0aXZlbHlcclxuICAgICAgICBjb25zb2xlLmxvZyhgTUFUQ0ggREVURUNURUQhIEFsbCAke3RvdGFsVXNlcnN9IHVzZXJzIHZvdGVkIHBvc2l0aXZlbHkgZm9yIG1vdmllICR7bW92aWVJZH1gKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBpZiBtYXRjaCBhbHJlYWR5IGV4aXN0c1xyXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nTWF0Y2ggPSBhd2FpdCB0aGlzLmdldEV4aXN0aW5nTWF0Y2gocm9vbUlkLCBtb3ZpZUlkKTtcclxuICAgICAgICBpZiAoZXhpc3RpbmdNYXRjaCkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coJ01hdGNoIGFscmVhZHkgZXhpc3RzLCByZXR1cm5pbmcgZXhpc3RpbmcgbWF0Y2gnKTtcclxuICAgICAgICAgIHJldHVybiBleGlzdGluZ01hdGNoO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIG5ldyBtYXRjaFxyXG4gICAgICAgIGNvbnN0IG1hdGNoID0gYXdhaXQgdGhpcy5jcmVhdGVNYXRjaChyb29tSWQsIG1vdmllSWQsIG1vdmllQ2FuZGlkYXRlLCBBcnJheS5mcm9tKHBvc2l0aXZlVXNlcklkcykpO1xyXG4gICAgICAgIHJldHVybiBtYXRjaDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc29sZS5sb2coYE5vIG1hdGNoIHlldC4gUG9zaXRpdmUgdm90ZXM6ICR7cG9zaXRpdmVVc2VySWRzLnNpemV9LCBUb3RhbCB1c2VyczogJHt0b3RhbFVzZXJzfWApO1xyXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGZvciBtYXRjaDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldEV4aXN0aW5nTWF0Y2gocm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlcik6IFByb21pc2U8TWF0Y2ggfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBLZXk6IHtcclxuICAgICAgICAgIHJvb21JZCxcclxuICAgICAgICAgIG1vdmllSWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgcmV0dXJuIHJlc3VsdC5JdGVtIGFzIE1hdGNoIHx8IG51bGw7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyBleGlzdGluZyBtYXRjaDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBjcmVhdGVNYXRjaChyb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCBtb3ZpZUNhbmRpZGF0ZTogTW92aWVDYW5kaWRhdGUsIG1hdGNoZWRVc2Vyczogc3RyaW5nW10pOiBQcm9taXNlPE1hdGNoPiB7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICBjb25zdCBtYXRjaElkID0gYCR7cm9vbUlkfSMke21vdmllSWR9YDtcclxuXHJcbiAgICBjb25zdCBtYXRjaDogTWF0Y2ggPSB7XHJcbiAgICAgIGlkOiBtYXRjaElkLFxyXG4gICAgICByb29tSWQsXHJcbiAgICAgIG1vdmllSWQsXHJcbiAgICAgIHRpdGxlOiBtb3ZpZUNhbmRpZGF0ZS50aXRsZSxcclxuICAgICAgcG9zdGVyUGF0aDogbW92aWVDYW5kaWRhdGUucG9zdGVyUGF0aCB8fCB1bmRlZmluZWQsXHJcbiAgICAgIG1lZGlhVHlwZTogbW92aWVDYW5kaWRhdGUubWVkaWFUeXBlLFxyXG4gICAgICBtYXRjaGVkVXNlcnMsXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgIH07XHJcblxyXG4gICAgLy8gU3RvcmUgT05MWSB0aGUgbWFpbiBtYXRjaCByZWNvcmQgLSBubyBkdXBsaWNhdGVzIHBlciB1c2VyXHJcbiAgICAvLyBUaGUgbWF0Y2ggaGFuZGxlciB3aWxsIGZpbHRlciBieSBtYXRjaGVkVXNlcnMgYXJyYXkgd2hlbiBxdWVyeWluZ1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgSXRlbTogbWF0Y2gsXHJcbiAgICAgICAgQ29uZGl0aW9uRXhwcmVzc2lvbjogJ2F0dHJpYnV0ZV9ub3RfZXhpc3RzKHJvb21JZCkgQU5EIGF0dHJpYnV0ZV9ub3RfZXhpc3RzKG1vdmllSWQpJywgLy8gUHJldmVudCBkdXBsaWNhdGVzXHJcbiAgICAgIH0pKTtcclxuICAgICAgY29uc29sZS5sb2coYOKchSBNYXRjaCBjcmVhdGVkOiAke21hdGNoLnRpdGxlfSBmb3IgJHttYXRjaGVkVXNlcnMubGVuZ3RofSB1c2Vyc2ApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc3QgZXJyID0gZXJyb3IgYXMgYW55O1xyXG4gICAgICBpZiAoZXJyLm5hbWUgPT09ICdDb25kaXRpb25hbENoZWNrRmFpbGVkRXhjZXB0aW9uJykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBNYXRjaCBhbHJlYWR5IGV4aXN0cyBmb3Igcm9vbSAke3Jvb21JZH0gYW5kIG1vdmllICR7bW92aWVJZH1gKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjcmVhdGluZyBtYXRjaDonLCBlcnJvcik7XHJcbiAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBDUklUSUNBTDogVHJpZ2dlciBBcHBTeW5jIHN1YnNjcmlwdGlvbiBGSVJTVCBiZWZvcmUgYW55IGNsZWFudXBcclxuICAgIC8vIFRoaXMgZW5zdXJlcyBhbGwgdXNlcnMgZ2V0IG5vdGlmaWVkIGJlZm9yZSBhbnkgY2hhbmdlc1xyXG4gICAgYXdhaXQgdGhpcy50cmlnZ2VyQXBwU3luY1N1YnNjcmlwdGlvbihtYXRjaCk7XHJcblxyXG4gICAgLy8gV2FpdCBhIG1vbWVudCB0byBlbnN1cmUgbm90aWZpY2F0aW9ucyBhcmUgc2VudFxyXG4gICAgLy8gVGhpcyBwcmV2ZW50cyBcIlJvb20gbm90IGZvdW5kXCIgZXJyb3JzIGZvciBjb25jdXJyZW50IHZvdGVzXHJcbiAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMjAwMCkpOyAvLyAyIHNlY29uZCBkZWxheVxyXG5cclxuICAgIC8vIERJU0FCTEVEOiBEbyBub3QgZGVsZXRlIHJvb20gYWZ0ZXIgbWF0Y2ggLSBsZXQgaXQgcmVtYWluIGFjdGl2ZVxyXG4gICAgLy8gVGhpcyBwcmV2ZW50cyBcIlJvb20gbm90IGZvdW5kXCIgZXJyb3JzIGZvciB1c2VycyB3aG8gdm90ZSBhZnRlciBtYXRjaCBpcyBjcmVhdGVkXHJcbiAgICAvLyBhd2FpdCB0aGlzLmRlbGV0ZVJvb20ocm9vbUlkKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coYE1hdGNoIGNyZWF0ZWQgYnV0IHJvb20gJHtyb29tSWR9IGtlcHQgYWN0aXZlIHRvIHByZXZlbnQgXCJSb29tIG5vdCBmb3VuZFwiIGVycm9yc2ApO1xyXG5cclxuICAgIHJldHVybiBtYXRjaDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZGVsZXRlUm9vbShyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gRGVsZXRlIHRoZSByb29tIGZyb20gRHluYW1vREJcclxuICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IERlbGV0ZUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5yb29tc1RhYmxlLFxyXG4gICAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBSb29tICR7cm9vbUlkfSBkZWxldGVkIGFmdGVyIG1hdGNoIGNyZWF0aW9uYCk7XHJcblxyXG4gICAgICAvLyBPcHRpb25hbGx5OiBEZWxldGUgYWxsIHZvdGVzIGZvciB0aGlzIHJvb20gdG8gZnJlZSB1cCBzcGFjZVxyXG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZVJvb21Wb3Rlcyhyb29tSWQpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZGVsZXRpbmcgcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICAvLyBEb24ndCBmYWlsIHRoZSBtYXRjaCBjcmVhdGlvbiBpZiByb29tIGRlbGV0aW9uIGZhaWxzXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGRlbGV0ZVJvb21Wb3Rlcyhyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gR2V0IGFsbCB2b3RlcyBhbmQgcGFydGljaXBhdGlvbiByZWNvcmRzIGZvciB0aGlzIHJvb21cclxuICAgICAgY29uc3Qgdm90ZXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgYWxsUmVjb3JkcyA9IHZvdGVzUmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICBcclxuICAgICAgLy8gRGVsZXRlIGFsbCByZWNvcmRzICh2b3RlcyBhbmQgcGFydGljaXBhdGlvbikgaW4gYmF0Y2hlc1xyXG4gICAgICBjb25zdCBkZWxldGVQcm9taXNlcyA9IGFsbFJlY29yZHMubWFwKHJlY29yZCA9PiBcclxuICAgICAgICBkb2NDbGllbnQuc2VuZChuZXcgRGVsZXRlQ29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICAgIEtleToge1xyXG4gICAgICAgICAgICByb29tSWQ6IHJlY29yZC5yb29tSWQsXHJcbiAgICAgICAgICAgIHVzZXJNb3ZpZUlkOiByZWNvcmQudXNlck1vdmllSWQsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pKVxyXG4gICAgICApO1xyXG5cclxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKGRlbGV0ZVByb21pc2VzKTtcclxuICAgICAgY29uc29sZS5sb2coYERlbGV0ZWQgJHthbGxSZWNvcmRzLmxlbmd0aH0gcmVjb3JkcyAodm90ZXMgYW5kIHBhcnRpY2lwYXRpb24pIGZvciByb29tICR7cm9vbUlkfWApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZGVsZXRpbmcgcmVjb3JkcyBmb3Igcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyB0cmlnZ2VyQXBwU3luY1N1YnNjcmlwdGlvbihtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnNvbGUubG9nKGDwn5SUIElOSUNJQU5ETyBCUk9BRENBU1QgSU5ESVZJRFVBTCBwYXJhIGNhZGEgdXN1YXJpbyBlbiBzYWxhOiAke21hdGNoLnJvb21JZH1gKTtcclxuICAgIGNvbnNvbGUubG9nKGDwn5GlIFVzdWFyaW9zIGEgbm90aWZpY2FyOiAke21hdGNoLm1hdGNoZWRVc2Vycy5qb2luKCcsICcpfWApO1xyXG4gICAgXHJcbiAgICBjb25zdCBlbmRwb2ludCA9IHByb2Nlc3MuZW52LkdSQVBIUUxfRU5EUE9JTlQ7XHJcbiAgICBpZiAoIWVuZHBvaW50KSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGQVRBTDogR1JBUEhRTF9FTkRQT0lOVCBubyBlc3TDoSBkZWZpbmlkbycpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTlVFVkEgRVNUUkFURUdJQTogRW52aWFyIG5vdGlmaWNhY2nDs24gaW5kaXZpZHVhbCBhIGNhZGEgdXN1YXJpb1xyXG4gICAgLy8gRXN0byBhc2VndXJhIHF1ZSBUT0RPUyBsb3MgdXN1YXJpb3MgcXVlIHBhcnRpY2lwYXJvbiBlbiBlbCBtYXRjaCByZWNpYmFuIGxhIG5vdGlmaWNhY2nDs25cclxuICAgIGNvbnN0IG5vdGlmaWNhdGlvblByb21pc2VzID0gbWF0Y2gubWF0Y2hlZFVzZXJzLm1hcChhc3luYyAodXNlcklkKSA9PiB7XHJcbiAgICAgIGF3YWl0IHRoaXMuc2VuZEluZGl2aWR1YWxVc2VyTm90aWZpY2F0aW9uKHVzZXJJZCwgbWF0Y2gsIGVuZHBvaW50KTtcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEVudmlhciB0b2RhcyBsYXMgbm90aWZpY2FjaW9uZXMgZW4gcGFyYWxlbG9cclxuICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQobm90aWZpY2F0aW9uUHJvbWlzZXMpO1xyXG4gICAgXHJcbiAgICAvLyBMb2cgcmVzdWx0YWRvc1xyXG4gICAgcmVzdWx0cy5mb3JFYWNoKChyZXN1bHQsIGluZGV4KSA9PiB7XHJcbiAgICAgIGNvbnN0IHVzZXJJZCA9IG1hdGNoLm1hdGNoZWRVc2Vyc1tpbmRleF07XHJcbiAgICAgIGlmIChyZXN1bHQuc3RhdHVzID09PSAnZnVsZmlsbGVkJykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDinIUgTm90aWZpY2FjacOzbiBlbnZpYWRhIGV4aXRvc2FtZW50ZSBhIHVzdWFyaW86ICR7dXNlcklkfWApO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBFcnJvciBlbnZpYW5kbyBub3RpZmljYWNpw7NuIGEgdXN1YXJpbyAke3VzZXJJZH06YCwgcmVzdWx0LnJlYXNvbik7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFRhbWJpw6luIGVudmlhciBsYSBub3RpZmljYWNpw7NuIGdlbmVyYWwgZGUgbGEgc2FsYSAocGFyYSBjb21wYXRpYmlsaWRhZClcclxuICAgIGF3YWl0IHRoaXMuc2VuZFJvb21Ob3RpZmljYXRpb24obWF0Y2gsIGVuZHBvaW50KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc2VuZEluZGl2aWR1YWxVc2VyTm90aWZpY2F0aW9uKHVzZXJJZDogc3RyaW5nLCBtYXRjaDogTWF0Y2gsIGVuZHBvaW50OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnNvbGUubG9nKGDwn5OkIEVudmlhbmRvIG5vdGlmaWNhY2nDs24gaW5kaXZpZHVhbCBhIHVzdWFyaW86ICR7dXNlcklkfWApO1xyXG4gICAgXHJcbiAgICAvLyBNdXRhY2nDs24gZXNwZWPDrWZpY2EgcGFyYSBub3RpZmljYXIgYSB1biB1c3VhcmlvIGluZGl2aWR1YWxcclxuICAgIGNvbnN0IG11dGF0aW9uID0gYFxyXG4gICAgICBtdXRhdGlvbiBQdWJsaXNoVXNlck1hdGNoKCR1c2VySWQ6IElEISwgJG1hdGNoRGF0YTogUm9vbU1hdGNoSW5wdXQhKSB7XHJcbiAgICAgICAgcHVibGlzaFVzZXJNYXRjaCh1c2VySWQ6ICR1c2VySWQsIG1hdGNoRGF0YTogJG1hdGNoRGF0YSkge1xyXG4gICAgICAgICAgcm9vbUlkXHJcbiAgICAgICAgICBtYXRjaElkXHJcbiAgICAgICAgICBtb3ZpZUlkXHJcbiAgICAgICAgICBtYXRjaGVkVXNlcnNcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIGA7XHJcblxyXG4gICAgY29uc3QgdmFyaWFibGVzID0ge1xyXG4gICAgICB1c2VySWQ6IHVzZXJJZCxcclxuICAgICAgbWF0Y2hEYXRhOiB7XHJcbiAgICAgICAgbWF0Y2hJZDogbWF0Y2guaWQsXHJcbiAgICAgICAgbW92aWVJZDogbWF0Y2gubW92aWVJZCxcclxuICAgICAgICBtb3ZpZVRpdGxlOiBtYXRjaC50aXRsZSxcclxuICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaC5wb3N0ZXJQYXRoLFxyXG4gICAgICAgIG1hdGNoZWRVc2VyczogbWF0Y2gubWF0Y2hlZFVzZXJzLFxyXG4gICAgICAgIHJvb21JZDogbWF0Y2gucm9vbUlkLCAvLyBJbmNsdWlyIHJvb21JZCBlbiBsb3MgZGF0b3NcclxuICAgICAgICB0aW1lc3RhbXA6IG1hdGNoLnRpbWVzdGFtcCxcclxuICAgICAgICBtYXRjaERldGFpbHM6IHtcclxuICAgICAgICAgIHZvdGVDb3VudDogbWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aCxcclxuICAgICAgICAgIHJlcXVpcmVkVm90ZXM6IG1hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGgsXHJcbiAgICAgICAgICBtYXRjaFR5cGU6ICd1bmFuaW1vdXMnXHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwoZW5kcG9pbnQpO1xyXG4gICAgICBjb25zdCByZXF1ZXN0ID0gbmV3IEh0dHBSZXF1ZXN0KHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICAgaG9zdDogdXJsLmhvc3RuYW1lLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaG9zdG5hbWU6IHVybC5ob3N0bmFtZSxcclxuICAgICAgICBwYXRoOiAnL2dyYXBocWwnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgcXVlcnk6IG11dGF0aW9uLCB2YXJpYWJsZXMgfSksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3Qgc2lnbmVyID0gbmV3IFNpZ25hdHVyZVY0KHtcclxuICAgICAgICBjcmVkZW50aWFsczogZGVmYXVsdFByb3ZpZGVyKCksXHJcbiAgICAgICAgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnLFxyXG4gICAgICAgIHNlcnZpY2U6ICdhcHBzeW5jJyxcclxuICAgICAgICBzaGEyNTY6IFNoYTI1NixcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBzaWduZWRSZXF1ZXN0ID0gYXdhaXQgc2lnbmVyLnNpZ24ocmVxdWVzdCk7XHJcblxyXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGVuZHBvaW50LCB7XHJcbiAgICAgICAgbWV0aG9kOiBzaWduZWRSZXF1ZXN0Lm1ldGhvZCxcclxuICAgICAgICBoZWFkZXJzOiBzaWduZWRSZXF1ZXN0LmhlYWRlcnMgYXMgYW55LFxyXG4gICAgICAgIGJvZHk6IHNpZ25lZFJlcXVlc3QuYm9keSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXNwb25zZS5qc29uKCkgYXMgeyBkYXRhPzogYW55OyBlcnJvcnM/OiBhbnlbXSB9O1xyXG4gICAgICBcclxuICAgICAgaWYgKHJlc3VsdC5lcnJvcnMpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgRXJyb3Igbm90aWZpY2FuZG8gdXN1YXJpbyAke3VzZXJJZH06YCwgSlNPTi5zdHJpbmdpZnkocmVzdWx0LmVycm9ycykpO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXBwU3luYyBlcnJvciBmb3IgdXNlciAke3VzZXJJZH06ICR7cmVzdWx0LmVycm9yc1swXT8ubWVzc2FnZX1gKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIFVzdWFyaW8gJHt1c2VySWR9IG5vdGlmaWNhZG8gZXhpdG9zYW1lbnRlYCk7XHJcbiAgICAgIH1cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBFcnJvciBlbnZpYW5kbyBub3RpZmljYWNpw7NuIGEgdXN1YXJpbyAke3VzZXJJZH06YCwgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc2VuZFJvb21Ob3RpZmljYXRpb24obWF0Y2g6IE1hdGNoLCBlbmRwb2ludDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+TpCBFbnZpYW5kbyBub3RpZmljYWNpw7NuIGdlbmVyYWwgZGUgc2FsYTogJHttYXRjaC5yb29tSWR9YCk7XHJcbiAgICBcclxuICAgIC8vIE1hbnRlbmVyIGxhIG5vdGlmaWNhY2nDs24gZ2VuZXJhbCBkZSBzYWxhIHBhcmEgY29tcGF0aWJpbGlkYWRcclxuICAgIGNvbnN0IG11dGF0aW9uID0gYFxyXG4gICAgICBtdXRhdGlvbiBQdWJsaXNoUm9vbU1hdGNoKCRyb29tSWQ6IElEISwgJG1hdGNoRGF0YTogUm9vbU1hdGNoSW5wdXQhKSB7XHJcbiAgICAgICAgcHVibGlzaFJvb21NYXRjaChyb29tSWQ6ICRyb29tSWQsIG1hdGNoRGF0YTogJG1hdGNoRGF0YSkge1xyXG4gICAgICAgICAgcm9vbUlkXHJcbiAgICAgICAgICBtYXRjaElkXHJcbiAgICAgICAgICBtb3ZpZUlkXHJcbiAgICAgICAgICBtYXRjaGVkVXNlcnNcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIGA7XHJcblxyXG4gICAgY29uc3QgdmFyaWFibGVzID0ge1xyXG4gICAgICByb29tSWQ6IG1hdGNoLnJvb21JZCxcclxuICAgICAgbWF0Y2hEYXRhOiB7XHJcbiAgICAgICAgbWF0Y2hJZDogbWF0Y2guaWQsXHJcbiAgICAgICAgbW92aWVJZDogbWF0Y2gubW92aWVJZCxcclxuICAgICAgICBtb3ZpZVRpdGxlOiBtYXRjaC50aXRsZSxcclxuICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaC5wb3N0ZXJQYXRoLFxyXG4gICAgICAgIG1hdGNoZWRVc2VyczogbWF0Y2gubWF0Y2hlZFVzZXJzLFxyXG4gICAgICAgIG1hdGNoRGV0YWlsczoge1xyXG4gICAgICAgICAgdm90ZUNvdW50OiBtYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RoLFxyXG4gICAgICAgICAgcmVxdWlyZWRWb3RlczogbWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aCxcclxuICAgICAgICAgIG1hdGNoVHlwZTogJ3VuYW5pbW91cydcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChlbmRwb2ludCk7XHJcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgSHR0cFJlcXVlc3Qoe1xyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICBob3N0OiB1cmwuaG9zdG5hbWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBob3N0bmFtZTogdXJsLmhvc3RuYW1lLFxyXG4gICAgICAgIHBhdGg6ICcvZ3JhcGhxbCcsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBxdWVyeTogbXV0YXRpb24sIHZhcmlhYmxlcyB9KSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBzaWduZXIgPSBuZXcgU2lnbmF0dXJlVjQoe1xyXG4gICAgICAgIGNyZWRlbnRpYWxzOiBkZWZhdWx0UHJvdmlkZXIoKSxcclxuICAgICAgICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScsXHJcbiAgICAgICAgc2VydmljZTogJ2FwcHN5bmMnLFxyXG4gICAgICAgIHNoYTI1NjogU2hhMjU2LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHNpZ25lZFJlcXVlc3QgPSBhd2FpdCBzaWduZXIuc2lnbihyZXF1ZXN0KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goZW5kcG9pbnQsIHtcclxuICAgICAgICBtZXRob2Q6IHNpZ25lZFJlcXVlc3QubWV0aG9kLFxyXG4gICAgICAgIGhlYWRlcnM6IHNpZ25lZFJlcXVlc3QuaGVhZGVycyBhcyBhbnksXHJcbiAgICAgICAgYm9keTogc2lnbmVkUmVxdWVzdC5ib2R5LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKSBhcyB7IGRhdGE/OiBhbnk7IGVycm9ycz86IGFueVtdIH07XHJcbiAgICAgIFxyXG4gICAgICBpZiAocmVzdWx0LmVycm9ycykge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBlbiBub3RpZmljYWNpw7NuIGRlIHNhbGE6JywgSlNPTi5zdHJpbmdpZnkocmVzdWx0LmVycm9ycykpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgTm90aWZpY2FjacOzbiBnZW5lcmFsIGRlIHNhbGEgZW52aWFkYSBleGl0b3NhbWVudGUnKTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGVudmlhbmRvIG5vdGlmaWNhY2nDs24gZ2VuZXJhbCBkZSBzYWxhOicsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZmFsbGJhY2tUb0NyZWF0ZU1hdGNoKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coJ/CflIQgVXNpbmcgZmFsbGJhY2sgY3JlYXRlTWF0Y2ggbWV0aG9kLi4uJyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBGQUxMQkFDSzogVXNlIHRoZSBvbGQgY3JlYXRlTWF0Y2ggbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XHJcbiAgICAgIGlmICh0aGlzLm1hdGNoTGFtYmRhQXJuKSB7XHJcbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZU1hdGNoJyxcclxuICAgICAgICAgIGlucHV0OiB7XHJcbiAgICAgICAgICAgIHJvb21JZDogbWF0Y2gucm9vbUlkLFxyXG4gICAgICAgICAgICBtb3ZpZUlkOiBtYXRjaC5tb3ZpZUlkLFxyXG4gICAgICAgICAgICB0aXRsZTogbWF0Y2gudGl0bGUsXHJcbiAgICAgICAgICAgIHBvc3RlclBhdGg6IG1hdGNoLnBvc3RlclBhdGgsXHJcbiAgICAgICAgICAgIG1hdGNoZWRVc2VyczogbWF0Y2gubWF0Y2hlZFVzZXJzLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjb25zb2xlLmxvZygn8J+agCBJbnZva2luZyBNYXRjaCBMYW1iZGEgd2l0aCBjcmVhdGVNYXRjaCAoZmFsbGJhY2spLi4uJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcclxuICAgICAgICAgIEZ1bmN0aW9uTmFtZTogdGhpcy5tYXRjaExhbWJkYUFybixcclxuICAgICAgICAgIEludm9jYXRpb25UeXBlOiAnUmVxdWVzdFJlc3BvbnNlJyxcclxuICAgICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKGNvbW1hbmQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChyZXNwb25zZS5QYXlsb2FkKSB7XHJcbiAgICAgICAgICBjb25zdCByZXN1bHQgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5QYXlsb2FkKSk7XHJcbiAgICAgICAgICBpZiAocmVzdWx0LnN0YXR1c0NvZGUgPT09IDIwMCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygn4pyFIEZhbGxiYWNrIGNyZWF0ZU1hdGNoIGV4ZWN1dGVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhbGxiYWNrIGNyZWF0ZU1hdGNoIHJldHVybmVkIGVycm9yOicsIHJlc3VsdC5ib2R5Py5lcnJvcik7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTdG9yZSBub3RpZmljYXRpb25zIGZvciBwb2xsaW5nIGZhbGxiYWNrXHJcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmVNYXRjaE5vdGlmaWNhdGlvbnMobWF0Y2gpO1xyXG4gICAgICBcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBpbiBmYWxsYmFjayBtZXRob2Q6JywgZXJyb3IpO1xyXG4gICAgICAvLyBTdG9yZSBub3RpZmljYXRpb25zIGZvciBwb2xsaW5nIGFzIGZpbmFsIGZhbGxiYWNrXHJcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmVNYXRjaE5vdGlmaWNhdGlvbnMobWF0Y2gpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzdG9yZU1hdGNoTm90aWZpY2F0aW9ucyhtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFN0b3JlIGluZGl2aWR1YWwgbm90aWZpY2F0aW9uIHJlY29yZHMgZm9yIGVhY2ggdXNlclxyXG4gICAgICAvLyBUaGlzIGVuYWJsZXMgcG9sbGluZy1iYXNlZCBtYXRjaCBkZXRlY3Rpb24gYXMgYSBmYWxsYmFja1xyXG4gICAgICBjb25zdCBub3RpZmljYXRpb25Qcm9taXNlcyA9IG1hdGNoLm1hdGNoZWRVc2Vycy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IG5vdGlmaWNhdGlvblJlY29yZCA9IHtcclxuICAgICAgICAgIHVzZXJJZCxcclxuICAgICAgICAgIG1hdGNoSWQ6IG1hdGNoLmlkLFxyXG4gICAgICAgICAgb3JpZ2luYWxSb29tSWQ6IG1hdGNoLnJvb21JZCwgLy8gU3RvcmUgb3JpZ2luYWwgcm9vbUlkIHNlcGFyYXRlbHlcclxuICAgICAgICAgIG9yaWdpbmFsTW92aWVJZDogbWF0Y2gubW92aWVJZCwgLy8gU3RvcmUgb3JpZ2luYWwgbW92aWVJZCBzZXBhcmF0ZWx5XHJcbiAgICAgICAgICB0aXRsZTogbWF0Y2gudGl0bGUsXHJcbiAgICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaC5wb3N0ZXJQYXRoLFxyXG4gICAgICAgICAgdGltZXN0YW1wOiBtYXRjaC50aW1lc3RhbXAsXHJcbiAgICAgICAgICBub3RpZmllZDogZmFsc2UsIC8vIEZsYWcgdG8gdHJhY2sgaWYgdXNlciBoYXMgYmVlbiBub3RpZmllZFxyXG4gICAgICAgICAgdHRsOiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICg3ICogMjQgKiA2MCAqIDYwKSwgLy8gNyBkYXlzIFRUTFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIFN0b3JlIGluIGEgbm90aWZpY2F0aW9ucyB0YWJsZSAod2UnbGwgdXNlIHRoZSBtYXRjaGVzIHRhYmxlIHdpdGggYSBzcGVjaWFsIHBhdHRlcm4pXHJcbiAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgICAgcm9vbUlkOiBgTk9USUZJQ0FUSU9OIyR7dXNlcklkfWAsIC8vIFNwZWNpYWwgcHJlZml4IGZvciBub3RpZmljYXRpb25zXHJcbiAgICAgICAgICAgIG1vdmllSWQ6IERhdGUubm93KCksIC8vIFVzZSB0aW1lc3RhbXAgYXMgc29ydCBrZXkgZm9yIHVuaXF1ZW5lc3NcclxuICAgICAgICAgICAgLi4ubm90aWZpY2F0aW9uUmVjb3JkLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBOb3RpZmljYXRpb24gc3RvcmVkIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChub3RpZmljYXRpb25Qcm9taXNlcyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfinIUgTWF0Y2ggbm90aWZpY2F0aW9ucyBzdG9yZWQgZm9yIHBvbGxpbmcgZmFsbGJhY2snKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHN0b3JpbmcgbWF0Y2ggbm90aWZpY2F0aW9uczonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIG5vdGlmeU1hdGNoQ3JlYXRlZChtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICAgICAgb3BlcmF0aW9uOiAnbWF0Y2hDcmVhdGVkJyxcclxuICAgICAgICBtYXRjaCxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlQ29tbWFuZCh7XHJcbiAgICAgICAgRnVuY3Rpb25OYW1lOiB0aGlzLm1hdGNoTGFtYmRhQXJuLFxyXG4gICAgICAgIEludm9jYXRpb25UeXBlOiAnRXZlbnQnLCAvLyBBc3luYyBpbnZvY2F0aW9uXHJcbiAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQoY29tbWFuZCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdNYXRjaCBub3RpZmljYXRpb24gc2VudCB0byBNYXRjaCBMYW1iZGEnKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBub3RpZnkgTWF0Y2ggTGFtYmRhOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG4vLyBMYW1iZGEgSGFuZGxlciBmb3IgQXBwU3luY1xyXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdWb3RlIExhbWJkYSByZWNlaXZlZCBBcHBTeW5jIGV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XHJcblxyXG4gIHRyeSB7XHJcbiAgICAvLyBFeHRyYWN0IHVzZXIgSUQgZnJvbSBBcHBTeW5jIGNvbnRleHRcclxuICAgIGNvbnN0IHVzZXJJZCA9IGV2ZW50LmlkZW50aXR5Py5jbGFpbXM/LnN1YiB8fCBldmVudC5pZGVudGl0eT8udXNlcm5hbWU7XHJcbiAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdVc2VyIG5vdCBhdXRoZW50aWNhdGVkIGZvciB2b3RlJyk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07IC8vIFJldHVybiBwcm9wZXIgVm90ZVJlc3VsdCBpbnN0ZWFkIG9mIHRocm93aW5nXHJcbiAgICB9XHJcblxyXG4gICAgLy8gR2V0IGFyZ3VtZW50cyBmcm9tIEFwcFN5bmNcclxuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGV2ZW50LmFyZ3VtZW50cztcclxuICAgIGNvbnN0IHsgcm9vbUlkLCBtb3ZpZUlkLCB2b3RlIH0gPSBpbnB1dDtcclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCFyb29tSWQpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignUm9vbSBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSB9OyAvLyBSZXR1cm4gcHJvcGVyIFZvdGVSZXN1bHQgaW5zdGVhZCBvZiB0aHJvd2luZ1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0eXBlb2YgbW92aWVJZCAhPT0gJ251bWJlcicpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignTW92aWUgSUQgbXVzdCBiZSBhIG51bWJlcicpO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSB9OyAvLyBSZXR1cm4gcHJvcGVyIFZvdGVSZXN1bHQgaW5zdGVhZCBvZiB0aHJvd2luZ1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0eXBlb2Ygdm90ZSAhPT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1ZvdGUgbXVzdCBiZSBhIGJvb2xlYW4nKTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UgfTsgLy8gUmV0dXJuIHByb3BlciBWb3RlUmVzdWx0IGluc3RlYWQgb2YgdGhyb3dpbmdcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCB2b3RlU2VydmljZSA9IG5ldyBWb3RlU2VydmljZSgpO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2b3RlU2VydmljZS5wcm9jZXNzVm90ZSh1c2VySWQsIHJvb21JZCwgbW92aWVJZCwgdm90ZSk7XHJcbiAgICAgIHJldHVybiByZXN1bHQ7IC8vIFRoaXMgYWxyZWFkeSByZXR1cm5zIHsgc3VjY2VzczogdHJ1ZSwgbWF0Y2g/OiBNYXRjaCB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBwcm9jZXNzaW5nIHZvdGU6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSB9OyAvLyBSZXR1cm4gcHJvcGVyIFZvdGVSZXN1bHQgb24gZXJyb3JcclxuICAgIH1cclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1ZvdGUgTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07IC8vIEFsd2F5cyByZXR1cm4gcHJvcGVyIFZvdGVSZXN1bHQsIG5ldmVyIHRocm93XHJcbiAgfVxyXG59OyJdfQ==