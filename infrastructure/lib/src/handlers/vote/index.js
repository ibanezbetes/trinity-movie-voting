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
        // Trigger AppSync subscription for all matched users
        await this.triggerMatchSubscriptions(match);
        // Optionally invoke Match Lambda for notifications (if implemented)
        if (this.matchLambdaArn) {
            try {
                await this.notifyMatchCreated(match);
            }
            catch (error) {
                console.error('Error notifying match creation:', error);
                // Don't fail the vote if notification fails
            }
        }
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
    async triggerMatchSubscriptions(match) {
        try {
            console.log(`Triggering match subscriptions for ${match.matchedUsers.length} users`);
            // SIMPLIFIED APPROACH: Execute single createMatch mutation
            // This will trigger AppSync subscription for all connected users
            // The frontend will filter matches based on user involvement
            if (!this.matchLambdaArn) {
                console.warn('MATCH_LAMBDA_ARN not configured, skipping subscription notifications');
                return;
            }
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
            const command = new client_lambda_1.InvokeCommand({
                FunctionName: this.matchLambdaArn,
                InvocationType: 'RequestResponse', // Synchronous invocation
                Payload: JSON.stringify(payload),
            });
            const response = await lambdaClient.send(command);
            if (response.Payload) {
                const result = JSON.parse(new TextDecoder().decode(response.Payload));
                if (result.statusCode === 200) {
                    console.log('✅ Match subscription triggered successfully');
                    console.log(`Notified all connected users about match: ${match.title}`);
                    console.log(`Matched users: ${match.matchedUsers.join(', ')}`);
                }
                else {
                    console.error('Match Lambda returned error:', result.body?.error);
                }
            }
        }
        catch (error) {
            console.error('Error triggering match subscriptions:', error);
            // Don't fail the match creation if subscription fails
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdm90ZS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQW9IO0FBQ3BILDBEQUFxRTtBQUVyRSx5QkFBeUI7QUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDNUQsTUFBTSxZQUFZLEdBQUcsSUFBSSw0QkFBWSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQThEMUUsZUFBZTtBQUNmLE1BQU0sV0FBVztJQU1mO1FBQ0UsSUFBSSxDQUFDLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUM7UUFDaEQsSUFBSSxDQUFDLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsSUFBSSxFQUFFLENBQUM7UUFDcEQsSUFBSSxDQUFDLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUM7UUFDaEQsSUFBSSxDQUFDLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixJQUFJLEVBQUUsQ0FBQztRQUV6RCxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDL0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxrREFBa0QsQ0FBQyxDQUFDO1FBQ3RFLENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFj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RUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFO2dCQUNKLE9BQU8sRUFBRSxLQUFLO2dCQUNkLEtBQUssRUFBRSxZQUFZO2FBQ3BCO1NBQ0YsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUE3Q1csUUFBQSxPQUFPLFdBNkNsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBQdXRDb21tYW5kLCBRdWVyeUNvbW1hbmQsIEdldENvbW1hbmQsIERlbGV0ZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5pbXBvcnQgeyBMYW1iZGFDbGllbnQsIEludm9rZUNvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtbGFtYmRhJztcclxuXHJcbi8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcclxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KTtcclxuY29uc3QgbGFtYmRhQ2xpZW50ID0gbmV3IExhbWJkYUNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuXHJcbi8vIFR5cGVzXHJcbmludGVyZmFjZSBWb3RlIHtcclxuICByb29tSWQ6IHN0cmluZztcclxuICB1c2VyTW92aWVJZDogc3RyaW5nOyAvLyBGb3JtYXQ6IFwidXNlcklkI21vdmllSWRcIlxyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIG1vdmllSWQ6IG51bWJlcjtcclxuICB2b3RlOiBib29sZWFuO1xyXG4gIHRpbWVzdGFtcDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTWF0Y2gge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgbW92aWVJZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aD86IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIG1hdGNoZWRVc2Vyczogc3RyaW5nW107XHJcbiAgdGltZXN0YW1wOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBSb29tIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIGNvZGU6IHN0cmluZztcclxuICBob3N0SWQ6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIGdlbnJlSWRzOiBudW1iZXJbXTtcclxuICBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdO1xyXG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xyXG4gIHR0bDogbnVtYmVyO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTW92aWVDYW5kaWRhdGUge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg6IHN0cmluZyB8IG51bGw7XHJcbiAgcmVsZWFzZURhdGU6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVm90ZUV2ZW50IHtcclxuICBvcGVyYXRpb246ICd2b3RlJztcclxuICB1c2VySWQ6IHN0cmluZztcclxuICBpbnB1dDoge1xyXG4gICAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgICB2b3RlOiBib29sZWFuO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBWb3RlUmVzcG9uc2Uge1xyXG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcclxuICBib2R5OiB7XHJcbiAgICBzdWNjZXNzOiBib29sZWFuO1xyXG4gICAgbWF0Y2g/OiBNYXRjaDtcclxuICAgIGVycm9yPzogc3RyaW5nO1xyXG4gIH07XHJcbn1cclxuXHJcbi8vIFZvdGUgU2VydmljZVxyXG5jbGFzcyBWb3RlU2VydmljZSB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB2b3Rlc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBtYXRjaGVzVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHJvb21zVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IG1hdGNoTGFtYmRhQXJuOiBzdHJpbmc7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy52b3Rlc1RhYmxlID0gcHJvY2Vzcy5lbnYuVk9URVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLm1hdGNoZXNUYWJsZSA9IHByb2Nlc3MuZW52Lk1BVENIRVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLnJvb21zVGFibGUgPSBwcm9jZXNzLmVudi5ST09NU19UQUJMRSB8fCAnJztcclxuICAgIHRoaXMubWF0Y2hMYW1iZGFBcm4gPSBwcm9jZXNzLmVudi5NQVRDSF9MQU1CREFfQVJOIHx8ICcnO1xyXG5cclxuICAgIGlmICghdGhpcy52b3Rlc1RhYmxlIHx8ICF0aGlzLm1hdGNoZXNUYWJsZSB8fCAhdGhpcy5yb29tc1RhYmxlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVxdWlyZWQgdGFibGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGFyZSBtaXNzaW5nJyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBwcm9jZXNzVm90ZSh1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgdm90ZTogYm9vbGVhbik6IFByb21pc2U8eyBzdWNjZXNzOiBib29sZWFuOyBtYXRjaD86IE1hdGNoIH0+IHtcclxuICAgIC8vIFZhbGlkYXRlIHJvb20gZXhpc3RzIGFuZCBnZXQgcm9vbSBkZXRhaWxzXHJcbiAgICBjb25zdCByb29tID0gYXdhaXQgdGhpcy5nZXRSb29tKHJvb21JZCk7XHJcbiAgICBpZiAoIXJvb20pIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIG5vdCBmb3VuZCBvciBoYXMgZXhwaXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFZhbGlkYXRlIG1vdmllIGlzIGluIHJvb20gY2FuZGlkYXRlc1xyXG4gICAgY29uc3QgbW92aWVDYW5kaWRhdGUgPSByb29tLmNhbmRpZGF0ZXMuZmluZChjID0+IGMuaWQgPT09IG1vdmllSWQpO1xyXG4gICAgaWYgKCFtb3ZpZUNhbmRpZGF0ZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ01vdmllIG5vdCBmb3VuZCBpbiByb29tIGNhbmRpZGF0ZXMnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBSZWNvcmQgdGhlIHZvdGVcclxuICAgIGF3YWl0IHRoaXMucmVjb3JkVm90ZSh1c2VySWQsIHJvb21JZCwgbW92aWVJZCwgdm90ZSk7XHJcblxyXG4gICAgLy8gQ2hlY2sgZm9yIG1hdGNoIGlmIHZvdGUgaXMgcG9zaXRpdmVcclxuICAgIGxldCBtYXRjaDogTWF0Y2ggfCB1bmRlZmluZWQ7XHJcbiAgICBpZiAodm90ZSkge1xyXG4gICAgICBtYXRjaCA9IGF3YWl0IHRoaXMuY2hlY2tGb3JNYXRjaChyb29tSWQsIG1vdmllSWQsIG1vdmllQ2FuZGlkYXRlKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBtYXRjaCB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBnZXRSb29tKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTxSb29tIHwgbnVsbD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5yb29tc1RhYmxlLFxyXG4gICAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGlmICghcmVzdWx0Lkl0ZW0pIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3Qgcm9vbSA9IHJlc3VsdC5JdGVtIGFzIFJvb207XHJcblxyXG4gICAgICAvLyBDaGVjayBpZiByb29tIGhhcyBleHBpcmVkXHJcbiAgICAgIGNvbnN0IG5vdyA9IE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApO1xyXG4gICAgICBpZiAocm9vbS50dGwgJiYgcm9vbS50dGwgPCBub3cpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHJvb207XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBnZXR0aW5nIHJvb206JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVjb3JkVm90ZSh1c2VySWQ6IHN0cmluZywgcm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgdm90ZTogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgdXNlck1vdmllSWQgPSBgJHt1c2VySWR9IyR7bW92aWVJZH1gO1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAgIGNvbnN0IHZvdGVSZWNvcmQ6IFZvdGUgPSB7XHJcbiAgICAgIHJvb21JZCxcclxuICAgICAgdXNlck1vdmllSWQsXHJcbiAgICAgIHVzZXJJZCxcclxuICAgICAgbW92aWVJZCxcclxuICAgICAgdm90ZSxcclxuICAgICAgdGltZXN0YW1wLFxyXG4gICAgfTtcclxuXHJcbiAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICBJdGVtOiB2b3RlUmVjb3JkLFxyXG4gICAgICAvLyBBbGxvdyBvdmVyd3JpdGluZyBwcmV2aW91cyB2b3RlcyBmb3IgdGhlIHNhbWUgdXNlci9tb3ZpZSBjb21iaW5hdGlvblxyXG4gICAgfSkpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBWb3RlIHJlY29yZGVkOiBVc2VyICR7dXNlcklkfSB2b3RlZCAke3ZvdGUgPyAnWUVTJyA6ICdOTyd9IGZvciBtb3ZpZSAke21vdmllSWR9IGluIHJvb20gJHtyb29tSWR9YCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGNoZWNrRm9yTWF0Y2gocm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlciwgbW92aWVDYW5kaWRhdGU6IE1vdmllQ2FuZGlkYXRlKTogUHJvbWlzZTxNYXRjaCB8IHVuZGVmaW5lZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gR2V0IGFsbCB2b3RlcyBmb3IgdGhpcyBtb3ZpZSBpbiB0aGlzIHJvb20gKGV4Y2x1ZGluZyBwYXJ0aWNpcGF0aW9uIHJlY29yZHMpXHJcbiAgICAgIGNvbnN0IHZvdGVzUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdtb3ZpZUlkID0gOm1vdmllSWQgQU5EIHZvdGUgPSA6dm90ZSBBTkQgbW92aWVJZCA8PiA6cGFydGljaXBhdGlvbk1hcmtlcicsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgICAnOm1vdmllSWQnOiBtb3ZpZUlkLFxyXG4gICAgICAgICAgJzp2b3RlJzogdHJ1ZSwgLy8gT25seSBwb3NpdGl2ZSB2b3Rlc1xyXG4gICAgICAgICAgJzpwYXJ0aWNpcGF0aW9uTWFya2VyJzogLTEsIC8vIEV4Y2x1ZGUgcGFydGljaXBhdGlvbiByZWNvcmRzXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgcG9zaXRpdmVWb3RlcyA9IHZvdGVzUmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHtwb3NpdGl2ZVZvdGVzLmxlbmd0aH0gcG9zaXRpdmUgdm90ZXMgZm9yIG1vdmllICR7bW92aWVJZH0gaW4gcm9vbSAke3Jvb21JZH1gKTtcclxuXHJcbiAgICAgIC8vIEdldCBhbGwgdW5pcXVlIHVzZXJzIHdobyBoYXZlIHZvdGVkIGluIHRoaXMgcm9vbSAoZXhjbHVkaW5nIHBhcnRpY2lwYXRpb24gcmVjb3JkcylcclxuICAgICAgY29uc3QgYWxsVm90ZXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ21vdmllSWQgPD4gOnBhcnRpY2lwYXRpb25NYXJrZXInLCAvLyBFeGNsdWRlIHBhcnRpY2lwYXRpb24gcmVjb3Jkc1xyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzpwYXJ0aWNpcGF0aW9uTWFya2VyJzogLTEsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgYWxsVm90ZXMgPSBhbGxWb3Rlc1Jlc3VsdC5JdGVtcyB8fCBbXTtcclxuICAgICAgY29uc3QgdW5pcXVlVXNlcnMgPSBuZXcgU2V0KGFsbFZvdGVzLm1hcCh2b3RlID0+ICh2b3RlIGFzIFZvdGUpLnVzZXJJZCkpO1xyXG4gICAgICBjb25zdCB0b3RhbFVzZXJzID0gdW5pcXVlVXNlcnMuc2l6ZTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBUb3RhbCB1bmlxdWUgdXNlcnMgd2hvIGhhdmUgdm90ZWQgaW4gcm9vbTogJHt0b3RhbFVzZXJzfWApO1xyXG5cclxuICAgICAgLy8gQ2hlY2sgaWYgYWxsIHVzZXJzIHZvdGVkIHBvc2l0aXZlbHkgZm9yIHRoaXMgbW92aWVcclxuICAgICAgY29uc3QgcG9zaXRpdmVVc2VySWRzID0gbmV3IFNldChwb3NpdGl2ZVZvdGVzLm1hcCh2b3RlID0+ICh2b3RlIGFzIFZvdGUpLnVzZXJJZCkpO1xyXG4gICAgICBcclxuICAgICAgaWYgKHBvc2l0aXZlVXNlcklkcy5zaXplID09PSB0b3RhbFVzZXJzICYmIHRvdGFsVXNlcnMgPiAxKSB7XHJcbiAgICAgICAgLy8gV2UgaGF2ZSBhIG1hdGNoISBBbGwgdXNlcnMgdm90ZWQgcG9zaXRpdmVseVxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBNQVRDSCBERVRFQ1RFRCEgQWxsICR7dG90YWxVc2Vyc30gdXNlcnMgdm90ZWQgcG9zaXRpdmVseSBmb3IgbW92aWUgJHttb3ZpZUlkfWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENoZWNrIGlmIG1hdGNoIGFscmVhZHkgZXhpc3RzXHJcbiAgICAgICAgY29uc3QgZXhpc3RpbmdNYXRjaCA9IGF3YWl0IHRoaXMuZ2V0RXhpc3RpbmdNYXRjaChyb29tSWQsIG1vdmllSWQpO1xyXG4gICAgICAgIGlmIChleGlzdGluZ01hdGNoKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZygnTWF0Y2ggYWxyZWFkeSBleGlzdHMsIHJldHVybmluZyBleGlzdGluZyBtYXRjaCcpO1xyXG4gICAgICAgICAgcmV0dXJuIGV4aXN0aW5nTWF0Y2g7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBDcmVhdGUgbmV3IG1hdGNoXHJcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBhd2FpdCB0aGlzLmNyZWF0ZU1hdGNoKHJvb21JZCwgbW92aWVJZCwgbW92aWVDYW5kaWRhdGUsIEFycmF5LmZyb20ocG9zaXRpdmVVc2VySWRzKSk7XHJcbiAgICAgICAgcmV0dXJuIG1hdGNoO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgTm8gbWF0Y2ggeWV0LiBQb3NpdGl2ZSB2b3RlczogJHtwb3NpdGl2ZVVzZXJJZHMuc2l6ZX0sIFRvdGFsIHVzZXJzOiAke3RvdGFsVXNlcnN9YCk7XHJcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgY2hlY2tpbmcgZm9yIG1hdGNoOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZ2V0RXhpc3RpbmdNYXRjaChyb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyKTogUHJvbWlzZTxNYXRjaCB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgIEtleToge1xyXG4gICAgICAgICAgcm9vbUlkLFxyXG4gICAgICAgICAgbW92aWVJZCxcclxuICAgICAgICB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICByZXR1cm4gcmVzdWx0Lkl0ZW0gYXMgTWF0Y2ggfHwgbnVsbDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGV4aXN0aW5nIG1hdGNoOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGNyZWF0ZU1hdGNoKHJvb21JZDogc3RyaW5nLCBtb3ZpZUlkOiBudW1iZXIsIG1vdmllQ2FuZGlkYXRlOiBNb3ZpZUNhbmRpZGF0ZSwgbWF0Y2hlZFVzZXJzOiBzdHJpbmdbXSk6IFByb21pc2U8TWF0Y2g+IHtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgIGNvbnN0IG1hdGNoSWQgPSBgJHtyb29tSWR9IyR7bW92aWVJZH1gO1xyXG5cclxuICAgIGNvbnN0IG1hdGNoOiBNYXRjaCA9IHtcclxuICAgICAgaWQ6IG1hdGNoSWQsXHJcbiAgICAgIHJvb21JZCxcclxuICAgICAgbW92aWVJZCxcclxuICAgICAgdGl0bGU6IG1vdmllQ2FuZGlkYXRlLnRpdGxlLFxyXG4gICAgICBwb3N0ZXJQYXRoOiBtb3ZpZUNhbmRpZGF0ZS5wb3N0ZXJQYXRoIHx8IHVuZGVmaW5lZCxcclxuICAgICAgbWVkaWFUeXBlOiBtb3ZpZUNhbmRpZGF0ZS5tZWRpYVR5cGUsXHJcbiAgICAgIG1hdGNoZWRVc2VycyxcclxuICAgICAgdGltZXN0YW1wLFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBTdG9yZSB0aGUgbWFpbiBtYXRjaCByZWNvcmRcclxuICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgSXRlbTogbWF0Y2gsXHJcbiAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfbm90X2V4aXN0cyhyb29tSWQpIEFORCBhdHRyaWJ1dGVfbm90X2V4aXN0cyhtb3ZpZUlkKScsIC8vIFByZXZlbnQgZHVwbGljYXRlc1xyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIENSSVRJQ0FMOiBDcmVhdGUgaW5kaXZpZHVhbCBtYXRjaCByZWNvcmRzIGZvciBlYWNoIHVzZXIgdG8gZW5hYmxlIEdTSSBxdWVyaWVzXHJcbiAgICAvLyBUaGlzIGFsbG93cyBlZmZpY2llbnQgcXVlcnlpbmcgb2YgbWF0Y2hlcyBieSB1c2VySWQgdXNpbmcgdGhlIG5ldyBHU0lcclxuICAgIGNvbnN0IHVzZXJNYXRjaFByb21pc2VzID0gbWF0Y2hlZFVzZXJzLm1hcChhc3luYyAodXNlcklkKSA9PiB7XHJcbiAgICAgIGNvbnN0IHVzZXJNYXRjaCA9IHtcclxuICAgICAgICAuLi5tYXRjaCxcclxuICAgICAgICB1c2VySWQsIC8vIEFkZCB1c2VySWQgZmllbGQgZm9yIEdTSVxyXG4gICAgICAgIGlkOiBgJHt1c2VySWR9IyR7bWF0Y2hJZH1gLCAvLyBVbmlxdWUgSUQgcGVyIHVzZXJcclxuICAgICAgICByb29tSWQ6IGAke3VzZXJJZH0jJHtyb29tSWR9YCwgLy8gQ29tcG9zaXRlIGtleSB0byBhdm9pZCBjb25mbGljdHNcclxuICAgICAgfTtcclxuXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICAgIEl0ZW06IHVzZXJNYXRjaCxcclxuICAgICAgICB9KSk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFVzZXIgbWF0Y2ggcmVjb3JkIGNyZWF0ZWQgZm9yIHVzZXIgJHt1c2VySWR9YCk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgY3JlYXRpbmcgdXNlciBtYXRjaCByZWNvcmQgZm9yICR7dXNlcklkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgLy8gQ29udGludWUgd2l0aCBvdGhlciB1c2VycyBldmVuIGlmIG9uZSBmYWlsc1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBXYWl0IGZvciBhbGwgdXNlciBtYXRjaCByZWNvcmRzIHRvIGJlIGNyZWF0ZWRcclxuICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZCh1c2VyTWF0Y2hQcm9taXNlcyk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYE1hdGNoIGNyZWF0ZWQ6ICR7bWF0Y2hJZH0gd2l0aCAke21hdGNoZWRVc2Vycy5sZW5ndGh9IHVzZXJzIGFuZCBpbmRpdmlkdWFsIHVzZXIgcmVjb3Jkc2ApO1xyXG5cclxuICAgIC8vIERlbGV0ZSB0aGUgcm9vbSBzaW5jZSBtYXRjaCBpcyBmb3VuZCAtIHJvb20gaXMgbm8gbG9uZ2VyIG5lZWRlZFxyXG4gICAgYXdhaXQgdGhpcy5kZWxldGVSb29tKHJvb21JZCk7XHJcblxyXG4gICAgLy8gVHJpZ2dlciBBcHBTeW5jIHN1YnNjcmlwdGlvbiBmb3IgYWxsIG1hdGNoZWQgdXNlcnNcclxuICAgIGF3YWl0IHRoaXMudHJpZ2dlck1hdGNoU3Vic2NyaXB0aW9ucyhtYXRjaCk7XHJcblxyXG4gICAgLy8gT3B0aW9uYWxseSBpbnZva2UgTWF0Y2ggTGFtYmRhIGZvciBub3RpZmljYXRpb25zIChpZiBpbXBsZW1lbnRlZClcclxuICAgIGlmICh0aGlzLm1hdGNoTGFtYmRhQXJuKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5ub3RpZnlNYXRjaENyZWF0ZWQobWF0Y2gpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIG5vdGlmeWluZyBtYXRjaCBjcmVhdGlvbjonLCBlcnJvcik7XHJcbiAgICAgICAgLy8gRG9uJ3QgZmFpbCB0aGUgdm90ZSBpZiBub3RpZmljYXRpb24gZmFpbHNcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBtYXRjaDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZGVsZXRlUm9vbShyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gRGVsZXRlIHRoZSByb29tIGZyb20gRHluYW1vREJcclxuICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IERlbGV0ZUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5yb29tc1RhYmxlLFxyXG4gICAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBSb29tICR7cm9vbUlkfSBkZWxldGVkIGFmdGVyIG1hdGNoIGNyZWF0aW9uYCk7XHJcblxyXG4gICAgICAvLyBPcHRpb25hbGx5OiBEZWxldGUgYWxsIHZvdGVzIGZvciB0aGlzIHJvb20gdG8gZnJlZSB1cCBzcGFjZVxyXG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZVJvb21Wb3Rlcyhyb29tSWQpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZGVsZXRpbmcgcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICAvLyBEb24ndCBmYWlsIHRoZSBtYXRjaCBjcmVhdGlvbiBpZiByb29tIGRlbGV0aW9uIGZhaWxzXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGRlbGV0ZVJvb21Wb3Rlcyhyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gR2V0IGFsbCB2b3RlcyBhbmQgcGFydGljaXBhdGlvbiByZWNvcmRzIGZvciB0aGlzIHJvb21cclxuICAgICAgY29uc3Qgdm90ZXNSZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgYWxsUmVjb3JkcyA9IHZvdGVzUmVzdWx0Lkl0ZW1zIHx8IFtdO1xyXG4gICAgICBcclxuICAgICAgLy8gRGVsZXRlIGFsbCByZWNvcmRzICh2b3RlcyBhbmQgcGFydGljaXBhdGlvbikgaW4gYmF0Y2hlc1xyXG4gICAgICBjb25zdCBkZWxldGVQcm9taXNlcyA9IGFsbFJlY29yZHMubWFwKHJlY29yZCA9PiBcclxuICAgICAgICBkb2NDbGllbnQuc2VuZChuZXcgRGVsZXRlQ29tbWFuZCh7XHJcbiAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMudm90ZXNUYWJsZSxcclxuICAgICAgICAgIEtleToge1xyXG4gICAgICAgICAgICByb29tSWQ6IHJlY29yZC5yb29tSWQsXHJcbiAgICAgICAgICAgIHVzZXJNb3ZpZUlkOiByZWNvcmQudXNlck1vdmllSWQsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0pKVxyXG4gICAgICApO1xyXG5cclxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKGRlbGV0ZVByb21pc2VzKTtcclxuICAgICAgY29uc29sZS5sb2coYERlbGV0ZWQgJHthbGxSZWNvcmRzLmxlbmd0aH0gcmVjb3JkcyAodm90ZXMgYW5kIHBhcnRpY2lwYXRpb24pIGZvciByb29tICR7cm9vbUlkfWApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZGVsZXRpbmcgcmVjb3JkcyBmb3Igcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyB0cmlnZ2VyTWF0Y2hTdWJzY3JpcHRpb25zKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYFRyaWdnZXJpbmcgbWF0Y2ggc3Vic2NyaXB0aW9ucyBmb3IgJHttYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RofSB1c2Vyc2ApO1xyXG4gICAgICBcclxuICAgICAgLy8gU0lNUExJRklFRCBBUFBST0FDSDogRXhlY3V0ZSBzaW5nbGUgY3JlYXRlTWF0Y2ggbXV0YXRpb25cclxuICAgICAgLy8gVGhpcyB3aWxsIHRyaWdnZXIgQXBwU3luYyBzdWJzY3JpcHRpb24gZm9yIGFsbCBjb25uZWN0ZWQgdXNlcnNcclxuICAgICAgLy8gVGhlIGZyb250ZW5kIHdpbGwgZmlsdGVyIG1hdGNoZXMgYmFzZWQgb24gdXNlciBpbnZvbHZlbWVudFxyXG4gICAgICBcclxuICAgICAgaWYgKCF0aGlzLm1hdGNoTGFtYmRhQXJuKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdNQVRDSF9MQU1CREFfQVJOIG5vdCBjb25maWd1cmVkLCBza2lwcGluZyBzdWJzY3JpcHRpb24gbm90aWZpY2F0aW9ucycpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgICBvcGVyYXRpb246ICdjcmVhdGVNYXRjaCcsXHJcbiAgICAgICAgaW5wdXQ6IHtcclxuICAgICAgICAgIHJvb21JZDogbWF0Y2gucm9vbUlkLFxyXG4gICAgICAgICAgbW92aWVJZDogbWF0Y2gubW92aWVJZCxcclxuICAgICAgICAgIHRpdGxlOiBtYXRjaC50aXRsZSxcclxuICAgICAgICAgIHBvc3RlclBhdGg6IG1hdGNoLnBvc3RlclBhdGgsXHJcbiAgICAgICAgICBtYXRjaGVkVXNlcnM6IG1hdGNoLm1hdGNoZWRVc2VycyxcclxuICAgICAgICB9LFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcclxuICAgICAgICBGdW5jdGlvbk5hbWU6IHRoaXMubWF0Y2hMYW1iZGFBcm4sXHJcbiAgICAgICAgSW52b2NhdGlvblR5cGU6ICdSZXF1ZXN0UmVzcG9uc2UnLCAvLyBTeW5jaHJvbm91cyBpbnZvY2F0aW9uXHJcbiAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChjb21tYW5kKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChyZXNwb25zZS5QYXlsb2FkKSB7XHJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUocmVzcG9uc2UuUGF5bG9hZCkpO1xyXG4gICAgICAgIGlmIChyZXN1bHQuc3RhdHVzQ29kZSA9PT0gMjAwKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZygn4pyFIE1hdGNoIHN1YnNjcmlwdGlvbiB0cmlnZ2VyZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgTm90aWZpZWQgYWxsIGNvbm5lY3RlZCB1c2VycyBhYm91dCBtYXRjaDogJHttYXRjaC50aXRsZX1gKTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBNYXRjaGVkIHVzZXJzOiAke21hdGNoLm1hdGNoZWRVc2Vycy5qb2luKCcsICcpfWApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKCdNYXRjaCBMYW1iZGEgcmV0dXJuZWQgZXJyb3I6JywgcmVzdWx0LmJvZHk/LmVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciB0cmlnZ2VyaW5nIG1hdGNoIHN1YnNjcmlwdGlvbnM6JywgZXJyb3IpO1xyXG4gICAgICAvLyBEb24ndCBmYWlsIHRoZSBtYXRjaCBjcmVhdGlvbiBpZiBzdWJzY3JpcHRpb24gZmFpbHNcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgbm90aWZ5TWF0Y2hDcmVhdGVkKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcGF5bG9hZCA9IHtcclxuICAgICAgICBvcGVyYXRpb246ICdtYXRjaENyZWF0ZWQnLFxyXG4gICAgICAgIG1hdGNoLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBJbnZva2VDb21tYW5kKHtcclxuICAgICAgICBGdW5jdGlvbk5hbWU6IHRoaXMubWF0Y2hMYW1iZGFBcm4sXHJcbiAgICAgICAgSW52b2NhdGlvblR5cGU6ICdFdmVudCcsIC8vIEFzeW5jIGludm9jYXRpb25cclxuICAgICAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeShwYXlsb2FkKSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChjb21tYW5kKTtcclxuICAgICAgY29uc29sZS5sb2coJ01hdGNoIG5vdGlmaWNhdGlvbiBzZW50IHRvIE1hdGNoIExhbWJkYScpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRmFpbGVkIHRvIG5vdGlmeSBNYXRjaCBMYW1iZGE6JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbi8vIExhbWJkYSBIYW5kbGVyXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyPFZvdGVFdmVudCwgVm90ZVJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdWb3RlIExhbWJkYSByZWNlaXZlZCBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCkpO1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgeyB1c2VySWQsIGlucHV0IH0gPSBldmVudDtcclxuICAgIGNvbnN0IHsgcm9vbUlkLCBtb3ZpZUlkLCB2b3RlIH0gPSBpbnB1dDtcclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFyb29tSWQpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHR5cGVvZiBtb3ZpZUlkICE9PSAnbnVtYmVyJykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ01vdmllIElEIG11c3QgYmUgYSBudW1iZXInKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodHlwZW9mIHZvdGUgIT09ICdib29sZWFuJykge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1ZvdGUgbXVzdCBiZSBhIGJvb2xlYW4nKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCB2b3RlU2VydmljZSA9IG5ldyBWb3RlU2VydmljZSgpO1xyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdm90ZVNlcnZpY2UucHJvY2Vzc1ZvdGUodXNlcklkLCByb29tSWQsIG1vdmllSWQsIHZvdGUpO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgYm9keTogcmVzdWx0LFxyXG4gICAgfTtcclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1ZvdGUgTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCc7XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgYm9keToge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvck1lc3NhZ2UsXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG4gIH1cclxufTsiXX0=