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
        console.log(`Match created: ${matchId} with ${matchedUsers.length} users and individual user records`);
        // Delete the room since match is found - room is no longer needed
        await this.deleteRoom(roomId);
        // CRITICAL: Trigger AppSync subscription by calling the createMatch mutation
        // This is the key fix - we need to execute the GraphQL mutation to trigger subscriptions
        await this.triggerAppSyncSubscription(match);
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
        console.log(`🔔 BROADCASTING REAL: Llamando a AppSync API para sala ${match.roomId}`);
        console.log(`🚀 NUEVA IMPLEMENTACION: Usando llamada HTTP directa a AppSync`);
        const endpoint = process.env.GRAPHQL_ENDPOINT;
        if (!endpoint) {
            console.error('❌ GRAPHQL_ENDPOINT no está definido');
            throw new Error('GRAPHQL_ENDPOINT no está definido');
        }
        // La mutación que dispara la suscripción "NoneDataSource"
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
        // Preparamos la petición HTTP
        const request = new protocol_http_1.HttpRequest({
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                host: new URL(endpoint).hostname,
            },
            hostname: new URL(endpoint).hostname,
            path: '/graphql',
            body: JSON.stringify({ query: mutation, variables }),
        });
        // Firmamos la petición con credenciales IAM de la Lambda
        const signer = new signature_v4_1.SignatureV4({
            credentials: (0, credential_provider_node_1.defaultProvider)(),
            region: process.env.AWS_REGION || 'us-east-1',
            service: 'appsync',
            sha256: sha256_js_1.Sha256,
        });
        try {
            const signedRequest = await signer.sign(request);
            // Usamos fetch nativo (Node 18+)
            const response = await fetch(endpoint, {
                method: signedRequest.method,
                headers: signedRequest.headers,
                body: signedRequest.body,
            });
            const result = await response.json();
            if (result.errors) {
                console.error('❌ Error de AppSync:', JSON.stringify(result.errors));
                throw new Error(`AppSync GraphQL errors: ${JSON.stringify(result.errors)}`);
            }
            else {
                console.log('✅ AppSync Broadcast Exitoso:', JSON.stringify(result.data));
                console.log(`🔔 Suscripción onRoomMatch disparada para sala ${match.roomId}`);
                console.log(`👥 Usuarios notificados: ${match.matchedUsers.join(', ')}`);
            }
        }
        catch (error) {
            console.error('❌ Error fatal llamando a AppSync:', error);
            // Aquí mantenemos el fallback de polling si falla
            await this.storeMatchNotifications(match);
            throw error;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdm90ZS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQW9IO0FBQ3BILDBEQUFxRTtBQUNyRSx3REFBb0Q7QUFDcEQscURBQStDO0FBQy9DLGdGQUFvRTtBQUNwRSwwREFBcUQ7QUFFckQseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUE4RDFFLGVBQWU7QUFDZixNQUFNLFdBQVc7SUFNZjtRQUNFLElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBQ3BELElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxjQUFjLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsSUFBSSxFQUFFLENBQUM7UUFFekQsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQy9ELE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUMsQ0FBQztRQUN0RSxDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxXQUFXLENBQUMsTUFBYyxFQUFFLE1BQWMsRUFBRSxPQUFlLEVBQUUsSUFBYTtRQUM5RSw0Q0FBNEM7UUFDNUMsTUFBTSxJQUFJLEdBQUcsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ3hDLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNWLE1BQU0sSUFBSSxLQUFLLENBQUMsK0JBQStCLENBQUMsQ0FBQztRQUNuRCxDQUFDO1FBRUQsMkVBQTJFO1FBQzNFLHNFQUFzRTtRQUN0RSw4REFBOEQ7UUFDOUQsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztRQUMxRSxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDbkIsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO1FBQzVELENBQUM7UUFFRCx1Q0FBdUM7UUFDdkMsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxLQUFLLE9BQU8sQ0FBQyxDQUFDO1FBQ25FLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUNwQixNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxDQUFDLENBQUM7UUFDeEQsQ0FBQztRQUVELGtCQUFrQjtRQUNsQixNQUFNLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFckQsc0NBQXNDO1FBQ3RDLElBQUksS0FBd0IsQ0FBQztRQUM3QixJQUFJLElBQUksRUFBRSxDQUFDO1lBQ1QsS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUUsT0FBTyxFQUFFLGNBQWMsQ0FBQyxDQUFDO1FBQ3BFLENBQUM7UUFFRCxPQUFPLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsQ0FBQztJQUNsQyxDQUFDO0lBRU8sS0FBSyxDQUFDLGtCQUFrQixDQUFDLE1BQWMsRUFBRSxNQUFjLEVBQUUsSUFBVTtRQUN6RSxJQUFJLENBQUM7WUFDSCx3RkFBd0Y7WUFDeEYsSUFBSSxJQUFJLENBQUMsTUFBTSxLQUFLLE1BQU0sRUFBRSxDQUFDO2dCQUMzQixPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsTUFBTSx3QkFBd0IsTUFBTSxtQkFBbUIsQ0FBQyxDQUFDO2dCQUM3RSxPQUFPLElBQUksQ0FBQztZQUNkLENBQUM7WUFFRCx5REFBeUQ7WUFDekQsTUFBTSxlQUFlLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksMkJBQVksQ0FBQztnQkFDNUQsU0FBUyxFQUFFLElBQUksQ0FBQyxVQUFVO2dCQUMxQixzQkFBc0IsRUFBRSxrQkFBa0I7Z0JBQzFDLGdCQUFnQixFQUFFLGtCQUFrQjtnQkFDcEMseUJBQXlCLEVBQUU7b0JBQ3pCLFNBQVMsRUFBRSxNQUFNO29CQUNqQixTQUFTLEVBQUUsTUFBTTtpQkFDbEI7Z0JBQ0QsS0FBSyxFQUFFLENBQUM7YUFDVCxDQUFDLENBQUMsQ0FBQztZQUVKLElBQUksZUFBZSxDQUFDLEtBQUssSUFBSSxlQUFlLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDOUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLE1BQU0saUNBQWlDLE1BQU0sbUJBQW1CLENBQUMsQ0FBQztnQkFDdEYsT0FBTyxJQUFJLENBQUM7WUFDZCxDQUFDO1lBRUQsZ0VBQWdFO1lBQ2hFLGtGQUFrRjtZQUNsRixPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsTUFBTSwyQkFBMkIsTUFBTSxpQ0FBaUMsQ0FBQyxDQUFDO1lBQzlGLE9BQU8sSUFBSSxDQUFDO1FBRWQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLHlDQUF5QyxNQUFNLFlBQVksTUFBTSxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDM0YscURBQXFEO1lBQ3JELE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUM7SUFFTyxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQWM7UUFDbEMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUkseUJBQVUsQ0FBQztnQkFDakQsU0FBUyxFQUFFLElBQUksQ0FBQyxVQUFVO2dCQUMxQixHQUFHLEVBQUUsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFO2FBQ3BCLENBQUMsQ0FBQyxDQUFDO1lBRUosSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQztnQkFDakIsT0FBTyxJQUFJLENBQUM7WUFDZCxDQUFDO1lBRUQsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQVksQ0FBQztZQUVqQyw0QkFBNEI7WUFDNUIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUM7WUFDMUMsSUFBSSxJQUFJLENBQUMsR0FBRyxJQUFJLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUM7Z0JBQy9CLE9BQU8sSUFBSSxDQUFDO1lBQ2QsQ0FBQztZQUVELE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLHFCQUFxQixFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQzVDLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUM7SUFFTyxLQUFLLENBQUMsVUFBVSxDQUFDLE1BQWMsRUFBRSxNQUFjLEVBQUUsT0FBZSxFQUFFLElBQWE7UUFDckYsTUFBTSxXQUFXLEdBQUcsR0FBRyxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7UUFDM0MsTUFBTSxTQUFTLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUUzQyxNQUFNLFVBQVUsR0FBUztZQUN2QixNQUFNO1lBQ04sV0FBVztZQUNYLE1BQU07WUFDTixPQUFPO1lBQ1AsSUFBSTtZQUNKLFNBQVM7U0FDVixDQUFDO1FBRUYsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUkseUJBQVUsQ0FBQztZQUNsQyxTQUFTLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDMUIsSUFBSSxFQUFFLFVBQVU7WUFDaEIsdUVBQXVFO1NBQ3hFLENBQUMsQ0FBQyxDQUFDO1FBRUosT0FBTyxDQUFDLEdBQUcsQ0FBQyx1QkFBdUIsTUFBTSxVQUFVLElBQUksQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLGNBQWMsT0FBTyxZQUFZLE1BQU0sRUFBRSxDQUFDLENBQUM7SUFDbkgsQ0FBQztJQUVPLEtBQUssQ0FBQyxhQUFhLENBQUMsTUFBYyxFQUFFLE9BQWUsRUFBRSxjQUE4QjtRQUN6RixJQUFJLENBQUM7WUFDSCw4RUFBOEU7WUFDOUUsTUFBTSxXQUFXLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksMkJBQVksQ0FBQztnQkFDeEQsU0FBUyxFQUFFLElBQUksQ0FBQyxVQUFVO2dCQUMxQixzQkFBc0IsRUFBRSxrQkFBa0I7Z0JBQzFDLGdCQUFnQixFQUFFLHlFQUF5RTtnQkFDM0YseUJBQXlCLEVBQUU7b0JBQ3pCLFNBQVMsRUFBRSxNQUFNO29CQUNqQixVQUFVLEVBQUUsT0FBTztvQkFDbkIsT0FBTyxFQUFFLElBQUksRUFBRSxzQkFBc0I7b0JBQ3JDLHNCQUFzQixFQUFFLENBQUMsQ0FBQyxFQUFFLGdDQUFnQztpQkFDN0Q7YUFDRixDQUFDLENBQUMsQ0FBQztZQUVKLE1BQU0sYUFBYSxHQUFHLFdBQVcsQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDO1lBQzlDLE9BQU8sQ0FBQyxHQUFHLENBQUMsU0FBUyxhQUFhLENBQUMsTUFBTSw2QkFBNkIsT0FBTyxZQUFZLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFFbkcscUZBQXFGO1lBQ3JGLE1BQU0sY0FBYyxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLDJCQUFZLENBQUM7Z0JBQzNELFNBQVMsRUFBRSxJQUFJLENBQUMsVUFBVTtnQkFDMUIsc0JBQXNCLEVBQUUsa0JBQWtCO2dCQUMxQyxnQkFBZ0IsRUFBRSxpQ0FBaUMsRUFBRSxnQ0FBZ0M7Z0JBQ3JGLHlCQUF5QixFQUFFO29CQUN6QixTQUFTLEVBQUUsTUFBTTtvQkFDakIsc0JBQXNCLEVBQUUsQ0FBQyxDQUFDO2lCQUMzQjthQUNGLENBQUMsQ0FBQyxDQUFDO1lBRUosTUFBTSxRQUFRLEdBQUcsY0FBYyxDQUFDLEtBQUssSUFBSSxFQUFFLENBQUM7WUFDNUMsTUFBTSxXQUFXLEdBQUcsSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFFLElBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBQ3pFLE1BQU0sVUFBVSxHQUFHLFdBQVcsQ0FBQyxJQUFJLENBQUM7WUFFcEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4Q0FBOEMsVUFBVSxFQUFFLENBQUMsQ0FBQztZQUV4RSxxREFBcUQ7WUFDckQsTUFBTSxlQUFlLEdBQUcsSUFBSSxHQUFHLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFFLElBQWEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBRWxGLElBQUksZUFBZSxDQUFDLElBQUksS0FBSyxVQUFVLElBQUksVUFBVSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUMxRCw4Q0FBOEM7Z0JBQzlDLE9BQU8sQ0FBQyxHQUFHLENBQUMsdUJBQXVCLFVBQVUscUNBQXFDLE9BQU8sRUFBRSxDQUFDLENBQUM7Z0JBRTdGLGdDQUFnQztnQkFDaEMsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFDO2dCQUNuRSxJQUFJLGFBQWEsRUFBRSxDQUFDO29CQUNsQixPQUFPLENBQUMsR0FBRyxDQUFDLGdEQUFnRCxDQUFDLENBQUM7b0JBQzlELE9BQU8sYUFBYSxDQUFDO2dCQUN2QixDQUFDO2dCQUVELG1CQUFtQjtnQkFDbkIsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQztnQkFDbkcsT0FBTyxLQUFLLENBQUM7WUFDZixDQUFDO1lBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQ0FBaUMsZUFBZSxDQUFDLElBQUksa0JBQWtCLFVBQVUsRUFBRSxDQUFDLENBQUM7WUFDakcsT0FBTyxTQUFTLENBQUM7UUFFbkIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLDJCQUEyQixFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ2xELE9BQU8sU0FBUyxDQUFDO1FBQ25CLENBQUM7SUFDSCxDQUFDO0lBRU8sS0FBSyxDQUFDLGdCQUFnQixDQUFDLE1BQWMsRUFBRSxPQUFlO1FBQzVELElBQUksQ0FBQztZQUNILE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLHlCQUFVLENBQUM7Z0JBQ2pELFNBQVMsRUFBRSxJQUFJLENBQUMsWUFBWTtnQkFDNUIsR0FBRyxFQUFFO29CQUNILE1BQU07b0JBQ04sT0FBTztpQkFDUjthQUNGLENBQUMsQ0FBQyxDQUFDO1lBRUosT0FBTyxNQUFNLENBQUMsSUFBYSxJQUFJLElBQUksQ0FBQztRQUN0QyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsZ0NBQWdDLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDdkQsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO0lBQ0gsQ0FBQztJQUVPLEtBQUssQ0FBQyxXQUFXLENBQUMsTUFBYyxFQUFFLE9BQWUsRUFBRSxjQUE4QixFQUFFLFlBQXNCO1FBQy9HLE1BQU0sU0FBUyxHQUFHLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUM7UUFDM0MsTUFBTSxPQUFPLEdBQUcsR0FBRyxNQUFNLElBQUksT0FBTyxFQUFFLENBQUM7UUFFdkMsTUFBTSxLQUFLLEdBQVU7WUFDbkIsRUFBRSxFQUFFLE9BQU87WUFDWCxNQUFNO1lBQ04sT0FBTztZQUNQLEtBQUssRUFBRSxjQUFjLENBQUMsS0FBSztZQUMzQixVQUFVLEVBQUUsY0FBYyxDQUFDLFVBQVUsSUFBSSxTQUFTO1lBQ2xELFNBQVMsRUFBRSxjQUFjLENBQUMsU0FBUztZQUNuQyxZQUFZO1lBQ1osU0FBUztTQUNWLENBQUM7UUFFRiw4QkFBOEI7UUFDOUIsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUkseUJBQVUsQ0FBQztZQUNsQyxTQUFTLEVBQUUsSUFBSSxDQUFDLFlBQVk7WUFDNUIsSUFBSSxFQUFFLEtBQUs7WUFDWCxtQkFBbUIsRUFBRSxnRUFBZ0UsRUFBRSxxQkFBcUI7U0FDN0csQ0FBQyxDQUFDLENBQUM7UUFFSixnRkFBZ0Y7UUFDaEYsd0VBQXdFO1FBQ3hFLE1BQU0saUJBQWlCLEdBQUcsWUFBWSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDMUQsTUFBTSxTQUFTLEdBQUc7Z0JBQ2hCLEdBQUcsS0FBSztnQkFDUixNQUFNLEVBQUUsMkJBQTJCO2dCQUNuQyxFQUFFLEVBQUUsR0FBRyxNQUFNLElBQUksT0FBTyxFQUFFLEVBQUUscUJBQXFCO2dCQUNqRCxNQUFNLEVBQUUsR0FBRyxNQUFNLElBQUksTUFBTSxFQUFFLEVBQUUsbUNBQW1DO2FBQ25FLENBQUM7WUFFRixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUkseUJBQVUsQ0FBQztvQkFDbEMsU0FBUyxFQUFFLElBQUksQ0FBQyxZQUFZO29CQUM1QixJQUFJLEVBQUUsU0FBUztpQkFDaEIsQ0FBQyxDQUFDLENBQUM7Z0JBQ0osT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQ0FBc0MsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUM5RCxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixPQUFPLENBQUMsS0FBSyxDQUFDLHdDQUF3QyxNQUFNLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztnQkFDeEUsOENBQThDO1lBQ2hELENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztRQUVILGdEQUFnRDtRQUNoRCxNQUFNLE9BQU8sQ0FBQyxVQUFVLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUU1QyxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixPQUFPLFNBQVMsWUFBWSxDQUFDLE1BQU0sb0NBQW9DLENBQUMsQ0FBQztRQUV2RyxrRUFBa0U7UUFDbEUsTUFBTSxJQUFJLENBQUMsVUFBVSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRTlCLDZFQUE2RTtRQUM3RSx5RkFBeUY7UUFDekYsTUFBTSxJQUFJLENBQUMsMEJBQTBCLENBQUMsS0FBSyxDQUFDLENBQUM7UUFFN0MsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBRU8sS0FBSyxDQUFDLFVBQVUsQ0FBQyxNQUFjO1FBQ3JDLElBQUksQ0FBQztZQUNILGdDQUFnQztZQUNoQyxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSw0QkFBYSxDQUFDO2dCQUNyQyxTQUFTLEVBQUUsSUFBSSxDQUFDLFVBQVU7Z0JBQzFCLEdBQUcsRUFBRSxFQUFFLEVBQUUsRUFBRSxNQUFNLEVBQUU7YUFDcEIsQ0FBQyxDQUFDLENBQUM7WUFFSixPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsTUFBTSwrQkFBK0IsQ0FBQyxDQUFDO1lBRTNELDhEQUE4RDtZQUM5RCxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDckMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLHVCQUF1QixNQUFNLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN2RCx1REFBdUQ7UUFDekQsQ0FBQztJQUNILENBQUM7SUFFTyxLQUFLLENBQUMsZUFBZSxDQUFDLE1BQWM7UUFDMUMsSUFBSSxDQUFDO1lBQ0gsd0RBQXdEO1lBQ3hELE1BQU0sV0FBVyxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLDJCQUFZLENBQUM7Z0JBQ3hELFNBQVMsRUFBRSxJQUFJLENBQUMsVUFBVTtnQkFDMUIsc0JBQXNCLEVBQUUsa0JBQWtCO2dCQUMxQyx5QkFBeUIsRUFBRTtvQkFDekIsU0FBUyxFQUFFLE1BQU07aUJBQ2xCO2FBQ0YsQ0FBQyxDQUFDLENBQUM7WUFFSixNQUFNLFVBQVUsR0FBRyxXQUFXLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQztZQUUzQywwREFBMEQ7WUFDMUQsTUFBTSxjQUFjLEdBQUcsVUFBVSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUM3QyxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksNEJBQWEsQ0FBQztnQkFDL0IsU0FBUyxFQUFFLElBQUksQ0FBQyxVQUFVO2dCQUMxQixHQUFHLEVBQUU7b0JBQ0gsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO29CQUNyQixXQUFXLEVBQUUsTUFBTSxDQUFDLFdBQVc7aUJBQ2hDO2FBQ0YsQ0FBQyxDQUFDLENBQ0osQ0FBQztZQUVGLE1BQU0sT0FBTyxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUMsQ0FBQztZQUN6QyxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsVUFBVSxDQUFDLE1BQU0sK0NBQStDLE1BQU0sRUFBRSxDQUFDLENBQUM7UUFDbkcsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLG1DQUFtQyxNQUFNLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNyRSxDQUFDO0lBQ0gsQ0FBQztJQUVPLEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxLQUFZO1FBQ25ELE9BQU8sQ0FBQyxHQUFHLENBQUMsMERBQTBELEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBQ3RGLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0VBQWdFLENBQUMsQ0FBQztRQUU5RSxNQUFNLFFBQVEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixDQUFDO1FBQzlDLElBQUksQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMscUNBQXFDLENBQUMsQ0FBQztZQUNyRCxNQUFNLElBQUksS0FBSyxDQUFDLG1DQUFtQyxDQUFDLENBQUM7UUFDdkQsQ0FBQztRQUVELDBEQUEwRDtRQUMxRCxNQUFNLFFBQVEsR0FBRzs7Ozs7Ozs7O0tBU2hCLENBQUM7UUFFRixNQUFNLFNBQVMsR0FBRztZQUNoQixNQUFNLEVBQUUsS0FBSyxDQUFDLE1BQU07WUFDcEIsU0FBUyxFQUFFO2dCQUNULE9BQU8sRUFBRSxLQUFLLENBQUMsRUFBRTtnQkFDakIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO2dCQUN0QixVQUFVLEVBQUUsS0FBSyxDQUFDLEtBQUs7Z0JBQ3ZCLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtnQkFDNUIsWUFBWSxFQUFFLEtBQUssQ0FBQyxZQUFZO2dCQUNoQyxZQUFZLEVBQUU7b0JBQ1osU0FBUyxFQUFFLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTTtvQkFDcEMsYUFBYSxFQUFFLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTTtvQkFDeEMsU0FBUyxFQUFFLFdBQVc7aUJBQ3ZCO2FBQ0Y7U0FDRixDQUFDO1FBRUYsOEJBQThCO1FBQzlCLE1BQU0sT0FBTyxHQUFHLElBQUksMkJBQVcsQ0FBQztZQUM5QixNQUFNLEVBQUUsTUFBTTtZQUNkLE9BQU8sRUFBRTtnQkFDUCxjQUFjLEVBQUUsa0JBQWtCO2dCQUNsQyxJQUFJLEVBQUUsSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUMsUUFBUTthQUNqQztZQUNELFFBQVEsRUFBRSxJQUFJLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQyxRQUFRO1lBQ3BDLElBQUksRUFBRSxVQUFVO1lBQ2hCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBQztTQUNyRCxDQUFDLENBQUM7UUFFSCx5REFBeUQ7UUFDekQsTUFBTSxNQUFNLEdBQUcsSUFBSSwwQkFBVyxDQUFDO1lBQzdCLFdBQVcsRUFBRSxJQUFBLDBDQUFlLEdBQUU7WUFDOUIsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVc7WUFDN0MsT0FBTyxFQUFFLFNBQVM7WUFDbEIsTUFBTSxFQUFFLGtCQUFNO1NBQ2YsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDO1lBQ0gsTUFBTSxhQUFhLEdBQUcsTUFBTSxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBRWpELGlDQUFpQztZQUNqQyxNQUFNLFFBQVEsR0FBRyxNQUFNLEtBQUssQ0FBQyxRQUFRLEVBQUU7Z0JBQ3JDLE1BQU0sRUFBRSxhQUFhLENBQUMsTUFBTTtnQkFDNUIsT0FBTyxFQUFFLGFBQWEsQ0FBQyxPQUFjO2dCQUNyQyxJQUFJLEVBQUUsYUFBYSxDQUFDLElBQUk7YUFDekIsQ0FBQyxDQUFDO1lBRUgsTUFBTSxNQUFNLEdBQUcsTUFBTSxRQUFRLENBQUMsSUFBSSxFQUFvQyxDQUFDO1lBRXZFLElBQUksTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUNsQixPQUFPLENBQUMsS0FBSyxDQUFDLHFCQUFxQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUM7Z0JBQ3BFLE1BQU0sSUFBSSxLQUFLLENBQUMsMkJBQTJCLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUM5RSxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO2dCQUN6RSxPQUFPLENBQUMsR0FBRyxDQUFDLGtEQUFrRCxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztnQkFDOUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0QkFBNEIsS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQzNFLENBQUM7UUFDSCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsbUNBQW1DLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDMUQsa0RBQWtEO1lBQ2xELE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQzFDLE1BQU0sS0FBSyxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUM7SUFFTyxLQUFLLENBQUMscUJBQXFCLENBQUMsS0FBWTtRQUM5QyxJQUFJLENBQUM7WUFDSCxPQUFPLENBQUMsR0FBRyxDQUFDLHlDQUF5QyxDQUFDLENBQUM7WUFFdkQsc0VBQXNFO1lBQ3RFLElBQUksSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO2dCQUN4QixNQUFNLE9BQU8sR0FBRztvQkFDZCxTQUFTLEVBQUUsYUFBYTtvQkFDeEIsS0FBSyxFQUFFO3dCQUNMLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTTt3QkFDcEIsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO3dCQUN0QixLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUs7d0JBQ2xCLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTt3QkFDNUIsWUFBWSxFQUFFLEtBQUssQ0FBQyxZQUFZO3FCQUNqQztpQkFDRixDQUFDO2dCQUVGLE9BQU8sQ0FBQyxHQUFHLENBQUMseURBQXlELENBQUMsQ0FBQztnQkFFdkUsTUFBTSxPQUFPLEdBQUcsSUFBSSw2QkFBYSxDQUFDO29CQUNoQyxZQUFZLEVBQUUsSUFBSSxDQUFDLGNBQWM7b0JBQ2pDLGNBQWMsRUFBRSxpQkFBaUI7b0JBQ2pDLE9BQU8sRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQztpQkFDakMsQ0FBQyxDQUFDO2dCQUVILE1BQU0sUUFBUSxHQUFHLE1BQU0sWUFBWSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztnQkFFbEQsSUFBSSxRQUFRLENBQUMsT0FBTyxFQUFFLENBQUM7b0JBQ3JCLE1BQU0sTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxXQUFXLEVBQUUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7b0JBQ3RFLElBQUksTUFBTSxDQUFDLFVBQVUsS0FBSyxHQUFHLEVBQUUsQ0FBQzt3QkFDOUIsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4Q0FBOEMsQ0FBQyxDQUFDO29CQUM5RCxDQUFDO3lCQUFNLENBQUM7d0JBQ04sT0FBTyxDQUFDLEtBQUssQ0FBQyx3Q0FBd0MsRUFBRSxNQUFNLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDO29CQUM5RSxDQUFDO2dCQUNILENBQUM7WUFDSCxDQUFDO1lBRUQsMkNBQTJDO1lBQzNDLE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLEtBQUssQ0FBQyxDQUFDO1FBRTVDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyw2QkFBNkIsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUNwRCxvREFBb0Q7WUFDcEQsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDNUMsQ0FBQztJQUNILENBQUM7SUFFTyxLQUFLLENBQUMsdUJBQXVCLENBQUMsS0FBWTtRQUNoRCxJQUFJLENBQUM7WUFDSCxzREFBc0Q7WUFDdEQsMkRBQTJEO1lBQzNELE1BQU0sb0JBQW9CLEdBQUcsS0FBSyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFO2dCQUNuRSxNQUFNLGtCQUFrQixHQUFHO29CQUN6QixNQUFNO29CQUNOLE9BQU8sRUFBRSxLQUFLLENBQUMsRUFBRTtvQkFDakIsY0FBYyxFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUUsbUNBQW1DO29CQUNqRSxlQUFlLEVBQUUsS0FBSyxDQUFDLE9BQU8sRUFBRSxvQ0FBb0M7b0JBQ3BFLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztvQkFDbEIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO29CQUM1QixTQUFTLEVBQUUsS0FBSyxDQUFDLFNBQVM7b0JBQzFCLFFBQVEsRUFBRSxLQUFLLEVBQUUsMENBQTBDO29CQUMzRCxHQUFHLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLENBQUMsRUFBRSxhQUFhO2lCQUN2RSxDQUFDO2dCQUVGLHNGQUFzRjtnQkFDdEYsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUkseUJBQVUsQ0FBQztvQkFDbEMsU0FBUyxFQUFFLElBQUksQ0FBQyxZQUFZO29CQUM1QixJQUFJLEVBQUU7d0JBQ0osTUFBTSxFQUFFLGdCQUFnQixNQUFNLEVBQUUsRUFBRSxtQ0FBbUM7d0JBQ3JFLE9BQU8sRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEVBQUUsMkNBQTJDO3dCQUNoRSxHQUFHLGtCQUFrQjtxQkFDdEI7aUJBQ0YsQ0FBQyxDQUFDLENBQUM7Z0JBRUosT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQ0FBZ0MsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUN4RCxDQUFDLENBQUMsQ0FBQztZQUVILE1BQU0sT0FBTyxDQUFDLFVBQVUsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO1lBQy9DLE9BQU8sQ0FBQyxHQUFHLENBQUMsbURBQW1ELENBQUMsQ0FBQztRQUNuRSxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsb0NBQW9DLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDN0QsQ0FBQztJQUNILENBQUM7SUFFTyxLQUFLLENBQUMsa0JBQWtCLENBQUMsS0FBWTtRQUMzQyxJQUFJLENBQUM7WUFDSCxNQUFNLE9BQU8sR0FBRztnQkFDZCxTQUFTLEVBQUUsY0FBYztnQkFDekIsS0FBSzthQUNOLENBQUM7WUFFRixNQUFNLE9BQU8sR0FBRyxJQUFJLDZCQUFhLENBQUM7Z0JBQ2hDLFlBQVksRUFBRSxJQUFJLENBQUMsY0FBYztnQkFDakMsY0FBYyxFQUFFLE9BQU8sRUFBRSxtQkFBbUI7Z0JBQzVDLE9BQU8sRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQzthQUNqQyxDQUFDLENBQUM7WUFFSCxNQUFNLFlBQVksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDakMsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5Q0FBeUMsQ0FBQyxDQUFDO1FBQ3pELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxnQ0FBZ0MsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN2RCxNQUFNLEtBQUssQ0FBQztRQUNkLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFFRCxpQkFBaUI7QUFDVixNQUFNLE9BQU8sR0FBcUMsS0FBSyxFQUFFLEtBQUssRUFBRSxFQUFFO0lBQ3ZFLE9BQU8sQ0FBQyxHQUFHLENBQUMsNkJBQTZCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO0lBRWxFLElBQUksQ0FBQztRQUNILE1BQU0sRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBQ2hDLE1BQU0sRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxHQUFHLEtBQUssQ0FBQztRQUV4QyxpQkFBaUI7UUFDakIsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ1osTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO1FBQ3pDLENBQUM7UUFFRCxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDWixNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUM7UUFDekMsQ0FBQztRQUVELElBQUksT0FBTyxPQUFPLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDaEMsTUFBTSxJQUFJLEtBQUssQ0FBQywyQkFBMkIsQ0FBQyxDQUFDO1FBQy9DLENBQUM7UUFFRCxJQUFJLE9BQU8sSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQzlCLE1BQU0sSUFBSSxLQUFLLENBQUMsd0JBQXdCLENBQUMsQ0FBQztRQUM1QyxDQUFDO1FBRUQsTUFBTSxXQUFXLEdBQUcsSUFBSSxXQUFXLEVBQUUsQ0FBQztRQUN0QyxNQUFNLE1BQU0sR0FBRyxNQUFNLFdBQVcsQ0FBQyxXQUFXLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFNUUsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFLE1BQU07U0FDYixDQUFDO0lBRUosQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLG9CQUFvQixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRTNDLE1BQU0sWUFBWSxHQUFHLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLHdCQUF3QixDQUFDO1FBRXZGLE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLElBQUksRUFBRTtnQkFDSixPQUFPLEVBQUUsS0FBSztnQkFDZCxLQUFLLEVBQUUsWUFBWTthQUNwQjtTQUNGLENBQUM7SUFDSixDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBN0NXLFFBQUEsT0FBTyxXQTZDbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUHV0Q29tbWFuZCwgUXVlcnlDb21tYW5kLCBHZXRDb21tYW5kLCBEZWxldGVDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcclxuaW1wb3J0IHsgTGFtYmRhQ2xpZW50LCBJbnZva2VDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSc7XHJcbmltcG9ydCB7IFNpZ25hdHVyZVY0IH0gZnJvbSAnQGF3cy1zZGsvc2lnbmF0dXJlLXY0JztcclxuaW1wb3J0IHsgU2hhMjU2IH0gZnJvbSAnQGF3cy1jcnlwdG8vc2hhMjU2LWpzJztcclxuaW1wb3J0IHsgZGVmYXVsdFByb3ZpZGVyIH0gZnJvbSAnQGF3cy1zZGsvY3JlZGVudGlhbC1wcm92aWRlci1ub2RlJztcclxuaW1wb3J0IHsgSHR0cFJlcXVlc3QgfSBmcm9tICdAYXdzLXNkay9wcm90b2NvbC1odHRwJztcclxuXHJcbi8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcclxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KTtcclxuY29uc3QgbGFtYmRhQ2xpZW50ID0gbmV3IExhbWJkYUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuXHJcbi8vIFR5cGVzXHJcbmludGVyZmFjZSBWb3RlIHtcclxuICByb29tSWQ6IHN0cmluZztcclxuICB1c2VyTW92aWVJZDogc3RyaW5nOyAvLyBGb3JtYXQ6IFwidXNlcklkI21vdmllSWRcIlxyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIG1vdmllSWQ6IG51bWJlcjtcclxuICB2b3RlOiBib29sZWFuO1xyXG4gIHRpbWVzdGFtcDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTWF0Y2gge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgbW92aWVJZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aD86IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIG1hdGNoZWRVc2Vyczogc3RyaW5nW107XHJcbiAgdGltZXN0YW1wOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBSb29tIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIGNvZGU6IHN0cmluZztcclxuICBob3N0SWQ6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIGdlbnJlSWRzOiBudW1iZXJbXTtcclxuICBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdO1xyXG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xyXG4gIHR0bDogbnVtYmVyO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTW92aWVDYW5kaWRhdGUge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg6IHN0cmluZyB8IG51bGw7XHJcbiAgcmVsZWFzZURhdGU6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVm90ZUV2ZW50IHtcclxuICBvcGVyYXRpb246ICd2b3RlJztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICBpbnB1dDoge1xyXG4gICAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgICB2b3RlOiBib29sZWFuO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBWb3RlUmVzcG9uc2Uge1xyXG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcclxuICBib2R5OiB7XHJcbiAgICBzdWNjZXNzOiBib29sZWFuO1xyXG4gICAgbWF0Y2g/OiBNYXRjaDtcclxuICAgIGVycm9yPzogc3RyaW5nO1xyXG4gIH07XHJcbn1cclxuXHJcbi8vIFZvdGUgU2VydmljZVxyXG5jbGFzcyBWb3RlU2VydmljZSB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB2b3Rlc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBtYXRjaGVzVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHJvb21zVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IG1hdGNoTGFtYmRhQXJuOiBzdHJpbmc7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy52b3Rlc1RhYmxlID0gcHJvY2Vzcy5lbnYuVk9URVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLm1hdGNoZXNUYWJsZSA9IHByb2Nlc3MuZW52Lk1BVENIRVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLnJvb21zVGFibGUgPSBwcm9jZXNzLmVudi5ST09NU19UQUJMRSB8fCAnJztcclxuICAgIHRoaXMubWF0Y2hMYW1iZGFBcm4gPSBwcm9jZXNzLmVudi5NQVRDSF9MQU1CREFfQVJOIHx8ICcnO1xyXG5cclxuICAgIGlmICghdGhpcy52b3Rlc1RhYmxlIHx8ICF0aGlzLm1hdGNoZXNUYWJsZSB8fCAhdGhpcy5yb29tc1RhYmxlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVxdWlyZWQgdGFibGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGFyZSBtaXNzaW5nJyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBwcm9jZXNzVm90ZSh1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgdm90ZTogYm9vbGVhbik6IFByb21pc2U8eyBzdWNjZXNzOiBib29sZWFuOyBtYXRjaD86IE1hdGNoIH0+IHtcclxuICAgIC8vIFZhbGlkYXRlIHJvb20gZXhpc3RzIGFuZCBnZXQgcm9vbSBkZXRhaWxzXHJcbiAgICBjb25zdCByb29tID0gYXdhaXQgdGhpcy5nZXRSb29tKHJvb21JZCk7XHJcbiAgICBpZiAoIXJvb20pIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZCBvciBoYXMgZXhwaXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEJhc2ljIHJvb20gbWVtYmVyc2hpcCB2YWxpZGF0aW9uIC0gY2hlY2sgaWYgdXNlciBoYXMgYWNjZXNzIHRvIHRoaXMgcm9vbVxyXG4gICAgLy8gRm9yIG5vdywgd2UgYWxsb3cgYW55IGF1dGhlbnRpY2F0ZWQgdXNlciB0byB2b3RlIGluIGFueSBhY3RpdmUgcm9vbVxyXG4gICAgLy8gVE9ETzogSW1wbGVtZW50IHByb3BlciByb29tIG1lbWJlcnNoaXAgdmFsaWRhdGlvbiBpbiBUYXNrIDJcclxuICAgIGNvbnN0IGhhc1Jvb21BY2Nlc3MgPSBhd2FpdCB0aGlzLnZhbGlkYXRlUm9vbUFjY2Vzcyh1c2VySWQsIHJvb21JZCwgcm9vbSk7XHJcbiAgICBpZiAoIWhhc1Jvb21BY2Nlc3MpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIGRvZXMgbm90IGhhdmUgYWNjZXNzIHRvIHRoaXMgcm9vbScpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFZhbGlkYXRlIG1vdmllIGlzIGluIHJvb20gY2FuZGlkYXRlc1xyXG4gICAgY29uc3QgbW92aWVDYW5kaWRhdGUgPSByb29tLmNhbmRpZGF0ZXMuZmluZChjID0+IGMuaWQgPT09IG1vdmllSWQpO1xyXG4gICAgaWYgKCFtb3ZpZUNhbmRpZGF0ZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ01vdmllIG5vdCBmb3VuZCBpbiByb29tIGNhbmRpZGF0ZXMnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSZWNvcmQgdGhlIHZvdGVcclxuICAgIGF3YWl0IHRoaXMucmVjb3JkVm90ZSh1c2VySWQsIHJvb21JZCwgbW92aWVJZCwgdm90ZSk7XHJcblxyXG4gICAgLy8gQ2hlY2sgZm9yIG1hdGNoIGlmIHZvdGUgaXMgcG9zaXRpdmVcclxuICAgIGxldCBtYXRjaDogTWF0Y2ggfCB1bmRlZmluZWQ7XHJcbiAgICBpZiAodm90ZSkge1xyXG4gICAgICBtYXRjaCA9IGF3YWl0IHRoaXMuY2hlY2tGb3JNYXRjaChyb29tSWQsIG1vdmllSWQsIG1vdmllQ2FuZGlkYXRlKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBtYXRjaCB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyB2YWxpZGF0ZVJvb21BY2Nlc3ModXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nLCByb29tOiBSb29tKTogUHJvbWlzZTxib29sZWFuPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBCYXNpYyB2YWxpZGF0aW9uOiBjaGVjayBpZiB1c2VyIGlzIHRoZSByb29tIGhvc3Qgb3IgaGFzIHByZXZpb3VzbHkgdm90ZWQgaW4gdGhpcyByb29tXHJcbiAgICAgIGlmIChyb29tLmhvc3RJZCA9PT0gdXNlcklkKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGlzIHRoZSBob3N0IG9mIHJvb20gJHtyb29tSWR9IC0gYWNjZXNzIGdyYW50ZWRgKTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgdXNlciBoYXMgcHJldmlvdXNseSBwYXJ0aWNpcGF0ZWQgaW4gdGhpcyByb29tXHJcbiAgICAgIGNvbnN0IHVzZXJWb3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAndXNlcklkID0gOnVzZXJJZCcsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIExpbWl0OiAxLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBpZiAodXNlclZvdGVzUmVzdWx0Lkl0ZW1zICYmIHVzZXJWb3Rlc1Jlc3VsdC5JdGVtcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGhhcyBwcmV2aW91c2x5IHZvdGVkIGluIHJvb20gJHtyb29tSWR9IC0gYWNjZXNzIGdyYW50ZWRgKTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gRm9yIE1WUDogQWxsb3cgYW55IGF1dGhlbnRpY2F0ZWQgdXNlciB0byBqb2luIGFueSBhY3RpdmUgcm9vbVxyXG4gICAgICAvLyBUT0RPOiBJbXBsZW1lbnQgcHJvcGVyIHJvb20gbWVtYmVyc2hpcCB2YWxpZGF0aW9uIHdpdGggRHluYW1vREIgdGFibGUgaW4gVGFzayAyXHJcbiAgICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSBncmFudGVkIGFjY2VzcyB0byByb29tICR7cm9vbUlkfSAoTVZQIG1vZGUgLSBhbGwgdXNlcnMgYWxsb3dlZClgKTtcclxuICAgICAgcmV0dXJuIHRydWU7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgdmFsaWRhdGluZyByb29tIGFjY2VzcyBmb3IgdXNlciAke3VzZXJJZH0gaW4gcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICAvLyBPbiBlcnJvciwgYWxsb3cgYWNjZXNzIGZvciBub3cgKGZhaWwgb3BlbiBmb3IgTVZQKVxyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZ2V0Um9vbShyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8Um9vbSB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMucm9vbXNUYWJsZSxcclxuICAgICAgICBLZXk6IHsgaWQ6IHJvb21JZCB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBpZiAoIXJlc3VsdC5JdGVtKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJvb20gPSByZXN1bHQuSXRlbSBhcyBSb29tO1xyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgcm9vbSBoYXMgZXhwaXJlZFxyXG4gICAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgICAgaWYgKHJvb20udHRsICYmIHJvb20udHRsIDwgbm93KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHJldHVybiByb29tO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2V0dGluZyByb29tOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlY29yZFZvdGUodXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIsIHZvdGU6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHVzZXJNb3ZpZUlkID0gYCR7dXNlcklkfSMke21vdmllSWR9YDtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuXHJcbiAgICBjb25zdCB2b3RlUmVjb3JkOiBWb3RlID0ge1xyXG4gICAgICByb29tSWQsXHJcbiAgICAgIHVzZXJNb3ZpZUlkLFxyXG4gICAgICB1c2VySWQsXHJcbiAgICAgIG1vdmllSWQsXHJcbiAgICAgIHZvdGUsXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgIH07XHJcblxyXG4gICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgSXRlbTogdm90ZVJlY29yZCxcclxuICAgICAgLy8gQWxsb3cgb3ZlcndyaXRpbmcgcHJldmlvdXMgdm90ZXMgZm9yIHRoZSBzYW1lIHVzZXIvbW92aWUgY29tYmluYXRpb25cclxuICAgIH0pKTtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgVm90ZSByZWNvcmRlZDogVXNlciAke3VzZXJJZH0gdm90ZWQgJHt2b3RlID8gJ1lFUycgOiAnTk8nfSBmb3IgbW92aWUgJHttb3ZpZUlkfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBjaGVja0Zvck1hdGNoKHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIsIG1vdmllQ2FuZGlkYXRlOiBNb3ZpZUNhbmRpZGF0ZSk6IFByb21pc2U8TWF0Y2ggfCB1bmRlZmluZWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIEdldCBhbGwgdm90ZXMgZm9yIHRoaXMgbW92aWUgaW4gdGhpcyByb29tIChleGNsdWRpbmcgcGFydGljaXBhdGlvbiByZWNvcmRzKVxyXG4gICAgICBjb25zdCB2b3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnbW92aWVJZCA9IDptb3ZpZUlkIEFORCB2b3RlID0gOnZvdGUgQU5EIG1vdmllSWQgPD4gOnBhcnRpY2lwYXRpb25NYXJrZXInLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzptb3ZpZUlkJzogbW92aWVJZCxcclxuICAgICAgICAgICc6dm90ZSc6IHRydWUsIC8vIE9ubHkgcG9zaXRpdmUgdm90ZXNcclxuICAgICAgICAgICc6cGFydGljaXBhdGlvbk1hcmtlcic6IC0xLCAvLyBFeGNsdWRlIHBhcnRpY2lwYXRpb24gcmVjb3Jkc1xyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IHBvc2l0aXZlVm90ZXMgPSB2b3Rlc1Jlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7cG9zaXRpdmVWb3Rlcy5sZW5ndGh9IHBvc2l0aXZlIHZvdGVzIGZvciBtb3ZpZSAke21vdmllSWR9IGluIHJvb20gJHtyb29tSWR9YCk7XHJcblxyXG4gICAgICAvLyBHZXQgYWxsIHVuaXF1ZSB1c2VycyB3aG8gaGF2ZSB2b3RlZCBpbiB0aGlzIHJvb20gKGV4Y2x1ZGluZyBwYXJ0aWNpcGF0aW9uIHJlY29yZHMpXHJcbiAgICAgIGNvbnN0IGFsbFZvdGVzUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdtb3ZpZUlkIDw+IDpwYXJ0aWNpcGF0aW9uTWFya2VyJywgLy8gRXhjbHVkZSBwYXJ0aWNpcGF0aW9uIHJlY29yZHNcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICAgICc6cGFydGljaXBhdGlvbk1hcmtlcic6IC0xLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IGFsbFZvdGVzID0gYWxsVm90ZXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIGNvbnN0IHVuaXF1ZVVzZXJzID0gbmV3IFNldChhbGxWb3Rlcy5tYXAodm90ZSA9PiAodm90ZSBhcyBWb3RlKS51c2VySWQpKTtcclxuICAgICAgY29uc3QgdG90YWxVc2VycyA9IHVuaXF1ZVVzZXJzLnNpemU7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgVG90YWwgdW5pcXVlIHVzZXJzIHdobyBoYXZlIHZvdGVkIGluIHJvb206ICR7dG90YWxVc2Vyc31gKTtcclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIGFsbCB1c2VycyB2b3RlZCBwb3NpdGl2ZWx5IGZvciB0aGlzIG1vdmllXHJcbiAgICAgIGNvbnN0IHBvc2l0aXZlVXNlcklkcyA9IG5ldyBTZXQocG9zaXRpdmVWb3Rlcy5tYXAodm90ZSA9PiAodm90ZSBhcyBWb3RlKS51c2VySWQpKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChwb3NpdGl2ZVVzZXJJZHMuc2l6ZSA9PT0gdG90YWxVc2VycyAmJiB0b3RhbFVzZXJzID4gMSkge1xyXG4gICAgICAgIC8vIFdlIGhhdmUgYSBtYXRjaCEgQWxsIHVzZXJzIHZvdGVkIHBvc2l0aXZlbHlcclxuICAgICAgICBjb25zb2xlLmxvZyhgTUFUQ0ggREVURUNURUQhIEFsbCAke3RvdGFsVXNlcnN9IHVzZXJzIHZvdGVkIHBvc2l0aXZlbHkgZm9yIG1vdmllICR7bW92aWVJZH1gKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBpZiBtYXRjaCBhbHJlYWR5IGV4aXN0c1xyXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nTWF0Y2ggPSBhd2FpdCB0aGlzLmdldEV4aXN0aW5nTWF0Y2gocm9vbUlkLCBtb3ZpZUlkKTtcclxuICAgICAgICBpZiAoZXhpc3RpbmdNYXRjaCkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coJ01hdGNoIGFscmVhZHkgZXhpc3RzLCByZXR1cm5pbmcgZXhpc3RpbmcgbWF0Y2gnKTtcclxuICAgICAgICAgIHJldHVybiBleGlzdGluZ01hdGNoO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIG5ldyBtYXRjaFxyXG4gICAgICAgIGNvbnN0IG1hdGNoID0gYXdhaXQgdGhpcy5jcmVhdGVNYXRjaChyb29tSWQsIG1vdmllSWQsIG1vdmllQ2FuZGlkYXRlLCBBcnJheS5mcm9tKHBvc2l0aXZlVXNlcklkcykpO1xyXG4gICAgICAgIHJldHVybiBtYXRjaDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc29sZS5sb2coYE5vIG1hdGNoIHlldC4gUG9zaXRpdmUgdm90ZXM6ICR7cG9zaXRpdmVVc2VySWRzLnNpemV9LCBUb3RhbCB1c2VyczogJHt0b3RhbFVzZXJzfWApO1xyXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGZvciBtYXRjaDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldEV4aXN0aW5nTWF0Y2gocm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlcik6IFByb21pc2U8TWF0Y2ggfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBLZXk6IHtcclxuICAgICAgICAgIHJvb21JZCxcclxuICAgICAgICAgIG1vdmllSWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgcmV0dXJuIHJlc3VsdC5JdGVtIGFzIE1hdGNoIHx8IG51bGw7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyBleGlzdGluZyBtYXRjaDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBjcmVhdGVNYXRjaChyb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCBtb3ZpZUNhbmRpZGF0ZTogTW92aWVDYW5kaWRhdGUsIG1hdGNoZWRVc2Vyczogc3RyaW5nW10pOiBQcm9taXNlPE1hdGNoPiB7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICBjb25zdCBtYXRjaElkID0gYCR7cm9vbUlkfSMke21vdmllSWR9YDtcclxuXHJcbiAgICBjb25zdCBtYXRjaDogTWF0Y2ggPSB7XHJcbiAgICAgIGlkOiBtYXRjaElkLFxyXG4gICAgICByb29tSWQsXHJcbiAgICAgIG1vdmllSWQsXHJcbiAgICAgIHRpdGxlOiBtb3ZpZUNhbmRpZGF0ZS50aXRsZSxcclxuICAgICAgcG9zdGVyUGF0aDogbW92aWVDYW5kaWRhdGUucG9zdGVyUGF0aCB8fCB1bmRlZmluZWQsXHJcbiAgICAgIG1lZGlhVHlwZTogbW92aWVDYW5kaWRhdGUubWVkaWFUeXBlLFxyXG4gICAgICBtYXRjaGVkVXNlcnMsXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgIH07XHJcblxyXG4gICAgLy8gU3RvcmUgdGhlIG1haW4gbWF0Y2ggcmVjb3JkXHJcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgIEl0ZW06IG1hdGNoLFxyXG4gICAgICBDb25kaXRpb25FeHByZXNzaW9uOiAnYXR0cmlidXRlX25vdF9leGlzdHMocm9vbUlkKSBBTkQgYXR0cmlidXRlX25vdF9leGlzdHMobW92aWVJZCknLCAvLyBQcmV2ZW50IGR1cGxpY2F0ZXNcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBDUklUSUNBTDogQ3JlYXRlIGluZGl2aWR1YWwgbWF0Y2ggcmVjb3JkcyBmb3IgZWFjaCB1c2VyIHRvIGVuYWJsZSBHU0kgcXVlcmllc1xyXG4gICAgLy8gVGhpcyBhbGxvd3MgZWZmaWNpZW50IHF1ZXJ5aW5nIG9mIG1hdGNoZXMgYnkgdXNlcklkIHVzaW5nIHRoZSBuZXcgR1NJXHJcbiAgICBjb25zdCB1c2VyTWF0Y2hQcm9taXNlcyA9IG1hdGNoZWRVc2Vycy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICBjb25zdCB1c2VyTWF0Y2ggPSB7XHJcbiAgICAgICAgLi4ubWF0Y2gsXHJcbiAgICAgICAgdXNlcklkLCAvLyBBZGQgdXNlcklkIGZpZWxkIGZvciBHU0lcclxuICAgICAgICBpZDogYCR7dXNlcklkfSMke21hdGNoSWR9YCwgLy8gVW5pcXVlIElEIHBlciB1c2VyXHJcbiAgICAgICAgcm9vbUlkOiBgJHt1c2VySWR9IyR7cm9vbUlkfWAsIC8vIENvbXBvc2l0ZSBrZXkgdG8gYXZvaWQgY29uZmxpY3RzXHJcbiAgICAgIH07XHJcblxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgICBJdGVtOiB1c2VyTWF0Y2gsXHJcbiAgICAgICAgfSkpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2VyIG1hdGNoIHJlY29yZCBjcmVhdGVkIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGNyZWF0aW5nIHVzZXIgbWF0Y2ggcmVjb3JkIGZvciAke3VzZXJJZH06YCwgZXJyb3IpO1xyXG4gICAgICAgIC8vIENvbnRpbnVlIHdpdGggb3RoZXIgdXNlcnMgZXZlbiBpZiBvbmUgZmFpbHNcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gV2FpdCBmb3IgYWxsIHVzZXIgbWF0Y2ggcmVjb3JkcyB0byBiZSBjcmVhdGVkXHJcbiAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQodXNlck1hdGNoUHJvbWlzZXMpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBNYXRjaCBjcmVhdGVkOiAke21hdGNoSWR9IHdpdGggJHttYXRjaGVkVXNlcnMubGVuZ3RofSB1c2VycyBhbmQgaW5kaXZpZHVhbCB1c2VyIHJlY29yZHNgKTtcclxuXHJcbiAgICAvLyBEZWxldGUgdGhlIHJvb20gc2luY2UgbWF0Y2ggaXMgZm91bmQgLSByb29tIGlzIG5vIGxvbmdlciBuZWVkZWRcclxuICAgIGF3YWl0IHRoaXMuZGVsZXRlUm9vbShyb29tSWQpO1xyXG5cclxuICAgIC8vIENSSVRJQ0FMOiBUcmlnZ2VyIEFwcFN5bmMgc3Vic2NyaXB0aW9uIGJ5IGNhbGxpbmcgdGhlIGNyZWF0ZU1hdGNoIG11dGF0aW9uXHJcbiAgICAvLyBUaGlzIGlzIHRoZSBrZXkgZml4IC0gd2UgbmVlZCB0byBleGVjdXRlIHRoZSBHcmFwaFFMIG11dGF0aW9uIHRvIHRyaWdnZXIgc3Vic2NyaXB0aW9uc1xyXG4gICAgYXdhaXQgdGhpcy50cmlnZ2VyQXBwU3luY1N1YnNjcmlwdGlvbihtYXRjaCk7XHJcblxyXG4gICAgcmV0dXJuIG1hdGNoO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBkZWxldGVSb29tKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBEZWxldGUgdGhlIHJvb20gZnJvbSBEeW5hbW9EQlxyXG4gICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgRGVsZXRlQ29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnJvb21zVGFibGUsXHJcbiAgICAgICAgS2V5OiB7IGlkOiByb29tSWQgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc29sZS5sb2coYFJvb20gJHtyb29tSWR9IGRlbGV0ZWQgYWZ0ZXIgbWF0Y2ggY3JlYXRpb25gKTtcclxuXHJcbiAgICAgIC8vIE9wdGlvbmFsbHk6IERlbGV0ZSBhbGwgdm90ZXMgZm9yIHRoaXMgcm9vbSB0byBmcmVlIHVwIHNwYWNlXHJcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlUm9vbVZvdGVzKHJvb21JZCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBkZWxldGluZyByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgIC8vIERvbid0IGZhaWwgdGhlIG1hdGNoIGNyZWF0aW9uIGlmIHJvb20gZGVsZXRpb24gZmFpbHNcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZGVsZXRlUm9vbVZvdGVzKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBHZXQgYWxsIHZvdGVzIGFuZCBwYXJ0aWNpcGF0aW9uIHJlY29yZHMgZm9yIHRoaXMgcm9vbVxyXG4gICAgICBjb25zdCB2b3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBhbGxSZWNvcmRzID0gdm90ZXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIFxyXG4gICAgICAvLyBEZWxldGUgYWxsIHJlY29yZHMgKHZvdGVzIGFuZCBwYXJ0aWNpcGF0aW9uKSBpbiBiYXRjaGVzXHJcbiAgICAgIGNvbnN0IGRlbGV0ZVByb21pc2VzID0gYWxsUmVjb3Jkcy5tYXAocmVjb3JkID0+IFxyXG4gICAgICAgIGRvY0NsaWVudC5zZW5kKG5ldyBEZWxldGVDb21tYW5kKHtcclxuICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgICAgS2V5OiB7XHJcbiAgICAgICAgICAgIHJvb21JZDogcmVjb3JkLnJvb21JZCxcclxuICAgICAgICAgICAgdXNlck1vdmllSWQ6IHJlY29yZC51c2VyTW92aWVJZCxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSkpXHJcbiAgICAgICk7XHJcblxyXG4gICAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoZGVsZXRlUHJvbWlzZXMpO1xyXG4gICAgICBjb25zb2xlLmxvZyhgRGVsZXRlZCAke2FsbFJlY29yZHMubGVuZ3RofSByZWNvcmRzICh2b3RlcyBhbmQgcGFydGljaXBhdGlvbikgZm9yIHJvb20gJHtyb29tSWR9YCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBkZWxldGluZyByZWNvcmRzIGZvciByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHRyaWdnZXJBcHBTeW5jU3Vic2NyaXB0aW9uKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc29sZS5sb2coYPCflJQgQlJPQURDQVNUSU5HIFJFQUw6IExsYW1hbmRvIGEgQXBwU3luYyBBUEkgcGFyYSBzYWxhICR7bWF0Y2gucm9vbUlkfWApO1xyXG4gICAgY29uc29sZS5sb2coYPCfmoAgTlVFVkEgSU1QTEVNRU5UQUNJT046IFVzYW5kbyBsbGFtYWRhIEhUVFAgZGlyZWN0YSBhIEFwcFN5bmNgKTtcclxuICAgIFxyXG4gICAgY29uc3QgZW5kcG9pbnQgPSBwcm9jZXNzLmVudi5HUkFQSFFMX0VORFBPSU5UO1xyXG4gICAgaWYgKCFlbmRwb2ludCkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgR1JBUEhRTF9FTkRQT0lOVCBubyBlc3TDoSBkZWZpbmlkbycpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0dSQVBIUUxfRU5EUE9JTlQgbm8gZXN0w6EgZGVmaW5pZG8nKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBMYSBtdXRhY2nDs24gcXVlIGRpc3BhcmEgbGEgc3VzY3JpcGNpw7NuIFwiTm9uZURhdGFTb3VyY2VcIlxyXG4gICAgY29uc3QgbXV0YXRpb24gPSBgXHJcbiAgICAgIG11dGF0aW9uIFB1Ymxpc2hSb29tTWF0Y2goJHJvb21JZDogSUQhLCAkbWF0Y2hEYXRhOiBSb29tTWF0Y2hJbnB1dCEpIHtcclxuICAgICAgICBwdWJsaXNoUm9vbU1hdGNoKHJvb21JZDogJHJvb21JZCwgbWF0Y2hEYXRhOiAkbWF0Y2hEYXRhKSB7XHJcbiAgICAgICAgICByb29tSWRcclxuICAgICAgICAgIG1hdGNoSWRcclxuICAgICAgICAgIG1vdmllSWRcclxuICAgICAgICAgIG1hdGNoZWRVc2Vyc1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgYDtcclxuXHJcbiAgICBjb25zdCB2YXJpYWJsZXMgPSB7XHJcbiAgICAgIHJvb21JZDogbWF0Y2gucm9vbUlkLFxyXG4gICAgICBtYXRjaERhdGE6IHtcclxuICAgICAgICBtYXRjaElkOiBtYXRjaC5pZCxcclxuICAgICAgICBtb3ZpZUlkOiBtYXRjaC5tb3ZpZUlkLFxyXG4gICAgICAgIG1vdmllVGl0bGU6IG1hdGNoLnRpdGxlLFxyXG4gICAgICAgIHBvc3RlclBhdGg6IG1hdGNoLnBvc3RlclBhdGgsXHJcbiAgICAgICAgbWF0Y2hlZFVzZXJzOiBtYXRjaC5tYXRjaGVkVXNlcnMsXHJcbiAgICAgICAgbWF0Y2hEZXRhaWxzOiB7XHJcbiAgICAgICAgICB2b3RlQ291bnQ6IG1hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGgsXHJcbiAgICAgICAgICByZXF1aXJlZFZvdGVzOiBtYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RoLFxyXG4gICAgICAgICAgbWF0Y2hUeXBlOiAndW5hbmltb3VzJ1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBQcmVwYXJhbW9zIGxhIHBldGljacOzbiBIVFRQXHJcbiAgICBjb25zdCByZXF1ZXN0ID0gbmV3IEh0dHBSZXF1ZXN0KHtcclxuICAgICAgbWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgIGhvc3Q6IG5ldyBVUkwoZW5kcG9pbnQpLmhvc3RuYW1lLFxyXG4gICAgICB9LFxyXG4gICAgICBob3N0bmFtZTogbmV3IFVSTChlbmRwb2ludCkuaG9zdG5hbWUsXHJcbiAgICAgIHBhdGg6ICcvZ3JhcGhxbCcsXHJcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgcXVlcnk6IG11dGF0aW9uLCB2YXJpYWJsZXMgfSksXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBGaXJtYW1vcyBsYSBwZXRpY2nDs24gY29uIGNyZWRlbmNpYWxlcyBJQU0gZGUgbGEgTGFtYmRhXHJcbiAgICBjb25zdCBzaWduZXIgPSBuZXcgU2lnbmF0dXJlVjQoe1xyXG4gICAgICBjcmVkZW50aWFsczogZGVmYXVsdFByb3ZpZGVyKCksXHJcbiAgICAgIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyxcclxuICAgICAgc2VydmljZTogJ2FwcHN5bmMnLFxyXG4gICAgICBzaGEyNTY6IFNoYTI1NixcclxuICAgIH0pO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHNpZ25lZFJlcXVlc3QgPSBhd2FpdCBzaWduZXIuc2lnbihyZXF1ZXN0KTtcclxuICAgICAgXHJcbiAgICAgIC8vIFVzYW1vcyBmZXRjaCBuYXRpdm8gKE5vZGUgMTgrKVxyXG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGVuZHBvaW50LCB7XHJcbiAgICAgICAgbWV0aG9kOiBzaWduZWRSZXF1ZXN0Lm1ldGhvZCxcclxuICAgICAgICBoZWFkZXJzOiBzaWduZWRSZXF1ZXN0LmhlYWRlcnMgYXMgYW55LFxyXG4gICAgICAgIGJvZHk6IHNpZ25lZFJlcXVlc3QuYm9keSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXNwb25zZS5qc29uKCkgYXMgeyBkYXRhPzogYW55OyBlcnJvcnM/OiBhbnlbXSB9O1xyXG4gICAgICBcclxuICAgICAgaWYgKHJlc3VsdC5lcnJvcnMpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgZGUgQXBwU3luYzonLCBKU09OLnN0cmluZ2lmeShyZXN1bHQuZXJyb3JzKSk7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBBcHBTeW5jIEdyYXBoUUwgZXJyb3JzOiAke0pTT04uc3RyaW5naWZ5KHJlc3VsdC5lcnJvcnMpfWApO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfinIUgQXBwU3luYyBCcm9hZGNhc3QgRXhpdG9zbzonLCBKU09OLnN0cmluZ2lmeShyZXN1bHQuZGF0YSkpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5SUIFN1c2NyaXBjacOzbiBvblJvb21NYXRjaCBkaXNwYXJhZGEgcGFyYSBzYWxhICR7bWF0Y2gucm9vbUlkfWApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5GlIFVzdWFyaW9zIG5vdGlmaWNhZG9zOiAke21hdGNoLm1hdGNoZWRVc2Vycy5qb2luKCcsICcpfWApO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgZmF0YWwgbGxhbWFuZG8gYSBBcHBTeW5jOicsIGVycm9yKTtcclxuICAgICAgLy8gQXF1w60gbWFudGVuZW1vcyBlbCBmYWxsYmFjayBkZSBwb2xsaW5nIHNpIGZhbGxhXHJcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmVNYXRjaE5vdGlmaWNhdGlvbnMobWF0Y2gpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZmFsbGJhY2tUb0NyZWF0ZU1hdGNoKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coJ/CflIQgVXNpbmcgZmFsbGJhY2sgY3JlYXRlTWF0Y2ggbWV0aG9kLi4uJyk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBGQUxMQkFDSzogVXNlIHRoZSBvbGQgY3JlYXRlTWF0Y2ggbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XHJcbiAgICAgIGlmICh0aGlzLm1hdGNoTGFtYmRhQXJuKSB7XHJcbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgICAgIG9wZXJhdGlvbjogJ2NyZWF0ZU1hdGNoJyxcclxuICAgICAgICAgIGlucHV0OiB7XHJcbiAgICAgICAgICAgIHJvb21JZDogbWF0Y2gucm9vbUlkLFxyXG4gICAgICAgICAgICBtb3ZpZUlkOiBtYXRjaC5tb3ZpZUlkLFxyXG4gICAgICAgICAgICB0aXRsZTogbWF0Y2gudGl0bGUsXHJcbiAgICAgICAgICAgIHBvc3RlclBhdGg6IG1hdGNoLnBvc3RlclBhdGgsXHJcbiAgICAgICAgICAgIG1hdGNoZWRVc2VyczogbWF0Y2gubWF0Y2hlZFVzZXJzLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjb25zb2xlLmxvZygn8J+agCBJbnZva2luZyBNYXRjaCBMYW1iZGEgd2l0aCBjcmVhdGVNYXRjaCAoZmFsbGJhY2spLi4uJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcclxuICAgICAgICAgIEZ1bmN0aW9uTmFtZTogdGhpcy5tYXRjaExhbWJkYUFybixcclxuICAgICAgICAgIEludm9jYXRpb25UeXBlOiAnUmVxdWVzdFJlc3BvbnNlJyxcclxuICAgICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKGNvbW1hbmQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChyZXNwb25zZS5QYXlsb2FkKSB7XHJcbiAgICAgICAgICBjb25zdCByZXN1bHQgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5QYXlsb2FkKSk7XHJcbiAgICAgICAgICBpZiAocmVzdWx0LnN0YXR1c0NvZGUgPT09IDIwMCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygn4pyFIEZhbGxiYWNrIGNyZWF0ZU1hdGNoIGV4ZWN1dGVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhbGxiYWNrIGNyZWF0ZU1hdGNoIHJldHVybmVkIGVycm9yOicsIHJlc3VsdC5ib2R5Py5lcnJvcik7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTdG9yZSBub3RpZmljYXRpb25zIGZvciBwb2xsaW5nIGZhbGxiYWNrXHJcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmVNYXRjaE5vdGlmaWNhdGlvbnMobWF0Y2gpO1xyXG4gICAgICBcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBpbiBmYWxsYmFjayBtZXRob2Q6JywgZXJyb3IpO1xyXG4gICAgICAvLyBTdG9yZSBub3RpZmljYXRpb25zIGZvciBwb2xsaW5nIGFzIGZpbmFsIGZhbGxiYWNrXHJcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmVNYXRjaE5vdGlmaWNhdGlvbnMobWF0Y2gpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzdG9yZU1hdGNoTm90aWZpY2F0aW9ucyhtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFN0b3JlIGluZGl2aWR1YWwgbm90aWZpY2F0aW9uIHJlY29yZHMgZm9yIGVhY2ggdXNlclxyXG4gICAgICAvLyBUaGlzIGVuYWJsZXMgcG9sbGluZy1iYXNlZCBtYXRjaCBkZXRlY3Rpb24gYXMgYSBmYWxsYmFja1xyXG4gICAgICBjb25zdCBub3RpZmljYXRpb25Qcm9taXNlcyA9IG1hdGNoLm1hdGNoZWRVc2Vycy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IG5vdGlmaWNhdGlvblJlY29yZCA9IHtcclxuICAgICAgICAgIHVzZXJJZCxcclxuICAgICAgICAgIG1hdGNoSWQ6IG1hdGNoLmlkLFxyXG4gICAgICAgICAgb3JpZ2luYWxSb29tSWQ6IG1hdGNoLnJvb21JZCwgLy8gU3RvcmUgb3JpZ2luYWwgcm9vbUlkIHNlcGFyYXRlbHlcclxuICAgICAgICAgIG9yaWdpbmFsTW92aWVJZDogbWF0Y2gubW92aWVJZCwgLy8gU3RvcmUgb3JpZ2luYWwgbW92aWVJZCBzZXBhcmF0ZWx5XHJcbiAgICAgICAgICB0aXRsZTogbWF0Y2gudGl0bGUsXHJcbiAgICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaC5wb3N0ZXJQYXRoLFxyXG4gICAgICAgICAgdGltZXN0YW1wOiBtYXRjaC50aW1lc3RhbXAsXHJcbiAgICAgICAgICBub3RpZmllZDogZmFsc2UsIC8vIEZsYWcgdG8gdHJhY2sgaWYgdXNlciBoYXMgYmVlbiBub3RpZmllZFxyXG4gICAgICAgICAgdHRsOiBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKSArICg3ICogMjQgKiA2MCAqIDYwKSwgLy8gNyBkYXlzIFRUTFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIC8vIFN0b3JlIGluIGEgbm90aWZpY2F0aW9ucyB0YWJsZSAod2UnbGwgdXNlIHRoZSBtYXRjaGVzIHRhYmxlIHdpdGggYSBzcGVjaWFsIHBhdHRlcm4pXHJcbiAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgICAgcm9vbUlkOiBgTk9USUZJQ0FUSU9OIyR7dXNlcklkfWAsIC8vIFNwZWNpYWwgcHJlZml4IGZvciBub3RpZmljYXRpb25zXHJcbiAgICAgICAgICAgIG1vdmllSWQ6IERhdGUubm93KCksIC8vIFVzZSB0aW1lc3RhbXAgYXMgc29ydCBrZXkgZm9yIHVuaXF1ZW5lc3NcclxuICAgICAgICAgICAgLi4ubm90aWZpY2F0aW9uUmVjb3JkLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9KSk7XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBOb3RpZmljYXRpb24gc3RvcmVkIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChub3RpZmljYXRpb25Qcm9taXNlcyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfinIUgTWF0Y2ggbm90aWZpY2F0aW9ucyBzdG9yZWQgZm9yIHBvbGxpbmcgZmFsbGJhY2snKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHN0b3JpbmcgbWF0Y2ggbm90aWZpY2F0aW9uczonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIG5vdGlmeU1hdGNoQ3JlYXRlZChtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICAgICAgb3BlcmF0aW9uOiAnbWF0Y2hDcmVhdGVkJyxcclxuICAgICAgICBtYXRjaCxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlQ29tbWFuZCh7XHJcbiAgICAgICAgRnVuY3Rpb25OYW1lOiB0aGlzLm1hdGNoTGFtYmRhQXJuLFxyXG4gICAgICAgIEludm9jYXRpb25UeXBlOiAnRXZlbnQnLCAvLyBBc3luYyBpbnZvY2F0aW9uXHJcbiAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQoY29tbWFuZCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdNYXRjaCBub3RpZmljYXRpb24gc2VudCB0byBNYXRjaCBMYW1iZGEnKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBub3RpZnkgTWF0Y2ggTGFtYmRhOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG4vLyBMYW1iZGEgSGFuZGxlclxyXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlcjxWb3RlRXZlbnQsIFZvdGVSZXNwb25zZT4gPSBhc3luYyAoZXZlbnQpID0+IHtcclxuICBjb25zb2xlLmxvZygnVm90ZSBMYW1iZGEgcmVjZWl2ZWQgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHsgdXNlcklkLCBpbnB1dCB9ID0gZXZlbnQ7XHJcbiAgICBjb25zdCB7IHJvb21JZCwgbW92aWVJZCwgdm90ZSB9ID0gaW5wdXQ7XHJcblxyXG4gICAgLy8gVmFsaWRhdGUgaW5wdXRcclxuICAgIGlmICghdXNlcklkKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVXNlciBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICghcm9vbUlkKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0eXBlb2YgbW92aWVJZCAhPT0gJ251bWJlcicpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNb3ZpZSBJRCBtdXN0IGJlIGEgbnVtYmVyJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHR5cGVvZiB2b3RlICE9PSAnYm9vbGVhbicpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdWb3RlIG11c3QgYmUgYSBib29sZWFuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgdm90ZVNlcnZpY2UgPSBuZXcgVm90ZVNlcnZpY2UoKTtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZvdGVTZXJ2aWNlLnByb2Nlc3NWb3RlKHVzZXJJZCwgcm9vbUlkLCBtb3ZpZUlkLCB2b3RlKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGJvZHk6IHJlc3VsdCxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdWb3RlIExhbWJkYSBlcnJvcjonLCBlcnJvcik7XHJcbiAgICBcclxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICB9XHJcbn07Il19