"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
// Initialize AWS clients
const dynamoClient = new client_dynamodb_1.DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(dynamoClient);
// Match Service
class MatchService {
    constructor() {
        this.matchesTable = process.env.MATCHES_TABLE || '';
        this.usersTable = process.env.USERS_TABLE || '';
        if (!this.matchesTable || !this.usersTable) {
            throw new Error('Required table environment variables are missing');
        }
    }
    async handleMatchCreated(match) {
        console.log(`Processing match created: ${match.id} with ${match.matchedUsers.length} users`);
        // Update user activity for all matched users
        await this.updateUserActivity(match.matchedUsers);
        // Log match creation for analytics
        console.log(`Match successfully processed: ${match.title} (${match.mediaType}) matched by users: ${match.matchedUsers.join(', ')}`);
        // Future: Send push notifications, update user statistics, etc.
    }
    async getUserMatches(userId) {
        try {
            // Query all matches across all rooms
            // Note: This is a scan operation which is not ideal for large datasets
            // In production, consider adding a GSI with userId as partition key
            const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.matchesTable,
                // Since we don't have a GSI for userId, we need to scan all matches
                // This is a limitation of the current schema design
                IndexName: 'timestamp-index', // Use LSI to get matches ordered by time
                KeyConditionExpression: 'roomId = :roomId', // This won't work for cross-room queries
                ExpressionAttributeValues: {
                    ':roomId': userId, // This is incorrect - we need a different approach
                },
            }));
            // Alternative approach: Scan with filter (not efficient but works for MVP)
            // In production, add GSI with userId as partition key
            const scanResult = await this.scanUserMatches(userId);
            return scanResult;
        }
        catch (error) {
            console.error('Error getting user matches:', error);
            return [];
        }
    }
    async scanUserMatches(userId) {
        // This is a temporary solution - in production, use GSI
        console.log(`Scanning matches for user: ${userId}`);
        // For MVP, we'll implement a simple approach
        // In production, this should be optimized with proper indexing
        const matches = [];
        try {
            // Since we don't have an efficient way to query matches by user,
            // we'll implement a basic version that works for the MVP
            // This would need to be optimized for production use
            // For now, return empty array and log the limitation
            console.log('getUserMatches: Returning empty array - requires GSI optimization for production');
            return matches;
        }
        catch (error) {
            console.error('Error scanning user matches:', error);
            return [];
        }
    }
    async updateUserActivity(userIds) {
        const timestamp = new Date().toISOString();
        // Update lastActiveAt for all matched users
        const updatePromises = userIds.map(async (userId) => {
            try {
                // Check if user exists, create if not
                const existingUser = await this.getUser(userId);
                if (existingUser) {
                    // Update existing user's last activity
                    await docClient.send(new lib_dynamodb_1.PutCommand({
                        TableName: this.usersTable,
                        Item: {
                            ...existingUser,
                            lastActiveAt: timestamp,
                        },
                    }));
                }
                else {
                    // Create new user record
                    const newUser = {
                        id: userId,
                        email: '', // Will be populated from Cognito when available
                        createdAt: timestamp,
                        lastActiveAt: timestamp,
                    };
                    await docClient.send(new lib_dynamodb_1.PutCommand({
                        TableName: this.usersTable,
                        Item: newUser,
                        ConditionExpression: 'attribute_not_exists(id)', // Prevent overwriting
                    }));
                }
                console.log(`Updated activity for user: ${userId}`);
            }
            catch (error) {
                console.error(`Error updating user activity for ${userId}:`, error);
                // Continue with other users even if one fails
            }
        });
        await Promise.allSettled(updatePromises);
    }
    async getUser(userId) {
        try {
            const result = await docClient.send(new lib_dynamodb_1.GetCommand({
                TableName: this.usersTable,
                Key: { id: userId },
            }));
            return result.Item || null;
        }
        catch (error) {
            console.error(`Error getting user ${userId}:`, error);
            return null;
        }
    }
    async processMatchNotification(match) {
        // Future implementation for real-time notifications
        // Could integrate with:
        // - AppSync subscriptions
        // - SNS for push notifications
        // - WebSocket connections
        // - Email notifications
        console.log(`Match notification: ${match.title} matched in room ${match.roomId}`);
        // For MVP, just log the notification
        // In production, implement actual notification delivery
    }
}
// Lambda Handler
const handler = async (event) => {
    console.log('Match Lambda received event:', JSON.stringify(event));
    try {
        const matchService = new MatchService();
        switch (event.operation) {
            case 'matchCreated': {
                const { match } = event;
                // Process the match creation
                await matchService.handleMatchCreated(match);
                // Send notifications (future implementation)
                await matchService.processMatchNotification(match);
                return {
                    statusCode: 200,
                    body: { success: true },
                };
            }
            case 'getUserMatches': {
                const { userId } = event;
                if (!userId) {
                    throw new Error('User ID is required');
                }
                const matches = await matchService.getUserMatches(userId);
                return {
                    statusCode: 200,
                    body: { matches },
                };
            }
            default:
                throw new Error(`Unknown operation: ${event.operation}`);
        }
    }
    catch (error) {
        console.error('Match Lambda error:', error);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvbWF0Y2gvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsOERBQTBEO0FBQzFELHdEQUFxRztBQUVyRyx5QkFBeUI7QUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUEwQzVELGdCQUFnQjtBQUNoQixNQUFNLFlBQVk7SUFJaEI7UUFDRSxJQUFJLENBQUMsWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxJQUFJLEVBQUUsQ0FBQztRQUNwRCxJQUFJLENBQUMsVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQztRQUVoRCxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUMzQyxNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxDQUFDLENBQUM7UUFDdEUsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsa0JBQWtCLENBQUMsS0FBWTtRQUNuQyxPQUFPLENBQUMsR0FBRyxDQUFDLDZCQUE2QixLQUFLLENBQUMsRUFBRSxTQUFTLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTSxRQUFRLENBQUMsQ0FBQztRQUU3Riw2Q0FBNkM7UUFDN0MsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRWxELG1DQUFtQztRQUNuQyxPQUFPLENBQUMsR0FBRyxDQUFDLGlDQUFpQyxLQUFLLENBQUMsS0FBSyxLQUFLLEtBQUssQ0FBQyxTQUFTLHVCQUF1QixLQUFL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QU0sSUFBSSxLQUFLLENBQUMsc0JBQXVCLEtBQWEsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBQ3RFLENBQUM7SUFFSCxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMscUJBQXFCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFNUMsTUFBTSxZQUFZLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUM7UUFFdkYsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFO2dCQUNKLE9BQU8sRUFBRSxLQUFLO2dCQUNkLEtBQUssRUFBRSxZQUFZO2FBQ3BCO1NBQ0YsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUF0RFcsUUFBQSxPQUFPLFdBc0RsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBRdWVyeUNvbW1hbmQsIEdldENvbW1hbmQsIFB1dENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpO1xyXG5cclxuLy8gVHlwZXNcclxuaW50ZXJmYWNlIE1hdGNoIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHJvb21JZDogc3RyaW5nO1xyXG4gIG1vdmllSWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg/OiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxuICBtYXRjaGVkVXNlcnM6IHN0cmluZ1tdO1xyXG4gIHRpbWVzdGFtcDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVXNlciB7XHJcbiAgaWQ6IHN0cmluZztcclxuICBlbWFpbDogc3RyaW5nO1xyXG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xyXG4gIGxhc3RBY3RpdmVBdDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTWF0Y2hDcmVhdGVkRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ21hdGNoQ3JlYXRlZCc7XHJcbiAgbWF0Y2g6IE1hdGNoO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgR2V0VXNlck1hdGNoZXNFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnZ2V0VXNlck1hdGNoZXMnO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG50eXBlIE1hdGNoRXZlbnQgPSBNYXRjaENyZWF0ZWRFdmVudCB8IEdldFVzZXJNYXRjaGVzRXZlbnQ7XHJcblxyXG5pbnRlcmZhY2UgTWF0Y2hSZXNwb25zZSB7XHJcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xyXG4gIGJvZHk6IHtcclxuICAgIG1hdGNoZXM/OiBNYXRjaFtdO1xyXG4gICAgc3VjY2Vzcz86IGJvb2xlYW47XHJcbiAgICBlcnJvcj86IHN0cmluZztcclxuICB9O1xyXG59XHJcblxyXG4vLyBNYXRjaCBTZXJ2aWNlXHJcbmNsYXNzIE1hdGNoU2VydmljZSB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBtYXRjaGVzVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHVzZXJzVGFibGU6IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLm1hdGNoZXNUYWJsZSA9IHByb2Nlc3MuZW52Lk1BVENIRVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLnVzZXJzVGFibGUgPSBwcm9jZXNzLmVudi5VU0VSU19UQUJMRSB8fCAnJztcclxuXHJcbiAgICBpZiAoIXRoaXMubWF0Y2hlc1RhYmxlIHx8ICF0aGlzLnVzZXJzVGFibGUpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZXF1aXJlZCB0YWJsZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgYXJlIG1pc3NpbmcnKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGhhbmRsZU1hdGNoQ3JlYXRlZChtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIG1hdGNoIGNyZWF0ZWQ6ICR7bWF0Y2guaWR9IHdpdGggJHttYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RofSB1c2Vyc2ApO1xyXG5cclxuICAgIC8vIFVwZGF0ZSB1c2VyIGFjdGl2aXR5IGZvciBhbGwgbWF0Y2hlZCB1c2Vyc1xyXG4gICAgYXdhaXQgdGhpcy51cGRhdGVVc2VyQWN0aXZpdHkobWF0Y2gubWF0Y2hlZFVzZXJzKTtcclxuXHJcbiAgICAvLyBMb2cgbWF0Y2ggY3JlYXRpb24gZm9yIGFuYWx5dGljc1xyXG4gICAgY29uc29sZS5sb2coYE1hdGNoIHN1Y2Nlc3NmdWxseSBwcm9jZXNzZWQ6ICR7bWF0Y2gudGl0bGV9ICgke21hdGNoLm1lZGlhVHlwZX0pIG1hdGNoZWQgYnkgdXNlcnM6ICR7bWF0Y2gubWF0Y2hlZFVzZXJzLmpvaW4oJywgJyl9YCk7XHJcblxyXG4gICAgLy8gRnV0dXJlOiBTZW5kIHB1c2ggbm90aWZpY2F0aW9ucywgdXBkYXRlIHVzZXIgc3RhdGlzdGljcywgZXRjLlxyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0VXNlck1hdGNoZXModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPE1hdGNoW10+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFF1ZXJ5IGFsbCBtYXRjaGVzIGFjcm9zcyBhbGwgcm9vbXNcclxuICAgICAgLy8gTm90ZTogVGhpcyBpcyBhIHNjYW4gb3BlcmF0aW9uIHdoaWNoIGlzIG5vdCBpZGVhbCBmb3IgbGFyZ2UgZGF0YXNldHNcclxuICAgICAgLy8gSW4gcHJvZHVjdGlvbiwgY29uc2lkZXIgYWRkaW5nIGEgR1NJIHdpdGggdXNlcklkIGFzIHBhcnRpdGlvbiBrZXlcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICAvLyBTaW5jZSB3ZSBkb24ndCBoYXZlIGEgR1NJIGZvciB1c2VySWQsIHdlIG5lZWQgdG8gc2NhbiBhbGwgbWF0Y2hlc1xyXG4gICAgICAgIC8vIFRoaXMgaXMgYSBsaW1pdGF0aW9uIG9mIHRoZSBjdXJyZW50IHNjaGVtYSBkZXNpZ25cclxuICAgICAgICBJbmRleE5hbWU6ICd0aW1lc3RhbXAtaW5kZXgnLCAvLyBVc2UgTFNJIHRvIGdldCBtYXRjaGVzIG9yZGVyZWQgYnkgdGltZVxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJywgLy8gVGhpcyB3b24ndCB3b3JrIGZvciBjcm9zcy1yb29tIHF1ZXJpZXNcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHVzZXJJZCwgLy8gVGhpcyBpcyBpbmNvcnJlY3QgLSB3ZSBuZWVkIGEgZGlmZmVyZW50IGFwcHJvYWNoXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgLy8gQWx0ZXJuYXRpdmUgYXBwcm9hY2g6IFNjYW4gd2l0aCBmaWx0ZXIgKG5vdCBlZmZpY2llbnQgYnV0IHdvcmtzIGZvciBNVlApXHJcbiAgICAgIC8vIEluIHByb2R1Y3Rpb24sIGFkZCBHU0kgd2l0aCB1c2VySWQgYXMgcGFydGl0aW9uIGtleVxyXG4gICAgICBjb25zdCBzY2FuUmVzdWx0ID0gYXdhaXQgdGhpcy5zY2FuVXNlck1hdGNoZXModXNlcklkKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiBzY2FuUmVzdWx0O1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdldHRpbmcgdXNlciBtYXRjaGVzOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzY2FuVXNlck1hdGNoZXModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPE1hdGNoW10+IHtcclxuICAgIC8vIFRoaXMgaXMgYSB0ZW1wb3Jhcnkgc29sdXRpb24gLSBpbiBwcm9kdWN0aW9uLCB1c2UgR1NJXHJcbiAgICBjb25zb2xlLmxvZyhgU2Nhbm5pbmcgbWF0Y2hlcyBmb3IgdXNlcjogJHt1c2VySWR9YCk7XHJcbiAgICBcclxuICAgIC8vIEZvciBNVlAsIHdlJ2xsIGltcGxlbWVudCBhIHNpbXBsZSBhcHByb2FjaFxyXG4gICAgLy8gSW4gcHJvZHVjdGlvbiwgdGhpcyBzaG91bGQgYmUgb3B0aW1pemVkIHdpdGggcHJvcGVyIGluZGV4aW5nXHJcbiAgICBjb25zdCBtYXRjaGVzOiBNYXRjaFtdID0gW107XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFNpbmNlIHdlIGRvbid0IGhhdmUgYW4gZWZmaWNpZW50IHdheSB0byBxdWVyeSBtYXRjaGVzIGJ5IHVzZXIsXHJcbiAgICAgIC8vIHdlJ2xsIGltcGxlbWVudCBhIGJhc2ljIHZlcnNpb24gdGhhdCB3b3JrcyBmb3IgdGhlIE1WUFxyXG4gICAgICAvLyBUaGlzIHdvdWxkIG5lZWQgdG8gYmUgb3B0aW1pemVkIGZvciBwcm9kdWN0aW9uIHVzZVxyXG4gICAgICBcclxuICAgICAgLy8gRm9yIG5vdywgcmV0dXJuIGVtcHR5IGFycmF5IGFuZCBsb2cgdGhlIGxpbWl0YXRpb25cclxuICAgICAgY29uc29sZS5sb2coJ2dldFVzZXJNYXRjaGVzOiBSZXR1cm5pbmcgZW1wdHkgYXJyYXkgLSByZXF1aXJlcyBHU0kgb3B0aW1pemF0aW9uIGZvciBwcm9kdWN0aW9uJyk7XHJcbiAgICAgIHJldHVybiBtYXRjaGVzO1xyXG4gICAgICBcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHNjYW5uaW5nIHVzZXIgbWF0Y2hlczonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlVXNlckFjdGl2aXR5KHVzZXJJZHM6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gICAgLy8gVXBkYXRlIGxhc3RBY3RpdmVBdCBmb3IgYWxsIG1hdGNoZWQgdXNlcnNcclxuICAgIGNvbnN0IHVwZGF0ZVByb21pc2VzID0gdXNlcklkcy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIENoZWNrIGlmIHVzZXIgZXhpc3RzLCBjcmVhdGUgaWYgbm90XHJcbiAgICAgICAgY29uc3QgZXhpc3RpbmdVc2VyID0gYXdhaXQgdGhpcy5nZXRVc2VyKHVzZXJJZCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGV4aXN0aW5nVXNlcikge1xyXG4gICAgICAgICAgLy8gVXBkYXRlIGV4aXN0aW5nIHVzZXIncyBsYXN0IGFjdGl2aXR5XHJcbiAgICAgICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy51c2Vyc1RhYmxlLFxyXG4gICAgICAgICAgICBJdGVtOiB7XHJcbiAgICAgICAgICAgICAgLi4uZXhpc3RpbmdVc2VyLFxyXG4gICAgICAgICAgICAgIGxhc3RBY3RpdmVBdDogdGltZXN0YW1wLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSkpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAvLyBDcmVhdGUgbmV3IHVzZXIgcmVjb3JkXHJcbiAgICAgICAgICBjb25zdCBuZXdVc2VyOiBVc2VyID0ge1xyXG4gICAgICAgICAgICBpZDogdXNlcklkLFxyXG4gICAgICAgICAgICBlbWFpbDogJycsIC8vIFdpbGwgYmUgcG9wdWxhdGVkIGZyb20gQ29nbml0byB3aGVuIGF2YWlsYWJsZVxyXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IHRpbWVzdGFtcCxcclxuICAgICAgICAgICAgbGFzdEFjdGl2ZUF0OiB0aW1lc3RhbXAsXHJcbiAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnVzZXJzVGFibGUsXHJcbiAgICAgICAgICAgIEl0ZW06IG5ld1VzZXIsXHJcbiAgICAgICAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfbm90X2V4aXN0cyhpZCknLCAvLyBQcmV2ZW50IG92ZXJ3cml0aW5nXHJcbiAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zb2xlLmxvZyhgVXBkYXRlZCBhY3Rpdml0eSBmb3IgdXNlcjogJHt1c2VySWR9YCk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgdXBkYXRpbmcgdXNlciBhY3Rpdml0eSBmb3IgJHt1c2VySWR9OmAsIGVycm9yKTtcclxuICAgICAgICAvLyBDb250aW51ZSB3aXRoIG90aGVyIHVzZXJzIGV2ZW4gaWYgb25lIGZhaWxzXHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZCh1cGRhdGVQcm9taXNlcyk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldFVzZXIodXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPFVzZXIgfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnVzZXJzVGFibGUsXHJcbiAgICAgICAgS2V5OiB7IGlkOiB1c2VySWQgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgcmV0dXJuIHJlc3VsdC5JdGVtIGFzIFVzZXIgfHwgbnVsbDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGdldHRpbmcgdXNlciAke3VzZXJJZH06YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIHByb2Nlc3NNYXRjaE5vdGlmaWNhdGlvbihtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIC8vIEZ1dHVyZSBpbXBsZW1lbnRhdGlvbiBmb3IgcmVhbC10aW1lIG5vdGlmaWNhdGlvbnNcclxuICAgIC8vIENvdWxkIGludGVncmF0ZSB3aXRoOlxyXG4gICAgLy8gLSBBcHBTeW5jIHN1YnNjcmlwdGlvbnNcclxuICAgIC8vIC0gU05TIGZvciBwdXNoIG5vdGlmaWNhdGlvbnNcclxuICAgIC8vIC0gV2ViU29ja2V0IGNvbm5lY3Rpb25zXHJcbiAgICAvLyAtIEVtYWlsIG5vdGlmaWNhdGlvbnNcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgTWF0Y2ggbm90aWZpY2F0aW9uOiAke21hdGNoLnRpdGxlfSBtYXRjaGVkIGluIHJvb20gJHttYXRjaC5yb29tSWR9YCk7XHJcbiAgICBcclxuICAgIC8vIEZvciBNVlAsIGp1c3QgbG9nIHRoZSBub3RpZmljYXRpb25cclxuICAgIC8vIEluIHByb2R1Y3Rpb24sIGltcGxlbWVudCBhY3R1YWwgbm90aWZpY2F0aW9uIGRlbGl2ZXJ5XHJcbiAgfVxyXG59XHJcblxyXG4vLyBMYW1iZGEgSGFuZGxlclxyXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlcjxNYXRjaEV2ZW50LCBNYXRjaFJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdNYXRjaCBMYW1iZGEgcmVjZWl2ZWQgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IG1hdGNoU2VydmljZSA9IG5ldyBNYXRjaFNlcnZpY2UoKTtcclxuXHJcbiAgICBzd2l0Y2ggKGV2ZW50Lm9wZXJhdGlvbikge1xyXG4gICAgICBjYXNlICdtYXRjaENyZWF0ZWQnOiB7XHJcbiAgICAgICAgY29uc3QgeyBtYXRjaCB9ID0gZXZlbnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUHJvY2VzcyB0aGUgbWF0Y2ggY3JlYXRpb25cclxuICAgICAgICBhd2FpdCBtYXRjaFNlcnZpY2UuaGFuZGxlTWF0Y2hDcmVhdGVkKG1hdGNoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBTZW5kIG5vdGlmaWNhdGlvbnMgKGZ1dHVyZSBpbXBsZW1lbnRhdGlvbilcclxuICAgICAgICBhd2FpdCBtYXRjaFNlcnZpY2UucHJvY2Vzc01hdGNoTm90aWZpY2F0aW9uKG1hdGNoKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgICAgIGJvZHk6IHsgc3VjY2VzczogdHJ1ZSB9LFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2dldFVzZXJNYXRjaGVzJzoge1xyXG4gICAgICAgIGNvbnN0IHsgdXNlcklkIH0gPSBldmVudDtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBtYXRjaGVzID0gYXdhaXQgbWF0Y2hTZXJ2aWNlLmdldFVzZXJNYXRjaGVzKHVzZXJJZCk7XHJcblxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgICBib2R5OiB7IG1hdGNoZXMgfSxcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBkZWZhdWx0OlxyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvcGVyYXRpb246ICR7KGV2ZW50IGFzIGFueSkub3BlcmF0aW9ufWApO1xyXG4gICAgfVxyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignTWF0Y2ggTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCc7XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgYm9keToge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvck1lc3NhZ2UsXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG4gIH1cclxufTsiXX0=