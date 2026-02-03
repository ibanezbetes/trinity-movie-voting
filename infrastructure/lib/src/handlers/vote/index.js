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
        // Store the main match record
        await docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: this.matchesTable,
            Item: match,
            ConditionExpression: 'attribute_not_exists(roomId) AND attribute_not_exists(movieId)', // Prevent duplicates
        }));
        // CRITICAL: Create individual match records for each user to enable GSI queries
        // This allows efficient querying of matches by userId using the new GSI
        const userMatchPromises = matchedUsers.map(async (userId) => {
            const userMatch = {
                ...match,
                userId, // Add userId field for GSI
                id: `${userId}#${matchId}`, // Unique ID per user
                roomId: `${userId}#${roomId}`, // Composite key to avoid conflicts
            };
            try {
                await docClient.send(new lib_dynamodb_1.PutCommand({
                    TableName: this.matchesTable,
                    Item: userMatch,
                }));
                console.log(`User match record created for user ${userId}`);
            }
            catch (error) {
                console.error(`Error creating user match record for ${userId}:`, error);
                // Continue with other users even if one fails
            }
        });
        // Wait for all user match records to be created
        await Promise.allSettled(userMatchPromises);
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
// Lambda Handler
const handler = async (event) => {
    console.log('Vote Lambda received event:', JSON.stringify(event));
    try {
        const { userId, input } = event;
        const { roomId, movieId, vote } = input;
        // Validate input
        if (!userId) {
            throw new Error('User ID is required');
        }
        if (!roomId) {
            throw new Error('Room ID is required');
        }
        if (typeof movieId !== 'number') {
            throw new Error('Movie ID must be a number');
        }
        if (typeof vote !== 'boolean') {
            throw new Error('Vote must be a boolean');
        }
        const voteService = new VoteService();
        const result = await voteService.processVote(userId, roomId, movieId, vote);
        return {
            statusCode: 200,
            body: result,
        };
    }
    catch (error) {
        console.error('Vote Lambda error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
            statusCode: 400,
            body: {
                success: false,
                error: errorMessage,
            },
        };
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdm90ZS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQW9IO0FBQ3BILDBEQUFxRTtBQUNyRSx3REFBb0Q7QUFDcEQscURBQStDO0FBQy9DLGdGQUFvRTtBQUNwRSwwREFBcUQ7QUFFckQseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUE4RDFFLGVBQWU7QUFDZixNQUFNLFdBQVc7SUFNZjtRQUNFLElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBQ3BELElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxjQUFjLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsSUFBSSxFQUFFLENBQUM7UUFFekQsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQy9ELE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUMsQ0FB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QUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixJQUFJLEVBQUUsTUFBTTtTQUNiLENBQUM7SUFFSixDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsb0JBQW9CLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFM0MsTUFBTSxZQUFZLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUM7UUFFdkYsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFO2dCQUNKLE9BQU8sRUFBRSxLQUFLO2dCQUNkLEtBQUssRUFBRSxZQUFZO2FBQ3BCO1NBQ0YsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUE3Q1csUUFBQSxPQUFPLFdBNkNsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBQdXRDb21tYW5kLCBRdWVyeUNvbW1hbmQsIEdldENvbW1hbmQsIERlbGV0ZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5pbXBvcnQgeyBMYW1iZGFDbGllbnQsIEludm9rZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtbGFtYmRhJztcclxuaW1wb3J0IHsgU2lnbmF0dXJlVjQgfSBmcm9tICdAYXdzLXNkay9zaWduYXR1cmUtdjQnO1xyXG5pbXBvcnQgeyBTaGEyNTYgfSBmcm9tICdAYXdzLWNyeXB0by9zaGEyNTYtanMnO1xyXG5pbXBvcnQgeyBkZWZhdWx0UHJvdmlkZXIgfSBmcm9tICdAYXdzLXNkay9jcmVkZW50aWFsLXByb3ZpZGVyLW5vZGUnO1xyXG5pbXBvcnQgeyBIdHRwUmVxdWVzdCB9IGZyb20gJ0Bhd3Mtc2RrL3Byb3RvY29sLWh0dHAnO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpO1xyXG5jb25zdCBsYW1iZGFDbGllbnQgPSBuZXcgTGFtYmRhQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5cclxuLy8gVHlwZXNcclxuaW50ZXJmYWNlIFZvdGUge1xyXG4gIHJvb21JZDogc3RyaW5nO1xyXG4gIHVzZXJNb3ZpZUlkOiBzdHJpbmc7IC8vIEZvcm1hdDogXCJ1c2VySWQjbW92aWVJZFwiXHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgbW92aWVJZDogbnVtYmVyO1xyXG4gIHZvdGU6IGJvb2xlYW47XHJcbiAgdGltZXN0YW1wOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNYXRjaCB7XHJcbiAgaWQ6IHN0cmluZztcclxuICByb29tSWQ6IHN0cmluZztcclxuICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBwb3N0ZXJQYXRoPzogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgbWF0Y2hlZFVzZXJzOiBzdHJpbmdbXTtcclxuICB0aW1lc3RhbXA6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIFJvb20ge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgY29kZTogc3RyaW5nO1xyXG4gIGhvc3RJZDogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgZ2VucmVJZHM6IG51bWJlcltdO1xyXG4gIGNhbmRpZGF0ZXM6IE1vdmllQ2FuZGlkYXRlW107XHJcbiAgY3JlYXRlZEF0OiBzdHJpbmc7XHJcbiAgdHRsOiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNb3ZpZUNhbmRpZGF0ZSB7XHJcbiAgaWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIG92ZXJ2aWV3OiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aDogc3RyaW5nIHwgbnVsbDtcclxuICByZWxlYXNlRGF0ZTogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbn1cclxuXHJcbmludGVyZmFjZSBWb3RlRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ3ZvdGUnO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIGlucHV0OiB7XHJcbiAgICByb29tSWQ6IHN0cmluZztcclxuICAgIG1vdmllSWQ6IG51bWJlcjtcclxuICAgIHZvdGU6IGJvb2xlYW47XHJcbiAgfTtcclxufVxyXG5cclxuaW50ZXJmYWNlIFZvdGVSZXNwb25zZSB7XHJcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xyXG4gIGJvZHk6IHtcclxuICAgIHN1Y2Nlc3M6IGJvb2xlYW47XHJcbiAgICBtYXRjaD86IE1hdGNoO1xyXG4gICAgZXJyb3I/OiBzdHJpbmc7XHJcbiAgfTtcclxufVxyXG5cclxuLy8gVm90ZSBTZXJ2aWNlXHJcbmNsYXNzIFZvdGVTZXJ2aWNlIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IHZvdGVzVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IG1hdGNoZXNUYWJsZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgcm9vbXNUYWJsZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbWF0Y2hMYW1iZGFBcm46IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLnZvdGVzVGFibGUgPSBwcm9jZXNzLmVudi5WT1RFU19UQUJMRSB8fCAnJztcclxuICAgIHRoaXMubWF0Y2hlc1RhYmxlID0gcHJvY2Vzcy5lbnYuTUFUQ0hFU19UQUJMRSB8fCAnJztcclxuICAgIHRoaXMucm9vbXNUYWJsZSA9IHByb2Nlc3MuZW52LlJPT01TX1RBQkxFIHx8ICcnO1xyXG4gICAgdGhpcy5tYXRjaExhbWJkYUFybiA9IHByb2Nlc3MuZW52Lk1BVENIX0xBTUJEQV9BUk4gfHwgJyc7XHJcblxyXG4gICAgaWYgKCF0aGlzLnZvdGVzVGFibGUgfHwgIXRoaXMubWF0Y2hlc1RhYmxlIHx8ICF0aGlzLnJvb21zVGFibGUpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZXF1aXJlZCB0YWJsZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgYXJlIG1pc3NpbmcnKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIHByb2Nlc3NWb3RlKHVzZXJJZDogc3RyaW5nLCByb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCB2b3RlOiBib29sZWFuKTogUHJvbWlzZTx7IHN1Y2Nlc3M6IGJvb2xlYW47IG1hdGNoPzogTWF0Y2ggfT4ge1xyXG4gICAgLy8gVmFsaWRhdGUgcm9vbSBleGlzdHMgYW5kIGdldCByb29tIGRldGFpbHNcclxuICAgIGNvbnN0IHJvb20gPSBhd2FpdCB0aGlzLmdldFJvb20ocm9vbUlkKTtcclxuICAgIGlmICghcm9vbSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gbm90IGZvdW5kIG9yIGhhcyBleHBpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQmFzaWMgcm9vbSBtZW1iZXJzaGlwIHZhbGlkYXRpb24gLSBjaGVjayBpZiB1c2VyIGhhcyBhY2Nlc3MgdG8gdGhpcyByb29tXHJcbiAgICAvLyBGb3Igbm93LCB3ZSBhbGxvdyBhbnkgYXV0aGVudGljYXRlZCB1c2VyIHRvIHZvdGUgaW4gYW55IGFjdGl2ZSByb29tXHJcbiAgICAvLyBUT0RPOiBJbXBsZW1lbnQgcHJvcGVyIHJvb20gbWVtYmVyc2hpcCB2YWxpZGF0aW9uIGluIFRhc2sgMlxyXG4gICAgY29uc3QgaGFzUm9vbUFjY2VzcyA9IGF3YWl0IHRoaXMudmFsaWRhdGVSb29tQWNjZXNzKHVzZXJJZCwgcm9vbUlkLCByb29tKTtcclxuICAgIGlmICghaGFzUm9vbUFjY2Vzcykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgZG9lcyBub3QgaGF2ZSBhY2Nlc3MgdG8gdGhpcyByb29tJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVmFsaWRhdGUgbW92aWUgaXMgaW4gcm9vbSBjYW5kaWRhdGVzXHJcbiAgICBjb25zdCBtb3ZpZUNhbmRpZGF0ZSA9IHJvb20uY2FuZGlkYXRlcy5maW5kKGMgPT4gYy5pZCA9PT0gbW92aWVJZCk7XHJcbiAgICBpZiAoIW1vdmllQ2FuZGlkYXRlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTW92aWUgbm90IGZvdW5kIGluIHJvb20gY2FuZGlkYXRlcycpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlY29yZCB0aGUgdm90ZVxyXG4gICAgYXdhaXQgdGhpcy5yZWNvcmRWb3RlKHVzZXJJZCwgcm9vbUlkLCBtb3ZpZUlkLCB2b3RlKTtcclxuXHJcbiAgICAvLyBDaGVjayBmb3IgbWF0Y2ggaWYgdm90ZSBpcyBwb3NpdGl2ZVxyXG4gICAgbGV0IG1hdGNoOiBNYXRjaCB8IHVuZGVmaW5lZDtcclxuICAgIGlmICh2b3RlKSB7XHJcbiAgICAgIG1hdGNoID0gYXdhaXQgdGhpcy5jaGVja0Zvck1hdGNoKHJvb21JZCwgbW92aWVJZCwgbW92aWVDYW5kaWRhdGUpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIG1hdGNoIH07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHZhbGlkYXRlUm9vbUFjY2Vzcyh1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcsIHJvb206IFJvb20pOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIEJhc2ljIHZhbGlkYXRpb246IGNoZWNrIGlmIHVzZXIgaXMgdGhlIHJvb20gaG9zdCBvciBoYXMgcHJldmlvdXNseSB2b3RlZCBpbiB0aGlzIHJvb21cclxuICAgICAgaWYgKHJvb20uaG9zdElkID09PSB1c2VySWQpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gaXMgdGhlIGhvc3Qgb2Ygcm9vbSAke3Jvb21JZH0gLSBhY2Nlc3MgZ3JhbnRlZGApO1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiB1c2VyIGhhcyBwcmV2aW91c2x5IHBhcnRpY2lwYXRlZCBpbiB0aGlzIHJvb21cclxuICAgICAgY29uc3QgdXNlclZvdGVzUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEZpbHRlckV4cHJlc3Npb246ICd1c2VySWQgPSA6dXNlcklkJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICAgICc6dXNlcklkJzogdXNlcklkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgTGltaXQ6IDEsXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGlmICh1c2VyVm90ZXNSZXN1bHQuSXRlbXMgJiYgdXNlclZvdGVzUmVzdWx0Lkl0ZW1zLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gaGFzIHByZXZpb3VzbHkgdm90ZWQgaW4gcm9vbSAke3Jvb21JZH0gLSBhY2Nlc3MgZ3JhbnRlZGApO1xyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBGb3IgTVZQOiBBbGxvdyBhbnkgYXV0aGVudGljYXRlZCB1c2VyIHRvIGpvaW4gYW55IGFjdGl2ZSByb29tXHJcbiAgICAgIC8vIFRPRE86IEltcGxlbWVudCBwcm9wZXIgcm9vbSBtZW1iZXJzaGlwIHZhbGlkYXRpb24gd2l0aCBEeW5hbW9EQiB0YWJsZSBpbiBUYXNrIDJcclxuICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGdyYW50ZWQgYWNjZXNzIHRvIHJvb20gJHtyb29tSWR9IChNVlAgbW9kZSAtIGFsbCB1c2VycyBhbGxvd2VkKWApO1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciB2YWxpZGF0aW5nIHJvb20gYWNjZXNzIGZvciB1c2VyICR7dXNlcklkfSBpbiByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgIC8vIE9uIGVycm9yLCBhbGxvdyBhY2Nlc3MgZm9yIG5vdyAoZmFpbCBvcGVuIGZvciBNVlApXHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBnZXRSb29tKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTxSb29tIHwgbnVsbD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5yb29tc1RhYmxlLFxyXG4gICAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGlmICghcmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3Qgcm9vbSA9IHJlc3VsdC5JdGVtIGFzIFJvb207XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiByb29tIGhhcyBleHBpcmVkXHJcbiAgICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xyXG4gICAgICBpZiAocm9vbS50dGwgJiYgcm9vbS50dGwgPCBub3cpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHJvb207XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBnZXR0aW5nIHJvb206JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVjb3JkVm90ZSh1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgdm90ZTogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgdXNlck1vdmllSWQgPSBgJHt1c2VySWR9IyR7bW92aWVJZH1gO1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAgIGNvbnN0IHZvdGVSZWNvcmQ6IFZvdGUgPSB7XHJcbiAgICAgIHJvb21JZCxcclxuICAgICAgdXNlck1vdmllSWQsXHJcbiAgICAgIHVzZXJJZCxcclxuICAgICAgbW92aWVJZCxcclxuICAgICAgdm90ZSxcclxuICAgICAgdGltZXN0YW1wLFxyXG4gICAgfTtcclxuXHJcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICBJdGVtOiB2b3RlUmVjb3JkLFxyXG4gICAgICAvLyBBbGxvdyBvdmVyd3JpdGluZyBwcmV2aW91cyB2b3RlcyBmb3IgdGhlIHNhbWUgdXNlci9tb3ZpZSBjb21iaW5hdGlvblxyXG4gICAgfSkpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBWb3RlIHJlY29yZGVkOiBVc2VyICR7dXNlcklkfSB2b3RlZCAke3ZvdGUgPyAnWUVTJyA6ICdOTyd9IGZvciBtb3ZpZSAke21vdmllSWR9IGluIHJvb20gJHtyb29tSWR9YCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGNoZWNrRm9yTWF0Y2gocm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgbW92aWVDYW5kaWRhdGU6IE1vdmllQ2FuZGlkYXRlKTogUHJvbWlzZTxNYXRjaCB8IHVuZGVmaW5lZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gR2V0IGFsbCB2b3RlcyBmb3IgdGhpcyBtb3ZpZSBpbiB0aGlzIHJvb20gKGV4Y2x1ZGluZyBwYXJ0aWNpcGF0aW9uIHJlY29yZHMpXHJcbiAgICAgIGNvbnN0IHZvdGVzUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdtb3ZpZUlkID0gOm1vdmllSWQgQU5EIHZvdGUgPSA6dm90ZSBBTkQgbW92aWVJZCA8PiA6cGFydGljaXBhdGlvbk1hcmtlcicsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgICAnOm1vdmllSWQnOiBtb3ZpZUlkLFxyXG4gICAgICAgICAgJzp2b3RlJzogdHJ1ZSwgLy8gT25seSBwb3NpdGl2ZSB2b3Rlc1xyXG4gICAgICAgICAgJzpwYXJ0aWNpcGF0aW9uTWFya2VyJzogLTEsIC8vIEV4Y2x1ZGUgcGFydGljaXBhdGlvbiByZWNvcmRzXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgcG9zaXRpdmVWb3RlcyA9IHZvdGVzUmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHtwb3NpdGl2ZVZvdGVzLmxlbmd0aH0gcG9zaXRpdmUgdm90ZXMgZm9yIG1vdmllICR7bW92aWVJZH0gaW4gcm9vbSAke3Jvb21JZH1gKTtcclxuXHJcbiAgICAgIC8vIEdldCBhbGwgdW5pcXVlIHVzZXJzIHdobyBoYXZlIHZvdGVkIGluIHRoaXMgcm9vbSAoZXhjbHVkaW5nIHBhcnRpY2lwYXRpb24gcmVjb3JkcylcclxuICAgICAgY29uc3QgYWxsVm90ZXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ21vdmllSWQgPD4gOnBhcnRpY2lwYXRpb25NYXJrZXInLCAvLyBFeGNsdWRlIHBhcnRpY2lwYXRpb24gcmVjb3Jkc1xyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzpwYXJ0aWNpcGF0aW9uTWFya2VyJzogLTEsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgYWxsVm90ZXMgPSBhbGxWb3Rlc1Jlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgY29uc3QgdW5pcXVlVXNlcnMgPSBuZXcgU2V0KGFsbFZvdGVzLm1hcCh2b3RlID0+ICh2b3RlIGFzIFZvdGUpLnVzZXJJZCkpO1xyXG4gICAgICBjb25zdCB0b3RhbFVzZXJzID0gdW5pcXVlVXNlcnMuc2l6ZTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBUb3RhbCB1bmlxdWUgdXNlcnMgd2hvIGhhdmUgdm90ZWQgaW4gcm9vbTogJHt0b3RhbFVzZXJzfWApO1xyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgYWxsIHVzZXJzIHZvdGVkIHBvc2l0aXZlbHkgZm9yIHRoaXMgbW92aWVcclxuICAgICAgY29uc3QgcG9zaXRpdmVVc2VySWRzID0gbmV3IFNldChwb3NpdGl2ZVZvdGVzLm1hcCh2b3RlID0+ICh2b3RlIGFzIFZvdGUpLnVzZXJJZCkpO1xyXG4gICAgICBcclxuICAgICAgaWYgKHBvc2l0aXZlVXNlcklkcy5zaXplID09PSB0b3RhbFVzZXJzICYmIHRvdGFsVXNlcnMgPiAxKSB7XHJcbiAgICAgICAgLy8gV2UgaGF2ZSBhIG1hdGNoISBBbGwgdXNlcnMgdm90ZWQgcG9zaXRpdmVseVxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBNQVRDSCBERVRFQ1RFRCEgQWxsICR7dG90YWxVc2Vyc30gdXNlcnMgdm90ZWQgcG9zaXRpdmVseSBmb3IgbW92aWUgJHttb3ZpZUlkfWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENoZWNrIGlmIG1hdGNoIGFscmVhZHkgZXhpc3RzXHJcbiAgICAgICAgY29uc3QgZXhpc3RpbmdNYXRjaCA9IGF3YWl0IHRoaXMuZ2V0RXhpc3RpbmdNYXRjaChyb29tSWQsIG1vdmllSWQpO1xyXG4gICAgICAgIGlmIChleGlzdGluZ01hdGNoKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZygnTWF0Y2ggYWxyZWFkeSBleGlzdHMsIHJldHVybmluZyBleGlzdGluZyBtYXRjaCcpO1xyXG4gICAgICAgICAgcmV0dXJuIGV4aXN0aW5nTWF0Y2g7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBDcmVhdGUgbmV3IG1hdGNoXHJcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBhd2FpdCB0aGlzLmNyZWF0ZU1hdGNoKHJvb21JZCwgbW92aWVJZCwgbW92aWVDYW5kaWRhdGUsIEFycmF5LmZyb20ocG9zaXRpdmVVc2VySWRzKSk7XHJcbiAgICAgICAgcmV0dXJuIG1hdGNoO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgTm8gbWF0Y2ggeWV0LiBQb3NpdGl2ZSB2b3RlczogJHtwb3NpdGl2ZVVzZXJJZHMuc2l6ZX0sIFRvdGFsIHVzZXJzOiAke3RvdGFsVXNlcnN9YCk7XHJcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgY2hlY2tpbmcgZm9yIG1hdGNoOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZ2V0RXhpc3RpbmdNYXRjaChyb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyKTogUHJvbWlzZTxNYXRjaCB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgIEtleToge1xyXG4gICAgICAgICAgcm9vbUlkLFxyXG4gICAgICAgICAgbW92aWVJZCxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICByZXR1cm4gcmVzdWx0Lkl0ZW0gYXMgTWF0Y2ggfHwgbnVsbDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGV4aXN0aW5nIG1hdGNoOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGNyZWF0ZU1hdGNoKHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIsIG1vdmllQ2FuZGlkYXRlOiBNb3ZpZUNhbmRpZGF0ZSwgbWF0Y2hlZFVzZXJzOiBzdHJpbmdbXSk6IFByb21pc2U8TWF0Y2g+IHtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgIGNvbnN0IG1hdGNoSWQgPSBgJHtyb29tSWR9IyR7bW92aWVJZH1gO1xyXG5cclxuICAgIGNvbnN0IG1hdGNoOiBNYXRjaCA9IHtcclxuICAgICAgaWQ6IG1hdGNoSWQsXHJcbiAgICAgIHJvb21JZCxcclxuICAgICAgbW92aWVJZCxcclxuICAgICAgdGl0bGU6IG1vdmllQ2FuZGlkYXRlLnRpdGxlLFxyXG4gICAgICBwb3N0ZXJQYXRoOiBtb3ZpZUNhbmRpZGF0ZS5wb3N0ZXJQYXRoIHx8IHVuZGVmaW5lZCxcclxuICAgICAgbWVkaWFUeXBlOiBtb3ZpZUNhbmRpZGF0ZS5tZWRpYVR5cGUsXHJcbiAgICAgIG1hdGNoZWRVc2VycyxcclxuICAgICAgdGltZXN0YW1wLFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBTdG9yZSB0aGUgbWFpbiBtYXRjaCByZWNvcmRcclxuICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgSXRlbTogbWF0Y2gsXHJcbiAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfbm90X2V4aXN0cyhyb29tSWQpIEFORCBhdHRyaWJ1dGVfbm90X2V4aXN0cyhtb3ZpZUlkKScsIC8vIFByZXZlbnQgZHVwbGljYXRlc1xyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIENSSVRJQ0FMOiBDcmVhdGUgaW5kaXZpZHVhbCBtYXRjaCByZWNvcmRzIGZvciBlYWNoIHVzZXIgdG8gZW5hYmxlIEdTSSBxdWVyaWVzXHJcbiAgICAvLyBUaGlzIGFsbG93cyBlZmZpY2llbnQgcXVlcnlpbmcgb2YgbWF0Y2hlcyBieSB1c2VySWQgdXNpbmcgdGhlIG5ldyBHU0lcclxuICAgIGNvbnN0IHVzZXJNYXRjaFByb21pc2VzID0gbWF0Y2hlZFVzZXJzLm1hcChhc3luYyAodXNlcklkKSA9PiB7XHJcbiAgICAgIGNvbnN0IHVzZXJNYXRjaCA9IHtcclxuICAgICAgICAuLi5tYXRjaCxcclxuICAgICAgICB1c2VySWQsIC8vIEFkZCB1c2VySWQgZmllbGQgZm9yIEdTSVxyXG4gICAgICAgIGlkOiBgJHt1c2VySWR9IyR7bWF0Y2hJZH1gLCAvLyBVbmlxdWUgSUQgcGVyIHVzZXJcclxuICAgICAgICByb29tSWQ6IGAke3VzZXJJZH0jJHtyb29tSWR9YCwgLy8gQ29tcG9zaXRlIGtleSB0byBhdm9pZCBjb25mbGljdHNcclxuICAgICAgfTtcclxuXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICAgIEl0ZW06IHVzZXJNYXRjaCxcclxuICAgICAgICB9KSk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFVzZXIgbWF0Y2ggcmVjb3JkIGNyZWF0ZWQgZm9yIHVzZXIgJHt1c2VySWR9YCk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgY3JlYXRpbmcgdXNlciBtYXRjaCByZWNvcmQgZm9yICR7dXNlcklkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgLy8gQ29udGludWUgd2l0aCBvdGhlciB1c2VycyBldmVuIGlmIG9uZSBmYWlsc1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBXYWl0IGZvciBhbGwgdXNlciBtYXRjaCByZWNvcmRzIHRvIGJlIGNyZWF0ZWRcclxuICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZCh1c2VyTWF0Y2hQcm9taXNlcyk7XHJcblxyXG4gICAgLy8gQ1JJVElDQUw6IFRyaWdnZXIgQXBwU3luYyBzdWJzY3JpcHRpb24gRklSU1QgYmVmb3JlIGFueSBjbGVhbnVwXHJcbiAgICAvLyBUaGlzIGVuc3VyZXMgYWxsIHVzZXJzIGdldCBub3RpZmllZCBiZWZvcmUgYW55IGNoYW5nZXNcclxuICAgIGF3YWl0IHRoaXMudHJpZ2dlckFwcFN5bmNTdWJzY3JpcHRpb24obWF0Y2gpO1xyXG5cclxuICAgIC8vIFdhaXQgYSBtb21lbnQgdG8gZW5zdXJlIG5vdGlmaWNhdGlvbnMgYXJlIHNlbnRcclxuICAgIC8vIFRoaXMgcHJldmVudHMgXCJSb29tIG5vdCBmb3VuZFwiIGVycm9ycyBmb3IgY29uY3VycmVudCB2b3Rlc1xyXG4gICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDIwMDApKTsgLy8gMiBzZWNvbmQgZGVsYXlcclxuXHJcbiAgICAvLyBESVNBQkxFRDogRG8gbm90IGRlbGV0ZSByb29tIGFmdGVyIG1hdGNoIC0gbGV0IGl0IHJlbWFpbiBhY3RpdmVcclxuICAgIC8vIFRoaXMgcHJldmVudHMgXCJSb29tIG5vdCBmb3VuZFwiIGVycm9ycyBmb3IgdXNlcnMgd2hvIHZvdGUgYWZ0ZXIgbWF0Y2ggaXMgY3JlYXRlZFxyXG4gICAgLy8gYXdhaXQgdGhpcy5kZWxldGVSb29tKHJvb21JZCk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKGBNYXRjaCBjcmVhdGVkIGJ1dCByb29tICR7cm9vbUlkfSBrZXB0IGFjdGl2ZSB0byBwcmV2ZW50IFwiUm9vbSBub3QgZm91bmRcIiBlcnJvcnNgKTtcclxuXHJcbiAgICByZXR1cm4gbWF0Y2g7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGRlbGV0ZVJvb20ocm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIERlbGV0ZSB0aGUgcm9vbSBmcm9tIER5bmFtb0RCXHJcbiAgICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBEZWxldGVDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMucm9vbXNUYWJsZSxcclxuICAgICAgICBLZXk6IHsgaWQ6IHJvb21JZCB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgUm9vbSAke3Jvb21JZH0gZGVsZXRlZCBhZnRlciBtYXRjaCBjcmVhdGlvbmApO1xyXG5cclxuICAgICAgLy8gT3B0aW9uYWxseTogRGVsZXRlIGFsbCB2b3RlcyBmb3IgdGhpcyByb29tIHRvIGZyZWUgdXAgc3BhY2VcclxuICAgICAgYXdhaXQgdGhpcy5kZWxldGVSb29tVm90ZXMocm9vbUlkKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGRlbGV0aW5nIHJvb20gJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgICAgLy8gRG9uJ3QgZmFpbCB0aGUgbWF0Y2ggY3JlYXRpb24gaWYgcm9vbSBkZWxldGlvbiBmYWlsc1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBkZWxldGVSb29tVm90ZXMocm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIEdldCBhbGwgdm90ZXMgYW5kIHBhcnRpY2lwYXRpb24gcmVjb3JkcyBmb3IgdGhpcyByb29tXHJcbiAgICAgIGNvbnN0IHZvdGVzUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IGFsbFJlY29yZHMgPSB2b3Rlc1Jlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgXHJcbiAgICAgIC8vIERlbGV0ZSBhbGwgcmVjb3JkcyAodm90ZXMgYW5kIHBhcnRpY2lwYXRpb24pIGluIGJhdGNoZXNcclxuICAgICAgY29uc3QgZGVsZXRlUHJvbWlzZXMgPSBhbGxSZWNvcmRzLm1hcChyZWNvcmQgPT4gXHJcbiAgICAgICAgZG9jQ2xpZW50LnNlbmQobmV3IERlbGV0ZUNvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgICBLZXk6IHtcclxuICAgICAgICAgICAgcm9vbUlkOiByZWNvcmQucm9vbUlkLFxyXG4gICAgICAgICAgICB1c2VyTW92aWVJZDogcmVjb3JkLnVzZXJNb3ZpZUlkLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9KSlcclxuICAgICAgKTtcclxuXHJcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChkZWxldGVQcm9taXNlcyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBEZWxldGVkICR7YWxsUmVjb3Jkcy5sZW5ndGh9IHJlY29yZHMgKHZvdGVzIGFuZCBwYXJ0aWNpcGF0aW9uKSBmb3Igcm9vbSAke3Jvb21JZH1gKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGRlbGV0aW5nIHJlY29yZHMgZm9yIHJvb20gJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgdHJpZ2dlckFwcFN5bmNTdWJzY3JpcHRpb24obWF0Y2g6IE1hdGNoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+UlCBJTklDSUFORE8gQlJPQURDQVNUIElORElWSURVQUwgcGFyYSBjYWRhIHVzdWFyaW8gZW4gc2FsYTogJHttYXRjaC5yb29tSWR9YCk7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+RpSBVc3VhcmlvcyBhIG5vdGlmaWNhcjogJHttYXRjaC5tYXRjaGVkVXNlcnMuam9pbignLCAnKX1gKTtcclxuICAgIFxyXG4gICAgY29uc3QgZW5kcG9pbnQgPSBwcm9jZXNzLmVudi5HUkFQSFFMX0VORFBPSU5UO1xyXG4gICAgaWYgKCFlbmRwb2ludCkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgRkFUQUw6IEdSQVBIUUxfRU5EUE9JTlQgbm8gZXN0w6EgZGVmaW5pZG8nKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIE5VRVZBIEVTVFJBVEVHSUE6IEVudmlhciBub3RpZmljYWNpw7NuIGluZGl2aWR1YWwgYSBjYWRhIHVzdWFyaW9cclxuICAgIC8vIEVzdG8gYXNlZ3VyYSBxdWUgVE9ET1MgbG9zIHVzdWFyaW9zIHF1ZSBwYXJ0aWNpcGFyb24gZW4gZWwgbWF0Y2ggcmVjaWJhbiBsYSBub3RpZmljYWNpw7NuXHJcbiAgICBjb25zdCBub3RpZmljYXRpb25Qcm9taXNlcyA9IG1hdGNoLm1hdGNoZWRVc2Vycy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICBhd2FpdCB0aGlzLnNlbmRJbmRpdmlkdWFsVXNlck5vdGlmaWNhdGlvbih1c2VySWQsIG1hdGNoLCBlbmRwb2ludCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBFbnZpYXIgdG9kYXMgbGFzIG5vdGlmaWNhY2lvbmVzIGVuIHBhcmFsZWxvXHJcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKG5vdGlmaWNhdGlvblByb21pc2VzKTtcclxuICAgIFxyXG4gICAgLy8gTG9nIHJlc3VsdGFkb3NcclxuICAgIHJlc3VsdHMuZm9yRWFjaCgocmVzdWx0LCBpbmRleCkgPT4ge1xyXG4gICAgICBjb25zdCB1c2VySWQgPSBtYXRjaC5tYXRjaGVkVXNlcnNbaW5kZXhdO1xyXG4gICAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ2Z1bGZpbGxlZCcpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIE5vdGlmaWNhY2nDs24gZW52aWFkYSBleGl0b3NhbWVudGUgYSB1c3VhcmlvOiAke3VzZXJJZH1gKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgRXJyb3IgZW52aWFuZG8gbm90aWZpY2FjacOzbiBhIHVzdWFyaW8gJHt1c2VySWR9OmAsIHJlc3VsdC5yZWFzb24pO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBUYW1iacOpbiBlbnZpYXIgbGEgbm90aWZpY2FjacOzbiBnZW5lcmFsIGRlIGxhIHNhbGEgKHBhcmEgY29tcGF0aWJpbGlkYWQpXHJcbiAgICBhd2FpdCB0aGlzLnNlbmRSb29tTm90aWZpY2F0aW9uKG1hdGNoLCBlbmRwb2ludCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHNlbmRJbmRpdmlkdWFsVXNlck5vdGlmaWNhdGlvbih1c2VySWQ6IHN0cmluZywgbWF0Y2g6IE1hdGNoLCBlbmRwb2ludDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+TpCBFbnZpYW5kbyBub3RpZmljYWNpw7NuIGluZGl2aWR1YWwgYSB1c3VhcmlvOiAke3VzZXJJZH1gKTtcclxuICAgIFxyXG4gICAgLy8gTXV0YWNpw7NuIGVzcGVjw61maWNhIHBhcmEgbm90aWZpY2FyIGEgdW4gdXN1YXJpbyBpbmRpdmlkdWFsXHJcbiAgICBjb25zdCBtdXRhdGlvbiA9IGBcclxuICAgICAgbXV0YXRpb24gUHVibGlzaFVzZXJNYXRjaCgkdXNlcklkOiBJRCEsICRtYXRjaERhdGE6IFJvb21NYXRjaElucHV0ISkge1xyXG4gICAgICAgIHB1Ymxpc2hVc2VyTWF0Y2godXNlcklkOiAkdXNlcklkLCBtYXRjaERhdGE6ICRtYXRjaERhdGEpIHtcclxuICAgICAgICAgIHJvb21JZFxyXG4gICAgICAgICAgbWF0Y2hJZFxyXG4gICAgICAgICAgbW92aWVJZFxyXG4gICAgICAgICAgbWF0Y2hlZFVzZXJzXHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICBgO1xyXG5cclxuICAgIGNvbnN0IHZhcmlhYmxlcyA9IHtcclxuICAgICAgdXNlcklkOiB1c2VySWQsXHJcbiAgICAgIG1hdGNoRGF0YToge1xyXG4gICAgICAgIG1hdGNoSWQ6IG1hdGNoLmlkLFxyXG4gICAgICAgIG1vdmllSWQ6IG1hdGNoLm1vdmllSWQsXHJcbiAgICAgICAgbW92aWVUaXRsZTogbWF0Y2gudGl0bGUsXHJcbiAgICAgICAgcG9zdGVyUGF0aDogbWF0Y2gucG9zdGVyUGF0aCxcclxuICAgICAgICBtYXRjaGVkVXNlcnM6IG1hdGNoLm1hdGNoZWRVc2VycyxcclxuICAgICAgICByb29tSWQ6IG1hdGNoLnJvb21JZCwgLy8gSW5jbHVpciByb29tSWQgZW4gbG9zIGRhdG9zXHJcbiAgICAgICAgdGltZXN0YW1wOiBtYXRjaC50aW1lc3RhbXAsXHJcbiAgICAgICAgbWF0Y2hEZXRhaWxzOiB7XHJcbiAgICAgICAgICB2b3RlQ291bnQ6IG1hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGgsXHJcbiAgICAgICAgICByZXF1aXJlZFZvdGVzOiBtYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RoLFxyXG4gICAgICAgICAgbWF0Y2hUeXBlOiAndW5hbmltb3VzJ1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKGVuZHBvaW50KTtcclxuICAgICAgY29uc3QgcmVxdWVzdCA9IG5ldyBIdHRwUmVxdWVzdCh7XHJcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAgIGhvc3Q6IHVybC5ob3N0bmFtZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIGhvc3RuYW1lOiB1cmwuaG9zdG5hbWUsXHJcbiAgICAgICAgcGF0aDogJy9ncmFwaHFsJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHF1ZXJ5OiBtdXRhdGlvbiwgdmFyaWFibGVzIH0pLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHNpZ25lciA9IG5ldyBTaWduYXR1cmVWNCh7XHJcbiAgICAgICAgY3JlZGVudGlhbHM6IGRlZmF1bHRQcm92aWRlcigpLFxyXG4gICAgICAgIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyxcclxuICAgICAgICBzZXJ2aWNlOiAnYXBwc3luYycsXHJcbiAgICAgICAgc2hhMjU2OiBTaGEyNTYsXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3Qgc2lnbmVkUmVxdWVzdCA9IGF3YWl0IHNpZ25lci5zaWduKHJlcXVlc3QpO1xyXG5cclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaChlbmRwb2ludCwge1xyXG4gICAgICAgIG1ldGhvZDogc2lnbmVkUmVxdWVzdC5tZXRob2QsXHJcbiAgICAgICAgaGVhZGVyczogc2lnbmVkUmVxdWVzdC5oZWFkZXJzIGFzIGFueSxcclxuICAgICAgICBib2R5OiBzaWduZWRSZXF1ZXN0LmJvZHksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcmVzcG9uc2UuanNvbigpIGFzIHsgZGF0YT86IGFueTsgZXJyb3JzPzogYW55W10gfTtcclxuICAgICAgXHJcbiAgICAgIGlmIChyZXN1bHQuZXJyb3JzKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIEVycm9yIG5vdGlmaWNhbmRvIHVzdWFyaW8gJHt1c2VySWR9OmAsIEpTT04uc3RyaW5naWZ5KHJlc3VsdC5lcnJvcnMpKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEFwcFN5bmMgZXJyb3IgZm9yIHVzZXIgJHt1c2VySWR9OiAke3Jlc3VsdC5lcnJvcnNbMF0/Lm1lc3NhZ2V9YCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYOKchSBVc3VhcmlvICR7dXNlcklkfSBub3RpZmljYWRvIGV4aXRvc2FtZW50ZWApO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGDinYwgRXJyb3IgZW52aWFuZG8gbm90aWZpY2FjacOzbiBhIHVzdWFyaW8gJHt1c2VySWR9OmAsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHNlbmRSb29tTm90aWZpY2F0aW9uKG1hdGNoOiBNYXRjaCwgZW5kcG9pbnQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc29sZS5sb2coYPCfk6QgRW52aWFuZG8gbm90aWZpY2FjacOzbiBnZW5lcmFsIGRlIHNhbGE6ICR7bWF0Y2gucm9vbUlkfWApO1xyXG4gICAgXHJcbiAgICAvLyBNYW50ZW5lciBsYSBub3RpZmljYWNpw7NuIGdlbmVyYWwgZGUgc2FsYSBwYXJhIGNvbXBhdGliaWxpZGFkXHJcbiAgICBjb25zdCBtdXRhdGlvbiA9IGBcclxuICAgICAgbXV0YXRpb24gUHVibGlzaFJvb21NYXRjaCgkcm9vbUlkOiBJRCEsICRtYXRjaERhdGE6IFJvb21NYXRjaElucHV0ISkge1xyXG4gICAgICAgIHB1Ymxpc2hSb29tTWF0Y2gocm9vbUlkOiAkcm9vbUlkLCBtYXRjaERhdGE6ICRtYXRjaERhdGEpIHtcclxuICAgICAgICAgIHJvb21JZFxyXG4gICAgICAgICAgbWF0Y2hJZFxyXG4gICAgICAgICAgbW92aWVJZFxyXG4gICAgICAgICAgbWF0Y2hlZFVzZXJzXHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICBgO1xyXG5cclxuICAgIGNvbnN0IHZhcmlhYmxlcyA9IHtcclxuICAgICAgcm9vbUlkOiBtYXRjaC5yb29tSWQsXHJcbiAgICAgIG1hdGNoRGF0YToge1xyXG4gICAgICAgIG1hdGNoSWQ6IG1hdGNoLmlkLFxyXG4gICAgICAgIG1vdmllSWQ6IG1hdGNoLm1vdmllSWQsXHJcbiAgICAgICAgbW92aWVUaXRsZTogbWF0Y2gudGl0bGUsXHJcbiAgICAgICAgcG9zdGVyUGF0aDogbWF0Y2gucG9zdGVyUGF0aCxcclxuICAgICAgICBtYXRjaGVkVXNlcnM6IG1hdGNoLm1hdGNoZWRVc2VycyxcclxuICAgICAgICBtYXRjaERldGFpbHM6IHtcclxuICAgICAgICAgIHZvdGVDb3VudDogbWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aCxcclxuICAgICAgICAgIHJlcXVpcmVkVm90ZXM6IG1hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGgsXHJcbiAgICAgICAgICBtYXRjaFR5cGU6ICd1bmFuaW1vdXMnXHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwoZW5kcG9pbnQpO1xyXG4gICAgICBjb25zdCByZXF1ZXN0ID0gbmV3IEh0dHBSZXF1ZXN0KHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICAgaG9zdDogdXJsLmhvc3RuYW1lLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaG9zdG5hbWU6IHVybC5ob3N0bmFtZSxcclxuICAgICAgICBwYXRoOiAnL2dyYXBocWwnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgcXVlcnk6IG11dGF0aW9uLCB2YXJpYWJsZXMgfSksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3Qgc2lnbmVyID0gbmV3IFNpZ25hdHVyZVY0KHtcclxuICAgICAgICBjcmVkZW50aWFsczogZGVmYXVsdFByb3ZpZGVyKCksXHJcbiAgICAgICAgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnLFxyXG4gICAgICAgIHNlcnZpY2U6ICdhcHBzeW5jJyxcclxuICAgICAgICBzaGEyNTY6IFNoYTI1NixcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBzaWduZWRSZXF1ZXN0ID0gYXdhaXQgc2lnbmVyLnNpZ24ocmVxdWVzdCk7XHJcblxyXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGVuZHBvaW50LCB7XHJcbiAgICAgICAgbWV0aG9kOiBzaWduZWRSZXF1ZXN0Lm1ldGhvZCxcclxuICAgICAgICBoZWFkZXJzOiBzaWduZWRSZXF1ZXN0LmhlYWRlcnMgYXMgYW55LFxyXG4gICAgICAgIGJvZHk6IHNpZ25lZFJlcXVlc3QuYm9keSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXNwb25zZS5qc29uKCkgYXMgeyBkYXRhPzogYW55OyBlcnJvcnM/OiBhbnlbXSB9O1xyXG4gICAgICBcclxuICAgICAgaWYgKHJlc3VsdC5lcnJvcnMpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgZW4gbm90aWZpY2FjacOzbiBkZSBzYWxhOicsIEpTT04uc3RyaW5naWZ5KHJlc3VsdC5lcnJvcnMpKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIE5vdGlmaWNhY2nDs24gZ2VuZXJhbCBkZSBzYWxhIGVudmlhZGEgZXhpdG9zYW1lbnRlJyk7XHJcbiAgICAgIH1cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBlbnZpYW5kbyBub3RpZmljYWNpw7NuIGdlbmVyYWwgZGUgc2FsYTonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGZhbGxiYWNrVG9DcmVhdGVNYXRjaChtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5SEIFVzaW5nIGZhbGxiYWNrIGNyZWF0ZU1hdGNoIG1ldGhvZC4uLicpO1xyXG4gICAgICBcclxuICAgICAgLy8gRkFMTEJBQ0s6IFVzZSB0aGUgb2xkIGNyZWF0ZU1hdGNoIG1ldGhvZCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxyXG4gICAgICBpZiAodGhpcy5tYXRjaExhbWJkYUFybikge1xyXG4gICAgICAgIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGVNYXRjaCcsXHJcbiAgICAgICAgICBpbnB1dDoge1xyXG4gICAgICAgICAgICByb29tSWQ6IG1hdGNoLnJvb21JZCxcclxuICAgICAgICAgICAgbW92aWVJZDogbWF0Y2gubW92aWVJZCxcclxuICAgICAgICAgICAgdGl0bGU6IG1hdGNoLnRpdGxlLFxyXG4gICAgICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaC5wb3N0ZXJQYXRoLFxyXG4gICAgICAgICAgICBtYXRjaGVkVXNlcnM6IG1hdGNoLm1hdGNoZWRVc2VycyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coJ/CfmoAgSW52b2tpbmcgTWF0Y2ggTGFtYmRhIHdpdGggY3JlYXRlTWF0Y2ggKGZhbGxiYWNrKS4uLicpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlQ29tbWFuZCh7XHJcbiAgICAgICAgICBGdW5jdGlvbk5hbWU6IHRoaXMubWF0Y2hMYW1iZGFBcm4sXHJcbiAgICAgICAgICBJbnZvY2F0aW9uVHlwZTogJ1JlcXVlc3RSZXNwb25zZScsXHJcbiAgICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKSxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChjb21tYW5kKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAocmVzcG9uc2UuUGF5bG9hZCkge1xyXG4gICAgICAgICAgY29uc3QgcmVzdWx0ID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocmVzcG9uc2UuUGF5bG9hZCkpO1xyXG4gICAgICAgICAgaWYgKHJlc3VsdC5zdGF0dXNDb2RlID09PSAyMDApIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ+KchSBGYWxsYmFjayBjcmVhdGVNYXRjaCBleGVjdXRlZCBzdWNjZXNzZnVsbHknKTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWxsYmFjayBjcmVhdGVNYXRjaCByZXR1cm5lZCBlcnJvcjonLCByZXN1bHQuYm9keT8uZXJyb3IpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gU3RvcmUgbm90aWZpY2F0aW9ucyBmb3IgcG9sbGluZyBmYWxsYmFja1xyXG4gICAgICBhd2FpdCB0aGlzLnN0b3JlTWF0Y2hOb3RpZmljYXRpb25zKG1hdGNoKTtcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgaW4gZmFsbGJhY2sgbWV0aG9kOicsIGVycm9yKTtcclxuICAgICAgLy8gU3RvcmUgbm90aWZpY2F0aW9ucyBmb3IgcG9sbGluZyBhcyBmaW5hbCBmYWxsYmFja1xyXG4gICAgICBhd2FpdCB0aGlzLnN0b3JlTWF0Y2hOb3RpZmljYXRpb25zKG1hdGNoKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc3RvcmVNYXRjaE5vdGlmaWNhdGlvbnMobWF0Y2g6IE1hdGNoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBTdG9yZSBpbmRpdmlkdWFsIG5vdGlmaWNhdGlvbiByZWNvcmRzIGZvciBlYWNoIHVzZXJcclxuICAgICAgLy8gVGhpcyBlbmFibGVzIHBvbGxpbmctYmFzZWQgbWF0Y2ggZGV0ZWN0aW9uIGFzIGEgZmFsbGJhY2tcclxuICAgICAgY29uc3Qgbm90aWZpY2F0aW9uUHJvbWlzZXMgPSBtYXRjaC5tYXRjaGVkVXNlcnMubWFwKGFzeW5jICh1c2VySWQpID0+IHtcclxuICAgICAgICBjb25zdCBub3RpZmljYXRpb25SZWNvcmQgPSB7XHJcbiAgICAgICAgICB1c2VySWQsXHJcbiAgICAgICAgICBtYXRjaElkOiBtYXRjaC5pZCxcclxuICAgICAgICAgIG9yaWdpbmFsUm9vbUlkOiBtYXRjaC5yb29tSWQsIC8vIFN0b3JlIG9yaWdpbmFsIHJvb21JZCBzZXBhcmF0ZWx5XHJcbiAgICAgICAgICBvcmlnaW5hbE1vdmllSWQ6IG1hdGNoLm1vdmllSWQsIC8vIFN0b3JlIG9yaWdpbmFsIG1vdmllSWQgc2VwYXJhdGVseVxyXG4gICAgICAgICAgdGl0bGU6IG1hdGNoLnRpdGxlLFxyXG4gICAgICAgICAgcG9zdGVyUGF0aDogbWF0Y2gucG9zdGVyUGF0aCxcclxuICAgICAgICAgIHRpbWVzdGFtcDogbWF0Y2gudGltZXN0YW1wLFxyXG4gICAgICAgICAgbm90aWZpZWQ6IGZhbHNlLCAvLyBGbGFnIHRvIHRyYWNrIGlmIHVzZXIgaGFzIGJlZW4gbm90aWZpZWRcclxuICAgICAgICAgIHR0bDogTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCkgKyAoNyAqIDI0ICogNjAgKiA2MCksIC8vIDcgZGF5cyBUVExcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICAvLyBTdG9yZSBpbiBhIG5vdGlmaWNhdGlvbnMgdGFibGUgKHdlJ2xsIHVzZSB0aGUgbWF0Y2hlcyB0YWJsZSB3aXRoIGEgc3BlY2lhbCBwYXR0ZXJuKVxyXG4gICAgICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgICBJdGVtOiB7XHJcbiAgICAgICAgICAgIHJvb21JZDogYE5PVElGSUNBVElPTiMke3VzZXJJZH1gLCAvLyBTcGVjaWFsIHByZWZpeCBmb3Igbm90aWZpY2F0aW9uc1xyXG4gICAgICAgICAgICBtb3ZpZUlkOiBEYXRlLm5vdygpLCAvLyBVc2UgdGltZXN0YW1wIGFzIHNvcnQga2V5IGZvciB1bmlxdWVuZXNzXHJcbiAgICAgICAgICAgIC4uLm5vdGlmaWNhdGlvblJlY29yZCxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSkpO1xyXG5cclxuICAgICAgICBjb25zb2xlLmxvZyhgTm90aWZpY2F0aW9uIHN0b3JlZCBmb3IgdXNlciAke3VzZXJJZH1gKTtcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQobm90aWZpY2F0aW9uUHJvbWlzZXMpO1xyXG4gICAgICBjb25zb2xlLmxvZygn4pyFIE1hdGNoIG5vdGlmaWNhdGlvbnMgc3RvcmVkIGZvciBwb2xsaW5nIGZhbGxiYWNrJyk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzdG9yaW5nIG1hdGNoIG5vdGlmaWNhdGlvbnM6JywgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBub3RpZnlNYXRjaENyZWF0ZWQobWF0Y2g6IE1hdGNoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBwYXlsb2FkID0ge1xyXG4gICAgICAgIG9wZXJhdGlvbjogJ21hdGNoQ3JlYXRlZCcsXHJcbiAgICAgICAgbWF0Y2gsXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBjb25zdCBjb21tYW5kID0gbmV3IEludm9rZUNvbW1hbmQoe1xyXG4gICAgICAgIEZ1bmN0aW9uTmFtZTogdGhpcy5tYXRjaExhbWJkYUFybixcclxuICAgICAgICBJbnZvY2F0aW9uVHlwZTogJ0V2ZW50JywgLy8gQXN5bmMgaW52b2NhdGlvblxyXG4gICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKGNvbW1hbmQpO1xyXG4gICAgICBjb25zb2xlLmxvZygnTWF0Y2ggbm90aWZpY2F0aW9uIHNlbnQgdG8gTWF0Y2ggTGFtYmRhJyk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gbm90aWZ5IE1hdGNoIExhbWJkYTonLCBlcnJvcik7XHJcbiAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuLy8gTGFtYmRhIEhhbmRsZXJcclxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXI8Vm90ZUV2ZW50LCBWb3RlUmVzcG9uc2U+ID0gYXN5bmMgKGV2ZW50KSA9PiB7XHJcbiAgY29uc29sZS5sb2coJ1ZvdGUgTGFtYmRhIHJlY2VpdmVkIGV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCB7IHVzZXJJZCwgaW5wdXQgfSA9IGV2ZW50O1xyXG4gICAgY29uc3QgeyByb29tSWQsIG1vdmllSWQsIHZvdGUgfSA9IGlucHV0O1xyXG5cclxuICAgIC8vIFZhbGlkYXRlIGlucHV0XHJcbiAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgSUQgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIXJvb21JZCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gSUQgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodHlwZW9mIG1vdmllSWQgIT09ICdudW1iZXInKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTW92aWUgSUQgbXVzdCBiZSBhIG51bWJlcicpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0eXBlb2Ygdm90ZSAhPT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVm90ZSBtdXN0IGJlIGEgYm9vbGVhbicpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHZvdGVTZXJ2aWNlID0gbmV3IFZvdGVTZXJ2aWNlKCk7XHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB2b3RlU2VydmljZS5wcm9jZXNzVm90ZSh1c2VySWQsIHJvb21JZCwgbW92aWVJZCwgdm90ZSk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBib2R5OiByZXN1bHQsXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignVm90ZSBMYW1iZGEgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgXHJcbiAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yIG9jY3VycmVkJztcclxuICAgIFxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogNDAwLFxyXG4gICAgICBib2R5OiB7XHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXHJcbiAgICAgICAgZXJyb3I6IGVycm9yTWVzc2FnZSxcclxuICAgICAgfSxcclxuICAgIH07XHJcbiAgfVxyXG59OyJdfQ==