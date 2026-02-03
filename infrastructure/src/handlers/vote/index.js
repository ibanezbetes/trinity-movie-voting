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
        // CRITICAL: Trigger AppSync subscription FIRST before deleting room
        // This ensures all users get notified before the room becomes unavailable
        await this.triggerAppSyncSubscription(match);
        // Wait a moment to ensure notifications are sent before deleting room
        // This prevents "Room not found" errors for concurrent votes
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        // Delete the room since match is found - room is no longer needed
        await this.deleteRoom(roomId);
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
        console.log(`🔔 INICIANDO BROADCAST REAL para sala: ${match.roomId}`);
        console.log(`🚀 NUEVA IMPLEMENTACION v2: Usando llamada HTTP directa a AppSync`);
        const endpoint = process.env.GRAPHQL_ENDPOINT;
        if (!endpoint) {
            console.error('❌ FATAL: GRAPHQL_ENDPOINT no está definido');
            return;
        }
        // Usamos la mutación EXACTA que definimos en el schema para activar la suscripción
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
            // Firmamos la petición con las credenciales IAM de la Lambda
            const signer = new signature_v4_1.SignatureV4({
                credentials: (0, credential_provider_node_1.defaultProvider)(),
                region: process.env.AWS_REGION || 'us-east-1',
                service: 'appsync',
                sha256: sha256_js_1.Sha256,
            });
            const signedRequest = await signer.sign(request);
            // Enviamos la petición HTTP (Node 18/20 ya tiene fetch nativo)
            const response = await fetch(endpoint, {
                method: signedRequest.method,
                headers: signedRequest.headers,
                body: signedRequest.body,
            });
            const result = await response.json();
            if (result.errors) {
                console.error('❌ Error de AppSync:', JSON.stringify(result.errors));
            }
            else {
                console.log('✅ BROADCAST EXITOSO: AppSync ha recibido la orden de notificar.');
            }
        }
        catch (error) {
            console.error('❌ Error enviando broadcast a AppSync:', error);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdm90ZS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQW9IO0FBQ3BILDBEQUFxRTtBQUNyRSx3REFBb0Q7QUFDcEQscURBQStDO0FBQy9DLGdGQUFvRTtBQUNwRSwwREFBcUQ7QUFFckQseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUE4RDFFLGVBQWU7QUFDZixNQUFNLFdBQVc7SUFNZjtRQUNFLElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxZQUFZLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDO1FBQ3BELElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxjQUFjLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsSUFBSSxFQUFFLENBQUM7UUFFekQsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQy9ELE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUMsQ0FB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QUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRTVFLE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLElBQUksRUFBRSxNQUFNO1NBQ2IsQ0FBQztJQUVKLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUUzQyxNQUFNLFlBQVksR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQztRQUV2RixPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixJQUFJLEVBQUU7Z0JBQ0osT0FBTyxFQUFFLEtBQUs7Z0JBQ2QsS0FBSyxFQUFFLFlBQVk7YUFDcEI7U0FDRixDQUFDO0lBQ0osQ0FBQztBQUNILENBQUMsQ0FBQztBQTdDVyxRQUFBLE9BQU8sV0E2Q2xCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSGFuZGxlciB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIFB1dENvbW1hbmQsIFF1ZXJ5Q29tbWFuZCwgR2V0Q29tbWFuZCwgRGVsZXRlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XHJcbmltcG9ydCB7IExhbWJkYUNsaWVudCwgSW52b2tlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1sYW1iZGEnO1xyXG5pbXBvcnQgeyBTaWduYXR1cmVWNCB9IGZyb20gJ0Bhd3Mtc2RrL3NpZ25hdHVyZS12NCc7XHJcbmltcG9ydCB7IFNoYTI1NiB9IGZyb20gJ0Bhd3MtY3J5cHRvL3NoYTI1Ni1qcyc7XHJcbmltcG9ydCB7IGRlZmF1bHRQcm92aWRlciB9IGZyb20gJ0Bhd3Mtc2RrL2NyZWRlbnRpYWwtcHJvdmlkZXItbm9kZSc7XHJcbmltcG9ydCB7IEh0dHBSZXF1ZXN0IH0gZnJvbSAnQGF3cy1zZGsvcHJvdG9jb2wtaHR0cCc7XHJcblxyXG4vLyBJbml0aWFsaXplIEFXUyBjbGllbnRzXHJcbmNvbnN0IGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGR5bmFtb0NsaWVudCk7XHJcbmNvbnN0IGxhbWJkYUNsaWVudCA9IG5ldyBMYW1iZGFDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcblxyXG4vLyBUeXBlc1xyXG5pbnRlcmZhY2UgVm90ZSB7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgdXNlck1vdmllSWQ6IHN0cmluZzsgLy8gRm9ybWF0OiBcInVzZXJJZCNtb3ZpZUlkXCJcclxuICB1c2VySWQ6IHN0cmluZztcclxuICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgdm90ZTogYm9vbGVhbjtcclxuICB0aW1lc3RhbXA6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIE1hdGNoIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHJvb21JZDogc3RyaW5nO1xyXG4gIG1vdmllSWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg/OiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxuICBtYXRjaGVkVXNlcnM6IHN0cmluZ1tdO1xyXG4gIHRpbWVzdGFtcDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgUm9vbSB7XHJcbiAgaWQ6IHN0cmluZztcclxuICBjb2RlOiBzdHJpbmc7XHJcbiAgaG9zdElkOiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxuICBnZW5yZUlkczogbnVtYmVyW107XHJcbiAgY2FuZGlkYXRlczogTW92aWVDYW5kaWRhdGVbXTtcclxuICBjcmVhdGVkQXQ6IHN0cmluZztcclxuICB0dGw6IG51bWJlcjtcclxufVxyXG5cclxuaW50ZXJmYWNlIE1vdmllQ2FuZGlkYXRlIHtcclxuICBpZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgb3ZlcnZpZXc6IHN0cmluZztcclxuICBwb3N0ZXJQYXRoOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJlbGVhc2VEYXRlOiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxufVxyXG5cclxuaW50ZXJmYWNlIFZvdGVFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAndm90ZSc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgaW5wdXQ6IHtcclxuICAgIHJvb21JZDogc3RyaW5nO1xyXG4gICAgbW92aWVJZDogbnVtYmVyO1xyXG4gICAgdm90ZTogYm9vbGVhbjtcclxuICB9O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVm90ZVJlc3BvbnNlIHtcclxuICBzdGF0dXNDb2RlOiBudW1iZXI7XHJcbiAgYm9keToge1xyXG4gICAgc3VjY2VzczogYm9vbGVhbjtcclxuICAgIG1hdGNoPzogTWF0Y2g7XHJcbiAgICBlcnJvcj86IHN0cmluZztcclxuICB9O1xyXG59XHJcblxyXG4vLyBWb3RlIFNlcnZpY2VcclxuY2xhc3MgVm90ZVNlcnZpY2Uge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgdm90ZXNUYWJsZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbWF0Y2hlc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSByb29tc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBtYXRjaExhbWJkYUFybjogc3RyaW5nO1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMudm90ZXNUYWJsZSA9IHByb2Nlc3MuZW52LlZPVEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUgPSBwcm9jZXNzLmVudi5NQVRDSEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgdGhpcy5yb29tc1RhYmxlID0gcHJvY2Vzcy5lbnYuUk9PTVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLm1hdGNoTGFtYmRhQXJuID0gcHJvY2Vzcy5lbnYuTUFUQ0hfTEFNQkRBX0FSTiB8fCAnJztcclxuXHJcbiAgICBpZiAoIXRoaXMudm90ZXNUYWJsZSB8fCAhdGhpcy5tYXRjaGVzVGFibGUgfHwgIXRoaXMucm9vbXNUYWJsZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlcXVpcmVkIHRhYmxlIGVudmlyb25tZW50IHZhcmlhYmxlcyBhcmUgbWlzc2luZycpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcHJvY2Vzc1ZvdGUodXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIsIHZvdGU6IGJvb2xlYW4pOiBQcm9taXNlPHsgc3VjY2VzczogYm9vbGVhbjsgbWF0Y2g/OiBNYXRjaCB9PiB7XHJcbiAgICAvLyBWYWxpZGF0ZSByb29tIGV4aXN0cyBhbmQgZ2V0IHJvb20gZGV0YWlsc1xyXG4gICAgY29uc3Qgcm9vbSA9IGF3YWl0IHRoaXMuZ2V0Um9vbShyb29tSWQpO1xyXG4gICAgaWYgKCFyb29tKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBub3QgZm91bmQgb3IgaGFzIGV4cGlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBCYXNpYyByb29tIG1lbWJlcnNoaXAgdmFsaWRhdGlvbiAtIGNoZWNrIGlmIHVzZXIgaGFzIGFjY2VzcyB0byB0aGlzIHJvb21cclxuICAgIC8vIEZvciBub3csIHdlIGFsbG93IGFueSBhdXRoZW50aWNhdGVkIHVzZXIgdG8gdm90ZSBpbiBhbnkgYWN0aXZlIHJvb21cclxuICAgIC8vIFRPRE86IEltcGxlbWVudCBwcm9wZXIgcm9vbSBtZW1iZXJzaGlwIHZhbGlkYXRpb24gaW4gVGFzayAyXHJcbiAgICBjb25zdCBoYXNSb29tQWNjZXNzID0gYXdhaXQgdGhpcy52YWxpZGF0ZVJvb21BY2Nlc3ModXNlcklkLCByb29tSWQsIHJvb20pO1xyXG4gICAgaWYgKCFoYXNSb29tQWNjZXNzKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVXNlciBkb2VzIG5vdCBoYXZlIGFjY2VzcyB0byB0aGlzIHJvb20nKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBtb3ZpZSBpcyBpbiByb29tIGNhbmRpZGF0ZXNcclxuICAgIGNvbnN0IG1vdmllQ2FuZGlkYXRlID0gcm9vbS5jYW5kaWRhdGVzLmZpbmQoYyA9PiBjLmlkID09PSBtb3ZpZUlkKTtcclxuICAgIGlmICghbW92aWVDYW5kaWRhdGUpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNb3ZpZSBub3QgZm91bmQgaW4gcm9vbSBjYW5kaWRhdGVzJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gUmVjb3JkIHRoZSB2b3RlXHJcbiAgICBhd2FpdCB0aGlzLnJlY29yZFZvdGUodXNlcklkLCByb29tSWQsIG1vdmllSWQsIHZvdGUpO1xyXG5cclxuICAgIC8vIENoZWNrIGZvciBtYXRjaCBpZiB2b3RlIGlzIHBvc2l0aXZlXHJcbiAgICBsZXQgbWF0Y2g6IE1hdGNoIHwgdW5kZWZpbmVkO1xyXG4gICAgaWYgKHZvdGUpIHtcclxuICAgICAgbWF0Y2ggPSBhd2FpdCB0aGlzLmNoZWNrRm9yTWF0Y2gocm9vbUlkLCBtb3ZpZUlkLCBtb3ZpZUNhbmRpZGF0ZSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbWF0Y2ggfTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgdmFsaWRhdGVSb29tQWNjZXNzKHVzZXJJZDogc3RyaW5nLCByb29tSWQ6IHN0cmluZywgcm9vbTogUm9vbSk6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gQmFzaWMgdmFsaWRhdGlvbjogY2hlY2sgaWYgdXNlciBpcyB0aGUgcm9vbSBob3N0IG9yIGhhcyBwcmV2aW91c2x5IHZvdGVkIGluIHRoaXMgcm9vbVxyXG4gICAgICBpZiAocm9vbS5ob3N0SWQgPT09IHVzZXJJZCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSBpcyB0aGUgaG9zdCBvZiByb29tICR7cm9vbUlkfSAtIGFjY2VzcyBncmFudGVkYCk7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHVzZXIgaGFzIHByZXZpb3VzbHkgcGFydGljaXBhdGVkIGluIHRoaXMgcm9vbVxyXG4gICAgICBjb25zdCB1c2VyVm90ZXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ3VzZXJJZCA9IDp1c2VySWQnLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBMaW1pdDogMSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgaWYgKHVzZXJWb3Rlc1Jlc3VsdC5JdGVtcyAmJiB1c2VyVm90ZXNSZXN1bHQuSXRlbXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSBoYXMgcHJldmlvdXNseSB2b3RlZCBpbiByb29tICR7cm9vbUlkfSAtIGFjY2VzcyBncmFudGVkYCk7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIEZvciBNVlA6IEFsbG93IGFueSBhdXRoZW50aWNhdGVkIHVzZXIgdG8gam9pbiBhbnkgYWN0aXZlIHJvb21cclxuICAgICAgLy8gVE9ETzogSW1wbGVtZW50IHByb3BlciByb29tIG1lbWJlcnNoaXAgdmFsaWRhdGlvbiB3aXRoIER5bmFtb0RCIHRhYmxlIGluIFRhc2sgMlxyXG4gICAgICBjb25zb2xlLmxvZyhgVXNlciAke3VzZXJJZH0gZ3JhbnRlZCBhY2Nlc3MgdG8gcm9vbSAke3Jvb21JZH0gKE1WUCBtb2RlIC0gYWxsIHVzZXJzIGFsbG93ZWQpYCk7XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHZhbGlkYXRpbmcgcm9vbSBhY2Nlc3MgZm9yIHVzZXIgJHt1c2VySWR9IGluIHJvb20gJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgICAgLy8gT24gZXJyb3IsIGFsbG93IGFjY2VzcyBmb3Igbm93IChmYWlsIG9wZW4gZm9yIE1WUClcclxuICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldFJvb20ocm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPFJvb20gfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnJvb21zVGFibGUsXHJcbiAgICAgICAgS2V5OiB7IGlkOiByb29tSWQgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgaWYgKCFyZXN1bHQuSXRlbSkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCByb29tID0gcmVzdWx0Lkl0ZW0gYXMgUm9vbTtcclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHJvb20gaGFzIGV4cGlyZWRcclxuICAgICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XHJcbiAgICAgIGlmIChyb29tLnR0bCAmJiByb29tLnR0bCA8IG5vdykge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gcm9vbTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdldHRpbmcgcm9vbTonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZWNvcmRWb3RlKHVzZXJJZDogc3RyaW5nLCByb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCB2b3RlOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB1c2VyTW92aWVJZCA9IGAke3VzZXJJZH0jJHttb3ZpZUlkfWA7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gICAgY29uc3Qgdm90ZVJlY29yZDogVm90ZSA9IHtcclxuICAgICAgcm9vbUlkLFxyXG4gICAgICB1c2VyTW92aWVJZCxcclxuICAgICAgdXNlcklkLFxyXG4gICAgICBtb3ZpZUlkLFxyXG4gICAgICB2b3RlLFxyXG4gICAgICB0aW1lc3RhbXAsXHJcbiAgICB9O1xyXG5cclxuICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgIEl0ZW06IHZvdGVSZWNvcmQsXHJcbiAgICAgIC8vIEFsbG93IG92ZXJ3cml0aW5nIHByZXZpb3VzIHZvdGVzIGZvciB0aGUgc2FtZSB1c2VyL21vdmllIGNvbWJpbmF0aW9uXHJcbiAgICB9KSk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYFZvdGUgcmVjb3JkZWQ6IFVzZXIgJHt1c2VySWR9IHZvdGVkICR7dm90ZSA/ICdZRVMnIDogJ05PJ30gZm9yIG1vdmllICR7bW92aWVJZH0gaW4gcm9vbSAke3Jvb21JZH1gKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgY2hlY2tGb3JNYXRjaChyb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCBtb3ZpZUNhbmRpZGF0ZTogTW92aWVDYW5kaWRhdGUpOiBQcm9taXNlPE1hdGNoIHwgdW5kZWZpbmVkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBHZXQgYWxsIHZvdGVzIGZvciB0aGlzIG1vdmllIGluIHRoaXMgcm9vbSAoZXhjbHVkaW5nIHBhcnRpY2lwYXRpb24gcmVjb3JkcylcclxuICAgICAgY29uc3Qgdm90ZXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ21vdmllSWQgPSA6bW92aWVJZCBBTkQgdm90ZSA9IDp2b3RlIEFORCBtb3ZpZUlkIDw+IDpwYXJ0aWNpcGF0aW9uTWFya2VyJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICAgICc6bW92aWVJZCc6IG1vdmllSWQsXHJcbiAgICAgICAgICAnOnZvdGUnOiB0cnVlLCAvLyBPbmx5IHBvc2l0aXZlIHZvdGVzXHJcbiAgICAgICAgICAnOnBhcnRpY2lwYXRpb25NYXJrZXInOiAtMSwgLy8gRXhjbHVkZSBwYXJ0aWNpcGF0aW9uIHJlY29yZHNcclxuICAgICAgICB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBwb3NpdGl2ZVZvdGVzID0gdm90ZXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke3Bvc2l0aXZlVm90ZXMubGVuZ3RofSBwb3NpdGl2ZSB2b3RlcyBmb3IgbW92aWUgJHttb3ZpZUlkfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG5cclxuICAgICAgLy8gR2V0IGFsbCB1bmlxdWUgdXNlcnMgd2hvIGhhdmUgdm90ZWQgaW4gdGhpcyByb29tIChleGNsdWRpbmcgcGFydGljaXBhdGlvbiByZWNvcmRzKVxyXG4gICAgICBjb25zdCBhbGxWb3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnbW92aWVJZCA8PiA6cGFydGljaXBhdGlvbk1hcmtlcicsIC8vIEV4Y2x1ZGUgcGFydGljaXBhdGlvbiByZWNvcmRzXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgICAnOnBhcnRpY2lwYXRpb25NYXJrZXInOiAtMSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBhbGxWb3RlcyA9IGFsbFZvdGVzUmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICBjb25zdCB1bmlxdWVVc2VycyA9IG5ldyBTZXQoYWxsVm90ZXMubWFwKHZvdGUgPT4gKHZvdGUgYXMgVm90ZSkudXNlcklkKSk7XHJcbiAgICAgIGNvbnN0IHRvdGFsVXNlcnMgPSB1bmlxdWVVc2Vycy5zaXplO1xyXG5cclxuICAgICAgY29uc29sZS5sb2coYFRvdGFsIHVuaXF1ZSB1c2VycyB3aG8gaGF2ZSB2b3RlZCBpbiByb29tOiAke3RvdGFsVXNlcnN9YCk7XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiBhbGwgdXNlcnMgdm90ZWQgcG9zaXRpdmVseSBmb3IgdGhpcyBtb3ZpZVxyXG4gICAgICBjb25zdCBwb3NpdGl2ZVVzZXJJZHMgPSBuZXcgU2V0KHBvc2l0aXZlVm90ZXMubWFwKHZvdGUgPT4gKHZvdGUgYXMgVm90ZSkudXNlcklkKSk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAocG9zaXRpdmVVc2VySWRzLnNpemUgPT09IHRvdGFsVXNlcnMgJiYgdG90YWxVc2VycyA+IDEpIHtcclxuICAgICAgICAvLyBXZSBoYXZlIGEgbWF0Y2ghIEFsbCB1c2VycyB2b3RlZCBwb3NpdGl2ZWx5XHJcbiAgICAgICAgY29uc29sZS5sb2coYE1BVENIIERFVEVDVEVEISBBbGwgJHt0b3RhbFVzZXJzfSB1c2VycyB2b3RlZCBwb3NpdGl2ZWx5IGZvciBtb3ZpZSAke21vdmllSWR9YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgaWYgbWF0Y2ggYWxyZWFkeSBleGlzdHNcclxuICAgICAgICBjb25zdCBleGlzdGluZ01hdGNoID0gYXdhaXQgdGhpcy5nZXRFeGlzdGluZ01hdGNoKHJvb21JZCwgbW92aWVJZCk7XHJcbiAgICAgICAgaWYgKGV4aXN0aW5nTWF0Y2gpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKCdNYXRjaCBhbHJlYWR5IGV4aXN0cywgcmV0dXJuaW5nIGV4aXN0aW5nIG1hdGNoJyk7XHJcbiAgICAgICAgICByZXR1cm4gZXhpc3RpbmdNYXRjaDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIENyZWF0ZSBuZXcgbWF0Y2hcclxuICAgICAgICBjb25zdCBtYXRjaCA9IGF3YWl0IHRoaXMuY3JlYXRlTWF0Y2gocm9vbUlkLCBtb3ZpZUlkLCBtb3ZpZUNhbmRpZGF0ZSwgQXJyYXkuZnJvbShwb3NpdGl2ZVVzZXJJZHMpKTtcclxuICAgICAgICByZXR1cm4gbWF0Y2g7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBObyBtYXRjaCB5ZXQuIFBvc2l0aXZlIHZvdGVzOiAke3Bvc2l0aXZlVXNlcklkcy5zaXplfSwgVG90YWwgdXNlcnM6ICR7dG90YWxVc2Vyc31gKTtcclxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyBmb3IgbWF0Y2g6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBnZXRFeGlzdGluZ01hdGNoKHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIpOiBQcm9taXNlPE1hdGNoIHwgbnVsbD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgS2V5OiB7XHJcbiAgICAgICAgICByb29tSWQsXHJcbiAgICAgICAgICBtb3ZpZUlkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIHJldHVybiByZXN1bHQuSXRlbSBhcyBNYXRjaCB8fCBudWxsO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgY2hlY2tpbmcgZXhpc3RpbmcgbWF0Y2g6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgY3JlYXRlTWF0Y2gocm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgbW92aWVDYW5kaWRhdGU6IE1vdmllQ2FuZGlkYXRlLCBtYXRjaGVkVXNlcnM6IHN0cmluZ1tdKTogUHJvbWlzZTxNYXRjaD4ge1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG4gICAgY29uc3QgbWF0Y2hJZCA9IGAke3Jvb21JZH0jJHttb3ZpZUlkfWA7XHJcblxyXG4gICAgY29uc3QgbWF0Y2g6IE1hdGNoID0ge1xyXG4gICAgICBpZDogbWF0Y2hJZCxcclxuICAgICAgcm9vbUlkLFxyXG4gICAgICBtb3ZpZUlkLFxyXG4gICAgICB0aXRsZTogbW92aWVDYW5kaWRhdGUudGl0bGUsXHJcbiAgICAgIHBvc3RlclBhdGg6IG1vdmllQ2FuZGlkYXRlLnBvc3RlclBhdGggfHwgdW5kZWZpbmVkLFxyXG4gICAgICBtZWRpYVR5cGU6IG1vdmllQ2FuZGlkYXRlLm1lZGlhVHlwZSxcclxuICAgICAgbWF0Y2hlZFVzZXJzLFxyXG4gICAgICB0aW1lc3RhbXAsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFN0b3JlIHRoZSBtYWluIG1hdGNoIHJlY29yZFxyXG4gICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICBJdGVtOiBtYXRjaCxcclxuICAgICAgQ29uZGl0aW9uRXhwcmVzc2lvbjogJ2F0dHJpYnV0ZV9ub3RfZXhpc3RzKHJvb21JZCkgQU5EIGF0dHJpYnV0ZV9ub3RfZXhpc3RzKG1vdmllSWQpJywgLy8gUHJldmVudCBkdXBsaWNhdGVzXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gQ1JJVElDQUw6IENyZWF0ZSBpbmRpdmlkdWFsIG1hdGNoIHJlY29yZHMgZm9yIGVhY2ggdXNlciB0byBlbmFibGUgR1NJIHF1ZXJpZXNcclxuICAgIC8vIFRoaXMgYWxsb3dzIGVmZmljaWVudCBxdWVyeWluZyBvZiBtYXRjaGVzIGJ5IHVzZXJJZCB1c2luZyB0aGUgbmV3IEdTSVxyXG4gICAgY29uc3QgdXNlck1hdGNoUHJvbWlzZXMgPSBtYXRjaGVkVXNlcnMubWFwKGFzeW5jICh1c2VySWQpID0+IHtcclxuICAgICAgY29uc3QgdXNlck1hdGNoID0ge1xyXG4gICAgICAgIC4uLm1hdGNoLFxyXG4gICAgICAgIHVzZXJJZCwgLy8gQWRkIHVzZXJJZCBmaWVsZCBmb3IgR1NJXHJcbiAgICAgICAgaWQ6IGAke3VzZXJJZH0jJHttYXRjaElkfWAsIC8vIFVuaXF1ZSBJRCBwZXIgdXNlclxyXG4gICAgICAgIHJvb21JZDogYCR7dXNlcklkfSMke3Jvb21JZH1gLCAvLyBDb21wb3NpdGUga2V5IHRvIGF2b2lkIGNvbmZsaWN0c1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgICAgSXRlbTogdXNlck1hdGNoLFxyXG4gICAgICAgIH0pKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgVXNlciBtYXRjaCByZWNvcmQgY3JlYXRlZCBmb3IgdXNlciAke3VzZXJJZH1gKTtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBjcmVhdGluZyB1c2VyIG1hdGNoIHJlY29yZCBmb3IgJHt1c2VySWR9OmAsIGVycm9yKTtcclxuICAgICAgICAvLyBDb250aW51ZSB3aXRoIG90aGVyIHVzZXJzIGV2ZW4gaWYgb25lIGZhaWxzXHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFdhaXQgZm9yIGFsbCB1c2VyIG1hdGNoIHJlY29yZHMgdG8gYmUgY3JlYXRlZFxyXG4gICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHVzZXJNYXRjaFByb21pc2VzKTtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgTWF0Y2ggY3JlYXRlZDogJHttYXRjaElkfSB3aXRoICR7bWF0Y2hlZFVzZXJzLmxlbmd0aH0gdXNlcnMgYW5kIGluZGl2aWR1YWwgdXNlciByZWNvcmRzYCk7XHJcblxyXG4gICAgLy8gQ1JJVElDQUw6IFRyaWdnZXIgQXBwU3luYyBzdWJzY3JpcHRpb24gRklSU1QgYmVmb3JlIGRlbGV0aW5nIHJvb21cclxuICAgIC8vIFRoaXMgZW5zdXJlcyBhbGwgdXNlcnMgZ2V0IG5vdGlmaWVkIGJlZm9yZSB0aGUgcm9vbSBiZWNvbWVzIHVuYXZhaWxhYmxlXHJcbiAgICBhd2FpdCB0aGlzLnRyaWdnZXJBcHBTeW5jU3Vic2NyaXB0aW9uKG1hdGNoKTtcclxuXHJcbiAgICAvLyBXYWl0IGEgbW9tZW50IHRvIGVuc3VyZSBub3RpZmljYXRpb25zIGFyZSBzZW50IGJlZm9yZSBkZWxldGluZyByb29tXHJcbiAgICAvLyBUaGlzIHByZXZlbnRzIFwiUm9vbSBub3QgZm91bmRcIiBlcnJvcnMgZm9yIGNvbmN1cnJlbnQgdm90ZXNcclxuICAgIGF3YWl0IG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCAyMDAwKSk7IC8vIDIgc2Vjb25kIGRlbGF5XHJcblxyXG4gICAgLy8gRGVsZXRlIHRoZSByb29tIHNpbmNlIG1hdGNoIGlzIGZvdW5kIC0gcm9vbSBpcyBubyBsb25nZXIgbmVlZGVkXHJcbiAgICBhd2FpdCB0aGlzLmRlbGV0ZVJvb20ocm9vbUlkKTtcclxuXHJcbiAgICByZXR1cm4gbWF0Y2g7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGRlbGV0ZVJvb20ocm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIERlbGV0ZSB0aGUgcm9vbSBmcm9tIER5bmFtb0RCXHJcbiAgICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBEZWxldGVDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMucm9vbXNUYWJsZSxcclxuICAgICAgICBLZXk6IHsgaWQ6IHJvb21JZCB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgUm9vbSAke3Jvb21JZH0gZGVsZXRlZCBhZnRlciBtYXRjaCBjcmVhdGlvbmApO1xyXG5cclxuICAgICAgLy8gT3B0aW9uYWxseTogRGVsZXRlIGFsbCB2b3RlcyBmb3IgdGhpcyByb29tIHRvIGZyZWUgdXAgc3BhY2VcclxuICAgICAgYXdhaXQgdGhpcy5kZWxldGVSb29tVm90ZXMocm9vbUlkKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGRlbGV0aW5nIHJvb20gJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgICAgLy8gRG9uJ3QgZmFpbCB0aGUgbWF0Y2ggY3JlYXRpb24gaWYgcm9vbSBkZWxldGlvbiBmYWlsc1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBkZWxldGVSb29tVm90ZXMocm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIEdldCBhbGwgdm90ZXMgYW5kIHBhcnRpY2lwYXRpb24gcmVjb3JkcyBmb3IgdGhpcyByb29tXHJcbiAgICAgIGNvbnN0IHZvdGVzUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IGFsbFJlY29yZHMgPSB2b3Rlc1Jlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgXHJcbiAgICAgIC8vIERlbGV0ZSBhbGwgcmVjb3JkcyAodm90ZXMgYW5kIHBhcnRpY2lwYXRpb24pIGluIGJhdGNoZXNcclxuICAgICAgY29uc3QgZGVsZXRlUHJvbWlzZXMgPSBhbGxSZWNvcmRzLm1hcChyZWNvcmQgPT4gXHJcbiAgICAgICAgZG9jQ2xpZW50LnNlbmQobmV3IERlbGV0ZUNvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgICBLZXk6IHtcclxuICAgICAgICAgICAgcm9vbUlkOiByZWNvcmQucm9vbUlkLFxyXG4gICAgICAgICAgICB1c2VyTW92aWVJZDogcmVjb3JkLnVzZXJNb3ZpZUlkLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9KSlcclxuICAgICAgKTtcclxuXHJcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChkZWxldGVQcm9taXNlcyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBEZWxldGVkICR7YWxsUmVjb3Jkcy5sZW5ndGh9IHJlY29yZHMgKHZvdGVzIGFuZCBwYXJ0aWNpcGF0aW9uKSBmb3Igcm9vbSAke3Jvb21JZH1gKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGRlbGV0aW5nIHJlY29yZHMgZm9yIHJvb20gJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgdHJpZ2dlckFwcFN5bmNTdWJzY3JpcHRpb24obWF0Y2g6IE1hdGNoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+UlCBJTklDSUFORE8gQlJPQURDQVNUIFJFQUwgcGFyYSBzYWxhOiAke21hdGNoLnJvb21JZH1gKTtcclxuICAgIGNvbnNvbGUubG9nKGDwn5qAIE5VRVZBIElNUExFTUVOVEFDSU9OIHYyOiBVc2FuZG8gbGxhbWFkYSBIVFRQIGRpcmVjdGEgYSBBcHBTeW5jYCk7XHJcbiAgICBcclxuICAgIGNvbnN0IGVuZHBvaW50ID0gcHJvY2Vzcy5lbnYuR1JBUEhRTF9FTkRQT0lOVDtcclxuICAgIGlmICghZW5kcG9pbnQpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEZBVEFMOiBHUkFQSFFMX0VORFBPSU5UIG5vIGVzdMOhIGRlZmluaWRvJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICAvLyBVc2Ftb3MgbGEgbXV0YWNpw7NuIEVYQUNUQSBxdWUgZGVmaW5pbW9zIGVuIGVsIHNjaGVtYSBwYXJhIGFjdGl2YXIgbGEgc3VzY3JpcGNpw7NuXHJcbiAgICBjb25zdCBtdXRhdGlvbiA9IGBcclxuICAgICAgbXV0YXRpb24gUHVibGlzaFJvb21NYXRjaCgkcm9vbUlkOiBJRCEsICRtYXRjaERhdGE6IFJvb21NYXRjaElucHV0ISkge1xyXG4gICAgICAgIHB1Ymxpc2hSb29tTWF0Y2gocm9vbUlkOiAkcm9vbUlkLCBtYXRjaERhdGE6ICRtYXRjaERhdGEpIHtcclxuICAgICAgICAgIHJvb21JZFxyXG4gICAgICAgICAgbWF0Y2hJZFxyXG4gICAgICAgICAgbW92aWVJZFxyXG4gICAgICAgICAgbWF0Y2hlZFVzZXJzXHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICBgO1xyXG5cclxuICAgIGNvbnN0IHZhcmlhYmxlcyA9IHtcclxuICAgICAgcm9vbUlkOiBtYXRjaC5yb29tSWQsXHJcbiAgICAgIG1hdGNoRGF0YToge1xyXG4gICAgICAgIG1hdGNoSWQ6IG1hdGNoLmlkLFxyXG4gICAgICAgIG1vdmllSWQ6IG1hdGNoLm1vdmllSWQsXHJcbiAgICAgICAgbW92aWVUaXRsZTogbWF0Y2gudGl0bGUsXHJcbiAgICAgICAgcG9zdGVyUGF0aDogbWF0Y2gucG9zdGVyUGF0aCxcclxuICAgICAgICBtYXRjaGVkVXNlcnM6IG1hdGNoLm1hdGNoZWRVc2VycyxcclxuICAgICAgICBtYXRjaERldGFpbHM6IHtcclxuICAgICAgICAgIHZvdGVDb3VudDogbWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aCxcclxuICAgICAgICAgIHJlcXVpcmVkVm90ZXM6IG1hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGgsXHJcbiAgICAgICAgICBtYXRjaFR5cGU6ICd1bmFuaW1vdXMnXHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwoZW5kcG9pbnQpO1xyXG4gICAgICBjb25zdCByZXF1ZXN0ID0gbmV3IEh0dHBSZXF1ZXN0KHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICAgaG9zdDogdXJsLmhvc3RuYW1lLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaG9zdG5hbWU6IHVybC5ob3N0bmFtZSxcclxuICAgICAgICBwYXRoOiAnL2dyYXBocWwnLFxyXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgcXVlcnk6IG11dGF0aW9uLCB2YXJpYWJsZXMgfSksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gRmlybWFtb3MgbGEgcGV0aWNpw7NuIGNvbiBsYXMgY3JlZGVuY2lhbGVzIElBTSBkZSBsYSBMYW1iZGFcclxuICAgICAgY29uc3Qgc2lnbmVyID0gbmV3IFNpZ25hdHVyZVY0KHtcclxuICAgICAgICBjcmVkZW50aWFsczogZGVmYXVsdFByb3ZpZGVyKCksXHJcbiAgICAgICAgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnLFxyXG4gICAgICAgIHNlcnZpY2U6ICdhcHBzeW5jJyxcclxuICAgICAgICBzaGEyNTY6IFNoYTI1NixcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBzaWduZWRSZXF1ZXN0ID0gYXdhaXQgc2lnbmVyLnNpZ24ocmVxdWVzdCk7XHJcblxyXG4gICAgICAvLyBFbnZpYW1vcyBsYSBwZXRpY2nDs24gSFRUUCAoTm9kZSAxOC8yMCB5YSB0aWVuZSBmZXRjaCBuYXRpdm8pXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goZW5kcG9pbnQsIHtcclxuICAgICAgICBtZXRob2Q6IHNpZ25lZFJlcXVlc3QubWV0aG9kLFxyXG4gICAgICAgIGhlYWRlcnM6IHNpZ25lZFJlcXVlc3QuaGVhZGVycyBhcyBhbnksXHJcbiAgICAgICAgYm9keTogc2lnbmVkUmVxdWVzdC5ib2R5LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKSBhcyB7IGRhdGE/OiBhbnk7IGVycm9ycz86IGFueVtdIH07XHJcbiAgICAgIFxyXG4gICAgICBpZiAocmVzdWx0LmVycm9ycykge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBkZSBBcHBTeW5jOicsIEpTT04uc3RyaW5naWZ5KHJlc3VsdC5lcnJvcnMpKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIEJST0FEQ0FTVCBFWElUT1NPOiBBcHBTeW5jIGhhIHJlY2liaWRvIGxhIG9yZGVuIGRlIG5vdGlmaWNhci4nKTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGVudmlhbmRvIGJyb2FkY2FzdCBhIEFwcFN5bmM6JywgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBmYWxsYmFja1RvQ3JlYXRlTWF0Y2gobWF0Y2g6IE1hdGNoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+UhCBVc2luZyBmYWxsYmFjayBjcmVhdGVNYXRjaCBtZXRob2QuLi4nKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEZBTExCQUNLOiBVc2UgdGhlIG9sZCBjcmVhdGVNYXRjaCBtZXRob2QgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcclxuICAgICAgaWYgKHRoaXMubWF0Y2hMYW1iZGFBcm4pIHtcclxuICAgICAgICBjb25zdCBwYXlsb2FkID0ge1xyXG4gICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlTWF0Y2gnLFxyXG4gICAgICAgICAgaW5wdXQ6IHtcclxuICAgICAgICAgICAgcm9vbUlkOiBtYXRjaC5yb29tSWQsXHJcbiAgICAgICAgICAgIG1vdmllSWQ6IG1hdGNoLm1vdmllSWQsXHJcbiAgICAgICAgICAgIHRpdGxlOiBtYXRjaC50aXRsZSxcclxuICAgICAgICAgICAgcG9zdGVyUGF0aDogbWF0Y2gucG9zdGVyUGF0aCxcclxuICAgICAgICAgICAgbWF0Y2hlZFVzZXJzOiBtYXRjaC5tYXRjaGVkVXNlcnMsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5qAIEludm9raW5nIE1hdGNoIExhbWJkYSB3aXRoIGNyZWF0ZU1hdGNoIChmYWxsYmFjaykuLi4nKTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBjb21tYW5kID0gbmV3IEludm9rZUNvbW1hbmQoe1xyXG4gICAgICAgICAgRnVuY3Rpb25OYW1lOiB0aGlzLm1hdGNoTGFtYmRhQXJuLFxyXG4gICAgICAgICAgSW52b2NhdGlvblR5cGU6ICdSZXF1ZXN0UmVzcG9uc2UnLFxyXG4gICAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQoY29tbWFuZCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHJlc3BvbnNlLlBheWxvYWQpIHtcclxuICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHJlc3BvbnNlLlBheWxvYWQpKTtcclxuICAgICAgICAgIGlmIChyZXN1bHQuc3RhdHVzQ29kZSA9PT0gMjAwKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfinIUgRmFsbGJhY2sgY3JlYXRlTWF0Y2ggZXhlY3V0ZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFsbGJhY2sgY3JlYXRlTWF0Y2ggcmV0dXJuZWQgZXJyb3I6JywgcmVzdWx0LmJvZHk/LmVycm9yKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFN0b3JlIG5vdGlmaWNhdGlvbnMgZm9yIHBvbGxpbmcgZmFsbGJhY2tcclxuICAgICAgYXdhaXQgdGhpcy5zdG9yZU1hdGNoTm90aWZpY2F0aW9ucyhtYXRjaCk7XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGluIGZhbGxiYWNrIG1ldGhvZDonLCBlcnJvcik7XHJcbiAgICAgIC8vIFN0b3JlIG5vdGlmaWNhdGlvbnMgZm9yIHBvbGxpbmcgYXMgZmluYWwgZmFsbGJhY2tcclxuICAgICAgYXdhaXQgdGhpcy5zdG9yZU1hdGNoTm90aWZpY2F0aW9ucyhtYXRjaCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHN0b3JlTWF0Y2hOb3RpZmljYXRpb25zKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gU3RvcmUgaW5kaXZpZHVhbCBub3RpZmljYXRpb24gcmVjb3JkcyBmb3IgZWFjaCB1c2VyXHJcbiAgICAgIC8vIFRoaXMgZW5hYmxlcyBwb2xsaW5nLWJhc2VkIG1hdGNoIGRldGVjdGlvbiBhcyBhIGZhbGxiYWNrXHJcbiAgICAgIGNvbnN0IG5vdGlmaWNhdGlvblByb21pc2VzID0gbWF0Y2gubWF0Y2hlZFVzZXJzLm1hcChhc3luYyAodXNlcklkKSA9PiB7XHJcbiAgICAgICAgY29uc3Qgbm90aWZpY2F0aW9uUmVjb3JkID0ge1xyXG4gICAgICAgICAgdXNlcklkLFxyXG4gICAgICAgICAgbWF0Y2hJZDogbWF0Y2guaWQsXHJcbiAgICAgICAgICBvcmlnaW5hbFJvb21JZDogbWF0Y2gucm9vbUlkLCAvLyBTdG9yZSBvcmlnaW5hbCByb29tSWQgc2VwYXJhdGVseVxyXG4gICAgICAgICAgb3JpZ2luYWxNb3ZpZUlkOiBtYXRjaC5tb3ZpZUlkLCAvLyBTdG9yZSBvcmlnaW5hbCBtb3ZpZUlkIHNlcGFyYXRlbHlcclxuICAgICAgICAgIHRpdGxlOiBtYXRjaC50aXRsZSxcclxuICAgICAgICAgIHBvc3RlclBhdGg6IG1hdGNoLnBvc3RlclBhdGgsXHJcbiAgICAgICAgICB0aW1lc3RhbXA6IG1hdGNoLnRpbWVzdGFtcCxcclxuICAgICAgICAgIG5vdGlmaWVkOiBmYWxzZSwgLy8gRmxhZyB0byB0cmFjayBpZiB1c2VyIGhhcyBiZWVuIG5vdGlmaWVkXHJcbiAgICAgICAgICB0dGw6IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDcgKiAyNCAqIDYwICogNjApLCAvLyA3IGRheXMgVFRMXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgLy8gU3RvcmUgaW4gYSBub3RpZmljYXRpb25zIHRhYmxlICh3ZSdsbCB1c2UgdGhlIG1hdGNoZXMgdGFibGUgd2l0aCBhIHNwZWNpYWwgcGF0dGVybilcclxuICAgICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgICAgSXRlbToge1xyXG4gICAgICAgICAgICByb29tSWQ6IGBOT1RJRklDQVRJT04jJHt1c2VySWR9YCwgLy8gU3BlY2lhbCBwcmVmaXggZm9yIG5vdGlmaWNhdGlvbnNcclxuICAgICAgICAgICAgbW92aWVJZDogRGF0ZS5ub3coKSwgLy8gVXNlIHRpbWVzdGFtcCBhcyBzb3J0IGtleSBmb3IgdW5pcXVlbmVzc1xyXG4gICAgICAgICAgICAuLi5ub3RpZmljYXRpb25SZWNvcmQsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYE5vdGlmaWNhdGlvbiBzdG9yZWQgZm9yIHVzZXIgJHt1c2VySWR9YCk7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKG5vdGlmaWNhdGlvblByb21pc2VzKTtcclxuICAgICAgY29uc29sZS5sb2coJ+KchSBNYXRjaCBub3RpZmljYXRpb25zIHN0b3JlZCBmb3IgcG9sbGluZyBmYWxsYmFjaycpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igc3RvcmluZyBtYXRjaCBub3RpZmljYXRpb25zOicsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgbm90aWZ5TWF0Y2hDcmVhdGVkKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgICBvcGVyYXRpb246ICdtYXRjaENyZWF0ZWQnLFxyXG4gICAgICAgIG1hdGNoLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcclxuICAgICAgICBGdW5jdGlvbk5hbWU6IHRoaXMubWF0Y2hMYW1iZGFBcm4sXHJcbiAgICAgICAgSW52b2NhdGlvblR5cGU6ICdFdmVudCcsIC8vIEFzeW5jIGludm9jYXRpb25cclxuICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChjb21tYW5kKTtcclxuICAgICAgY29uc29sZS5sb2coJ01hdGNoIG5vdGlmaWNhdGlvbiBzZW50IHRvIE1hdGNoIExhbWJkYScpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIG5vdGlmeSBNYXRjaCBMYW1iZGE6JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbi8vIExhbWJkYSBIYW5kbGVyXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyPFZvdGVFdmVudCwgVm90ZVJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdWb3RlIExhbWJkYSByZWNlaXZlZCBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCkpO1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgeyB1c2VySWQsIGlucHV0IH0gPSBldmVudDtcclxuICAgIGNvbnN0IHsgcm9vbUlkLCBtb3ZpZUlkLCB2b3RlIH0gPSBpbnB1dDtcclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFyb29tSWQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHR5cGVvZiBtb3ZpZUlkICE9PSAnbnVtYmVyJykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ01vdmllIElEIG11c3QgYmUgYSBudW1iZXInKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodHlwZW9mIHZvdGUgIT09ICdib29sZWFuJykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1ZvdGUgbXVzdCBiZSBhIGJvb2xlYW4nKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCB2b3RlU2VydmljZSA9IG5ldyBWb3RlU2VydmljZSgpO1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdm90ZVNlcnZpY2UucHJvY2Vzc1ZvdGUodXNlcklkLCByb29tSWQsIG1vdmllSWQsIHZvdGUpO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgYm9keTogcmVzdWx0LFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1ZvdGUgTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCc7XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgYm9keToge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvck1lc3NhZ2UsXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG4gIH1cclxufTsiXX0=