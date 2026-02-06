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
// CONFIGURATION: Choose match logic
// 'maxParticipants' = Match when exactly maxParticipants users vote YES (current)
// 'allUsers' = Match when ALL users in room vote YES (your specification)
const MATCH_LOGIC = 'maxParticipants';
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
        // Basic room membership validation
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
            match = await this.checkForMatch(roomId, movieId, movieCandidate, room);
        }
        return { success: true, match };
    }
    async validateRoomAccess(userId, roomId, room) {
        try {
            // Check if user is the room host
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
            console.log(`User ${userId} granted access to room ${roomId} (MVP mode - all users allowed)`);
            return true;
        }
        catch (error) {
            console.error(`Error validating room access for user ${userId} in room ${roomId}:`, error);
            return true; // Fail open for MVP
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
        }));
        console.log(`Vote recorded: User ${userId} voted ${vote ? 'YES' : 'NO'} for movie ${movieId} in room ${roomId}`);
    }
    /**
     * CRITICAL: Check for match using configured logic
     *
     * Two modes:
     * 1. 'maxParticipants': Match when exactly maxParticipants users vote YES
     * 2. 'allUsers': Match when ALL users in room vote YES (true consensus)
     */
    async checkForMatch(roomId, movieId, movieCandidate, room) {
        try {
            console.log(`🔍 Checking for match using logic: ${MATCH_LOGIC}`);
            // STEP 1: Get all positive votes for this movie
            // CRITICAL: Use ConsistentRead to see votes that were just written
            const positiveVotesResult = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.votesTable,
                KeyConditionExpression: 'roomId = :roomId',
                FilterExpression: 'movieId = :movieId AND vote = :vote AND movieId <> :participationMarker',
                ExpressionAttributeValues: {
                    ':roomId': roomId,
                    ':movieId': movieId,
                    ':vote': true,
                    ':participationMarker': -1, // Exclude participation records
                },
                ConsistentRead: true, // ✅ CRITICAL: Force strong consistency
            }));
            const positiveVotes = positiveVotesResult.Items || [];
            const positiveUserIds = new Set(positiveVotes.map(vote => vote.userId));
            const positiveVoteCount = positiveUserIds.size;
            console.log(`Found ${positiveVoteCount} unique positive votes for movie ${movieId} in room ${roomId}`);
            // STEP 2: Determine required votes based on match logic
            let requiredVotes;
            let matchLogicDescription;
            if (MATCH_LOGIC === 'maxParticipants') {
                // MODE 1: Match when exactly maxParticipants users vote YES
                requiredVotes = room.maxParticipants || 2;
                matchLogicDescription = `maxParticipants (${requiredVotes})`;
                console.log(`Using maxParticipants logic: Room ${roomId} requires ${requiredVotes} positive votes for a match`);
            }
            else {
                // MODE 2: Match when ALL users in room vote YES
                // Get ALL users who have participated in this room
                const allUsersResult = await docClient.send(new lib_dynamodb_1.QueryCommand({
                    TableName: this.votesTable,
                    KeyConditionExpression: 'roomId = :roomId',
                    FilterExpression: 'movieId = :participationMarker',
                    ExpressionAttributeValues: {
                        ':roomId': roomId,
                        ':participationMarker': -1, // Participation records
                    },
                    ConsistentRead: true,
                }));
                const allUsers = allUsersResult.Items || [];
                const totalUsersInRoom = new Set(allUsers.map(record => record.userId)).size;
                requiredVotes = totalUsersInRoom;
                matchLogicDescription = `all users in room (${requiredVotes})`;
                console.log(`Using allUsers logic: Room ${roomId} has ${totalUsersInRoom} users, requires ${requiredVotes} positive votes for a match`);
            }
            // STEP 3: Check if match condition is met
            if (positiveVoteCount === requiredVotes) {
                console.log(`🎉 MATCH DETECTED! ${positiveVoteCount} users voted positively for movie ${movieId} (required: ${matchLogicDescription})`);
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
            console.log(`No match yet. Positive votes: ${positiveVoteCount}, Required: ${requiredVotes} (${matchLogicDescription})`);
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
        // Store match in DynamoDB
        try {
            await docClient.send(new lib_dynamodb_1.PutCommand({
                TableName: this.matchesTable,
                Item: match,
                ConditionExpression: 'attribute_not_exists(roomId) AND attribute_not_exists(movieId)',
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
        // CRITICAL: Trigger AppSync subscription to notify all users
        await this.triggerAppSyncSubscription(match);
        // Wait to ensure notifications are sent
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log(`Match created and notifications sent for room ${roomId}`);
        return match;
    }
    /**
     * CRITICAL: Trigger AppSync subscriptions via GraphQL mutations
     * This is the ONLY way to notify frontend clients in real-time
     * Direct DynamoDB writes do NOT trigger subscriptions
     */
    async triggerAppSyncSubscription(match) {
        console.log(`🔔 BROADCASTING match notifications to ${match.matchedUsers.length} users`);
        console.log(`👥 Users to notify: ${match.matchedUsers.join(', ')}`);
        const endpoint = process.env.GRAPHQL_ENDPOINT;
        if (!endpoint) {
            console.error('❌ FATAL: GRAPHQL_ENDPOINT not defined');
            return;
        }
        // STRATEGY: Send individual notification to each user
        // This ensures ALL users who participated in the match receive notification
        const notificationPromises = match.matchedUsers.map(async (userId) => {
            await this.sendIndividualUserNotification(userId, match, endpoint);
        });
        // Send all notifications in parallel
        const results = await Promise.allSettled(notificationPromises);
        // Log results
        results.forEach((result, index) => {
            const userId = match.matchedUsers[index];
            if (result.status === 'fulfilled') {
                console.log(`✅ Notification sent successfully to user: ${userId}`);
            }
            else {
                console.error(`❌ Error sending notification to user ${userId}:`, result.reason);
            }
        });
        // Also send room notification for compatibility
        await this.sendRoomNotification(match, endpoint);
    }
    /**
     * Send individual user notification via publishUserMatch mutation
     */
    async sendIndividualUserNotification(userId, match, endpoint) {
        console.log(`📤 Sending individual notification to user: ${userId}`);
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
                roomId: match.roomId,
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
            // Sign request with IAM credentials
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
                console.error(`❌ Error notifying user ${userId}:`, JSON.stringify(result.errors));
                throw new Error(`AppSync error for user ${userId}: ${result.errors[0]?.message}`);
            }
            else {
                console.log(`✅ User ${userId} notified successfully`);
            }
        }
        catch (error) {
            console.error(`❌ Error sending notification to user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Send room notification via publishRoomMatch mutation
     */
    async sendRoomNotification(match, endpoint) {
        console.log(`📤 Sending room notification: ${match.roomId}`);
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
                console.error('❌ Error in room notification:', JSON.stringify(result.errors));
            }
            else {
                console.log('✅ Room notification sent successfully');
            }
        }
        catch (error) {
            console.error('❌ Error sending room notification:', error);
        }
    }
}
// Lambda Handler for AppSync
const handler = async (event) => {
    console.log('Vote Lambda received AppSync event:', JSON.stringify(event));
    console.log(`🔧 Match logic configured as: ${MATCH_LOGIC}`);
    try {
        // Extract user ID from AppSync context
        const userId = event.identity?.claims?.sub || event.identity?.username;
        if (!userId) {
            console.error('User not authenticated for vote');
            return { success: false };
        }
        // Get arguments from AppSync
        const { input } = event.arguments;
        const { roomId, movieId, vote } = input;
        // Validate input
        if (!roomId) {
            console.error('Room ID is required');
            return { success: false };
        }
        if (typeof movieId !== 'number') {
            console.error('Movie ID must be a number');
            return { success: false };
        }
        if (typeof vote !== 'boolean') {
            console.error('Vote must be a boolean');
            return { success: false };
        }
        const voteService = new VoteService();
        try {
            const result = await voteService.processVote(userId, roomId, movieId, vote);
            return result;
        }
        catch (error) {
            console.error('Error processing vote:', error);
            return { success: false };
        }
    }
    catch (error) {
        console.error('Vote Lambda error:', error);
        return { success: false };
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXgtaW1wcm92ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdm90ZS9pbmRleC1pbXByb3ZlZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQW9IO0FBQ3BILDBEQUFxRTtBQUNyRSx3REFBb0Q7QUFDcEQscURBQStDO0FBQy9DLGdGQUFvRTtBQUNwRSwwREFBcUQ7QUFFckQseUJBQXlCO0FBQ3pCLE1BQU0sWUFBWSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFDNUUsTUFBTSxTQUFTLEdBQUcscUNBQXNCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO0FBQzVELE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7QUFFMUUsb0NBQW9DO0FBQ3BDLGtGQUFrRjtBQUNsRiwwRUFBMEU7QUFDMUUsTUFBTSxXQUFXLEdBQW1DLGlCQUFpQixDQUFDO0FBZ0V0RSxlQUFlO0FBQ2YsTUFBTSxXQUFXO0lBTWY7UUFDRSxJQUFJLENBQUMsVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQztRQUNoRCxJQUFJLENBQUMsWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxJQUFJLEVBQUUsQ0FBQztRQUNwRCxJQUFJLENBQUMsVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQztRQUNoRCxJQUFJLENBQUMsY0FBYyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWdCLElBQUksRUFBRSxDQUFDO1FBRXpELElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUMvRCxNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxDQUFDLENBQUM7UUFDdEUsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsV0FBVyxDQUFDLE1BQWMsRUFBRSxNQUFjLEVBQUUsT0FBZSxFQUFFLElBQWE7UUFDOUUsNENBQTRDO1FBQzVDLE1BQU0sSUFBSSxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUN4QyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDVixNQUFNLElBQUksS0FBSyxDQUFDLCtCQUErQixDQUFDLENBQUM7UUFDbkQsQ0FBQztRQUVELG1DQUFtQztRQUNuQyxNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzFFLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUNuQixNQUFNLElBQUksS0FBSyxDQUFDLHdDQUF3QyxDQUFDLENBQUM7UUFDNUQsQ0FBQztRQUVELHVDQUF1QztRQUN2QyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssT0FBTyxDQUFDLENBQUM7UUFDbkUsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3BCLE1BQU0sSUFBSSxLQUFLLENBQUMsb0NBQW9DLENBQUMsQ0FBQztRQUN4RCxDQUFDO1FBRUQsa0JBQWtCO1FBQ2xCLE1BQU0sSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBQztRQUVyRCxzQ0FBc0M7UUFDdEMsSUFBSSxLQUF3QixDQUFDO1FBQzdCLElBQUksSUFBSSxFQUFFLENBQUM7WUFDVCxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQzFFLENBQUM7UUFFRCxPQUFPLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsQ0FBQztJQUNsQyxDQUFDO0lBRU8sS0FBSyxDQUFDLGtCQUFrQixDQUFDLE1BQWMsRUFBRSxNQUFjLEVBQUUsSUFBVTtRQUN6RSxJQUFJLENBQUM7WUFDSCxpQ0FBaUM7WUFDakMsSUFBSSxJQUFJLENBQUMsTUFBTSxLQUFLLE1BQU0sRUFBRSxDQUFDO2dCQUMzQixPQUFPLENBQUMsR0FBRyxDQUFDLFFBQVEsTUFBTSx3QkFBd0IsTUFBTSxtQkFBbUIsQ0FBQyxDQUFDO2dCQUM3RSxPQUFPLElBQUksQ0FBQztZQUNkLENBQUM7WUFFRCx5REFBeUQ7WUFDekQsTUFBTSxlQUFlLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksMkJBQVksQ0FBQztnQkFDNUQsU0FBUyxFQUFFLElBQUksQ0FBQyxVQUFVO2dCQUMxQixzQkFBc0IsRUFBRSxrQkFBa0I7Z0JBQzFDLGdCQUFnQixFQUFFLGtCQUFrQjtnQkFDcEMseUJBQXlCLEVBQUU7b0JBQ3pCLFNBQVMsRUFBRSxNQUFNO29CQUNqQixTQUFTLEVBQUUsTUFBTTtpQkFDbEI7Z0JBQ0QsS0FBSyxFQUFFLENBQUM7YUFDVCxDQUFDLENBQUMsQ0FBQztZQUVKLElBQUksZUFBZSxDQUFDLEtBQUssSUFBSSxlQUFlLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztnQkFDOUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxRQUFRLE1BQU0saUNBQWlDLE1BQU0sbUJBQW1CLENBQUMsQ0FBQztnQkFDdEYsT0FBTyxJQUFJLENBQUM7WUFDZCxDQUFDO1lBRUQsZ0VBQWdFO1lBQ2hFLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxNQUFNLDJCQUEyQixNQUFNLGlDQUFpQyxDQUFDLENBQUM7WUFDOUYsT0FBTyxJQUFJLENBQUM7UUFFZCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMseUNBQXlDLE1BQU0sWUFBWSxNQUFNLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUMzRixPQUFPLElBQUksQ0FBQyxDQUFDLG9CQUFvQjtRQUNuQyxDQUFDO0lBQ0gsQ0FBQztJQUVPLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBYztRQUNsQyxJQUFJLENBQUM7WUFDSCxNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSx5QkFBVSxDQUFDO2dCQUNqRCxTQUFTLEVBQUUsSUFBSSxDQUFDLFVBQVU7Z0JBQzFCLEdBQUcsRUFBRSxFQUFFLEVBQUUsRUFBRSxNQUFNLEVBQUU7YUFDcEIsQ0FBQyxDQUFDLENBQUM7WUFFSixJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDO2dCQUNqQixPQUFPLElBQUksQ0FBQztZQUNkLENBQUM7WUFFRCxNQUFNLElBQUksR0FBRyxNQUFNLENBQUMsSUFBWSxDQUFDO1lBRWpDLDRCQUE0QjtZQUM1QixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQztZQUMxQyxJQUFJLElBQUksQ0FBQyxHQUFHLElBQUksSUFBSSxDQUFDLEdBQUcsR0FBRyxHQUFHLEVBQUUsQ0FBQztnQkFDL0IsT0FBTyxJQUFJLENBQUM7WUFDZCxDQUFDO1lBRUQsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMscUJBQXFCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDNUMsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO0lBQ0gsQ0FBQztJQUVPLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBYyxFQUFFLE1BQWMsRUFBRSxPQUFlLEVBQUUsSUFBYTtRQUNyRixNQUFNLFdBQVcsR0FBRyxHQUFHLE1BQU0sSUFBSSxPQUFPLEVBQUUsQ0FBQztRQUMzQyxNQUFNLFNBQVMsR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBRTNDLE1BQU0sVUFBVSxHQUFTO1lBQ3ZCLE1BQU07WUFDTixXQUFXO1lBQ1gsTUFBTTtZQUNOLE9BQU87WUFDUCxJQUFJO1lBQ0osU0FBUztTQUNWLENBQUM7UUFFRixNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSx5QkFBVSxDQUFDO1lBQ2xDLFNBQVMsRUFBRSxJQUFJLENBQUMsVUFBVTtZQUMxQixJQUFJLEVBQUUsVUFBVTtTQUNqQixDQUFDLENBQUMsQ0FBQztRQUVKLE9BQU8sQ0FBQyxHQUFHLENBQUMsdUJBQXVCLE1BQU0sVUFBVSxJQUFJLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxjQUFjLE9BQU8sWUFBWSxNQUFNLEVBQUUsQ0FBQyxDQUFDO0lBQ25ILENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSyxLQUFLLENBQUMsYUFBYSxDQUFDLE1BQWMsRUFBRSxPQUFlLEVBQUUsY0FBOEIsRUFBRSxJQUFVO1FBQ3JHLElBQUksQ0FBQztZQUNILE9BQU8sQ0FBQyxHQUFHLENBQUMsc0NBQXNDLFdBQVcsRUFBRSxDQUFDLENBQUM7WUFFakUsZ0RBQWdEO1lBQ2hELG1FQUFtRTtZQUNuRSxNQUFNLG1CQUFtQixHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLDJCQUFZLENBQUM7Z0JBQ2hFLFNBQVMsRUFBRSxJQUFJLENBQUMsVUFBVTtnQkFDMUIsc0JBQXNCLEVBQUUsa0JBQWtCO2dCQUMxQyxnQkFBZ0IsRUFBRSx5RUFBeUU7Z0JBQzNGLHlCQUF5QixFQUFFO29CQUN6QixTQUFTLEVBQUUsTUFBTTtvQkFDakIsVUFBVSxFQUFFLE9BQU87b0JBQ25CLE9BQU8sRUFBRSxJQUFJO29CQUNiLHNCQUFzQixFQUFFLENBQUMsQ0FBQyxFQUFFLGdDQUFnQztpQkFDN0Q7Z0JBQ0QsY0FBYyxFQUFFLElBQUksRUFBRSx1Q0FBdUM7YUFDOUQsQ0FBQyxDQUFDLENBQUM7WUFFSixNQUFNLGFBQWEsR0FBRyxtQkFBbUIsQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDO1lBQ3RELE1BQU0sZUFBZSxHQUFHLElBQUksR0FBRyxDQUFDLGFBQWEsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBRSxJQUFhLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztZQUNsRixNQUFNLGlCQUFpQixHQUFHLGVBQWUsQ0FBQyxJQUFJLENBQUM7WUFFL0MsT0FBTyxDQUFDLEdBQUcsQ0FBQyxTQUFTLGlCQUFpQixvQ0FBb0MsT0FBTyxZQUFZLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFFdkcsd0RBQXdEO1lBQ3hELElBQUksYUFBcUIsQ0FBQztZQUMxQixJQUFJLHFCQUE2QixDQUFDO1lBRWxDLElBQUksV0FBVyxLQUFLLGlCQUFpQixFQUFFLENBQUM7Z0JBQ3RDLDREQUE0RDtnQkFDNUQsYUFBYSxHQUFHLElBQUksQ0FBQyxlQUFlLElBQUksQ0FBQyxDQUFDO2dCQUMxQyxxQkFBcUIsR0FBRyxvQkFBb0IsYUFBYSxHQUFHLENBQUM7Z0JBRTdELE9BQU8sQ0FBQyxHQUFHLENBQUMscUNBQXFDLE1BQU0sYUFBYSxhQUFhLDZCQUE2QixDQUFDLENBQUM7WUFFbEgsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLGdEQUFnRDtnQkFDaEQsbURBQW1EO2dCQUNuRCxNQUFNLGNBQWMsR0FBRyxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSwyQkFBWSxDQUFDO29CQUMzRCxTQUFTLEVBQUUsSUFBSSxDQUFDLFVBQVU7b0JBQzFCLHNCQUFzQixFQUFFLGtCQUFrQjtvQkFDMUMsZ0JBQWdCLEVBQUUsZ0NBQWdDO29CQUNsRCx5QkFBeUIsRUFBRTt3QkFDekIsU0FBUyxFQUFFLE1BQU07d0JBQ2pCLHNCQUFzQixFQUFFLENBQUMsQ0FBQyxFQUFFLHdCQUF3QjtxQkFDckQ7b0JBQ0QsY0FBYyxFQUFFLElBQUk7aUJBQ3JCLENBQUMsQ0FBQyxDQUFDO2dCQUVKLE1BQU0sUUFBUSxHQUFHLGNBQWMsQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFDO2dCQUM1QyxNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBRSxNQUFlLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7Z0JBQ3ZGLGFBQWEsR0FBRyxnQkFBZ0IsQ0FBQztnQkFDakMscUJBQXFCLEdBQUcsc0JBQXNCLGFBQWEsR0FBRyxDQUFDO2dCQUUvRCxPQUFPLENBQUMsR0FBRyxDQUFDLDhCQUE4QixNQUFNLFFBQVEsZ0JBQWdCLG9CQUFvQixhQUFhLDZCQUE2QixDQUFDLENBQUM7WUFDMUksQ0FBQztZQUVELDBDQUEwQztZQUMxQyxJQUFJLGlCQUFpQixLQUFLLGFBQWEsRUFBRSxDQUFDO2dCQUN4QyxPQUFPLENBQUMsR0FBRyxDQUFDLHNCQUFzQixpQkFBaUIscUNBQXFDLE9BQU8sZUFBZSxxQkFBcUIsR0FBRyxDQUFDLENBQUM7Z0JBRXhJLGdDQUFnQztnQkFDaEMsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxDQUFDO2dCQUNuRSxJQUFJLGFBQWEsRUFBRSxDQUFDO29CQUNsQixPQUFPLENBQUMsR0FBRyxDQUFDLGdEQUFnRCxDQUFDLENBQUM7b0JBQzlELE9BQU8sYUFBYSxDQUFDO2dCQUN2QixDQUFDO2dCQUVELG1CQUFtQjtnQkFDbkIsTUFBTSxLQUFLLEdBQUcsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQztnQkFDbkcsT0FBTyxLQUFLLENBQUM7WUFDZixDQUFDO1lBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQ0FBaUMsaUJBQWlCLGVBQWUsYUFBYSxLQUFLLHFCQUFxQixHQUFHLENBQUMsQ0FBQztZQUN6SCxPQUFPLFNBQVMsQ0FBQztRQUVuQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsMkJBQTJCLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDbEQsT0FBTyxTQUFTLENBQUM7UUFDbkIsQ0FBQztJQUNILENBQUM7SUFFTyxLQUFLLENBQUMsZ0JBQWdCLENBQUMsTUFBYyxFQUFFLE9BQWU7UUFDNUQsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUkseUJBQVUsQ0FBQztnQkFDakQsU0FBUyxFQUFFLElBQUksQ0FBQyxZQUFZO2dCQUM1QixHQUFHLEVBQUU7b0JBQ0gsTUFBTTtvQkFDTixPQUFPO2lCQUNSO2FBQ0YsQ0FBQyxDQUFDLENBQUM7WUFFSixPQUFPLE1BQU0sQ0FBQyxJQUFhLElBQUksSUFBSSxDQUFDO1FBQ3RDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxnQ0FBZ0MsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN2RCxPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7SUFDSCxDQUFDO0lBRU8sS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFjLEVBQUUsT0FBZSxFQUFFLGNBQThCLEVBQUUsWUFBc0I7UUFDL0csTUFBTSxTQUFTLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUMzQyxNQUFNLE9BQU8sR0FBRyxHQUFHLE1BQU0sSUFBSSxPQUFPLEVBQUUsQ0FBQztRQUV2QyxNQUFNLEtBQUssR0FBVTtZQUNuQixFQUFFLEVBQUUsT0FBTztZQUNYLE1BQU07WUFDTixPQUFPO1lBQ1AsS0FBSyxFQUFFLGNBQWMsQ0FBQyxLQUFLO1lBQzNCLFVBQVUsRUFBRSxjQUFjLENBQUMsVUFBVSxJQUFJLFNBQVM7WUFDbEQsU0FBUyxFQUFFLGNBQWMsQ0FBQyxTQUFTO1lBQ25DLFlBQVk7WUFDWixTQUFTO1NBQ1YsQ0FBQztRQUVGLDBCQUEwQjtRQUMxQixJQUFJLENBQUM7WUFDSCxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSx5QkFBVSxDQUFDO2dCQUNsQyxTQUFTLEVBQUUsSUFBSSxDQUFDLFlBQVk7Z0JBQzVCLElBQUksRUFBRSxLQUFLO2dCQUNYLG1CQUFtQixFQUFFLGdFQUFnRTthQUN0RixDQUFDLENBQUMsQ0FBQztZQUNKLE9BQU8sQ0FBQyxHQUFHLENBQUMsb0JBQW9CLEtBQUssQ0FBQyxLQUFLLFFBQVEsWUFBWSxDQUFDLE1BQU0sUUFBUSxDQUFDLENBQUM7UUFDbEYsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixNQUFNLEdBQUcsR0FBRyxLQUFZLENBQUM7WUFDekIsSUFBSSxHQUFHLENBQUMsSUFBSSxLQUFLLGlDQUFpQyxFQUFFLENBQUM7Z0JBQ25ELE9BQU8sQ0FBQyxHQUFHLENBQUMsaUNBQWlDLE1BQU0sY0FBYyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1lBQzlFLENBQUM7aUJBQU0sQ0FBQztnQkFDTixPQUFPLENBQUMsS0FBSyxDQUFDLHVCQUF1QixFQUFFLEtBQUssQ0FBQyxDQUFDO2dCQUM5QyxNQUFNLEtBQUssQ0FBQztZQUNkLENBQUM7UUFDSCxDQUFDO1FBRUQsNkRBQTZEO1FBQzdELE1BQU0sSUFBSSxDQUFDLDBCQUEwQixDQUFDLEtBQUssQ0FBQyxDQUFDO1FBRTdDLHdDQUF3QztRQUN4QyxNQUFNLElBQUksT0FBTyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBRXhELE9BQU8sQ0FBQyxHQUFHLENBQUMsaURBQWlELE1BQU0sRUFBRSxDQUFDLENBQUM7UUFFdkUsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBRUQ7Ozs7T0FJRztJQUNLLEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxLQUFZO1FBQ25ELE9BQU8sQ0FBQyxHQUFHLENBQUMsMENBQTBDLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTSxRQUFRLENBQUMsQ0FBQztRQUN6RixPQUFPLENBQUMsR0FBRyxDQUFDLHVCQUF1QixLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7UUFFcEUsTUFBTSxRQUFRLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQztRQUM5QyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDZCxPQUFPLENBQUMsS0FBSyxDQUFDLHVDQUF1QyxDQUFDLENBQUM7WUFDdkQsT0FBTztRQUNULENBQUM7UUFFRCxzREFBc0Q7UUFDdEQsNEVBQTRFO1FBQzVFLE1BQU0sb0JBQW9CLEdBQUcsS0FBSyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ25FLE1BQU0sSUFBSSxDQUFDLDhCQUE4QixDQUFDLE1BQU0sRUFBRSxLQUFLLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDckUsQ0FBQyxDQUFDLENBQUM7UUFFSCxxQ0FBcUM7UUFDckMsTUFBTSxPQUFPLEdBQUcsTUFBTSxPQUFPLENBQUMsVUFBVSxDQUFDLG9CQUFvQixDQUFDLENBQUM7UUFFL0QsY0FBYztRQUNkLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLEVBQUUsS0FBSyxFQUFFLEVBQUU7WUFDaEMsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUN6QyxJQUFJLE1BQU0sQ0FBQyxNQUFNLEtBQUssV0FBVyxFQUFFLENBQUM7Z0JBQ2xDLE9BQU8sQ0FBQyxHQUFHLENBQUMsNkNBQTZDLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFDckUsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE9BQU8sQ0FBQyxLQUFLLENBQUMsd0NBQXdDLE1BQU0sR0FBRyxFQUFFLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUNsRixDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUM7UUFFSCxnREFBZ0Q7UUFDaEQsTUFBTSxJQUFJLENBQUMsb0JBQW9CLENBQUMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQ25ELENBQUM7SUFFRDs7T0FFRztJQUNLLEtBQUssQ0FBQyw4QkFBOEIsQ0FBQyxNQUFjLEVBQUUsS0FBWSxFQUFFLFFBQWdCO1FBQ3pGLE9BQU8sQ0FBQyxHQUFHLENBQUMsK0NBQStDLE1BQU0sRUFBRSxDQUFDLENBQUM7UUFFckUsTUFBTSxRQUFRLEdBQUc7Ozs7Ozs7OztLQVNoQixDQUFDO1FBRUYsTUFBTSxTQUFTLEdBQUc7WUFDaEIsTUFBTSxFQUFFLE1BQU07WUFDZCxTQUFTLEVBQUU7Z0JBQ1QsT0FBTyxFQUFFLEtBQUssQ0FBQyxFQUFFO2dCQUNqQixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87Z0JBQ3RCLFVBQVUsRUFBRSxLQUFLLENBQUMsS0FBSztnQkFDdkIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO2dCQUM1QixZQUFZLEVBQUUsS0FBSyxDQUFDLFlBQVk7Z0JBQ2hDLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTTtnQkFDcEIsU0FBUyxFQUFFLEtBQUssQ0FBQyxTQUFTO2dCQUMxQixZQUFZLEVBQUU7b0JBQ1osU0FBUyxFQUFFLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTTtvQkFDcEMsYUFBYSxFQUFFLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTTtvQkFDeEMsU0FBUyxFQUFFLFdBQVc7aUJBQ3ZCO2FBQ0Y7U0FDRixDQUFDO1FBRUYsSUFBSSxDQUFDO1lBQ0gsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDOUIsTUFBTSxPQUFPLEdBQUcsSUFBSSwyQkFBVyxDQUFDO2dCQUM5QixNQUFNLEVBQUUsTUFBTTtnQkFDZCxPQUFPLEVBQUU7b0JBQ1AsY0FBYyxFQUFFLGtCQUFrQjtvQkFDbEMsSUFBSSxFQUFFLEdBQUcsQ0FBQyxRQUFRO2lCQUNuQjtnQkFDRCxRQUFRLEVBQUUsR0FBRyxDQUFDLFFBQVE7Z0JBQ3RCLElBQUksRUFBRSxVQUFVO2dCQUNoQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsU0FBUyxFQUFFLENBQUM7YUFDckQsQ0FBQyxDQUFDO1lBRUgsb0NBQW9DO1lBQ3BDLE1BQU0sTUFBTSxHQUFHLElBQUksMEJBQVcsQ0FBQztnQkFDN0IsV0FBVyxFQUFFLElBQUEsMENBQWUsR0FBRTtnQkFDOUIsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLFdBQVc7Z0JBQzdDLE9BQU8sRUFBRSxTQUFTO2dCQUNsQixNQUFNLEVBQUUsa0JBQU07YUFDZixDQUFDLENBQUM7WUFFSCxNQUFNLGFBQWEsR0FBRyxNQUFNLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFFakQsTUFBTSxRQUFRLEdBQUcsTUFBTSxLQUFLLENBQUMsUUFBUSxFQUFFO2dCQUNyQyxNQUFNLEVBQUUsYUFBYSxDQUFDLE1BQU07Z0JBQzVCLE9BQU8sRUFBRSxhQUFhLENBQUMsT0FBYztnQkFDckMsSUFBSSxFQUFFLGFBQWEsQ0FBQyxJQUFJO2FBQ3pCLENBQUMsQ0FBQztZQUVILE1BQU0sTUFBTSxHQUFHLE1BQU0sUUFBUSxDQUFDLElBQUksRUFBb0MsQ0FBQztZQUV2RSxJQUFJLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDbEIsT0FBTyxDQUFDLEtBQUssQ0FBQywwQkFBMEIsTUFBTSxHQUFHLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztnQkFDbEYsTUFBTSxJQUFJLEtBQUssQ0FBQywwQkFBMEIsTUFBTSxLQUFLLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsT0FBTyxFQUFFLENBQUMsQ0FBQztZQUNwRixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLE1BQU0sd0JBQXdCLENBQUMsQ0FBQztZQUN4RCxDQUFDO1FBQ0gsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLHdDQUF3QyxNQUFNLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN4RSxNQUFNLEtBQUssQ0FBQztRQUNkLENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxLQUFLLENBQUMsb0JBQW9CLENBQUMsS0FBWSxFQUFFLFFBQWdCO1FBQy9ELE9BQU8sQ0FBQyxHQUFHLENBQUMsaUNBQWlDLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBRTdELE1BQU0sUUFBUSxHQUFHOzs7Ozs7Ozs7S0FTaEIsQ0FBQztRQUVGLE1BQU0sU0FBUyxHQUFHO1lBQ2hCLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTTtZQUNwQixTQUFTLEVBQUU7Z0JBQ1QsT0FBTyxFQUFFLEtBQUssQ0FBQyxFQUFFO2dCQUNqQixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87Z0JBQ3RCLFVBQVUsRUFBRSxLQUFLLENBQUMsS0FBSztnQkFDdkIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO2dCQUM1QixZQUFZLEVBQUUsS0FBSyxDQUFDLFlBQVk7Z0JBQ2hDLFlBQVksRUFBRTtvQkFDWixTQUFTLEVBQUUsS0FBSyxDQUFDLFlBQVksQ0FBQyxNQUFNO29CQUNwQyxhQUFhLEVBQUUsS0FBSyxDQUFDLFlBQVksQ0FBQyxNQUFNO29CQUN4QyxTQUFTLEVBQUUsV0FBVztpQkFDdkI7YUFDRjtTQUNGLENBQUM7UUFFRixJQUFJLENBQUM7WUFDSCxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUM5QixNQUFNLE9BQU8sR0FBRyxJQUFJLDJCQUFXLENBQUM7Z0JBQzlCLE1BQU0sRUFBRSxNQUFNO2dCQUNkLE9BQU8sRUFBRTtvQkFDUCxjQUFjLEVBQUUsa0JBQWtCO29CQUNsQyxJQUFJLEVBQUUsR0FBRyxDQUFDLFFBQVE7aUJBQ25CO2dCQUNELFFBQVEsRUFBRSxHQUFHLENBQUMsUUFBUTtnQkFDdEIsSUFBSSxFQUFFLFVBQVU7Z0JBQ2hCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxTQUFTLEVBQUUsQ0FBQzthQUNyRCxDQUFDLENBQUM7WUFFSCxNQUFNLE1BQU0sR0FBRyxJQUFJLDBCQUFXLENBQUM7Z0JBQzdCLFdBQVcsRUFBRSxJQUFBLDBDQUFlLEdBQUU7Z0JBQzlCLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLFVBQVUsSUFBSSxXQUFXO2dCQUM3QyxPQUFPLEVBQUUsU0FBUztnQkFDbEIsTUFBTSxFQUFFLGtCQUFNO2FBQ2YsQ0FBQyxDQUFDO1lBRUgsTUFBTSxhQUFhLEdBQUcsTUFBTSxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1lBRWpELE1BQU0sUUFBUSxHQUFHLE1BQU0sS0FBSyxDQUFDLFFBQVEsRUFBRTtnQkFDckMsTUFBTSxFQUFFLGFBQWEsQ0FBQyxNQUFNO2dCQUM1QixPQUFPLEVBQUUsYUFBYSxDQUFDLE9BQWM7Z0JBQ3JDLElBQUksRUFBRSxhQUFhLENBQUMsSUFBSTthQUN6QixDQUFDLENBQUM7WUFFSCxNQUFNLE1BQU0sR0FBRyxNQUFNLFFBQVEsQ0FBQyxJQUFJLEVBQW9DLENBQUM7WUFFdkUsSUFBSSxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7Z0JBQ2xCLE9BQU8sQ0FBQyxLQUFLLENBQUMsK0JBQStCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQztZQUNoRixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sT0FBTyxDQUFDLEdBQUcsQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDO1lBQ3ZELENBQUM7UUFDSCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsb0NBQW9DLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDN0QsQ0FBQztJQUNILENBQUM7Q0FDRjtBQUVELDZCQUE2QjtBQUN0QixNQUFNLE9BQU8sR0FBWSxLQUFLLEVBQUUsS0FBSyxFQUFFLEVBQUU7SUFDOUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQ0FBcUMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7SUFDMUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQ0FBaUMsV0FBVyxFQUFFLENBQUMsQ0FBQztJQUU1RCxJQUFJLENBQUM7UUFDSCx1Q0FBdUM7UUFDdkMsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLFFBQVEsRUFBRSxNQUFNLEVBQUUsR0FBRyxJQUFJLEtBQUssQ0FBQyxRQUFRLEVBQUUsUUFBUSxDQUFDO1FBQ3ZFLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNaLE9BQU8sQ0FBQyxLQUFLLENBQUMsaUNBQWlDLENBQUMsQ0FBQztZQUNqRCxPQUFPLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxDQUFDO1FBQzVCLENBQUM7UUFFRCw2QkFBNkI7UUFDN0IsTUFBTSxFQUFFLEtBQUssRUFBRSxHQUFHLEtBQUssQ0FBQyxTQUFTLENBQUM7UUFDbEMsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRXhDLGlCQUFpQjtRQUNqQixJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDWixPQUFPLENBQUMsS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUM7WUFDckMsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQztRQUM1QixDQUFDO1FBRUQsSUFBSSxPQUFPLE9BQU8sS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUNoQyxPQUFPLENBQUMsS0FBSyxDQUFDLDJCQUEyQixDQUFDLENBQUM7WUFDM0MsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQztRQUM1QixDQUFDO1FBRUQsSUFBSSxPQUFPLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUM5QixPQUFPLENBQUMsS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUM7WUFDeEMsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsQ0FBQztRQUM1QixDQUFDO1FBRUQsTUFBTSxXQUFXLEdBQUcsSUFBSSxXQUFXLEVBQUUsQ0FBQztRQUV0QyxJQUFJLENBQUM7WUFDSCxNQUFNLE1BQU0sR0FBRyxNQUFNLFdBQVcsQ0FBQyxXQUFXLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDNUUsT0FBTyxNQUFNLENBQUM7UUFDaEIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLHdCQUF3QixFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQy9DLE9BQU8sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLENBQUM7UUFDNUIsQ0FBQztJQUVILENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUMzQyxPQUFPLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxDQUFDO0lBQzVCLENBQUM7QUFDSCxDQUFDLENBQUM7QUE5Q1csUUFBQSxPQUFPLFdBOENsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBQdXRDb21tYW5kLCBRdWVyeUNvbW1hbmQsIEdldENvbW1hbmQsIERlbGV0ZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5pbXBvcnQgeyBMYW1iZGFDbGllbnQsIEludm9rZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtbGFtYmRhJztcclxuaW1wb3J0IHsgU2lnbmF0dXJlVjQgfSBmcm9tICdAYXdzLXNkay9zaWduYXR1cmUtdjQnO1xyXG5pbXBvcnQgeyBTaGEyNTYgfSBmcm9tICdAYXdzLWNyeXB0by9zaGEyNTYtanMnO1xyXG5pbXBvcnQgeyBkZWZhdWx0UHJvdmlkZXIgfSBmcm9tICdAYXdzLXNkay9jcmVkZW50aWFsLXByb3ZpZGVyLW5vZGUnO1xyXG5pbXBvcnQgeyBIdHRwUmVxdWVzdCB9IGZyb20gJ0Bhd3Mtc2RrL3Byb3RvY29sLWh0dHAnO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpO1xyXG5jb25zdCBsYW1iZGFDbGllbnQgPSBuZXcgTGFtYmRhQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5cclxuLy8gQ09ORklHVVJBVElPTjogQ2hvb3NlIG1hdGNoIGxvZ2ljXHJcbi8vICdtYXhQYXJ0aWNpcGFudHMnID0gTWF0Y2ggd2hlbiBleGFjdGx5IG1heFBhcnRpY2lwYW50cyB1c2VycyB2b3RlIFlFUyAoY3VycmVudClcclxuLy8gJ2FsbFVzZXJzJyA9IE1hdGNoIHdoZW4gQUxMIHVzZXJzIGluIHJvb20gdm90ZSBZRVMgKHlvdXIgc3BlY2lmaWNhdGlvbilcclxuY29uc3QgTUFUQ0hfTE9HSUM6ICdtYXhQYXJ0aWNpcGFudHMnIHwgJ2FsbFVzZXJzJyA9ICdtYXhQYXJ0aWNpcGFudHMnO1xyXG5cclxuLy8gVHlwZXNcclxuaW50ZXJmYWNlIFZvdGUge1xyXG4gIHJvb21JZDogc3RyaW5nO1xyXG4gIHVzZXJNb3ZpZUlkOiBzdHJpbmc7IC8vIEZvcm1hdDogXCJ1c2VySWQjbW92aWVJZFwiXHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgbW92aWVJZDogbnVtYmVyO1xyXG4gIHZvdGU6IGJvb2xlYW47XHJcbiAgdGltZXN0YW1wOiBzdHJpbmc7XHJcbiAgaXNQYXJ0aWNpcGF0aW9uPzogYm9vbGVhbjtcclxufVxyXG5cclxuaW50ZXJmYWNlIE1hdGNoIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHJvb21JZDogc3RyaW5nO1xyXG4gIG1vdmllSWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg/OiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxuICBtYXRjaGVkVXNlcnM6IHN0cmluZ1tdO1xyXG4gIHRpbWVzdGFtcDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgUm9vbSB7XHJcbiAgaWQ6IHN0cmluZztcclxuICBjb2RlOiBzdHJpbmc7XHJcbiAgaG9zdElkOiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxuICBnZW5yZUlkczogbnVtYmVyW107XHJcbiAgY2FuZGlkYXRlczogTW92aWVDYW5kaWRhdGVbXTtcclxuICBjcmVhdGVkQXQ6IHN0cmluZztcclxuICB0dGw6IG51bWJlcjtcclxuICBtYXhQYXJ0aWNpcGFudHM6IG51bWJlcjtcclxufVxyXG5cclxuaW50ZXJmYWNlIE1vdmllQ2FuZGlkYXRlIHtcclxuICBpZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgb3ZlcnZpZXc6IHN0cmluZztcclxuICBwb3N0ZXJQYXRoOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJlbGVhc2VEYXRlOiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxufVxyXG5cclxuaW50ZXJmYWNlIFZvdGVFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAndm90ZSc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgaW5wdXQ6IHtcclxuICAgIHJvb21JZDogc3RyaW5nO1xyXG4gICAgbW92aWVJZDogbnVtYmVyO1xyXG4gICAgdm90ZTogYm9vbGVhbjtcclxuICB9O1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVm90ZVJlc3BvbnNlIHtcclxuICBzdGF0dXNDb2RlOiBudW1iZXI7XHJcbiAgYm9keToge1xyXG4gICAgc3VjY2VzczogYm9vbGVhbjtcclxuICAgIG1hdGNoPzogTWF0Y2g7XHJcbiAgICBlcnJvcj86IHN0cmluZztcclxuICB9O1xyXG59XHJcblxyXG4vLyBWb3RlIFNlcnZpY2VcclxuY2xhc3MgVm90ZVNlcnZpY2Uge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgdm90ZXNUYWJsZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbWF0Y2hlc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSByb29tc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBtYXRjaExhbWJkYUFybjogc3RyaW5nO1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMudm90ZXNUYWJsZSA9IHByb2Nlc3MuZW52LlZPVEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUgPSBwcm9jZXNzLmVudi5NQVRDSEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgdGhpcy5yb29tc1RhYmxlID0gcHJvY2Vzcy5lbnYuUk9PTVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLm1hdGNoTGFtYmRhQXJuID0gcHJvY2Vzcy5lbnYuTUFUQ0hfTEFNQkRBX0FSTiB8fCAnJztcclxuXHJcbiAgICBpZiAoIXRoaXMudm90ZXNUYWJsZSB8fCAhdGhpcy5tYXRjaGVzVGFibGUgfHwgIXRoaXMucm9vbXNUYWJsZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlcXVpcmVkIHRhYmxlIGVudmlyb25tZW50IHZhcmlhYmxlcyBhcmUgbWlzc2luZycpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcHJvY2Vzc1ZvdGUodXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIsIHZvdGU6IGJvb2xlYW4pOiBQcm9taXNlPHsgc3VjY2VzczogYm9vbGVhbjsgbWF0Y2g/OiBNYXRjaCB9PiB7XHJcbiAgICAvLyBWYWxpZGF0ZSByb29tIGV4aXN0cyBhbmQgZ2V0IHJvb20gZGV0YWlsc1xyXG4gICAgY29uc3Qgcm9vbSA9IGF3YWl0IHRoaXMuZ2V0Um9vbShyb29tSWQpO1xyXG4gICAgaWYgKCFyb29tKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBub3QgZm91bmQgb3IgaGFzIGV4cGlyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBCYXNpYyByb29tIG1lbWJlcnNoaXAgdmFsaWRhdGlvblxyXG4gICAgY29uc3QgaGFzUm9vbUFjY2VzcyA9IGF3YWl0IHRoaXMudmFsaWRhdGVSb29tQWNjZXNzKHVzZXJJZCwgcm9vbUlkLCByb29tKTtcclxuICAgIGlmICghaGFzUm9vbUFjY2Vzcykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgZG9lcyBub3QgaGF2ZSBhY2Nlc3MgdG8gdGhpcyByb29tJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVmFsaWRhdGUgbW92aWUgaXMgaW4gcm9vbSBjYW5kaWRhdGVzXHJcbiAgICBjb25zdCBtb3ZpZUNhbmRpZGF0ZSA9IHJvb20uY2FuZGlkYXRlcy5maW5kKGMgPT4gYy5pZCA9PT0gbW92aWVJZCk7XHJcbiAgICBpZiAoIW1vdmllQ2FuZGlkYXRlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTW92aWUgbm90IGZvdW5kIGluIHJvb20gY2FuZGlkYXRlcycpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlY29yZCB0aGUgdm90ZVxyXG4gICAgYXdhaXQgdGhpcy5yZWNvcmRWb3RlKHVzZXJJZCwgcm9vbUlkLCBtb3ZpZUlkLCB2b3RlKTtcclxuXHJcbiAgICAvLyBDaGVjayBmb3IgbWF0Y2ggaWYgdm90ZSBpcyBwb3NpdGl2ZVxyXG4gICAgbGV0IG1hdGNoOiBNYXRjaCB8IHVuZGVmaW5lZDtcclxuICAgIGlmICh2b3RlKSB7XHJcbiAgICAgIG1hdGNoID0gYXdhaXQgdGhpcy5jaGVja0Zvck1hdGNoKHJvb21JZCwgbW92aWVJZCwgbW92aWVDYW5kaWRhdGUsIHJvb20pO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIG1hdGNoIH07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHZhbGlkYXRlUm9vbUFjY2Vzcyh1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcsIHJvb206IFJvb20pOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIENoZWNrIGlmIHVzZXIgaXMgdGhlIHJvb20gaG9zdFxyXG4gICAgICBpZiAocm9vbS5ob3N0SWQgPT09IHVzZXJJZCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSBpcyB0aGUgaG9zdCBvZiByb29tICR7cm9vbUlkfSAtIGFjY2VzcyBncmFudGVkYCk7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHVzZXIgaGFzIHByZXZpb3VzbHkgcGFydGljaXBhdGVkIGluIHRoaXMgcm9vbVxyXG4gICAgICBjb25zdCB1c2VyVm90ZXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ3VzZXJJZCA9IDp1c2VySWQnLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBMaW1pdDogMSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgaWYgKHVzZXJWb3Rlc1Jlc3VsdC5JdGVtcyAmJiB1c2VyVm90ZXNSZXN1bHQuSXRlbXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSBoYXMgcHJldmlvdXNseSB2b3RlZCBpbiByb29tICR7cm9vbUlkfSAtIGFjY2VzcyBncmFudGVkYCk7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIEZvciBNVlA6IEFsbG93IGFueSBhdXRoZW50aWNhdGVkIHVzZXIgdG8gam9pbiBhbnkgYWN0aXZlIHJvb21cclxuICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGdyYW50ZWQgYWNjZXNzIHRvIHJvb20gJHtyb29tSWR9IChNVlAgbW9kZSAtIGFsbCB1c2VycyBhbGxvd2VkKWApO1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciB2YWxpZGF0aW5nIHJvb20gYWNjZXNzIGZvciB1c2VyICR7dXNlcklkfSBpbiByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB0cnVlOyAvLyBGYWlsIG9wZW4gZm9yIE1WUFxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBnZXRSb29tKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTxSb29tIHwgbnVsbD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5yb29tc1RhYmxlLFxyXG4gICAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGlmICghcmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3Qgcm9vbSA9IHJlc3VsdC5JdGVtIGFzIFJvb207XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiByb29tIGhhcyBleHBpcmVkXHJcbiAgICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xyXG4gICAgICBpZiAocm9vbS50dGwgJiYgcm9vbS50dGwgPCBub3cpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHJvb207XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBnZXR0aW5nIHJvb206JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVjb3JkVm90ZSh1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgdm90ZTogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgdXNlck1vdmllSWQgPSBgJHt1c2VySWR9IyR7bW92aWVJZH1gO1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAgIGNvbnN0IHZvdGVSZWNvcmQ6IFZvdGUgPSB7XHJcbiAgICAgIHJvb21JZCxcclxuICAgICAgdXNlck1vdmllSWQsXHJcbiAgICAgIHVzZXJJZCxcclxuICAgICAgbW92aWVJZCxcclxuICAgICAgdm90ZSxcclxuICAgICAgdGltZXN0YW1wLFxyXG4gICAgfTtcclxuXHJcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICBJdGVtOiB2b3RlUmVjb3JkLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBWb3RlIHJlY29yZGVkOiBVc2VyICR7dXNlcklkfSB2b3RlZCAke3ZvdGUgPyAnWUVTJyA6ICdOTyd9IGZvciBtb3ZpZSAke21vdmllSWR9IGluIHJvb20gJHtyb29tSWR9YCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDUklUSUNBTDogQ2hlY2sgZm9yIG1hdGNoIHVzaW5nIGNvbmZpZ3VyZWQgbG9naWNcclxuICAgKiBcclxuICAgKiBUd28gbW9kZXM6XHJcbiAgICogMS4gJ21heFBhcnRpY2lwYW50cyc6IE1hdGNoIHdoZW4gZXhhY3RseSBtYXhQYXJ0aWNpcGFudHMgdXNlcnMgdm90ZSBZRVNcclxuICAgKiAyLiAnYWxsVXNlcnMnOiBNYXRjaCB3aGVuIEFMTCB1c2VycyBpbiByb29tIHZvdGUgWUVTICh0cnVlIGNvbnNlbnN1cylcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIGNoZWNrRm9yTWF0Y2gocm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgbW92aWVDYW5kaWRhdGU6IE1vdmllQ2FuZGlkYXRlLCByb29tOiBSb29tKTogUHJvbWlzZTxNYXRjaCB8IHVuZGVmaW5lZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYPCflI0gQ2hlY2tpbmcgZm9yIG1hdGNoIHVzaW5nIGxvZ2ljOiAke01BVENIX0xPR0lDfWApO1xyXG5cclxuICAgICAgLy8gU1RFUCAxOiBHZXQgYWxsIHBvc2l0aXZlIHZvdGVzIGZvciB0aGlzIG1vdmllXHJcbiAgICAgIC8vIENSSVRJQ0FMOiBVc2UgQ29uc2lzdGVudFJlYWQgdG8gc2VlIHZvdGVzIHRoYXQgd2VyZSBqdXN0IHdyaXR0ZW5cclxuICAgICAgY29uc3QgcG9zaXRpdmVWb3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnbW92aWVJZCA9IDptb3ZpZUlkIEFORCB2b3RlID0gOnZvdGUgQU5EIG1vdmllSWQgPD4gOnBhcnRpY2lwYXRpb25NYXJrZXInLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzptb3ZpZUlkJzogbW92aWVJZCxcclxuICAgICAgICAgICc6dm90ZSc6IHRydWUsXHJcbiAgICAgICAgICAnOnBhcnRpY2lwYXRpb25NYXJrZXInOiAtMSwgLy8gRXhjbHVkZSBwYXJ0aWNpcGF0aW9uIHJlY29yZHNcclxuICAgICAgICB9LFxyXG4gICAgICAgIENvbnNpc3RlbnRSZWFkOiB0cnVlLCAvLyDinIUgQ1JJVElDQUw6IEZvcmNlIHN0cm9uZyBjb25zaXN0ZW5jeVxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBwb3NpdGl2ZVZvdGVzID0gcG9zaXRpdmVWb3Rlc1Jlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgY29uc3QgcG9zaXRpdmVVc2VySWRzID0gbmV3IFNldChwb3NpdGl2ZVZvdGVzLm1hcCh2b3RlID0+ICh2b3RlIGFzIFZvdGUpLnVzZXJJZCkpO1xyXG4gICAgICBjb25zdCBwb3NpdGl2ZVZvdGVDb3VudCA9IHBvc2l0aXZlVXNlcklkcy5zaXplO1xyXG5cclxuICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7cG9zaXRpdmVWb3RlQ291bnR9IHVuaXF1ZSBwb3NpdGl2ZSB2b3RlcyBmb3IgbW92aWUgJHttb3ZpZUlkfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG5cclxuICAgICAgLy8gU1RFUCAyOiBEZXRlcm1pbmUgcmVxdWlyZWQgdm90ZXMgYmFzZWQgb24gbWF0Y2ggbG9naWNcclxuICAgICAgbGV0IHJlcXVpcmVkVm90ZXM6IG51bWJlcjtcclxuICAgICAgbGV0IG1hdGNoTG9naWNEZXNjcmlwdGlvbjogc3RyaW5nO1xyXG5cclxuICAgICAgaWYgKE1BVENIX0xPR0lDID09PSAnbWF4UGFydGljaXBhbnRzJykge1xyXG4gICAgICAgIC8vIE1PREUgMTogTWF0Y2ggd2hlbiBleGFjdGx5IG1heFBhcnRpY2lwYW50cyB1c2VycyB2b3RlIFlFU1xyXG4gICAgICAgIHJlcXVpcmVkVm90ZXMgPSByb29tLm1heFBhcnRpY2lwYW50cyB8fCAyO1xyXG4gICAgICAgIG1hdGNoTG9naWNEZXNjcmlwdGlvbiA9IGBtYXhQYXJ0aWNpcGFudHMgKCR7cmVxdWlyZWRWb3Rlc30pYDtcclxuICAgICAgICBcclxuICAgICAgICBjb25zb2xlLmxvZyhgVXNpbmcgbWF4UGFydGljaXBhbnRzIGxvZ2ljOiBSb29tICR7cm9vbUlkfSByZXF1aXJlcyAke3JlcXVpcmVkVm90ZXN9IHBvc2l0aXZlIHZvdGVzIGZvciBhIG1hdGNoYCk7XHJcblxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIE1PREUgMjogTWF0Y2ggd2hlbiBBTEwgdXNlcnMgaW4gcm9vbSB2b3RlIFlFU1xyXG4gICAgICAgIC8vIEdldCBBTEwgdXNlcnMgd2hvIGhhdmUgcGFydGljaXBhdGVkIGluIHRoaXMgcm9vbVxyXG4gICAgICAgIGNvbnN0IGFsbFVzZXJzUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdtb3ZpZUlkID0gOnBhcnRpY2lwYXRpb25NYXJrZXInLFxyXG4gICAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICAgICAgJzpwYXJ0aWNpcGF0aW9uTWFya2VyJzogLTEsIC8vIFBhcnRpY2lwYXRpb24gcmVjb3Jkc1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIENvbnNpc3RlbnRSZWFkOiB0cnVlLFxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgY29uc3QgYWxsVXNlcnMgPSBhbGxVc2Vyc1Jlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgICBjb25zdCB0b3RhbFVzZXJzSW5Sb29tID0gbmV3IFNldChhbGxVc2Vycy5tYXAocmVjb3JkID0+IChyZWNvcmQgYXMgVm90ZSkudXNlcklkKSkuc2l6ZTtcclxuICAgICAgICByZXF1aXJlZFZvdGVzID0gdG90YWxVc2Vyc0luUm9vbTtcclxuICAgICAgICBtYXRjaExvZ2ljRGVzY3JpcHRpb24gPSBgYWxsIHVzZXJzIGluIHJvb20gKCR7cmVxdWlyZWRWb3Rlc30pYDtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYFVzaW5nIGFsbFVzZXJzIGxvZ2ljOiBSb29tICR7cm9vbUlkfSBoYXMgJHt0b3RhbFVzZXJzSW5Sb29tfSB1c2VycywgcmVxdWlyZXMgJHtyZXF1aXJlZFZvdGVzfSBwb3NpdGl2ZSB2b3RlcyBmb3IgYSBtYXRjaGApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTVEVQIDM6IENoZWNrIGlmIG1hdGNoIGNvbmRpdGlvbiBpcyBtZXRcclxuICAgICAgaWYgKHBvc2l0aXZlVm90ZUNvdW50ID09PSByZXF1aXJlZFZvdGVzKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfjokgTUFUQ0ggREVURUNURUQhICR7cG9zaXRpdmVWb3RlQ291bnR9IHVzZXJzIHZvdGVkIHBvc2l0aXZlbHkgZm9yIG1vdmllICR7bW92aWVJZH0gKHJlcXVpcmVkOiAke21hdGNoTG9naWNEZXNjcmlwdGlvbn0pYCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2hlY2sgaWYgbWF0Y2ggYWxyZWFkeSBleGlzdHNcclxuICAgICAgICBjb25zdCBleGlzdGluZ01hdGNoID0gYXdhaXQgdGhpcy5nZXRFeGlzdGluZ01hdGNoKHJvb21JZCwgbW92aWVJZCk7XHJcbiAgICAgICAgaWYgKGV4aXN0aW5nTWF0Y2gpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKCdNYXRjaCBhbHJlYWR5IGV4aXN0cywgcmV0dXJuaW5nIGV4aXN0aW5nIG1hdGNoJyk7XHJcbiAgICAgICAgICByZXR1cm4gZXhpc3RpbmdNYXRjaDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIENyZWF0ZSBuZXcgbWF0Y2hcclxuICAgICAgICBjb25zdCBtYXRjaCA9IGF3YWl0IHRoaXMuY3JlYXRlTWF0Y2gocm9vbUlkLCBtb3ZpZUlkLCBtb3ZpZUNhbmRpZGF0ZSwgQXJyYXkuZnJvbShwb3NpdGl2ZVVzZXJJZHMpKTtcclxuICAgICAgICByZXR1cm4gbWF0Y2g7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBObyBtYXRjaCB5ZXQuIFBvc2l0aXZlIHZvdGVzOiAke3Bvc2l0aXZlVm90ZUNvdW50fSwgUmVxdWlyZWQ6ICR7cmVxdWlyZWRWb3Rlc30gKCR7bWF0Y2hMb2dpY0Rlc2NyaXB0aW9ufSlgKTtcclxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyBmb3IgbWF0Y2g6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBnZXRFeGlzdGluZ01hdGNoKHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIpOiBQcm9taXNlPE1hdGNoIHwgbnVsbD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgS2V5OiB7XHJcbiAgICAgICAgICByb29tSWQsXHJcbiAgICAgICAgICBtb3ZpZUlkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIHJldHVybiByZXN1bHQuSXRlbSBhcyBNYXRjaCB8fCBudWxsO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgY2hlY2tpbmcgZXhpc3RpbmcgbWF0Y2g6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgY3JlYXRlTWF0Y2gocm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgbW92aWVDYW5kaWRhdGU6IE1vdmllQ2FuZGlkYXRlLCBtYXRjaGVkVXNlcnM6IHN0cmluZ1tdKTogUHJvbWlzZTxNYXRjaD4ge1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG4gICAgY29uc3QgbWF0Y2hJZCA9IGAke3Jvb21JZH0jJHttb3ZpZUlkfWA7XHJcblxyXG4gICAgY29uc3QgbWF0Y2g6IE1hdGNoID0ge1xyXG4gICAgICBpZDogbWF0Y2hJZCxcclxuICAgICAgcm9vbUlkLFxyXG4gICAgICBtb3ZpZUlkLFxyXG4gICAgICB0aXRsZTogbW92aWVDYW5kaWRhdGUudGl0bGUsXHJcbiAgICAgIHBvc3RlclBhdGg6IG1vdmllQ2FuZGlkYXRlLnBvc3RlclBhdGggfHwgdW5kZWZpbmVkLFxyXG4gICAgICBtZWRpYVR5cGU6IG1vdmllQ2FuZGlkYXRlLm1lZGlhVHlwZSxcclxuICAgICAgbWF0Y2hlZFVzZXJzLFxyXG4gICAgICB0aW1lc3RhbXAsXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIFN0b3JlIG1hdGNoIGluIER5bmFtb0RCXHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBJdGVtOiBtYXRjaCxcclxuICAgICAgICBDb25kaXRpb25FeHByZXNzaW9uOiAnYXR0cmlidXRlX25vdF9leGlzdHMocm9vbUlkKSBBTkQgYXR0cmlidXRlX25vdF9leGlzdHMobW92aWVJZCknLFxyXG4gICAgICB9KSk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDinIUgTWF0Y2ggY3JlYXRlZDogJHttYXRjaC50aXRsZX0gZm9yICR7bWF0Y2hlZFVzZXJzLmxlbmd0aH0gdXNlcnNgKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnN0IGVyciA9IGVycm9yIGFzIGFueTtcclxuICAgICAgaWYgKGVyci5uYW1lID09PSAnQ29uZGl0aW9uYWxDaGVja0ZhaWxlZEV4Y2VwdGlvbicpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgTWF0Y2ggYWxyZWFkeSBleGlzdHMgZm9yIHJvb20gJHtyb29tSWR9IGFuZCBtb3ZpZSAke21vdmllSWR9YCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgY3JlYXRpbmcgbWF0Y2g6JywgZXJyb3IpO1xyXG4gICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ1JJVElDQUw6IFRyaWdnZXIgQXBwU3luYyBzdWJzY3JpcHRpb24gdG8gbm90aWZ5IGFsbCB1c2Vyc1xyXG4gICAgYXdhaXQgdGhpcy50cmlnZ2VyQXBwU3luY1N1YnNjcmlwdGlvbihtYXRjaCk7XHJcblxyXG4gICAgLy8gV2FpdCB0byBlbnN1cmUgbm90aWZpY2F0aW9ucyBhcmUgc2VudFxyXG4gICAgYXdhaXQgbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIDIwMDApKTtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgTWF0Y2ggY3JlYXRlZCBhbmQgbm90aWZpY2F0aW9ucyBzZW50IGZvciByb29tICR7cm9vbUlkfWApO1xyXG5cclxuICAgIHJldHVybiBtYXRjaDtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENSSVRJQ0FMOiBUcmlnZ2VyIEFwcFN5bmMgc3Vic2NyaXB0aW9ucyB2aWEgR3JhcGhRTCBtdXRhdGlvbnNcclxuICAgKiBUaGlzIGlzIHRoZSBPTkxZIHdheSB0byBub3RpZnkgZnJvbnRlbmQgY2xpZW50cyBpbiByZWFsLXRpbWVcclxuICAgKiBEaXJlY3QgRHluYW1vREIgd3JpdGVzIGRvIE5PVCB0cmlnZ2VyIHN1YnNjcmlwdGlvbnNcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIHRyaWdnZXJBcHBTeW5jU3Vic2NyaXB0aW9uKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc29sZS5sb2coYPCflJQgQlJPQURDQVNUSU5HIG1hdGNoIG5vdGlmaWNhdGlvbnMgdG8gJHttYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RofSB1c2Vyc2ApO1xyXG4gICAgY29uc29sZS5sb2coYPCfkaUgVXNlcnMgdG8gbm90aWZ5OiAke21hdGNoLm1hdGNoZWRVc2Vycy5qb2luKCcsICcpfWApO1xyXG4gICAgXHJcbiAgICBjb25zdCBlbmRwb2ludCA9IHByb2Nlc3MuZW52LkdSQVBIUUxfRU5EUE9JTlQ7XHJcbiAgICBpZiAoIWVuZHBvaW50KSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGQVRBTDogR1JBUEhRTF9FTkRQT0lOVCBub3QgZGVmaW5lZCcpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgLy8gU1RSQVRFR1k6IFNlbmQgaW5kaXZpZHVhbCBub3RpZmljYXRpb24gdG8gZWFjaCB1c2VyXHJcbiAgICAvLyBUaGlzIGVuc3VyZXMgQUxMIHVzZXJzIHdobyBwYXJ0aWNpcGF0ZWQgaW4gdGhlIG1hdGNoIHJlY2VpdmUgbm90aWZpY2F0aW9uXHJcbiAgICBjb25zdCBub3RpZmljYXRpb25Qcm9taXNlcyA9IG1hdGNoLm1hdGNoZWRVc2Vycy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICBhd2FpdCB0aGlzLnNlbmRJbmRpdmlkdWFsVXNlck5vdGlmaWNhdGlvbih1c2VySWQsIG1hdGNoLCBlbmRwb2ludCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBTZW5kIGFsbCBub3RpZmljYXRpb25zIGluIHBhcmFsbGVsXHJcbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKG5vdGlmaWNhdGlvblByb21pc2VzKTtcclxuICAgIFxyXG4gICAgLy8gTG9nIHJlc3VsdHNcclxuICAgIHJlc3VsdHMuZm9yRWFjaCgocmVzdWx0LCBpbmRleCkgPT4ge1xyXG4gICAgICBjb25zdCB1c2VySWQgPSBtYXRjaC5tYXRjaGVkVXNlcnNbaW5kZXhdO1xyXG4gICAgICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ2Z1bGZpbGxlZCcpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIE5vdGlmaWNhdGlvbiBzZW50IHN1Y2Nlc3NmdWxseSB0byB1c2VyOiAke3VzZXJJZH1gKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgRXJyb3Igc2VuZGluZyBub3RpZmljYXRpb24gdG8gdXNlciAke3VzZXJJZH06YCwgcmVzdWx0LnJlYXNvbik7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFsc28gc2VuZCByb29tIG5vdGlmaWNhdGlvbiBmb3IgY29tcGF0aWJpbGl0eVxyXG4gICAgYXdhaXQgdGhpcy5zZW5kUm9vbU5vdGlmaWNhdGlvbihtYXRjaCwgZW5kcG9pbnQpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2VuZCBpbmRpdmlkdWFsIHVzZXIgbm90aWZpY2F0aW9uIHZpYSBwdWJsaXNoVXNlck1hdGNoIG11dGF0aW9uXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhc3luYyBzZW5kSW5kaXZpZHVhbFVzZXJOb3RpZmljYXRpb24odXNlcklkOiBzdHJpbmcsIG1hdGNoOiBNYXRjaCwgZW5kcG9pbnQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc29sZS5sb2coYPCfk6QgU2VuZGluZyBpbmRpdmlkdWFsIG5vdGlmaWNhdGlvbiB0byB1c2VyOiAke3VzZXJJZH1gKTtcclxuICAgIFxyXG4gICAgY29uc3QgbXV0YXRpb24gPSBgXHJcbiAgICAgIG11dGF0aW9uIFB1Ymxpc2hVc2VyTWF0Y2goJHVzZXJJZDogSUQhLCAkbWF0Y2hEYXRhOiBSb29tTWF0Y2hJbnB1dCEpIHtcclxuICAgICAgICBwdWJsaXNoVXNlck1hdGNoKHVzZXJJZDogJHVzZXJJZCwgbWF0Y2hEYXRhOiAkbWF0Y2hEYXRhKSB7XHJcbiAgICAgICAgICByb29tSWRcclxuICAgICAgICAgIG1hdGNoSWRcclxuICAgICAgICAgIG1vdmllSWRcclxuICAgICAgICAgIG1hdGNoZWRVc2Vyc1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgYDtcclxuXHJcbiAgICBjb25zdCB2YXJpYWJsZXMgPSB7XHJcbiAgICAgIHVzZXJJZDogdXNlcklkLFxyXG4gICAgICBtYXRjaERhdGE6IHtcclxuICAgICAgICBtYXRjaElkOiBtYXRjaC5pZCxcclxuICAgICAgICBtb3ZpZUlkOiBtYXRjaC5tb3ZpZUlkLFxyXG4gICAgICAgIG1vdmllVGl0bGU6IG1hdGNoLnRpdGxlLFxyXG4gICAgICAgIHBvc3RlclBhdGg6IG1hdGNoLnBvc3RlclBhdGgsXHJcbiAgICAgICAgbWF0Y2hlZFVzZXJzOiBtYXRjaC5tYXRjaGVkVXNlcnMsXHJcbiAgICAgICAgcm9vbUlkOiBtYXRjaC5yb29tSWQsXHJcbiAgICAgICAgdGltZXN0YW1wOiBtYXRjaC50aW1lc3RhbXAsXHJcbiAgICAgICAgbWF0Y2hEZXRhaWxzOiB7XHJcbiAgICAgICAgICB2b3RlQ291bnQ6IG1hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGgsXHJcbiAgICAgICAgICByZXF1aXJlZFZvdGVzOiBtYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RoLFxyXG4gICAgICAgICAgbWF0Y2hUeXBlOiAndW5hbmltb3VzJ1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfTtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKGVuZHBvaW50KTtcclxuICAgICAgY29uc3QgcmVxdWVzdCA9IG5ldyBIdHRwUmVxdWVzdCh7XHJcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAgIGhvc3Q6IHVybC5ob3N0bmFtZSxcclxuICAgICAgICB9LFxyXG4gICAgICAgIGhvc3RuYW1lOiB1cmwuaG9zdG5hbWUsXHJcbiAgICAgICAgcGF0aDogJy9ncmFwaHFsJyxcclxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IHF1ZXJ5OiBtdXRhdGlvbiwgdmFyaWFibGVzIH0pLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIFNpZ24gcmVxdWVzdCB3aXRoIElBTSBjcmVkZW50aWFsc1xyXG4gICAgICBjb25zdCBzaWduZXIgPSBuZXcgU2lnbmF0dXJlVjQoe1xyXG4gICAgICAgIGNyZWRlbnRpYWxzOiBkZWZhdWx0UHJvdmlkZXIoKSxcclxuICAgICAgICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScsXHJcbiAgICAgICAgc2VydmljZTogJ2FwcHN5bmMnLFxyXG4gICAgICAgIHNoYTI1NjogU2hhMjU2LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHNpZ25lZFJlcXVlc3QgPSBhd2FpdCBzaWduZXIuc2lnbihyZXF1ZXN0KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goZW5kcG9pbnQsIHtcclxuICAgICAgICBtZXRob2Q6IHNpZ25lZFJlcXVlc3QubWV0aG9kLFxyXG4gICAgICAgIGhlYWRlcnM6IHNpZ25lZFJlcXVlc3QuaGVhZGVycyBhcyBhbnksXHJcbiAgICAgICAgYm9keTogc2lnbmVkUmVxdWVzdC5ib2R5LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKSBhcyB7IGRhdGE/OiBhbnk7IGVycm9ycz86IGFueVtdIH07XHJcbiAgICAgIFxyXG4gICAgICBpZiAocmVzdWx0LmVycm9ycykge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBFcnJvciBub3RpZnlpbmcgdXNlciAke3VzZXJJZH06YCwgSlNPTi5zdHJpbmdpZnkocmVzdWx0LmVycm9ycykpO1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQXBwU3luYyBlcnJvciBmb3IgdXNlciAke3VzZXJJZH06ICR7cmVzdWx0LmVycm9yc1swXT8ubWVzc2FnZX1gKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg4pyFIFVzZXIgJHt1c2VySWR9IG5vdGlmaWVkIHN1Y2Nlc3NmdWxseWApO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGDinYwgRXJyb3Igc2VuZGluZyBub3RpZmljYXRpb24gdG8gdXNlciAke3VzZXJJZH06YCwgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNlbmQgcm9vbSBub3RpZmljYXRpb24gdmlhIHB1Ymxpc2hSb29tTWF0Y2ggbXV0YXRpb25cclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIHNlbmRSb29tTm90aWZpY2F0aW9uKG1hdGNoOiBNYXRjaCwgZW5kcG9pbnQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc29sZS5sb2coYPCfk6QgU2VuZGluZyByb29tIG5vdGlmaWNhdGlvbjogJHttYXRjaC5yb29tSWR9YCk7XHJcbiAgICBcclxuICAgIGNvbnN0IG11dGF0aW9uID0gYFxyXG4gICAgICBtdXRhdGlvbiBQdWJsaXNoUm9vbU1hdGNoKCRyb29tSWQ6IElEISwgJG1hdGNoRGF0YTogUm9vbU1hdGNoSW5wdXQhKSB7XHJcbiAgICAgICAgcHVibGlzaFJvb21NYXRjaChyb29tSWQ6ICRyb29tSWQsIG1hdGNoRGF0YTogJG1hdGNoRGF0YSkge1xyXG4gICAgICAgICAgcm9vbUlkXHJcbiAgICAgICAgICBtYXRjaElkXHJcbiAgICAgICAgICBtb3ZpZUlkXHJcbiAgICAgICAgICBtYXRjaGVkVXNlcnNcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIGA7XHJcblxyXG4gICAgY29uc3QgdmFyaWFibGVzID0ge1xyXG4gICAgICByb29tSWQ6IG1hdGNoLnJvb21JZCxcclxuICAgICAgbWF0Y2hEYXRhOiB7XHJcbiAgICAgICAgbWF0Y2hJZDogbWF0Y2guaWQsXHJcbiAgICAgICAgbW92aWVJZDogbWF0Y2gubW92aWVJZCxcclxuICAgICAgICBtb3ZpZVRpdGxlOiBtYXRjaC50aXRsZSxcclxuICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaC5wb3N0ZXJQYXRoLFxyXG4gICAgICAgIG1hdGNoZWRVc2VyczogbWF0Y2gubWF0Y2hlZFVzZXJzLFxyXG4gICAgICAgIG1hdGNoRGV0YWlsczoge1xyXG4gICAgICAgICAgdm90ZUNvdW50OiBtYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RoLFxyXG4gICAgICAgICAgcmVxdWlyZWRWb3RlczogbWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aCxcclxuICAgICAgICAgIG1hdGNoVHlwZTogJ3VuYW5pbW91cydcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH07XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChlbmRwb2ludCk7XHJcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXcgSHR0cFJlcXVlc3Qoe1xyXG4gICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICBob3N0OiB1cmwuaG9zdG5hbWUsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBob3N0bmFtZTogdXJsLmhvc3RuYW1lLFxyXG4gICAgICAgIHBhdGg6ICcvZ3JhcGhxbCcsXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBxdWVyeTogbXV0YXRpb24sIHZhcmlhYmxlcyB9KSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCBzaWduZXIgPSBuZXcgU2lnbmF0dXJlVjQoe1xyXG4gICAgICAgIGNyZWRlbnRpYWxzOiBkZWZhdWx0UHJvdmlkZXIoKSxcclxuICAgICAgICByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ3VzLWVhc3QtMScsXHJcbiAgICAgICAgc2VydmljZTogJ2FwcHN5bmMnLFxyXG4gICAgICAgIHNoYTI1NjogU2hhMjU2LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHNpZ25lZFJlcXVlc3QgPSBhd2FpdCBzaWduZXIuc2lnbihyZXF1ZXN0KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goZW5kcG9pbnQsIHtcclxuICAgICAgICBtZXRob2Q6IHNpZ25lZFJlcXVlc3QubWV0aG9kLFxyXG4gICAgICAgIGhlYWRlcnM6IHNpZ25lZFJlcXVlc3QuaGVhZGVycyBhcyBhbnksXHJcbiAgICAgICAgYm9keTogc2lnbmVkUmVxdWVzdC5ib2R5LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlc3BvbnNlLmpzb24oKSBhcyB7IGRhdGE/OiBhbnk7IGVycm9ycz86IGFueVtdIH07XHJcbiAgICAgIFxyXG4gICAgICBpZiAocmVzdWx0LmVycm9ycykge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBpbiByb29tIG5vdGlmaWNhdGlvbjonLCBKU09OLnN0cmluZ2lmeShyZXN1bHQuZXJyb3JzKSk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBSb29tIG5vdGlmaWNhdGlvbiBzZW50IHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3Igc2VuZGluZyByb29tIG5vdGlmaWNhdGlvbjonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG4vLyBMYW1iZGEgSGFuZGxlciBmb3IgQXBwU3luY1xyXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdWb3RlIExhbWJkYSByZWNlaXZlZCBBcHBTeW5jIGV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XHJcbiAgY29uc29sZS5sb2coYPCflKcgTWF0Y2ggbG9naWMgY29uZmlndXJlZCBhczogJHtNQVRDSF9MT0dJQ31gKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIC8vIEV4dHJhY3QgdXNlciBJRCBmcm9tIEFwcFN5bmMgY29udGV4dFxyXG4gICAgY29uc3QgdXNlcklkID0gZXZlbnQuaWRlbnRpdHk/LmNsYWltcz8uc3ViIHx8IGV2ZW50LmlkZW50aXR5Py51c2VybmFtZTtcclxuICAgIGlmICghdXNlcklkKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1VzZXIgbm90IGF1dGhlbnRpY2F0ZWQgZm9yIHZvdGUnKTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UgfTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBHZXQgYXJndW1lbnRzIGZyb20gQXBwU3luY1xyXG4gICAgY29uc3QgeyBpbnB1dCB9ID0gZXZlbnQuYXJndW1lbnRzO1xyXG4gICAgY29uc3QgeyByb29tSWQsIG1vdmllSWQsIHZvdGUgfSA9IGlucHV0O1xyXG5cclxuICAgIC8vIFZhbGlkYXRlIGlucHV0XHJcbiAgICBpZiAoIXJvb21JZCkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdSb29tIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHR5cGVvZiBtb3ZpZUlkICE9PSAnbnVtYmVyJykge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdNb3ZpZSBJRCBtdXN0IGJlIGEgbnVtYmVyJyk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHR5cGVvZiB2b3RlICE9PSAnYm9vbGVhbicpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignVm90ZSBtdXN0IGJlIGEgYm9vbGVhbicpO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHZvdGVTZXJ2aWNlID0gbmV3IFZvdGVTZXJ2aWNlKCk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZvdGVTZXJ2aWNlLnByb2Nlc3NWb3RlKHVzZXJJZCwgcm9vbUlkLCBtb3ZpZUlkLCB2b3RlKTtcclxuICAgICAgcmV0dXJuIHJlc3VsdDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHByb2Nlc3Npbmcgdm90ZTonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlIH07XHJcbiAgICB9XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdWb3RlIExhbWJkYSBlcnJvcjonLCBlcnJvcik7XHJcbiAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSB9O1xyXG4gIH1cclxufTtcclxuIl19