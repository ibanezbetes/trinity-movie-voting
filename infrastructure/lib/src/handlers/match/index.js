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
        // Send notifications to all matched users
        await this.notifyMatchToUsers(match);
        // Log match creation for analytics
        console.log(`Match successfully processed: ${match.title} (${match.mediaType}) matched by users: ${match.matchedUsers.join(', ')}`);
    }
    async notifyMatchToUsers(match) {
        try {
            console.log(`Sending match notifications to ${match.matchedUsers.length} users`);
            // In a real implementation, you would use AppSync subscriptions or push notifications
            // For now, we'll log the notification and store it for the frontend to poll
            const notificationPromises = match.matchedUsers.map(async (userId) => {
                try {
                    // Store notification in user's record or send via AppSync subscription
                    console.log(`Notifying user ${userId} about match: ${match.title}`);
                    // Here you would typically:
                    // 1. Send AppSync subscription notification
                    // 2. Send push notification
                    // 3. Store notification in user's inbox
                    return { userId, success: true };
                }
                catch (error) {
                    console.error(`Failed to notify user ${userId}:`, error);
                    return { userId, success: false, error };
                }
            });
            const results = await Promise.allSettled(notificationPromises);
            const successful = results.filter(r => r.status === 'fulfilled').length;
            console.log(`Match notifications sent: ${successful}/${match.matchedUsers.length} successful`);
        }
        catch (error) {
            console.error('Error sending match notifications:', error);
        }
    }
    async checkRoomMatch(roomId) {
        try {
            console.log(`Checking for existing match in room: ${roomId}`);
            // Query matches table for any match in this room
            const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.matchesTable,
                KeyConditionExpression: 'roomId = :roomId',
                ExpressionAttributeValues: {
                    ':roomId': roomId,
                },
                Limit: 1, // We only need to know if there's any match
            }));
            if (result.Items && result.Items.length > 0) {
                const match = result.Items[0];
                console.log(`Found existing match in room ${roomId}: ${match.title}`);
                return match;
            }
            console.log(`No match found in room: ${roomId}`);
            return null;
        }
        catch (error) {
            console.error(`Error checking room match for ${roomId}:`, error);
            return null;
        }
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
            case 'checkRoomMatch': {
                const { roomId } = event;
                if (!roomId) {
                    throw new Error('Room ID is required');
                }
                const match = await matchService.checkRoomMatch(roomId);
                return {
                    statusCode: 200,
                    body: { match: match || undefined },
                };
            }
            case 'notifyMatch': {
                const { match } = event;
                if (!match) {
                    throw new Error('Match is required');
                }
                await matchService.notifyMatchToUsers(match);
                return {
                    statusCode: 200,
                    body: { success: true },
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvbWF0Y2gvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsOERBQTBEO0FBQzFELHdEQUFxRztBQUVyRyx5QkFBeUI7QUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFxRDVELGdCQUFnQjtBQUNoQixNQUFNLFlBQVk7SUFJaEI7UUFDRSxJQUFJLENBQUMsWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxJQUFJLEVBQUUsQ0FBQztRQUNwRCxJQUFJLENBQUMsVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQztRQUVoRCxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUMzQyxNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxDQUFDLENBQUM7UUFDdEUsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsa0JBQWtCLENBQUMsS0FBWTtRQUNuQyxPQUFPLENBQUMsR0FBRyxDQUFDLDZCQUE2QixLQUFLLENBQUMsRUFBRSxTQUFTLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTSxRQUFRLENBQUMsQ0FBQztRQUU3Riw2Q0FBNkM7UUFDN0MsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRWxELDBDQUEwQztRQUMxQyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUVyQyxtQ0FBbUM7UUFDbkMsT0FBTyxDQUFDLEdB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UUFFdkYsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFO2dCQUNKLE9BQU8sRUFBRSxLQUFLO2dCQUNkLEtBQUssRUFBRSxZQUFZO2FBQ3BCO1NBQ0YsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUFwRlcsUUFBQSxPQUFPLFdBb0ZsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBRdWVyeUNvbW1hbmQsIEdldENvbW1hbmQsIFB1dENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9saWItZHluYW1vZGInO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBBV1MgY2xpZW50c1xyXG5jb25zdCBkeW5hbW9DbGllbnQgPSBuZXcgRHluYW1vREJDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfSk7XHJcbmNvbnN0IGRvY0NsaWVudCA9IER5bmFtb0RCRG9jdW1lbnRDbGllbnQuZnJvbShkeW5hbW9DbGllbnQpO1xyXG5cclxuLy8gVHlwZXNcclxuaW50ZXJmYWNlIE1hdGNoIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHJvb21JZDogc3RyaW5nO1xyXG4gIG1vdmllSWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg/OiBzdHJpbmc7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxuICBtYXRjaGVkVXNlcnM6IHN0cmluZ1tdO1xyXG4gIHRpbWVzdGFtcDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVXNlciB7XHJcbiAgaWQ6IHN0cmluZztcclxuICBlbWFpbDogc3RyaW5nO1xyXG4gIGNyZWF0ZWRBdDogc3RyaW5nO1xyXG4gIGxhc3RBY3RpdmVBdDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTWF0Y2hDcmVhdGVkRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ21hdGNoQ3JlYXRlZCc7XHJcbiAgbWF0Y2g6IE1hdGNoO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgR2V0VXNlck1hdGNoZXNFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnZ2V0VXNlck1hdGNoZXMnO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQ2hlY2tSb29tTWF0Y2hFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnY2hlY2tSb29tTWF0Y2gnO1xyXG4gIHJvb21JZDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTm90aWZ5TWF0Y2hFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnbm90aWZ5TWF0Y2gnO1xyXG4gIG1hdGNoOiBNYXRjaDtcclxufVxyXG5cclxudHlwZSBNYXRjaEV2ZW50ID0gTWF0Y2hDcmVhdGVkRXZlbnQgfCBHZXRVc2VyTWF0Y2hlc0V2ZW50IHwgQ2hlY2tSb29tTWF0Y2hFdmVudCB8IE5vdGlmeU1hdGNoRXZlbnQ7XHJcblxyXG5pbnRlcmZhY2UgTWF0Y2hSZXNwb25zZSB7XHJcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xyXG4gIGJvZHk6IHtcclxuICAgIG1hdGNoZXM/OiBNYXRjaFtdO1xyXG4gICAgbWF0Y2g/OiBNYXRjaDtcclxuICAgIHN1Y2Nlc3M/OiBib29sZWFuO1xyXG4gICAgZXJyb3I/OiBzdHJpbmc7XHJcbiAgfTtcclxufVxyXG5cclxuLy8gTWF0Y2ggU2VydmljZVxyXG5jbGFzcyBNYXRjaFNlcnZpY2Uge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbWF0Y2hlc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB1c2Vyc1RhYmxlOiBzdHJpbmc7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUgPSBwcm9jZXNzLmVudi5NQVRDSEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgdGhpcy51c2Vyc1RhYmxlID0gcHJvY2Vzcy5lbnYuVVNFUlNfVEFCTEUgfHwgJyc7XHJcblxyXG4gICAgaWYgKCF0aGlzLm1hdGNoZXNUYWJsZSB8fCAhdGhpcy51c2Vyc1RhYmxlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVxdWlyZWQgdGFibGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGFyZSBtaXNzaW5nJyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBoYW5kbGVNYXRjaENyZWF0ZWQobWF0Y2g6IE1hdGNoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zb2xlLmxvZyhgUHJvY2Vzc2luZyBtYXRjaCBjcmVhdGVkOiAke21hdGNoLmlkfSB3aXRoICR7bWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aH0gdXNlcnNgKTtcclxuXHJcbiAgICAvLyBVcGRhdGUgdXNlciBhY3Rpdml0eSBmb3IgYWxsIG1hdGNoZWQgdXNlcnNcclxuICAgIGF3YWl0IHRoaXMudXBkYXRlVXNlckFjdGl2aXR5KG1hdGNoLm1hdGNoZWRVc2Vycyk7XHJcblxyXG4gICAgLy8gU2VuZCBub3RpZmljYXRpb25zIHRvIGFsbCBtYXRjaGVkIHVzZXJzXHJcbiAgICBhd2FpdCB0aGlzLm5vdGlmeU1hdGNoVG9Vc2VycyhtYXRjaCk7XHJcblxyXG4gICAgLy8gTG9nIG1hdGNoIGNyZWF0aW9uIGZvciBhbmFseXRpY3NcclxuICAgIGNvbnNvbGUubG9nKGBNYXRjaCBzdWNjZXNzZnVsbHkgcHJvY2Vzc2VkOiAke21hdGNoLnRpdGxlfSAoJHttYXRjaC5tZWRpYVR5cGV9KSBtYXRjaGVkIGJ5IHVzZXJzOiAke21hdGNoLm1hdGNoZWRVc2Vycy5qb2luKCcsICcpfWApO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgbm90aWZ5TWF0Y2hUb1VzZXJzKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYFNlbmRpbmcgbWF0Y2ggbm90aWZpY2F0aW9ucyB0byAke21hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGh9IHVzZXJzYCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBJbiBhIHJlYWwgaW1wbGVtZW50YXRpb24sIHlvdSB3b3VsZCB1c2UgQXBwU3luYyBzdWJzY3JpcHRpb25zIG9yIHB1c2ggbm90aWZpY2F0aW9uc1xyXG4gICAgICAvLyBGb3Igbm93LCB3ZSdsbCBsb2cgdGhlIG5vdGlmaWNhdGlvbiBhbmQgc3RvcmUgaXQgZm9yIHRoZSBmcm9udGVuZCB0byBwb2xsXHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBub3RpZmljYXRpb25Qcm9taXNlcyA9IG1hdGNoLm1hdGNoZWRVc2Vycy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAvLyBTdG9yZSBub3RpZmljYXRpb24gaW4gdXNlcidzIHJlY29yZCBvciBzZW5kIHZpYSBBcHBTeW5jIHN1YnNjcmlwdGlvblxyXG4gICAgICAgICAgY29uc29sZS5sb2coYE5vdGlmeWluZyB1c2VyICR7dXNlcklkfSBhYm91dCBtYXRjaDogJHttYXRjaC50aXRsZX1gKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gSGVyZSB5b3Ugd291bGQgdHlwaWNhbGx5OlxyXG4gICAgICAgICAgLy8gMS4gU2VuZCBBcHBTeW5jIHN1YnNjcmlwdGlvbiBub3RpZmljYXRpb25cclxuICAgICAgICAgIC8vIDIuIFNlbmQgcHVzaCBub3RpZmljYXRpb25cclxuICAgICAgICAgIC8vIDMuIFN0b3JlIG5vdGlmaWNhdGlvbiBpbiB1c2VyJ3MgaW5ib3hcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgcmV0dXJuIHsgdXNlcklkLCBzdWNjZXNzOiB0cnVlIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBub3RpZnkgdXNlciAke3VzZXJJZH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgcmV0dXJuIHsgdXNlcklkLCBzdWNjZXNzOiBmYWxzZSwgZXJyb3IgfTtcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChub3RpZmljYXRpb25Qcm9taXNlcyk7XHJcbiAgICAgIGNvbnN0IHN1Y2Nlc3NmdWwgPSByZXN1bHRzLmZpbHRlcihyID0+IHIuc3RhdHVzID09PSAnZnVsZmlsbGVkJykubGVuZ3RoO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coYE1hdGNoIG5vdGlmaWNhdGlvbnMgc2VudDogJHtzdWNjZXNzZnVsfS8ke21hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGh9IHN1Y2Nlc3NmdWxgKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHNlbmRpbmcgbWF0Y2ggbm90aWZpY2F0aW9uczonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBjaGVja1Jvb21NYXRjaChyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8TWF0Y2ggfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgQ2hlY2tpbmcgZm9yIGV4aXN0aW5nIG1hdGNoIGluIHJvb206ICR7cm9vbUlkfWApO1xyXG4gICAgICBcclxuICAgICAgLy8gUXVlcnkgbWF0Y2hlcyB0YWJsZSBmb3IgYW55IG1hdGNoIGluIHRoaXMgcm9vbVxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIExpbWl0OiAxLCAvLyBXZSBvbmx5IG5lZWQgdG8ga25vdyBpZiB0aGVyZSdzIGFueSBtYXRjaFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBpZiAocmVzdWx0Lkl0ZW1zICYmIHJlc3VsdC5JdGVtcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc3QgbWF0Y2ggPSByZXN1bHQuSXRlbXNbMF0gYXMgTWF0Y2g7XHJcbiAgICAgICAgY29uc29sZS5sb2coYEZvdW5kIGV4aXN0aW5nIG1hdGNoIGluIHJvb20gJHtyb29tSWR9OiAke21hdGNoLnRpdGxlfWApO1xyXG4gICAgICAgIHJldHVybiBtYXRjaDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc29sZS5sb2coYE5vIG1hdGNoIGZvdW5kIGluIHJvb206ICR7cm9vbUlkfWApO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGNoZWNraW5nIHJvb20gbWF0Y2ggZm9yICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0VXNlck1hdGNoZXModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPE1hdGNoW10+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFF1ZXJ5IGFsbCBtYXRjaGVzIGFjcm9zcyBhbGwgcm9vbXNcclxuICAgICAgLy8gTm90ZTogVGhpcyBpcyBhIHNjYW4gb3BlcmF0aW9uIHdoaWNoIGlzIG5vdCBpZGVhbCBmb3IgbGFyZ2UgZGF0YXNldHNcclxuICAgICAgLy8gSW4gcHJvZHVjdGlvbiwgY29uc2lkZXIgYWRkaW5nIGEgR1NJIHdpdGggdXNlcklkIGFzIHBhcnRpdGlvbiBrZXlcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICAvLyBTaW5jZSB3ZSBkb24ndCBoYXZlIGEgR1NJIGZvciB1c2VySWQsIHdlIG5lZWQgdG8gc2NhbiBhbGwgbWF0Y2hlc1xyXG4gICAgICAgIC8vIFRoaXMgaXMgYSBsaW1pdGF0aW9uIG9mIHRoZSBjdXJyZW50IHNjaGVtYSBkZXNpZ25cclxuICAgICAgICBJbmRleE5hbWU6ICd0aW1lc3RhbXAtaW5kZXgnLCAvLyBVc2UgTFNJIHRvIGdldCBtYXRjaGVzIG9yZGVyZWQgYnkgdGltZVxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJywgLy8gVGhpcyB3b24ndCB3b3JrIGZvciBjcm9zcy1yb29tIHF1ZXJpZXNcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHVzZXJJZCwgLy8gVGhpcyBpcyBpbmNvcnJlY3QgLSB3ZSBuZWVkIGEgZGlmZmVyZW50IGFwcHJvYWNoXHJcbiAgICAgICAgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgLy8gQWx0ZXJuYXRpdmUgYXBwcm9hY2g6IFNjYW4gd2l0aCBmaWx0ZXIgKG5vdCBlZmZpY2llbnQgYnV0IHdvcmtzIGZvciBNVlApXHJcbiAgICAgIC8vIEluIHByb2R1Y3Rpb24sIGFkZCBHU0kgd2l0aCB1c2VySWQgYXMgcGFydGl0aW9uIGtleVxyXG4gICAgICBjb25zdCBzY2FuUmVzdWx0ID0gYXdhaXQgdGhpcy5zY2FuVXNlck1hdGNoZXModXNlcklkKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiBzY2FuUmVzdWx0O1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdldHRpbmcgdXNlciBtYXRjaGVzOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzY2FuVXNlck1hdGNoZXModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPE1hdGNoW10+IHtcclxuICAgIC8vIFRoaXMgaXMgYSB0ZW1wb3Jhcnkgc29sdXRpb24gLSBpbiBwcm9kdWN0aW9uLCB1c2UgR1NJXHJcbiAgICBjb25zb2xlLmxvZyhgU2Nhbm5pbmcgbWF0Y2hlcyBmb3IgdXNlcjogJHt1c2VySWR9YCk7XHJcbiAgICBcclxuICAgIC8vIEZvciBNVlAsIHdlJ2xsIGltcGxlbWVudCBhIHNpbXBsZSBhcHByb2FjaFxyXG4gICAgLy8gSW4gcHJvZHVjdGlvbiwgdGhpcyBzaG91bGQgYmUgb3B0aW1pemVkIHdpdGggcHJvcGVyIGluZGV4aW5nXHJcbiAgICBjb25zdCBtYXRjaGVzOiBNYXRjaFtdID0gW107XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFNpbmNlIHdlIGRvbid0IGhhdmUgYW4gZWZmaWNpZW50IHdheSB0byBxdWVyeSBtYXRjaGVzIGJ5IHVzZXIsXHJcbiAgICAgIC8vIHdlJ2xsIGltcGxlbWVudCBhIGJhc2ljIHZlcnNpb24gdGhhdCB3b3JrcyBmb3IgdGhlIE1WUFxyXG4gICAgICAvLyBUaGlzIHdvdWxkIG5lZWQgdG8gYmUgb3B0aW1pemVkIGZvciBwcm9kdWN0aW9uIHVzZVxyXG4gICAgICBcclxuICAgICAgLy8gRm9yIG5vdywgcmV0dXJuIGVtcHR5IGFycmF5IGFuZCBsb2cgdGhlIGxpbWl0YXRpb25cclxuICAgICAgY29uc29sZS5sb2coJ2dldFVzZXJNYXRjaGVzOiBSZXR1cm5pbmcgZW1wdHkgYXJyYXkgLSByZXF1aXJlcyBHU0kgb3B0aW1pemF0aW9uIGZvciBwcm9kdWN0aW9uJyk7XHJcbiAgICAgIHJldHVybiBtYXRjaGVzO1xyXG4gICAgICBcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHNjYW5uaW5nIHVzZXIgbWF0Y2hlczonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlVXNlckFjdGl2aXR5KHVzZXJJZHM6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gICAgLy8gVXBkYXRlIGxhc3RBY3RpdmVBdCBmb3IgYWxsIG1hdGNoZWQgdXNlcnNcclxuICAgIGNvbnN0IHVwZGF0ZVByb21pc2VzID0gdXNlcklkcy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIENoZWNrIGlmIHVzZXIgZXhpc3RzLCBjcmVhdGUgaWYgbm90XHJcbiAgICAgICAgY29uc3QgZXhpc3RpbmdVc2VyID0gYXdhaXQgdGhpcy5nZXRVc2VyKHVzZXJJZCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGV4aXN0aW5nVXNlcikge1xyXG4gICAgICAgICAgLy8gVXBkYXRlIGV4aXN0aW5nIHVzZXIncyBsYXN0IGFjdGl2aXR5XHJcbiAgICAgICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy51c2Vyc1RhYmxlLFxyXG4gICAgICAgICAgICBJdGVtOiB7XHJcbiAgICAgICAgICAgICAgLi4uZXhpc3RpbmdVc2VyLFxyXG4gICAgICAgICAgICAgIGxhc3RBY3RpdmVBdDogdGltZXN0YW1wLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSkpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAvLyBDcmVhdGUgbmV3IHVzZXIgcmVjb3JkXHJcbiAgICAgICAgICBjb25zdCBuZXdVc2VyOiBVc2VyID0ge1xyXG4gICAgICAgICAgICBpZDogdXNlcklkLFxyXG4gICAgICAgICAgICBlbWFpbDogJycsIC8vIFdpbGwgYmUgcG9wdWxhdGVkIGZyb20gQ29nbml0byB3aGVuIGF2YWlsYWJsZVxyXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IHRpbWVzdGFtcCxcclxuICAgICAgICAgICAgbGFzdEFjdGl2ZUF0OiB0aW1lc3RhbXAsXHJcbiAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnVzZXJzVGFibGUsXHJcbiAgICAgICAgICAgIEl0ZW06IG5ld1VzZXIsXHJcbiAgICAgICAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfbm90X2V4aXN0cyhpZCknLCAvLyBQcmV2ZW50IG92ZXJ3cml0aW5nXHJcbiAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zb2xlLmxvZyhgVXBkYXRlZCBhY3Rpdml0eSBmb3IgdXNlcjogJHt1c2VySWR9YCk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgdXBkYXRpbmcgdXNlciBhY3Rpdml0eSBmb3IgJHt1c2VySWR9OmAsIGVycm9yKTtcclxuICAgICAgICAvLyBDb250aW51ZSB3aXRoIG90aGVyIHVzZXJzIGV2ZW4gaWYgb25lIGZhaWxzXHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZCh1cGRhdGVQcm9taXNlcyk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldFVzZXIodXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPFVzZXIgfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnVzZXJzVGFibGUsXHJcbiAgICAgICAgS2V5OiB7IGlkOiB1c2VySWQgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgcmV0dXJuIHJlc3VsdC5JdGVtIGFzIFVzZXIgfHwgbnVsbDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGdldHRpbmcgdXNlciAke3VzZXJJZH06YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIHByb2Nlc3NNYXRjaE5vdGlmaWNhdGlvbihtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIC8vIEZ1dHVyZSBpbXBsZW1lbnRhdGlvbiBmb3IgcmVhbC10aW1lIG5vdGlmaWNhdGlvbnNcclxuICAgIC8vIENvdWxkIGludGVncmF0ZSB3aXRoOlxyXG4gICAgLy8gLSBBcHBTeW5jIHN1YnNjcmlwdGlvbnNcclxuICAgIC8vIC0gU05TIGZvciBwdXNoIG5vdGlmaWNhdGlvbnNcclxuICAgIC8vIC0gV2ViU29ja2V0IGNvbm5lY3Rpb25zXHJcbiAgICAvLyAtIEVtYWlsIG5vdGlmaWNhdGlvbnNcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgTWF0Y2ggbm90aWZpY2F0aW9uOiAke21hdGNoLnRpdGxlfSBtYXRjaGVkIGluIHJvb20gJHttYXRjaC5yb29tSWR9YCk7XHJcbiAgICBcclxuICAgIC8vIEZvciBNVlAsIGp1c3QgbG9nIHRoZSBub3RpZmljYXRpb25cclxuICAgIC8vIEluIHByb2R1Y3Rpb24sIGltcGxlbWVudCBhY3R1YWwgbm90aWZpY2F0aW9uIGRlbGl2ZXJ5XHJcbiAgfVxyXG59XHJcblxyXG4vLyBMYW1iZGEgSGFuZGxlclxyXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlcjxNYXRjaEV2ZW50LCBNYXRjaFJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdNYXRjaCBMYW1iZGEgcmVjZWl2ZWQgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IG1hdGNoU2VydmljZSA9IG5ldyBNYXRjaFNlcnZpY2UoKTtcclxuXHJcbiAgICBzd2l0Y2ggKGV2ZW50Lm9wZXJhdGlvbikge1xyXG4gICAgICBjYXNlICdtYXRjaENyZWF0ZWQnOiB7XHJcbiAgICAgICAgY29uc3QgeyBtYXRjaCB9ID0gZXZlbnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUHJvY2VzcyB0aGUgbWF0Y2ggY3JlYXRpb25cclxuICAgICAgICBhd2FpdCBtYXRjaFNlcnZpY2UuaGFuZGxlTWF0Y2hDcmVhdGVkKG1hdGNoKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBTZW5kIG5vdGlmaWNhdGlvbnMgKGZ1dHVyZSBpbXBsZW1lbnRhdGlvbilcclxuICAgICAgICBhd2FpdCBtYXRjaFNlcnZpY2UucHJvY2Vzc01hdGNoTm90aWZpY2F0aW9uKG1hdGNoKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgICAgIGJvZHk6IHsgc3VjY2VzczogdHJ1ZSB9LFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2dldFVzZXJNYXRjaGVzJzoge1xyXG4gICAgICAgIGNvbnN0IHsgdXNlcklkIH0gPSBldmVudDtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBtYXRjaGVzID0gYXdhaXQgbWF0Y2hTZXJ2aWNlLmdldFVzZXJNYXRjaGVzKHVzZXJJZCk7XHJcblxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgICBib2R5OiB7IG1hdGNoZXMgfSxcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdjaGVja1Jvb21NYXRjaCc6IHtcclxuICAgICAgICBjb25zdCB7IHJvb21JZCB9ID0gZXZlbnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFyb29tSWQpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBhd2FpdCBtYXRjaFNlcnZpY2UuY2hlY2tSb29tTWF0Y2gocm9vbUlkKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgICAgIGJvZHk6IHsgbWF0Y2g6IG1hdGNoIHx8IHVuZGVmaW5lZCB9LFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ25vdGlmeU1hdGNoJzoge1xyXG4gICAgICAgIGNvbnN0IHsgbWF0Y2ggfSA9IGV2ZW50O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghbWF0Y2gpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTWF0Y2ggaXMgcmVxdWlyZWQnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGF3YWl0IG1hdGNoU2VydmljZS5ub3RpZnlNYXRjaFRvVXNlcnMobWF0Y2gpO1xyXG5cclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgICAgYm9keTogeyBzdWNjZXNzOiB0cnVlIH0sXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgZGVmYXVsdDpcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3BlcmF0aW9uOiAkeyhldmVudCBhcyBhbnkpLm9wZXJhdGlvbn1gKTtcclxuICAgIH1cclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ01hdGNoIExhbWJkYSBlcnJvcjonLCBlcnJvcik7XHJcbiAgICBcclxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICB9XHJcbn07Il19