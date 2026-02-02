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
            // Get all votes for this movie in this room
            const votesResult = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.votesTable,
                KeyConditionExpression: 'roomId = :roomId',
                FilterExpression: 'movieId = :movieId AND vote = :vote',
                ExpressionAttributeValues: {
                    ':roomId': roomId,
                    ':movieId': movieId,
                    ':vote': true, // Only positive votes
                },
            }));
            const positiveVotes = votesResult.Items || [];
            console.log(`Found ${positiveVotes.length} positive votes for movie ${movieId} in room ${roomId}`);
            // Get all unique users who have voted in this room
            const allVotesResult = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.votesTable,
                KeyConditionExpression: 'roomId = :roomId',
                ExpressionAttributeValues: {
                    ':roomId': roomId,
                },
            }));
            const allVotes = allVotesResult.Items || [];
            const uniqueUsers = new Set(allVotes.map(vote => vote.userId));
            const totalUsers = uniqueUsers.size;
            console.log(`Total unique users in room: ${totalUsers}`);
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
        // Store match in DynamoDB
        await docClient.send(new lib_dynamodb_1.PutCommand({
            TableName: this.matchesTable,
            Item: match,
            ConditionExpression: 'attribute_not_exists(roomId) AND attribute_not_exists(movieId)', // Prevent duplicates
        }));
        console.log(`Match created: ${matchId} with ${matchedUsers.length} users`);
        // Delete the room since match is found - room is no longer needed
        await this.deleteRoom(roomId);
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
            // Get all votes for this room
            const votesResult = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.votesTable,
                KeyConditionExpression: 'roomId = :roomId',
                ExpressionAttributeValues: {
                    ':roomId': roomId,
                },
            }));
            const votes = votesResult.Items || [];
            // Delete votes in batches
            const deletePromises = votes.map(vote => docClient.send(new lib_dynamodb_1.DeleteCommand({
                TableName: this.votesTable,
                Key: {
                    roomId: vote.roomId,
                    userMovieId: vote.userMovieId,
                },
            })));
            await Promise.allSettled(deletePromises);
            console.log(`Deleted ${votes.length} votes for room ${roomId}`);
        }
        catch (error) {
            console.error(`Error deleting votes for room ${roomId}:`, error);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdm90ZS9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSw4REFBMEQ7QUFDMUQsd0RBQW9IO0FBQ3BILDBEQUFxRTtBQUVyRSx5QkFBeUI7QUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFDNUQsTUFBTSxZQUFZLEdBQUcsSUFBSSw0QkFBWSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQThEMUUsZUFBZTtBQUNmLE1BQU0sV0FBVztJQU1mO1FBQ0UsSUFBSSxDQUFDLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUM7UUFDaEQsSUFBSSxDQUFDLFlBQVksR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsSUFBSSxFQUFFLENBQUM7UUFDcEQsSUFBSSxDQUFDLFVBQVUsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsSUFBSSxFQUFFLENBQUM7UUFDaEQsSUFBSSxDQUFDLGNBQWMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGdCQUFnQixJQUFJLEVBQUUsQ0FBQztRQUV6RCxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDL0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxrREFBa0QsQ0FBQyxDQUFDO1FBQ3RFLENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLFdBQVcsQ0FBQyxNQUFj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QTJCLENBQUMsQ0FBQztRQUMvQyxDQUFDO1FBRUQsSUFBSSxPQUFPLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUM5QixNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixDQUFDLENBQUM7UUFDNUMsQ0FBQztRQUVELE1BQU0sV0FBVyxHQUFHLElBQUksV0FBVyxFQUFFLENBQUM7UUFDdEMsTUFBTSxNQUFNLEdBQUcsTUFBTSxXQUFXLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRTVFLE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLElBQUksRUFBRSxNQUFNO1NBQ2IsQ0FBQztJQUVKLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUUzQyxNQUFNLFlBQVksR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQztRQUV2RixPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixJQUFJLEVBQUU7Z0JBQ0osT0FBTyxFQUFFLEtBQUs7Z0JBQ2QsS0FBSyxFQUFFLFlBQVk7YUFDcEI7U0FDRixDQUFDO0lBQ0osQ0FBQztBQUNILENBQUMsQ0FBQztBQTdDVyxRQUFBLE9BQU8sV0E2Q2xCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSGFuZGxlciB9IGZyb20gJ2F3cy1sYW1iZGEnO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1keW5hbW9kYic7XHJcbmltcG9ydCB7IER5bmFtb0RCRG9jdW1lbnRDbGllbnQsIFB1dENvbW1hbmQsIFF1ZXJ5Q29tbWFuZCwgR2V0Q29tbWFuZCwgRGVsZXRlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XHJcbmltcG9ydCB7IExhbWJkYUNsaWVudCwgSW52b2tlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1sYW1iZGEnO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpO1xyXG5jb25zdCBsYW1iZGFDbGllbnQgPSBuZXcgTGFtYmRhQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5cclxuLy8gVHlwZXNcclxuaW50ZXJmYWNlIFZvdGUge1xyXG4gIHJvb21JZDogc3RyaW5nO1xyXG4gIHVzZXJNb3ZpZUlkOiBzdHJpbmc7IC8vIEZvcm1hdDogXCJ1c2VySWQjbW92aWVJZFwiXHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbiAgbW92aWVJZDogbnVtYmVyO1xyXG4gIHZvdGU6IGJvb2xlYW47XHJcbiAgdGltZXN0YW1wOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNYXRjaCB7XHJcbiAgaWQ6IHN0cmluZztcclxuICByb29tSWQ6IHN0cmluZztcclxuICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBwb3N0ZXJQYXRoPzogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgbWF0Y2hlZFVzZXJzOiBzdHJpbmdbXTtcclxuICB0aW1lc3RhbXA6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIFJvb20ge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgY29kZTogc3RyaW5nO1xyXG4gIGhvc3RJZDogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgZ2VucmVJZHM6IG51bWJlcltdO1xyXG4gIGNhbmRpZGF0ZXM6IE1vdmllQ2FuZGlkYXRlW107XHJcbiAgY3JlYXRlZEF0OiBzdHJpbmc7XHJcbiAgdHRsOiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNb3ZpZUNhbmRpZGF0ZSB7XHJcbiAgaWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIG92ZXJ2aWV3OiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aDogc3RyaW5nIHwgbnVsbDtcclxuICByZWxlYXNlRGF0ZTogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbn1cclxuXHJcbmludGVyZmFjZSBWb3RlRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ3ZvdGUnO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG4gIGlucHV0OiB7XHJcbiAgICByb29tSWQ6IHN0cmluZztcclxuICAgIG1vdmllSWQ6IG51bWJlcjtcclxuICAgIHZvdGU6IGJvb2xlYW47XHJcbiAgfTtcclxufVxyXG5cclxuaW50ZXJmYWNlIFZvdGVSZXNwb25zZSB7XHJcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xyXG4gIGJvZHk6IHtcclxuICAgIHN1Y2Nlc3M6IGJvb2xlYW47XHJcbiAgICBtYXRjaD86IE1hdGNoO1xyXG4gICAgZXJyb3I/OiBzdHJpbmc7XHJcbiAgfTtcclxufVxyXG5cclxuLy8gVm90ZSBTZXJ2aWNlXHJcbmNsYXNzIFZvdGVTZXJ2aWNlIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IHZvdGVzVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IG1hdGNoZXNUYWJsZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgcm9vbXNUYWJsZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbWF0Y2hMYW1iZGFBcm46IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLnZvdGVzVGFibGUgPSBwcm9jZXNzLmVudi5WT1RFU19UQUJMRSB8fCAnJztcclxuICAgIHRoaXMubWF0Y2hlc1RhYmxlID0gcHJvY2Vzcy5lbnYuTUFUQ0hFU19UQUJMRSB8fCAnJztcclxuICAgIHRoaXMucm9vbXNUYWJsZSA9IHByb2Nlc3MuZW52LlJPT01TX1RBQkxFIHx8ICcnO1xyXG4gICAgdGhpcy5tYXRjaExhbWJkYUFybiA9IHByb2Nlc3MuZW52Lk1BVENIX0xBTUJEQV9BUk4gfHwgJyc7XHJcblxyXG4gICAgaWYgKCF0aGlzLnZvdGVzVGFibGUgfHwgIXRoaXMubWF0Y2hlc1RhYmxlIHx8ICF0aGlzLnJvb21zVGFibGUpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZXF1aXJlZCB0YWJsZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgYXJlIG1pc3NpbmcnKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIHByb2Nlc3NWb3RlKHVzZXJJZDogc3RyaW5nLCByb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCB2b3RlOiBib29sZWFuKTogUHJvbWlzZTx7IHN1Y2Nlc3M6IGJvb2xlYW47IG1hdGNoPzogTWF0Y2ggfT4ge1xyXG4gICAgLy8gVmFsaWRhdGUgcm9vbSBleGlzdHMgYW5kIGdldCByb29tIGRldGFpbHNcclxuICAgIGNvbnN0IHJvb20gPSBhd2FpdCB0aGlzLmdldFJvb20ocm9vbUlkKTtcclxuICAgIGlmICghcm9vbSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gbm90IGZvdW5kIG9yIGhhcyBleHBpcmVkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVmFsaWRhdGUgbW92aWUgaXMgaW4gcm9vbSBjYW5kaWRhdGVzXHJcbiAgICBjb25zdCBtb3ZpZUNhbmRpZGF0ZSA9IHJvb20uY2FuZGlkYXRlcy5maW5kKGMgPT4gYy5pZCA9PT0gbW92aWVJZCk7XHJcbiAgICBpZiAoIW1vdmllQ2FuZGlkYXRlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTW92aWUgbm90IGZvdW5kIGluIHJvb20gY2FuZGlkYXRlcycpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFJlY29yZCB0aGUgdm90ZVxyXG4gICAgYXdhaXQgdGhpcy5yZWNvcmRWb3RlKHVzZXJJZCwgcm9vbUlkLCBtb3ZpZUlkLCB2b3RlKTtcclxuXHJcbiAgICAvLyBDaGVjayBmb3IgbWF0Y2ggaWYgdm90ZSBpcyBwb3NpdGl2ZVxyXG4gICAgbGV0IG1hdGNoOiBNYXRjaCB8IHVuZGVmaW5lZDtcclxuICAgIGlmICh2b3RlKSB7XHJcbiAgICAgIG1hdGNoID0gYXdhaXQgdGhpcy5jaGVja0Zvck1hdGNoKHJvb21JZCwgbW92aWVJZCwgbW92aWVDYW5kaWRhdGUpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIG1hdGNoIH07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldFJvb20ocm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPFJvb20gfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnJvb21zVGFibGUsXHJcbiAgICAgICAgS2V5OiB7IGlkOiByb29tSWQgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgaWYgKCFyZXN1bHQuSXRlbSkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCByb29tID0gcmVzdWx0Lkl0ZW0gYXMgUm9vbTtcclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIHJvb20gaGFzIGV4cGlyZWRcclxuICAgICAgY29uc3Qgbm93ID0gTWF0aC5mbG9vcihEYXRlLm5vdygpIC8gMTAwMCk7XHJcbiAgICAgIGlmIChyb29tLnR0bCAmJiByb29tLnR0bCA8IG5vdykge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICB9XHJcblxyXG4gICAgICByZXR1cm4gcm9vbTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdldHRpbmcgcm9vbTonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZWNvcmRWb3RlKHVzZXJJZDogc3RyaW5nLCByb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCB2b3RlOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB1c2VyTW92aWVJZCA9IGAke3VzZXJJZH0jJHttb3ZpZUlkfWA7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gICAgY29uc3Qgdm90ZVJlY29yZDogVm90ZSA9IHtcclxuICAgICAgcm9vbUlkLFxyXG4gICAgICB1c2VyTW92aWVJZCxcclxuICAgICAgdXNlcklkLFxyXG4gICAgICBtb3ZpZUlkLFxyXG4gICAgICB2b3RlLFxyXG4gICAgICB0aW1lc3RhbXAsXHJcbiAgICB9O1xyXG5cclxuICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgIEl0ZW06IHZvdGVSZWNvcmQsXHJcbiAgICAgIC8vIEFsbG93IG92ZXJ3cml0aW5nIHByZXZpb3VzIHZvdGVzIGZvciB0aGUgc2FtZSB1c2VyL21vdmllIGNvbWJpbmF0aW9uXHJcbiAgICB9KSk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYFZvdGUgcmVjb3JkZWQ6IFVzZXIgJHt1c2VySWR9IHZvdGVkICR7dm90ZSA/ICdZRVMnIDogJ05PJ30gZm9yIG1vdmllICR7bW92aWVJZH0gaW4gcm9vbSAke3Jvb21JZH1gKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgY2hlY2tGb3JNYXRjaChyb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCBtb3ZpZUNhbmRpZGF0ZTogTW92aWVDYW5kaWRhdGUpOiBQcm9taXNlPE1hdGNoIHwgdW5kZWZpbmVkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBHZXQgYWxsIHZvdGVzIGZvciB0aGlzIG1vdmllIGluIHRoaXMgcm9vbVxyXG4gICAgICBjb25zdCB2b3Rlc1Jlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnbW92aWVJZCA9IDptb3ZpZUlkIEFORCB2b3RlID0gOnZvdGUnLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgICAgJzptb3ZpZUlkJzogbW92aWVJZCxcclxuICAgICAgICAgICc6dm90ZSc6IHRydWUsIC8vIE9ubHkgcG9zaXRpdmUgdm90ZXNcclxuICAgICAgICB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBwb3NpdGl2ZVZvdGVzID0gdm90ZXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke3Bvc2l0aXZlVm90ZXMubGVuZ3RofSBwb3NpdGl2ZSB2b3RlcyBmb3IgbW92aWUgJHttb3ZpZUlkfSBpbiByb29tICR7cm9vbUlkfWApO1xyXG5cclxuICAgICAgLy8gR2V0IGFsbCB1bmlxdWUgdXNlcnMgd2hvIGhhdmUgdm90ZWQgaW4gdGhpcyByb29tXHJcbiAgICAgIGNvbnN0IGFsbFZvdGVzUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IGFsbFZvdGVzID0gYWxsVm90ZXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIGNvbnN0IHVuaXF1ZVVzZXJzID0gbmV3IFNldChhbGxWb3Rlcy5tYXAodm90ZSA9PiAodm90ZSBhcyBWb3RlKS51c2VySWQpKTtcclxuICAgICAgY29uc3QgdG90YWxVc2VycyA9IHVuaXF1ZVVzZXJzLnNpemU7XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgVG90YWwgdW5pcXVlIHVzZXJzIGluIHJvb206ICR7dG90YWxVc2Vyc31gKTtcclxuXHJcbiAgICAgIC8vIENoZWNrIGlmIGFsbCB1c2VycyB2b3RlZCBwb3NpdGl2ZWx5IGZvciB0aGlzIG1vdmllXHJcbiAgICAgIGNvbnN0IHBvc2l0aXZlVXNlcklkcyA9IG5ldyBTZXQocG9zaXRpdmVWb3Rlcy5tYXAodm90ZSA9PiAodm90ZSBhcyBWb3RlKS51c2VySWQpKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChwb3NpdGl2ZVVzZXJJZHMuc2l6ZSA9PT0gdG90YWxVc2VycyAmJiB0b3RhbFVzZXJzID4gMSkge1xyXG4gICAgICAgIC8vIFdlIGhhdmUgYSBtYXRjaCEgQWxsIHVzZXJzIHZvdGVkIHBvc2l0aXZlbHlcclxuICAgICAgICBjb25zb2xlLmxvZyhgTUFUQ0ggREVURUNURUQhIEFsbCAke3RvdGFsVXNlcnN9IHVzZXJzIHZvdGVkIHBvc2l0aXZlbHkgZm9yIG1vdmllICR7bW92aWVJZH1gKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDaGVjayBpZiBtYXRjaCBhbHJlYWR5IGV4aXN0c1xyXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nTWF0Y2ggPSBhd2FpdCB0aGlzLmdldEV4aXN0aW5nTWF0Y2gocm9vbUlkLCBtb3ZpZUlkKTtcclxuICAgICAgICBpZiAoZXhpc3RpbmdNYXRjaCkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coJ01hdGNoIGFscmVhZHkgZXhpc3RzLCByZXR1cm5pbmcgZXhpc3RpbmcgbWF0Y2gnKTtcclxuICAgICAgICAgIHJldHVybiBleGlzdGluZ01hdGNoO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gQ3JlYXRlIG5ldyBtYXRjaFxyXG4gICAgICAgIGNvbnN0IG1hdGNoID0gYXdhaXQgdGhpcy5jcmVhdGVNYXRjaChyb29tSWQsIG1vdmllSWQsIG1vdmllQ2FuZGlkYXRlLCBBcnJheS5mcm9tKHBvc2l0aXZlVXNlcklkcykpO1xyXG4gICAgICAgIHJldHVybiBtYXRjaDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc29sZS5sb2coYE5vIG1hdGNoIHlldC4gUG9zaXRpdmUgdm90ZXM6ICR7cG9zaXRpdmVVc2VySWRzLnNpemV9LCBUb3RhbCB1c2VyczogJHt0b3RhbFVzZXJzfWApO1xyXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGNoZWNraW5nIGZvciBtYXRjaDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldEV4aXN0aW5nTWF0Y2gocm9vbUlkOiBzdHJpbmcsIG1vdmllSWQ6IG51bWJlcik6IFByb21pc2U8TWF0Y2ggfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBLZXk6IHtcclxuICAgICAgICAgIHJvb21JZCxcclxuICAgICAgICAgIG1vdmllSWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgcmV0dXJuIHJlc3VsdC5JdGVtIGFzIE1hdGNoIHx8IG51bGw7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBjaGVja2luZyBleGlzdGluZyBtYXRjaDonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBjcmVhdGVNYXRjaChyb29tSWQ6IHN0cmluZywgbW92aWVJZDogbnVtYmVyLCBtb3ZpZUNhbmRpZGF0ZTogTW92aWVDYW5kaWRhdGUsIG1hdGNoZWRVc2Vyczogc3RyaW5nW10pOiBQcm9taXNlPE1hdGNoPiB7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICBjb25zdCBtYXRjaElkID0gYCR7cm9vbUlkfSMke21vdmllSWR9YDtcclxuXHJcbiAgICBjb25zdCBtYXRjaDogTWF0Y2ggPSB7XHJcbiAgICAgIGlkOiBtYXRjaElkLFxyXG4gICAgICByb29tSWQsXHJcbiAgICAgIG1vdmllSWQsXHJcbiAgICAgIHRpdGxlOiBtb3ZpZUNhbmRpZGF0ZS50aXRsZSxcclxuICAgICAgcG9zdGVyUGF0aDogbW92aWVDYW5kaWRhdGUucG9zdGVyUGF0aCB8fCB1bmRlZmluZWQsXHJcbiAgICAgIG1lZGlhVHlwZTogbW92aWVDYW5kaWRhdGUubWVkaWFUeXBlLFxyXG4gICAgICBtYXRjaGVkVXNlcnMsXHJcbiAgICAgIHRpbWVzdGFtcCxcclxuICAgIH07XHJcblxyXG4gICAgLy8gU3RvcmUgbWF0Y2ggaW4gRHluYW1vREJcclxuICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgSXRlbTogbWF0Y2gsXHJcbiAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfbm90X2V4aXN0cyhyb29tSWQpIEFORCBhdHRyaWJ1dGVfbm90X2V4aXN0cyhtb3ZpZUlkKScsIC8vIFByZXZlbnQgZHVwbGljYXRlc1xyXG4gICAgfSkpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBNYXRjaCBjcmVhdGVkOiAke21hdGNoSWR9IHdpdGggJHttYXRjaGVkVXNlcnMubGVuZ3RofSB1c2Vyc2ApO1xyXG5cclxuICAgIC8vIERlbGV0ZSB0aGUgcm9vbSBzaW5jZSBtYXRjaCBpcyBmb3VuZCAtIHJvb20gaXMgbm8gbG9uZ2VyIG5lZWRlZFxyXG4gICAgYXdhaXQgdGhpcy5kZWxldGVSb29tKHJvb21JZCk7XHJcblxyXG4gICAgLy8gT3B0aW9uYWxseSBpbnZva2UgTWF0Y2ggTGFtYmRhIGZvciBub3RpZmljYXRpb25zIChpZiBpbXBsZW1lbnRlZClcclxuICAgIGlmICh0aGlzLm1hdGNoTGFtYmRhQXJuKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5ub3RpZnlNYXRjaENyZWF0ZWQobWF0Y2gpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIG5vdGlmeWluZyBtYXRjaCBjcmVhdGlvbjonLCBlcnJvcik7XHJcbiAgICAgICAgLy8gRG9uJ3QgZmFpbCB0aGUgdm90ZSBpZiBub3RpZmljYXRpb24gZmFpbHNcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBtYXRjaDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZGVsZXRlUm9vbShyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gRGVsZXRlIHRoZSByb29tIGZyb20gRHluYW1vREJcclxuICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IERlbGV0ZUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5yb29tc1RhYmxlLFxyXG4gICAgICAgIEtleTogeyBpZDogcm9vbUlkIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBSb29tICR7cm9vbUlkfSBkZWxldGVkIGFmdGVyIG1hdGNoIGNyZWF0aW9uYCk7XHJcblxyXG4gICAgICAvLyBPcHRpb25hbGx5OiBEZWxldGUgYWxsIHZvdGVzIGZvciB0aGlzIHJvb20gdG8gZnJlZSB1cCBzcGFjZVxyXG4gICAgICBhd2FpdCB0aGlzLmRlbGV0ZVJvb21Wb3Rlcyhyb29tSWQpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZGVsZXRpbmcgcm9vbSAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICAvLyBEb24ndCBmYWlsIHRoZSBtYXRjaCBjcmVhdGlvbiBpZiByb29tIGRlbGV0aW9uIGZhaWxzXHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGRlbGV0ZVJvb21Wb3Rlcyhyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gR2V0IGFsbCB2b3RlcyBmb3IgdGhpcyByb29tXHJcbiAgICAgIGNvbnN0IHZvdGVzUmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnZvdGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IHZvdGVzID0gdm90ZXNSZXN1bHQuSXRlbXMgfHwgW107XHJcbiAgICAgIFxyXG4gICAgICAvLyBEZWxldGUgdm90ZXMgaW4gYmF0Y2hlc1xyXG4gICAgICBjb25zdCBkZWxldGVQcm9taXNlcyA9IHZvdGVzLm1hcCh2b3RlID0+IFxyXG4gICAgICAgIGRvY0NsaWVudC5zZW5kKG5ldyBEZWxldGVDb21tYW5kKHtcclxuICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy52b3Rlc1RhYmxlLFxyXG4gICAgICAgICAgS2V5OiB7XHJcbiAgICAgICAgICAgIHJvb21JZDogdm90ZS5yb29tSWQsXHJcbiAgICAgICAgICAgIHVzZXJNb3ZpZUlkOiB2b3RlLnVzZXJNb3ZpZUlkLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9KSlcclxuICAgICAgKTtcclxuXHJcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChkZWxldGVQcm9taXNlcyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBEZWxldGVkICR7dm90ZXMubGVuZ3RofSB2b3RlcyBmb3Igcm9vbSAke3Jvb21JZH1gKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGRlbGV0aW5nIHZvdGVzIGZvciByb29tICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIG5vdGlmeU1hdGNoQ3JlYXRlZChtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHBheWxvYWQgPSB7XHJcbiAgICAgICAgb3BlcmF0aW9uOiAnbWF0Y2hDcmVhdGVkJyxcclxuICAgICAgICBtYXRjaCxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIGNvbnN0IGNvbW1hbmQgPSBuZXcgSW52b2tlQ29tbWFuZCh7XHJcbiAgICAgICAgRnVuY3Rpb25OYW1lOiB0aGlzLm1hdGNoTGFtYmRhQXJuLFxyXG4gICAgICAgIEludm9jYXRpb25UeXBlOiAnRXZlbnQnLCAvLyBBc3luYyBpbnZvY2F0aW9uXHJcbiAgICAgICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkocGF5bG9hZCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQoY29tbWFuZCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdNYXRjaCBub3RpZmljYXRpb24gc2VudCB0byBNYXRjaCBMYW1iZGEnKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBub3RpZnkgTWF0Y2ggTGFtYmRhOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG4vLyBMYW1iZGEgSGFuZGxlclxyXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlcjxWb3RlRXZlbnQsIFZvdGVSZXNwb25zZT4gPSBhc3luYyAoZXZlbnQpID0+IHtcclxuICBjb25zb2xlLmxvZygnVm90ZSBMYW1iZGEgcmVjZWl2ZWQgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHsgdXNlcklkLCBpbnB1dCB9ID0gZXZlbnQ7XHJcbiAgICBjb25zdCB7IHJvb21JZCwgbW92aWVJZCwgdm90ZSB9ID0gaW5wdXQ7XHJcblxyXG4gICAgLy8gVmFsaWRhdGUgaW5wdXRcclxuICAgIGlmICghdXNlcklkKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVXNlciBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICghcm9vbUlkKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0eXBlb2YgbW92aWVJZCAhPT0gJ251bWJlcicpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNb3ZpZSBJRCBtdXN0IGJlIGEgbnVtYmVyJyk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHR5cGVvZiB2b3RlICE9PSAnYm9vbGVhbicpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdWb3RlIG11c3QgYmUgYSBib29sZWFuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgdm90ZVNlcnZpY2UgPSBuZXcgVm90ZVNlcnZpY2UoKTtcclxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHZvdGVTZXJ2aWNlLnByb2Nlc3NWb3RlKHVzZXJJZCwgcm9vbUlkLCBtb3ZpZUlkLCB2b3RlKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGJvZHk6IHJlc3VsdCxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdWb3RlIExhbWJkYSBlcnJvcjonLCBlcnJvcik7XHJcbiAgICBcclxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICB9XHJcbn07Il19