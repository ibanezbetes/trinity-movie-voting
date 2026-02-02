"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_lambda_1 = require("@aws-sdk/client-lambda");
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
        try {
            console.log(`🔔 CRITICAL FIX: Triggering AppSync subscription for match: ${match.title}`);
            console.log(`📱 Broadcasting to ALL users who voted in room ${match.roomId}`);
            console.log(`👥 Matched users: ${match.matchedUsers.join(', ')}`);
            // SIMPLIFIED APPROACH: Use the createMatch mutation that already works
            // This will trigger the onMatchCreated subscription for all connected clients
            // The client-side filtering will ensure each user only processes relevant matches
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
                console.log('🚀 Invoking Match Lambda with createMatch...');
                console.log('📡 This will trigger onMatchCreated subscription for ALL connected clients');
                console.log('🔍 Client-side filtering will ensure each user gets relevant matches');
                const command = new client_lambda_1.InvokeCommand({
                    FunctionName: this.matchLambdaArn,
                    InvocationType: 'RequestResponse',
                    Payload: JSON.stringify(payload),
                });
                const response = await lambdaClient.send(command);
                if (response.Payload) {
                    const result = JSON.parse(new TextDecoder().decode(response.Payload));
                    console.log('📨 Match Lambda response:', JSON.stringify(result, null, 2));
                    if (result.statusCode === 200) {
                        console.log('✅ createMatch executed successfully');
                        console.log('🔔 onMatchCreated subscription triggered for all connected clients');
                        console.log(`👥 Users ${match.matchedUsers.join(', ')} should receive notifications`);
                    }
                    else {
                        console.error('❌ Match Lambda returned error:', result.body?.error);
                        throw new Error(result.body?.error || 'Failed to create match');
                    }
                }
                else {
                    throw new Error('No response payload from Match Lambda');
                }
            }
            else {
                throw new Error('Match Lambda ARN not configured');
            }
        }
        catch (error) {
            console.error('❌ Error triggering AppSync subscription:', error);
            // Store notifications for polling as fallback
            await this.storeMatchNotifications(match);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdm90ZS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQW9IO0FBQ3BILDBEQUFxRTtBQUVyRSx5QkFBeUI7QUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDNUQsTUFBTSxZQUFZLEdBQUcsSUFBSSw0QkFBWSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQThEMUUsZUFBZTtBQUNmLE1BQU0sV0FBVztJQU1mO1FBQ0UsSUFBSSxDQUFDLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUM7UUFDaEQsSUFBSSxDQUFDLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsSUFBSSxFQUFFLENBQUM7UUFDcEQsSUFBSSxDQUFDLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUM7UUFDaEQsSUFBSSxDQUFDLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixJQUFJLEVBQUUsQ0FBQztRQUV6RCxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDL0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxrREFBa0QsQ0FBQyxDQUFDO1FBQ3RFLENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFj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O0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsb0JBQW9CLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFM0MsTUFBTSxZQUFZLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUM7UUFFdkYsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFO2dCQUNKLE9BQU8sRUFBRSxLQUFLO2dCQUNkLEtBQUssRUFBRSxZQUFZO2FBQ3BCO1NBQ0YsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUE3Q1csUUFBQSxPQUFPLFdBNkNsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBQdXRDb21tYW5kLCBRdWVyeUNvbW1hbmQsIEdldENvbW1hbmQsIERlbGV0ZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5pbXBvcnQgeyBMYW1iZGFDbGllbnQsIEludm9rZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtbGFtYmRhJztcclxuXHJcbi8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcclxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KTtcclxuY29uc3QgbGFtYmRhQ2xpZW50ID0gbmV3IExhbWJkYUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuXHJcbi8vIFR5cGVzXHJcbmludGVyZmFjZSBWb3RlIHtcclxuICByb29tSWQ6IHN0cmluZztcclxuICB1c2VyTW92aWVJZDogc3RyaW5nOyAvLyBGb3JtYXQ6IFwidXNlcklkI21vdmllSWRcIlxyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIG1vdmllSWQ6IG51bWJlcjtcclxuICB2b3RlOiBib29sZWFuO1xyXG4gIHRpbWVzdGFtcDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTWF0Y2gge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgbW92aWVJZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aD86IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIG1hdGNoZWRVc2Vyczogc3RyaW5nW107XHJcbiAgdGltZXN0YW1wOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBSb29tIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIGNvZGU6IHN0cmluZztcclxuICBob3N0SWQ6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIGdlbnJlSWRzOiBudW1iZXJbXTtcclxuICBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdO1xyXG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xyXG4gIHR0bDogbnVtYmVyO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTW92aWVDYW5kaWRhdGUge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg6IHN0cmluZyB8IG51bGw7XHJcbiAgcmVsZWFzZURhdGU6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVm90ZUV2ZW50IHtcclxuICBvcGVyYXRpb246ICd2b3RlJztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICBpbnB1dDoge1xyXG4gICAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgICB2b3RlOiBib29sZWFuO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBWb3RlUmVzcG9uc2Uge1xyXG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcclxuICBib2R5OiB7XHJcbiAgICBzdWNjZXNzOiBib29sZWFuO1xyXG4gICAgbWF0Y2g/OiBNYXRjaDtcclxuICAgIGVycm9yPzogc3RyaW5nO1xyXG4gIH07XHJcbn1cclxuXHJcbi8vIFZvdGUgU2VydmljZVxyXG5jbGFzcyBWb3RlU2VydmljZSB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB2b3Rlc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBtYXRjaGVzVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHJvb21zVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IG1hdGNoTGFtYmRhQXJuOiBzdHJpbmc7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy52b3Rlc1RhYmxlID0gcHJvY2Vzcy5lbnYuVk9URVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLm1hdGNoZXNUYWJsZSA9IHByb2Nlc3MuZW52Lk1BVENIRVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLnJvb21zVGFibGUgPSBwcm9jZXNzLmVudi5ST09NU19UQUJMRSB8fCAnJztcclxuICAgIHRoaXMubWF0Y2hMYW1iZGFBcm4gPSBwcm9jZXNzLmVudi5NQVRDSF9MQU1CREFfQVJOIHx8ICcnO1xyXG5cclxuICAgIGlmICghdGhpcy52b3Rlc1RhYmxlIHx8ICF0aGlzLm1hdGNoZXNUYWJsZSB8fCAhdGhpcy5yb29tc1RhYmxlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVxdWlyZWQgdGFibGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGFyZSBtaXNzaW5nJyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBwcm9jZXNzVm90ZSh1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgdm90ZTogYm9vbGVhbik6IFByb21pc2U8eyBzdWNjZXNzOiBib29sZWFuOyBtYXRjaD86IE1hdGNoIH0+IHtcclxuICAgIC8vIFZhbGlkYXRlIHJvb20gZXhpc3RzIGFuZCBnZXQgcm9vbSBkZXRhaWxzXHJcbiAgICBjb25zdCByb29tID0gYXdhaXQgdGhpcy5nZXRSb29tKHJvb21JZCk7XHJcbiAgICBpZiAoIXJvb20pIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZCBvciBoYXMgZXhwaXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIEJhc2ljIHJvb20gbWVtYmVyc2hpcCB2YWxpZGF0aW9uIC0gY2hlY2sgaWYgdXNlciBoYXMgYWNjZXNzIHRvIHRoaXMgcm9vbVxyXG4gICAgLy8gRm9yIG5vdywgd2UgYWxsb3cgYW55IGF1dGhlbnRpY2F0ZWQgdXNlciB0byB2b3RlIGluIGFueSBhY3RpdmUgcm9vbVxyXG4gICAgLy8gVE9ETzogSW1wbGVtZW50IHByb3BlciByb29tIG1lbWJlcnNoaXAgdmFsaWRhdGlvbiBpbiBUYXNrIDJcclxuICAgIGNvbnN0IGhhc1Jvb21BY2Nlc3MgPSBhd2FpdCB0aGlzLnZhbGlkYXRlUm9vbUFjY2Vzcyh1c2VySWQsIHJvb21JZCwgcm9vbSk7XHJcbiAgICBpZiAoIWhhc1Jvb21BY2Nlc3MpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIGRvZXMgbm90IGhhdmUgYWNjZXNzIHRvIHRoaXMgcm9vbScpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFZhbGlkYXRlIG1vdmllIGlzIGluIHJvb20gY2FuZGlkYXRlc1xyXG4gICAgY29uc3QgbW92aWVDYW5kaWRhdGUgPSByb29tLmNhbmRpZGF0ZXMuZmluZChjID0+IGMuaWQgPT09IG1vdmllSWQpO1xyXG4gICAgaWYgKCFtb3ZpZUNhbmRpZGF0ZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ01vdmllIG5vdCBmb3VuZCBpbiByb29tIGNhbmRpZGF0ZXMnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSZWNvcmQgdGhlIHZvdGVcclxuICAgIGF3YWl0IHRoaXMucmVjb3JkVm90ZSh1c2VySWQsIHJvb21JZCwgbW92aWVJZCwgdm90ZSk7XHJcblxyXG4gICAgLy8gQ2hlY2sgZm9yIG1hdGNoIGlmIHZvdGUgaXMgcG9zaXRpdmVcclxuICAgIGxldCBtYXRjaDogTWF0Y2ggfCB1bmRlZmluZWQ7XHJcbiAgICBpZiAodm90ZSkge1xyXG4gICAgICBtYXRjaCA9IGF3YWl0IHRoaXMuY2hlY2tGb3JNYXRjaChyb29tSWQsIG1vdmllSWQsIG1vdmllQ2FuZGlkYXRlKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBtYXRjaCB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyB2YWxpZGF0ZVJvb21BY2Nlc3ModXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nLCByb29tOiBSb29tKTogUHJvbWlzZTxib29sZWFuPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBCYXNpYyB2YWxpZGF0aW9uOiBjaGVjayBpZiB1c2VyIGlzIHRoZSByb29tIGhvc3Qgb3IgaGFzIHByZXZpb3VzbHkgdm90ZWQgaW4gdGhpcyByb29tXHJcbiAgICAgIGlmIChyb29tLmhvc3RJZCA9PT0gdXNlcklkKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGlzIHRoZSBob3N0IG9mIHJvb20gJHtyb29tSWR9IC0gYWNjZXNzIGdyYW50ZWRgKTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgdXNlciBoYXMgcHJldmlvdXNseSBwYXJ0aWNpcGF0ZWQgaW4gdGhpcyByb29tXHJcbiAgICAgIGNvbnN0IHVzZXJWb3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAndXNlcklkID0gOnVzZXJJZCcsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIExpbWl0OiAxLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBpZiAodXNlclZvdGVzUmVzdWx0Lkl0ZW1zICYmIHVzZXJWb3Rlc1Jlc3VsdC5JdGVtcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFVzZXIgJHt1c2VySWR9IGhhcyBwcmV2aW91c2x5IHZvdGVkIGluIHJvb20gJHtyb29tSWR9IC0gYWNjZXNzIGdyYW50ZWRgKTtcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gRm9yIE1WUDogQWxsb3cgYW55IGF1dGhlbnRpY2F0ZWQgdXNlciB0byBqb2luIGFueSBhY3RpdmUgcm9vbVxyXG4gICAgICAvLyBUT0RPOiBJbXBsZW1lbnQgcHJvcGVyIHJvb20gbWVtYmVyc2hpcCB2YWxpZGF0aW9uIHdpdGggRHluYW1vREIgdGFibGUgaW4gVGFzayAyXHJcbiAgICAgIGNvbnNvbGUubG9nKGBVc2VyICR7dXNlcklkfSBncmFudGVkIGFjY2VzcyB0byByb29tICR7cm9vbUlkfSAoTVZQIG1vZGUgLSBhbGwgdXNlcnMgYWxsb3dlZClgKTtcclxuICAgICAgcmV0dXJuIHRydWU7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgdmFsaWRhdGluZyByb29tIGFjY2VzcyBmb3IgdXNlciAke3VzZXJJZH0gaW4gcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICAvLyBPbiBlcnJvciwgYWxsb3cgYWNjZXNzIGZvciBub3cgKGZhaWwgb3BlbiBmb3IgTVZQKVxyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZ2V0Um9vbShyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8Um9vbSB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMucm9vbXNUYWJsZSxcclxuICAgICAgICBLZXk6IHsgaWQ6IHJvb21JZCB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBpZiAoIXJlc3VsdC5JdGVtKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJvb20gPSByZXN1bHQuSXRlbSBhcyBSb29tO1xyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgcm9vbSBoYXMgZXhwaXJlZFxyXG4gICAgICBjb25zdCBub3cgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcclxuICAgICAgaWYgKHJvb20udHRsICYmIHJvb20udHRsIDwgbm93KSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHJldHVybiByb29tO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2V0dGluZyByb29tOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlY29yZFZvdGUodXNlcklkOiBzdHJpbmcsIHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIsIHZvdGU6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHVzZXJNb3ZpZUlkID0gYCR7dXNlcklkfSMke21vdmllSWR9YDtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuXHJcbiAgICBjb25zdCB2b3RlUmVjb3JkOiBWb3RlID0ge1xyXG4gICAgICByb29tSWQsXHJcbiAgICAgIHVzZXJNb3ZpZUlkLFxyXG4gICAgICB1c2VySWQsXHJcbiAgICAgIG1vdmllSWQsXHJcbiAgICAgIHZvdGUsXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgIH07XHJcblxyXG4gICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgSXRlbTogdm90ZVJlY29yZCxcclxuICAgICAgLy8gQWxsb3cgb3ZlcndyaXRpbmcgcHJldmlvdXMgdm90ZXMgZm9yIHRoZSBzYW1lIHVzZXIvbW92aWUgY29tYmluYXRpb25cclxuICAgIH0pKTtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgVm90ZSByZWNvcmRlZDogVXNlciAke3VzZXJJZH0gdm90ZWQgJHt2b3RlID8gJ1lFUycgOiAnTk8nfSBmb3IgbW92aWUgJHttb3ZpZUlkfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBjaGVja0Zvck1hdGNoKHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIsIG1vdmllQ2FuZGlkYXRlOiBNb3ZpZUNhbmRpZGF0ZSk6IFByb21pc2U8TWF0Y2ggfCB1bmRlZmluZWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIEdldCBhbGwgdm90ZXMgZm9yIHRoaXMgbW92aWUgaW4gdGhpcyByb29tIChleGNsdWRpbmcgcGFydGljaXBhdGlvbiByZWNvcmRzKVxyXG4gICAgICBjb25zdCB2b3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnbW92aWVJZCA9IDptb3ZpZUlkIEFORCB2b3RlID0gOnZvdGUgQU5EIG1vdmllSWQgPD4gOnBhcnRpY2lwYXRpb25NYXJrZXInLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzptb3ZpZUlkJzogbW92aWVJZCxcclxuICAgICAgICAgICc6dm90ZSc6IHRydWUsIC8vIE9ubHkgcG9zaXRpdmUgdm90ZXNcclxuICAgICAgICAgICc6cGFydGljaXBhdGlvbk1hcmtlcic6IC0xLCAvLyBFeGNsdWRlIHBhcnRpY2lwYXRpb24gcmVjb3Jkc1xyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IHBvc2l0aXZlVm90ZXMgPSB2b3Rlc1Jlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7cG9zaXRpdmVWb3Rlcy5sZW5ndGh9IHBvc2l0aXZlIHZvdGVzIGZvciBtb3ZpZSAke21vdmllSWR9IGluIHJvb20gJHtyb29tSWR9YCk7XHJcblxyXG4gICAgICAvLyBHZXQgYWxsIHVuaXF1ZSB1c2VycyB3aG8gaGF2ZSB2b3RlZCBpbiB0aGlzIHJvb20gKGV4Y2x1ZGluZyBwYXJ0aWNpcGF0aW9uIHJlY29yZHMpXHJcbiAgICAgIGNvbnN0IGFsbFZvdGVzUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdtb3ZpZUlkIDw+IDpwYXJ0aWNpcGF0aW9uTWFya2VyJywgLy8gRXhjbHVkZSBwYXJ0aWNpcGF0aW9uIHJlY29yZHNcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICAgICc6cGFydGljaXBhdGlvbk1hcmtlcic6IC0xLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IGFsbFZvdGVzID0gYWxsVm90ZXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIGNvbnN0IHVuaXF1ZVVzZXJzID0gbmV3IFNldChhbGxWb3Rlcy5tYXAodm90ZSA9PiAodm90ZSBhcyBWb3RlKS51c2VySWQpKTtcclxuICAgICAgY29uc3QgdG90YWxVc2VycyA9IHVuaXF1ZVVzZXJzLnNpemU7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgVG90YWwgdW5pcXVlIHVzZXJzIHdobyBoYXZlIHZvdGVkIGluIHJvb206ICR7dG90YWxVc2Vyc31gKTtcclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIGFsbCB1c2VycyB2b3RlZCBwb3NpdGl2ZWx5IGZvciB0aGlzIG1vdmllXHJcbiAgICAgIGNvbnN0IHBvc2l0aXZlVXNlcklkcyA9IG5ldyBTZXQocG9zaXRpdmVWb3Rlcy5tYXAodm90ZSA9PiAodm90ZSBhcyBWb3RlKS51c2VySWQpKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChwb3NpdGl2ZVVzZXJJZHMuc2l6ZSA9PT0gdG90YWxVc2VycyAmJiB0b3RhbFVzZXJzID4gMSkge1xyXG4gICAgICAgIC8vIFdlIGhhdmUgYSBtYXRjaCEgQWxsIHVzZXJzIHZvdGVkIHBvc2l0aXZlbHlcclxuICAgICAgICBjb25zb2xlLmxvZyhgTUFUQ0ggREVURUNURUQhIEFsbCAke3RvdGFsVXNlcnN9IHVzZXJzIHZvdGVkIHBvc2l0aXZlbHkgZm9yIG1vdmllICR7bW92aWVJZH1gKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBpZiBtYXRjaCBhbHJlYWR5IGV4aXN0c1xyXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nTWF0Y2ggPSBhd2FpdCB0aGlzLmdldEV4aXN0aW5nTWF0Y2gocm9vbUlkLCBtb3ZpZUlkKTtcclxuICAgICAgICBpZiAoZXhpc3RpbmdNYXRjaCkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coJ01hdGNoIGFscmVhZHkgZXhpc3RzLCByZXR1cm5pbmcgZXhpc3RpbmcgbWF0Y2gnKTtcclxuICAgICAgICAgIHJldHVybiBleGlzdGluZ01hdGNoO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIG5ldyBtYXRjaFxyXG4gICAgICAgIGNvbnN0IG1hdGNoID0gYXdhaXQgdGhpcy5jcmVhdGVNYXRjaChyb29tSWQsIG1vdmllSWQsIG1vdmllQ2FuZGlkYXRlLCBBcnJheS5mcm9tKHBvc2l0aXZlVXNlcklkcykpO1xyXG4gICAgICAgIHJldHVybiBtYXRjaDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc29sZS5sb2coYE5vIG1hdGNoIHlldC4gUG9zaXRpdmUgdm90ZXM6ICR7cG9zaXRpdmVVc2VySWRzLnNpemV9LCBUb3RhbCB1c2VyczogJHt0b3RhbFVzZXJzfWApO1xyXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGZvciBtYXRjaDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldEV4aXN0aW5nTWF0Y2gocm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlcik6IFByb21pc2U8TWF0Y2ggfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBLZXk6IHtcclxuICAgICAgICAgIHJvb21JZCxcclxuICAgICAgICAgIG1vdmllSWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgcmV0dXJuIHJlc3VsdC5JdGVtIGFzIE1hdGNoIHx8IG51bGw7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyBleGlzdGluZyBtYXRjaDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBjcmVhdGVNYXRjaChyb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCBtb3ZpZUNhbmRpZGF0ZTogTW92aWVDYW5kaWRhdGUsIG1hdGNoZWRVc2Vyczogc3RyaW5nW10pOiBQcm9taXNlPE1hdGNoPiB7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICBjb25zdCBtYXRjaElkID0gYCR7cm9vbUlkfSMke21vdmllSWR9YDtcclxuXHJcbiAgICBjb25zdCBtYXRjaDogTWF0Y2ggPSB7XHJcbiAgICAgIGlkOiBtYXRjaElkLFxyXG4gICAgICByb29tSWQsXHJcbiAgICAgIG1vdmllSWQsXHJcbiAgICAgIHRpdGxlOiBtb3ZpZUNhbmRpZGF0ZS50aXRsZSxcclxuICAgICAgcG9zdGVyUGF0aDogbW92aWVDYW5kaWRhdGUucG9zdGVyUGF0aCB8fCB1bmRlZmluZWQsXHJcbiAgICAgIG1lZGlhVHlwZTogbW92aWVDYW5kaWRhdGUubWVkaWFUeXBlLFxyXG4gICAgICBtYXRjaGVkVXNlcnMsXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgIH07XHJcblxyXG4gICAgLy8gU3RvcmUgdGhlIG1haW4gbWF0Y2ggcmVjb3JkXHJcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgIEl0ZW06IG1hdGNoLFxyXG4gICAgICBDb25kaXRpb25FeHByZXNzaW9uOiAnYXR0cmlidXRlX25vdF9leGlzdHMocm9vbUlkKSBBTkQgYXR0cmlidXRlX25vdF9leGlzdHMobW92aWVJZCknLCAvLyBQcmV2ZW50IGR1cGxpY2F0ZXNcclxuICAgIH0pKTtcclxuXHJcbiAgICAvLyBDUklUSUNBTDogQ3JlYXRlIGluZGl2aWR1YWwgbWF0Y2ggcmVjb3JkcyBmb3IgZWFjaCB1c2VyIHRvIGVuYWJsZSBHU0kgcXVlcmllc1xyXG4gICAgLy8gVGhpcyBhbGxvd3MgZWZmaWNpZW50IHF1ZXJ5aW5nIG9mIG1hdGNoZXMgYnkgdXNlcklkIHVzaW5nIHRoZSBuZXcgR1NJXHJcbiAgICBjb25zdCB1c2VyTWF0Y2hQcm9taXNlcyA9IG1hdGNoZWRVc2Vycy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICBjb25zdCB1c2VyTWF0Y2ggPSB7XHJcbiAgICAgICAgLi4ubWF0Y2gsXHJcbiAgICAgICAgdXNlcklkLCAvLyBBZGQgdXNlcklkIGZpZWxkIGZvciBHU0lcclxuICAgICAgICBpZDogYCR7dXNlcklkfSMke21hdGNoSWR9YCwgLy8gVW5pcXVlIElEIHBlciB1c2VyXHJcbiAgICAgICAgcm9vbUlkOiBgJHt1c2VySWR9IyR7cm9vbUlkfWAsIC8vIENvbXBvc2l0ZSBrZXkgdG8gYXZvaWQgY29uZmxpY3RzXHJcbiAgICAgIH07XHJcblxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgICBJdGVtOiB1c2VyTWF0Y2gsXHJcbiAgICAgICAgfSkpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2VyIG1hdGNoIHJlY29yZCBjcmVhdGVkIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGNyZWF0aW5nIHVzZXIgbWF0Y2ggcmVjb3JkIGZvciAke3VzZXJJZH06YCwgZXJyb3IpO1xyXG4gICAgICAgIC8vIENvbnRpbnVlIHdpdGggb3RoZXIgdXNlcnMgZXZlbiBpZiBvbmUgZmFpbHNcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gV2FpdCBmb3IgYWxsIHVzZXIgbWF0Y2ggcmVjb3JkcyB0byBiZSBjcmVhdGVkXHJcbiAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQodXNlck1hdGNoUHJvbWlzZXMpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBNYXRjaCBjcmVhdGVkOiAke21hdGNoSWR9IHdpdGggJHttYXRjaGVkVXNlcnMubGVuZ3RofSB1c2VycyBhbmQgaW5kaXZpZHVhbCB1c2VyIHJlY29yZHNgKTtcclxuXHJcbiAgICAvLyBEZWxldGUgdGhlIHJvb20gc2luY2UgbWF0Y2ggaXMgZm91bmQgLSByb29tIGlzIG5vIGxvbmdlciBuZWVkZWRcclxuICAgIGF3YWl0IHRoaXMuZGVsZXRlUm9vbShyb29tSWQpO1xyXG5cclxuICAgIC8vIENSSVRJQ0FMOiBUcmlnZ2VyIEFwcFN5bmMgc3Vic2NyaXB0aW9uIGJ5IGNhbGxpbmcgdGhlIGNyZWF0ZU1hdGNoIG11dGF0aW9uXHJcbiAgICAvLyBUaGlzIGlzIHRoZSBrZXkgZml4IC0gd2UgbmVlZCB0byBleGVjdXRlIHRoZSBHcmFwaFFMIG11dGF0aW9uIHRvIHRyaWdnZXIgc3Vic2NyaXB0aW9uc1xyXG4gICAgYXdhaXQgdGhpcy50cmlnZ2VyQXBwU3luY1N1YnNjcmlwdGlvbihtYXRjaCk7XHJcblxyXG4gICAgcmV0dXJuIG1hdGNoO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBkZWxldGVSb29tKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBEZWxldGUgdGhlIHJvb20gZnJvbSBEeW5hbW9EQlxyXG4gICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgRGVsZXRlQ29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnJvb21zVGFibGUsXHJcbiAgICAgICAgS2V5OiB7IGlkOiByb29tSWQgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc29sZS5sb2coYFJvb20gJHtyb29tSWR9IGRlbGV0ZWQgYWZ0ZXIgbWF0Y2ggY3JlYXRpb25gKTtcclxuXHJcbiAgICAgIC8vIE9wdGlvbmFsbHk6IERlbGV0ZSBhbGwgdm90ZXMgZm9yIHRoaXMgcm9vbSB0byBmcmVlIHVwIHNwYWNlXHJcbiAgICAgIGF3YWl0IHRoaXMuZGVsZXRlUm9vbVZvdGVzKHJvb21JZCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBkZWxldGluZyByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgIC8vIERvbid0IGZhaWwgdGhlIG1hdGNoIGNyZWF0aW9uIGlmIHJvb20gZGVsZXRpb24gZmFpbHNcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZGVsZXRlUm9vbVZvdGVzKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBHZXQgYWxsIHZvdGVzIGFuZCBwYXJ0aWNpcGF0aW9uIHJlY29yZHMgZm9yIHRoaXMgcm9vbVxyXG4gICAgICBjb25zdCB2b3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBhbGxSZWNvcmRzID0gdm90ZXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIFxyXG4gICAgICAvLyBEZWxldGUgYWxsIHJlY29yZHMgKHZvdGVzIGFuZCBwYXJ0aWNpcGF0aW9uKSBpbiBiYXRjaGVzXHJcbiAgICAgIGNvbnN0IGRlbGV0ZVByb21pc2VzID0gYWxsUmVjb3Jkcy5tYXAocmVjb3JkID0+IFxyXG4gICAgICAgIGRvY0NsaWVudC5zZW5kKG5ldyBEZWxldGVDb21tYW5kKHtcclxuICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgICAgS2V5OiB7XHJcbiAgICAgICAgICAgIHJvb21JZDogcmVjb3JkLnJvb21JZCxcclxuICAgICAgICAgICAgdXNlck1vdmllSWQ6IHJlY29yZC51c2VyTW92aWVJZCxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSkpXHJcbiAgICAgICk7XHJcblxyXG4gICAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoZGVsZXRlUHJvbWlzZXMpO1xyXG4gICAgICBjb25zb2xlLmxvZyhgRGVsZXRlZCAke2FsbFJlY29yZHMubGVuZ3RofSByZWNvcmRzICh2b3RlcyBhbmQgcGFydGljaXBhdGlvbikgZm9yIHJvb20gJHtyb29tSWR9YCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBkZWxldGluZyByZWNvcmRzIGZvciByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHRyaWdnZXJBcHBTeW5jU3Vic2NyaXB0aW9uKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYPCflJQgQ1JJVElDQUwgRklYOiBUcmlnZ2VyaW5nIEFwcFN5bmMgc3Vic2NyaXB0aW9uIGZvciBtYXRjaDogJHttYXRjaC50aXRsZX1gKTtcclxuICAgICAgY29uc29sZS5sb2coYPCfk7EgQnJvYWRjYXN0aW5nIHRvIEFMTCB1c2VycyB3aG8gdm90ZWQgaW4gcm9vbSAke21hdGNoLnJvb21JZH1gKTtcclxuICAgICAgY29uc29sZS5sb2coYPCfkaUgTWF0Y2hlZCB1c2VyczogJHttYXRjaC5tYXRjaGVkVXNlcnMuam9pbignLCAnKX1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFNJTVBMSUZJRUQgQVBQUk9BQ0g6IFVzZSB0aGUgY3JlYXRlTWF0Y2ggbXV0YXRpb24gdGhhdCBhbHJlYWR5IHdvcmtzXHJcbiAgICAgIC8vIFRoaXMgd2lsbCB0cmlnZ2VyIHRoZSBvbk1hdGNoQ3JlYXRlZCBzdWJzY3JpcHRpb24gZm9yIGFsbCBjb25uZWN0ZWQgY2xpZW50c1xyXG4gICAgICAvLyBUaGUgY2xpZW50LXNpZGUgZmlsdGVyaW5nIHdpbGwgZW5zdXJlIGVhY2ggdXNlciBvbmx5IHByb2Nlc3NlcyByZWxldmFudCBtYXRjaGVzXHJcbiAgICAgIFxyXG4gICAgICBpZiAodGhpcy5tYXRjaExhbWJkYUFybikge1xyXG4gICAgICAgIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICAgICAgICBvcGVyYXRpb246ICdjcmVhdGVNYXRjaCcsXHJcbiAgICAgICAgICBpbnB1dDoge1xyXG4gICAgICAgICAgICByb29tSWQ6IG1hdGNoLnJvb21JZCxcclxuICAgICAgICAgICAgbW92aWVJZDogbWF0Y2gubW92aWVJZCxcclxuICAgICAgICAgICAgdGl0bGU6IG1hdGNoLnRpdGxlLFxyXG4gICAgICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaC5wb3N0ZXJQYXRoLFxyXG4gICAgICAgICAgICBtYXRjaGVkVXNlcnM6IG1hdGNoLm1hdGNoZWRVc2VycyxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coJ/CfmoAgSW52b2tpbmcgTWF0Y2ggTGFtYmRhIHdpdGggY3JlYXRlTWF0Y2guLi4nKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+ToSBUaGlzIHdpbGwgdHJpZ2dlciBvbk1hdGNoQ3JlYXRlZCBzdWJzY3JpcHRpb24gZm9yIEFMTCBjb25uZWN0ZWQgY2xpZW50cycpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5SNIENsaWVudC1zaWRlIGZpbHRlcmluZyB3aWxsIGVuc3VyZSBlYWNoIHVzZXIgZ2V0cyByZWxldmFudCBtYXRjaGVzJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcclxuICAgICAgICAgIEZ1bmN0aW9uTmFtZTogdGhpcy5tYXRjaExhbWJkYUFybixcclxuICAgICAgICAgIEludm9jYXRpb25UeXBlOiAnUmVxdWVzdFJlc3BvbnNlJyxcclxuICAgICAgICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHBheWxvYWQpLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKGNvbW1hbmQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChyZXNwb25zZS5QYXlsb2FkKSB7XHJcbiAgICAgICAgICBjb25zdCByZXN1bHQgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShyZXNwb25zZS5QYXlsb2FkKSk7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZygn8J+TqCBNYXRjaCBMYW1iZGEgcmVzcG9uc2U6JywgSlNPTi5zdHJpbmdpZnkocmVzdWx0LCBudWxsLCAyKSk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGlmIChyZXN1bHQuc3RhdHVzQ29kZSA9PT0gMjAwKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfinIUgY3JlYXRlTWF0Y2ggZXhlY3V0ZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfwn5SUIG9uTWF0Y2hDcmVhdGVkIHN1YnNjcmlwdGlvbiB0cmlnZ2VyZWQgZm9yIGFsbCBjb25uZWN0ZWQgY2xpZW50cycpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+RpSBVc2VycyAke21hdGNoLm1hdGNoZWRVc2Vycy5qb2luKCcsICcpfSBzaG91bGQgcmVjZWl2ZSBub3RpZmljYXRpb25zYCk7XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgTWF0Y2ggTGFtYmRhIHJldHVybmVkIGVycm9yOicsIHJlc3VsdC5ib2R5Py5lcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihyZXN1bHQuYm9keT8uZXJyb3IgfHwgJ0ZhaWxlZCB0byBjcmVhdGUgbWF0Y2gnKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyByZXNwb25zZSBwYXlsb2FkIGZyb20gTWF0Y2ggTGFtYmRhJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignTWF0Y2ggTGFtYmRhIEFSTiBub3QgY29uZmlndXJlZCcpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIHRyaWdnZXJpbmcgQXBwU3luYyBzdWJzY3JpcHRpb246JywgZXJyb3IpO1xyXG4gICAgICAvLyBTdG9yZSBub3RpZmljYXRpb25zIGZvciBwb2xsaW5nIGFzIGZhbGxiYWNrXHJcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmVNYXRjaE5vdGlmaWNhdGlvbnMobWF0Y2gpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBmYWxsYmFja1RvQ3JlYXRlTWF0Y2gobWF0Y2g6IE1hdGNoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+UhCBVc2luZyBmYWxsYmFjayBjcmVhdGVNYXRjaCBtZXRob2QuLi4nKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEZBTExCQUNLOiBVc2UgdGhlIG9sZCBjcmVhdGVNYXRjaCBtZXRob2QgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcclxuICAgICAgaWYgKHRoaXMubWF0Y2hMYW1iZGFBcm4pIHtcclxuICAgICAgICBjb25zdCBwYXlsb2FkID0ge1xyXG4gICAgICAgICAgb3BlcmF0aW9uOiAnY3JlYXRlTWF0Y2gnLFxyXG4gICAgICAgICAgaW5wdXQ6IHtcclxuICAgICAgICAgICAgcm9vbUlkOiBtYXRjaC5yb29tSWQsXHJcbiAgICAgICAgICAgIG1vdmllSWQ6IG1hdGNoLm1vdmllSWQsXHJcbiAgICAgICAgICAgIHRpdGxlOiBtYXRjaC50aXRsZSxcclxuICAgICAgICAgICAgcG9zdGVyUGF0aDogbWF0Y2gucG9zdGVyUGF0aCxcclxuICAgICAgICAgICAgbWF0Y2hlZFVzZXJzOiBtYXRjaC5tYXRjaGVkVXNlcnMsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5qAIEludm9raW5nIE1hdGNoIExhbWJkYSB3aXRoIGNyZWF0ZU1hdGNoIChmYWxsYmFjaykuLi4nKTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBjb21tYW5kID0gbmV3IEludm9rZUNvbW1hbmQoe1xyXG4gICAgICAgICAgRnVuY3Rpb25OYW1lOiB0aGlzLm1hdGNoTGFtYmRhQXJuLFxyXG4gICAgICAgICAgSW52b2NhdGlvblR5cGU6ICdSZXF1ZXN0UmVzcG9uc2UnLFxyXG4gICAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQoY29tbWFuZCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHJlc3BvbnNlLlBheWxvYWQpIHtcclxuICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKHJlc3BvbnNlLlBheWxvYWQpKTtcclxuICAgICAgICAgIGlmIChyZXN1bHQuc3RhdHVzQ29kZSA9PT0gMjAwKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCfinIUgRmFsbGJhY2sgY3JlYXRlTWF0Y2ggZXhlY3V0ZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFsbGJhY2sgY3JlYXRlTWF0Y2ggcmV0dXJuZWQgZXJyb3I6JywgcmVzdWx0LmJvZHk/LmVycm9yKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFN0b3JlIG5vdGlmaWNhdGlvbnMgZm9yIHBvbGxpbmcgZmFsbGJhY2tcclxuICAgICAgYXdhaXQgdGhpcy5zdG9yZU1hdGNoTm90aWZpY2F0aW9ucyhtYXRjaCk7XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGluIGZhbGxiYWNrIG1ldGhvZDonLCBlcnJvcik7XHJcbiAgICAgIC8vIFN0b3JlIG5vdGlmaWNhdGlvbnMgZm9yIHBvbGxpbmcgYXMgZmluYWwgZmFsbGJhY2tcclxuICAgICAgYXdhaXQgdGhpcy5zdG9yZU1hdGNoTm90aWZpY2F0aW9ucyhtYXRjaCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHN0b3JlTWF0Y2hOb3RpZmljYXRpb25zKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gU3RvcmUgaW5kaXZpZHVhbCBub3RpZmljYXRpb24gcmVjb3JkcyBmb3IgZWFjaCB1c2VyXHJcbiAgICAgIC8vIFRoaXMgZW5hYmxlcyBwb2xsaW5nLWJhc2VkIG1hdGNoIGRldGVjdGlvbiBhcyBhIGZhbGxiYWNrXHJcbiAgICAgIGNvbnN0IG5vdGlmaWNhdGlvblByb21pc2VzID0gbWF0Y2gubWF0Y2hlZFVzZXJzLm1hcChhc3luYyAodXNlcklkKSA9PiB7XHJcbiAgICAgICAgY29uc3Qgbm90aWZpY2F0aW9uUmVjb3JkID0ge1xyXG4gICAgICAgICAgdXNlcklkLFxyXG4gICAgICAgICAgbWF0Y2hJZDogbWF0Y2guaWQsXHJcbiAgICAgICAgICBvcmlnaW5hbFJvb21JZDogbWF0Y2gucm9vbUlkLCAvLyBTdG9yZSBvcmlnaW5hbCByb29tSWQgc2VwYXJhdGVseVxyXG4gICAgICAgICAgb3JpZ2luYWxNb3ZpZUlkOiBtYXRjaC5tb3ZpZUlkLCAvLyBTdG9yZSBvcmlnaW5hbCBtb3ZpZUlkIHNlcGFyYXRlbHlcclxuICAgICAgICAgIHRpdGxlOiBtYXRjaC50aXRsZSxcclxuICAgICAgICAgIHBvc3RlclBhdGg6IG1hdGNoLnBvc3RlclBhdGgsXHJcbiAgICAgICAgICB0aW1lc3RhbXA6IG1hdGNoLnRpbWVzdGFtcCxcclxuICAgICAgICAgIG5vdGlmaWVkOiBmYWxzZSwgLy8gRmxhZyB0byB0cmFjayBpZiB1c2VyIGhhcyBiZWVuIG5vdGlmaWVkXHJcbiAgICAgICAgICB0dGw6IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKDcgKiAyNCAqIDYwICogNjApLCAvLyA3IGRheXMgVFRMXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgLy8gU3RvcmUgaW4gYSBub3RpZmljYXRpb25zIHRhYmxlICh3ZSdsbCB1c2UgdGhlIG1hdGNoZXMgdGFibGUgd2l0aCBhIHNwZWNpYWwgcGF0dGVybilcclxuICAgICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgICAgSXRlbToge1xyXG4gICAgICAgICAgICByb29tSWQ6IGBOT1RJRklDQVRJT04jJHt1c2VySWR9YCwgLy8gU3BlY2lhbCBwcmVmaXggZm9yIG5vdGlmaWNhdGlvbnNcclxuICAgICAgICAgICAgbW92aWVJZDogRGF0ZS5ub3coKSwgLy8gVXNlIHRpbWVzdGFtcCBhcyBzb3J0IGtleSBmb3IgdW5pcXVlbmVzc1xyXG4gICAgICAgICAgICAuLi5ub3RpZmljYXRpb25SZWNvcmQsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pKTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYE5vdGlmaWNhdGlvbiBzdG9yZWQgZm9yIHVzZXIgJHt1c2VySWR9YCk7XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKG5vdGlmaWNhdGlvblByb21pc2VzKTtcclxuICAgICAgY29uc29sZS5sb2coJ+KchSBNYXRjaCBub3RpZmljYXRpb25zIHN0b3JlZCBmb3IgcG9sbGluZyBmYWxsYmFjaycpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igc3RvcmluZyBtYXRjaCBub3RpZmljYXRpb25zOicsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgbm90aWZ5TWF0Y2hDcmVhdGVkKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgICBvcGVyYXRpb246ICdtYXRjaENyZWF0ZWQnLFxyXG4gICAgICAgIG1hdGNoLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcclxuICAgICAgICBGdW5jdGlvbk5hbWU6IHRoaXMubWF0Y2hMYW1iZGFBcm4sXHJcbiAgICAgICAgSW52b2NhdGlvblR5cGU6ICdFdmVudCcsIC8vIEFzeW5jIGludm9jYXRpb25cclxuICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChjb21tYW5kKTtcclxuICAgICAgY29uc29sZS5sb2coJ01hdGNoIG5vdGlmaWNhdGlvbiBzZW50IHRvIE1hdGNoIExhbWJkYScpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIG5vdGlmeSBNYXRjaCBMYW1iZGE6JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbi8vIExhbWJkYSBIYW5kbGVyXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyPFZvdGVFdmVudCwgVm90ZVJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdWb3RlIExhbWJkYSByZWNlaXZlZCBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCkpO1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgeyB1c2VySWQsIGlucHV0IH0gPSBldmVudDtcclxuICAgIGNvbnN0IHsgcm9vbUlkLCBtb3ZpZUlkLCB2b3RlIH0gPSBpbnB1dDtcclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFyb29tSWQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHR5cGVvZiBtb3ZpZUlkICE9PSAnbnVtYmVyJykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ01vdmllIElEIG11c3QgYmUgYSBudW1iZXInKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodHlwZW9mIHZvdGUgIT09ICdib29sZWFuJykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1ZvdGUgbXVzdCBiZSBhIGJvb2xlYW4nKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCB2b3RlU2VydmljZSA9IG5ldyBWb3RlU2VydmljZSgpO1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdm90ZVNlcnZpY2UucHJvY2Vzc1ZvdGUodXNlcklkLCByb29tSWQsIG1vdmllSWQsIHZvdGUpO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgYm9keTogcmVzdWx0LFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1ZvdGUgTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCc7XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgYm9keToge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvck1lc3NhZ2UsXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG4gIH1cclxufTsiXX0=