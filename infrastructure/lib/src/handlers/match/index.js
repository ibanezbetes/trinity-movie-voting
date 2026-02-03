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
            console.log(`Getting matches for user: ${userId}`);
            // Use the new GSI to efficiently query matches by user
            const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.matchesTable,
                IndexName: 'userId-timestamp-index',
                KeyConditionExpression: 'userId = :userId',
                ExpressionAttributeValues: {
                    ':userId': userId,
                },
                ScanIndexForward: false, // Sort by timestamp descending (newest first)
                Limit: 50, // Limit to last 50 matches for performance
            }));
            const matches = (result.Items || []);
            console.log(`Found ${matches.length} matches for user ${userId}`);
            return matches;
        }
        catch (error) {
            console.error('Error getting user matches:', error);
            // Fallback to scan method for backward compatibility
            console.log('Falling back to scan method...');
            return await this.scanUserMatches(userId);
        }
    }
    async checkUserMatches(userId) {
        try {
            console.log(`🔍 Checking for ANY matches for user: ${userId}`);
            // Use the GSI to efficiently query matches by user
            const result = await docClient.send(new lib_dynamodb_1.QueryCommand({
                TableName: this.matchesTable,
                IndexName: 'userId-timestamp-index',
                KeyConditionExpression: 'userId = :userId',
                ExpressionAttributeValues: {
                    ':userId': userId,
                },
                ScanIndexForward: false, // Sort by timestamp descending (newest first)
                Limit: 10, // Limit to last 10 matches for performance
            }));
            const matches = (result.Items || []);
            console.log(`✅ Found ${matches.length} matches for user ${userId}`);
            if (matches.length > 0) {
                console.log(`📋 Recent matches:`, matches.map(m => ({
                    id: m.id,
                    title: m.title,
                    roomId: m.roomId,
                    timestamp: m.timestamp
                })));
            }
            return matches;
        }
        catch (error) {
            console.error('❌ Error checking user matches:', error);
            // Fallback to scan method for backward compatibility
            console.log('🔄 Falling back to scan method...');
            return await this.scanUserMatches(userId);
        }
    }
    async scanUserMatches(userId) {
        console.log(`Scanning matches for user: ${userId} (fallback method)`);
        try {
            // Scan the entire matches table and filter by user
            // This is inefficient but works as a fallback
            const result = await docClient.send(new lib_dynamodb_1.ScanCommand({
                TableName: this.matchesTable,
                FilterExpression: 'contains(matchedUsers, :userId)',
                ExpressionAttributeValues: {
                    ':userId': userId,
                },
                Limit: 50,
            }));
            const matches = (result.Items || []);
            console.log(`Scan found ${matches.length} matches for user ${userId}`);
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
            case 'publishRoomMatch': {
                const { roomId, matchData } = event;
                console.log(`🚀 CRITICAL FIX: Processing publishRoomMatch for room: ${roomId}`);
                console.log(`🎬 Movie: ${matchData.movieTitle}`);
                console.log(`👥 Matched users: ${matchData.matchedUsers.join(', ')}`);
                // CRITICAL FIX: Return the correct roomMatchEvent structure that AppSync expects
                // The AppSync resolver will use this to trigger the roomMatch subscription
                const roomMatchEvent = {
                    roomId: roomId,
                    matchId: matchData.matchId,
                    movieId: String(matchData.movieId), // Convert to string for consistency
                    movieTitle: matchData.movieTitle,
                    posterPath: matchData.posterPath || null,
                    matchedUsers: matchData.matchedUsers,
                    timestamp: new Date().toISOString(),
                    matchDetails: matchData.matchDetails
                };
                console.log('📡 Returning roomMatchEvent for AppSync subscription trigger');
                console.log('✅ AppSync will broadcast this to all roomMatch subscribers');
                console.log(`🔔 All users subscribed to roomMatch(${roomId}) will be notified`);
                // CRITICAL: Return the roomMatchEvent in the body so AppSync resolver can use it
                return {
                    statusCode: 200,
                    body: {
                        success: true,
                        roomMatchEvent: roomMatchEvent,
                        message: 'Room match event prepared for AppSync subscription broadcast'
                    },
                };
            }
            case 'createMatch': {
                const { input } = event;
                // Create the match object
                const timestamp = new Date().toISOString();
                const matchId = `${input.roomId}#${input.movieId}`;
                const match = {
                    id: matchId,
                    roomId: input.roomId,
                    movieId: input.movieId,
                    title: input.title,
                    posterPath: input.posterPath,
                    mediaType: 'MOVIE', // Default, should be passed from input
                    matchedUsers: input.matchedUsers,
                    timestamp,
                };
                console.log(`🎉 CreateMatch mutation executed via AppSync resolver`);
                console.log(`📡 This will automatically trigger AppSync subscriptions`);
                console.log(`🎬 Match: ${match.title}`);
                console.log(`👥 Notifying ${match.matchedUsers.length} users: ${match.matchedUsers.join(', ')}`);
                // CRITICAL: When this resolver returns the match object, AppSync will automatically
                // trigger the onMatchCreated subscription for all connected clients.
                // The subscription is configured in schema.graphql as:
                // onMatchCreated: Match @aws_subscribe(mutations: ["createMatch"])
                // This means any client subscribed to onMatchCreated will receive this match
                // The client-side filtering in subscriptions.ts will ensure each user only
                // processes matches where they are in the matchedUsers array
                console.log('✅ Returning match object to AppSync for subscription broadcast');
                return {
                    statusCode: 200,
                    body: { match },
                };
            }
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
            case 'checkUserMatches': {
                const { userId } = event;
                if (!userId) {
                    throw new Error('User ID is required');
                }
                const matches = await matchService.checkUserMatches(userId);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvbWF0Y2gvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsOERBQTBEO0FBQzFELHdEQUFrSDtBQUVsSCx5QkFBeUI7QUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFzRjVELGdCQUFnQjtBQUNoQixNQUFNLFlBQVk7SUFJaEI7UUFDRSxJQUFJLENBQUMsWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxJQUFJLEVBQUUsQ0FBQztRQUNwRCxJQUFJLENBQUMsVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQztRQUVoRCxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUMzQyxNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxDQUFDLENBQUM7UUFDdEUsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsa0JBQWtCLENBQUMsS0FBWTtRQUNuQyxPQUFPLENBQUMsR0FBRyxDQUFDLDZCQUE2QixLQUFLLENBQUMsRUFBRSxTQUFTLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTSxRQUFRLENBQUMsQ0FBQztRQUU3Riw2Q0FBNkM7UUFDN0MsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRWxELDBDQUEwQztRQUMxQyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUVyQyxtQ0FBbUM7UUFDbkMsT0FBTyxDQUFDLEdB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LENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLHdCQUF3QixDQUFDO1FBRXZGLE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLElBQUksRUFBRTtnQkFDSixPQUFPLEVBQUUsS0FBSztnQkFDZCxLQUFLLEVBQUUsWUFBWTthQUNwQjtTQUNGLENBQUM7SUFDSixDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBL0tXLFFBQUEsT0FBTyxXQStLbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUXVlcnlDb21tYW5kLCBHZXRDb21tYW5kLCBQdXRDb21tYW5kLCBTY2FuQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XHJcblxyXG4vLyBJbml0aWFsaXplIEFXUyBjbGllbnRzXHJcbmNvbnN0IGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGR5bmFtb0NsaWVudCk7XHJcblxyXG4vLyBUeXBlc1xyXG5pbnRlcmZhY2UgTWF0Y2gge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgbW92aWVJZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aD86IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIG1hdGNoZWRVc2Vyczogc3RyaW5nW107XHJcbiAgdGltZXN0YW1wOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBVc2VyIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIGVtYWlsOiBzdHJpbmc7XHJcbiAgY3JlYXRlZEF0OiBzdHJpbmc7XHJcbiAgbGFzdEFjdGl2ZUF0OiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBDcmVhdGVNYXRjaEV2ZW50IHtcclxuICBvcGVyYXRpb246ICdjcmVhdGVNYXRjaCc7XHJcbiAgaW5wdXQ6IHtcclxuICAgIHJvb21JZDogc3RyaW5nO1xyXG4gICAgbW92aWVJZDogbnVtYmVyO1xyXG4gICAgdGl0bGU6IHN0cmluZztcclxuICAgIHBvc3RlclBhdGg/OiBzdHJpbmc7XHJcbiAgICBtYXRjaGVkVXNlcnM6IHN0cmluZ1tdO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBHZXRVc2VyTWF0Y2hlc0V2ZW50IHtcclxuICBvcGVyYXRpb246ICdnZXRVc2VyTWF0Y2hlcyc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBDaGVja1Jvb21NYXRjaEV2ZW50IHtcclxuICBvcGVyYXRpb246ICdjaGVja1Jvb21NYXRjaCc7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBOb3RpZnlNYXRjaEV2ZW50IHtcclxuICBvcGVyYXRpb246ICdub3RpZnlNYXRjaCc7XHJcbiAgbWF0Y2g6IE1hdGNoO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTWF0Y2hDcmVhdGVkRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ21hdGNoQ3JlYXRlZCc7XHJcbiAgbWF0Y2g6IE1hdGNoO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQ2hlY2tVc2VyTWF0Y2hlc0V2ZW50IHtcclxuICBvcGVyYXRpb246ICdjaGVja1VzZXJNYXRjaGVzJztcclxuICB1c2VySWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIFB1Ymxpc2hSb29tTWF0Y2hFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAncHVibGlzaFJvb21NYXRjaCc7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgbWF0Y2hEYXRhOiB7XHJcbiAgICBtYXRjaElkOiBzdHJpbmc7XHJcbiAgICBtb3ZpZUlkOiBzdHJpbmc7XHJcbiAgICBtb3ZpZVRpdGxlOiBzdHJpbmc7XHJcbiAgICBwb3N0ZXJQYXRoPzogc3RyaW5nO1xyXG4gICAgbWF0Y2hlZFVzZXJzOiBzdHJpbmdbXTtcclxuICAgIG1hdGNoRGV0YWlsczoge1xyXG4gICAgICB2b3RlQ291bnQ6IG51bWJlcjtcclxuICAgICAgcmVxdWlyZWRWb3RlczogbnVtYmVyO1xyXG4gICAgICBtYXRjaFR5cGU6IHN0cmluZztcclxuICAgIH07XHJcbiAgfTtcclxufVxyXG5cclxudHlwZSBNYXRjaEV2ZW50ID0gQ3JlYXRlTWF0Y2hFdmVudCB8IE1hdGNoQ3JlYXRlZEV2ZW50IHwgR2V0VXNlck1hdGNoZXNFdmVudCB8IENoZWNrUm9vbU1hdGNoRXZlbnQgfCBDaGVja1VzZXJNYXRjaGVzRXZlbnQgfCBOb3RpZnlNYXRjaEV2ZW50IHwgUHVibGlzaFJvb21NYXRjaEV2ZW50O1xyXG5cclxuaW50ZXJmYWNlIE1hdGNoUmVzcG9uc2Uge1xyXG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcclxuICBib2R5OiB7XHJcbiAgICBtYXRjaGVzPzogTWF0Y2hbXTtcclxuICAgIG1hdGNoPzogTWF0Y2g7XHJcbiAgICBzdWNjZXNzPzogYm9vbGVhbjtcclxuICAgIGVycm9yPzogc3RyaW5nO1xyXG4gIH07XHJcbn1cclxuXHJcbi8vIE1hdGNoIFNlcnZpY2VcclxuY2xhc3MgTWF0Y2hTZXJ2aWNlIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IG1hdGNoZXNUYWJsZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgdXNlcnNUYWJsZTogc3RyaW5nO1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMubWF0Y2hlc1RhYmxlID0gcHJvY2Vzcy5lbnYuTUFUQ0hFU19UQUJMRSB8fCAnJztcclxuICAgIHRoaXMudXNlcnNUYWJsZSA9IHByb2Nlc3MuZW52LlVTRVJTX1RBQkxFIHx8ICcnO1xyXG5cclxuICAgIGlmICghdGhpcy5tYXRjaGVzVGFibGUgfHwgIXRoaXMudXNlcnNUYWJsZSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1JlcXVpcmVkIHRhYmxlIGVudmlyb25tZW50IHZhcmlhYmxlcyBhcmUgbWlzc2luZycpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgaGFuZGxlTWF0Y2hDcmVhdGVkKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc29sZS5sb2coYFByb2Nlc3NpbmcgbWF0Y2ggY3JlYXRlZDogJHttYXRjaC5pZH0gd2l0aCAke21hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGh9IHVzZXJzYCk7XHJcblxyXG4gICAgLy8gVXBkYXRlIHVzZXIgYWN0aXZpdHkgZm9yIGFsbCBtYXRjaGVkIHVzZXJzXHJcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZVVzZXJBY3Rpdml0eShtYXRjaC5tYXRjaGVkVXNlcnMpO1xyXG5cclxuICAgIC8vIFNlbmQgbm90aWZpY2F0aW9ucyB0byBhbGwgbWF0Y2hlZCB1c2Vyc1xyXG4gICAgYXdhaXQgdGhpcy5ub3RpZnlNYXRjaFRvVXNlcnMobWF0Y2gpO1xyXG5cclxuICAgIC8vIExvZyBtYXRjaCBjcmVhdGlvbiBmb3IgYW5hbHl0aWNzXHJcbiAgICBjb25zb2xlLmxvZyhgTWF0Y2ggc3VjY2Vzc2Z1bGx5IHByb2Nlc3NlZDogJHttYXRjaC50aXRsZX0gKCR7bWF0Y2gubWVkaWFUeXBlfSkgbWF0Y2hlZCBieSB1c2VyczogJHttYXRjaC5tYXRjaGVkVXNlcnMuam9pbignLCAnKX1gKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIG5vdGlmeU1hdGNoVG9Vc2VycyhtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBTZW5kaW5nIG1hdGNoIG5vdGlmaWNhdGlvbnMgdG8gJHttYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RofSB1c2Vyc2ApO1xyXG4gICAgICBcclxuICAgICAgLy8gSW4gYSByZWFsIGltcGxlbWVudGF0aW9uLCB5b3Ugd291bGQgdXNlIEFwcFN5bmMgc3Vic2NyaXB0aW9ucyBvciBwdXNoIG5vdGlmaWNhdGlvbnNcclxuICAgICAgLy8gRm9yIG5vdywgd2UnbGwgbG9nIHRoZSBub3RpZmljYXRpb24gYW5kIHN0b3JlIGl0IGZvciB0aGUgZnJvbnRlbmQgdG8gcG9sbFxyXG4gICAgICBcclxuICAgICAgY29uc3Qgbm90aWZpY2F0aW9uUHJvbWlzZXMgPSBtYXRjaC5tYXRjaGVkVXNlcnMubWFwKGFzeW5jICh1c2VySWQpID0+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgLy8gU3RvcmUgbm90aWZpY2F0aW9uIGluIHVzZXIncyByZWNvcmQgb3Igc2VuZCB2aWEgQXBwU3luYyBzdWJzY3JpcHRpb25cclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBOb3RpZnlpbmcgdXNlciAke3VzZXJJZH0gYWJvdXQgbWF0Y2g6ICR7bWF0Y2gudGl0bGV9YCk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIEhlcmUgeW91IHdvdWxkIHR5cGljYWxseTpcclxuICAgICAgICAgIC8vIDEuIFNlbmQgQXBwU3luYyBzdWJzY3JpcHRpb24gbm90aWZpY2F0aW9uXHJcbiAgICAgICAgICAvLyAyLiBTZW5kIHB1c2ggbm90aWZpY2F0aW9uXHJcbiAgICAgICAgICAvLyAzLiBTdG9yZSBub3RpZmljYXRpb24gaW4gdXNlcidzIGluYm94XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIHJldHVybiB7IHVzZXJJZCwgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gbm90aWZ5IHVzZXIgJHt1c2VySWR9OmAsIGVycm9yKTtcclxuICAgICAgICAgIHJldHVybiB7IHVzZXJJZCwgc3VjY2VzczogZmFsc2UsIGVycm9yIH07XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQobm90aWZpY2F0aW9uUHJvbWlzZXMpO1xyXG4gICAgICBjb25zdCBzdWNjZXNzZnVsID0gcmVzdWx0cy5maWx0ZXIociA9PiByLnN0YXR1cyA9PT0gJ2Z1bGZpbGxlZCcpLmxlbmd0aDtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGBNYXRjaCBub3RpZmljYXRpb25zIHNlbnQ6ICR7c3VjY2Vzc2Z1bH0vJHttYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RofSBzdWNjZXNzZnVsYCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzZW5kaW5nIG1hdGNoIG5vdGlmaWNhdGlvbnM6JywgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgY2hlY2tSb29tTWF0Y2gocm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPE1hdGNoIHwgbnVsbD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYENoZWNraW5nIGZvciBleGlzdGluZyBtYXRjaCBpbiByb29tOiAke3Jvb21JZH1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFF1ZXJ5IG1hdGNoZXMgdGFibGUgZm9yIGFueSBtYXRjaCBpbiB0aGlzIHJvb21cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBMaW1pdDogMSwgLy8gV2Ugb25seSBuZWVkIHRvIGtub3cgaWYgdGhlcmUncyBhbnkgbWF0Y2hcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgaWYgKHJlc3VsdC5JdGVtcyAmJiByZXN1bHQuSXRlbXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnN0IG1hdGNoID0gcmVzdWx0Lkl0ZW1zWzBdIGFzIE1hdGNoO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCBleGlzdGluZyBtYXRjaCBpbiByb29tICR7cm9vbUlkfTogJHttYXRjaC50aXRsZX1gKTtcclxuICAgICAgICByZXR1cm4gbWF0Y2g7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBObyBtYXRjaCBmb3VuZCBpbiByb29tOiAke3Jvb21JZH1gKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBjaGVja2luZyByb29tIG1hdGNoIGZvciAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGdldFVzZXJNYXRjaGVzKHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxNYXRjaFtdPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgR2V0dGluZyBtYXRjaGVzIGZvciB1c2VyOiAke3VzZXJJZH1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFVzZSB0aGUgbmV3IEdTSSB0byBlZmZpY2llbnRseSBxdWVyeSBtYXRjaGVzIGJ5IHVzZXJcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBJbmRleE5hbWU6ICd1c2VySWQtdGltZXN0YW1wLWluZGV4JyxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAndXNlcklkID0gOnVzZXJJZCcsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBTY2FuSW5kZXhGb3J3YXJkOiBmYWxzZSwgLy8gU29ydCBieSB0aW1lc3RhbXAgZGVzY2VuZGluZyAobmV3ZXN0IGZpcnN0KVxyXG4gICAgICAgIExpbWl0OiA1MCwgLy8gTGltaXQgdG8gbGFzdCA1MCBtYXRjaGVzIGZvciBwZXJmb3JtYW5jZVxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBtYXRjaGVzID0gKHJlc3VsdC5JdGVtcyB8fCBbXSkgYXMgTWF0Y2hbXTtcclxuICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7bWF0Y2hlcy5sZW5ndGh9IG1hdGNoZXMgZm9yIHVzZXIgJHt1c2VySWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gbWF0Y2hlcztcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBnZXR0aW5nIHVzZXIgbWF0Y2hlczonLCBlcnJvcik7XHJcbiAgICAgIFxyXG4gICAgICAvLyBGYWxsYmFjayB0byBzY2FuIG1ldGhvZCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxyXG4gICAgICBjb25zb2xlLmxvZygnRmFsbGluZyBiYWNrIHRvIHNjYW4gbWV0aG9kLi4uJyk7XHJcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLnNjYW5Vc2VyTWF0Y2hlcyh1c2VySWQpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgY2hlY2tVc2VyTWF0Y2hlcyh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8TWF0Y2hbXT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYPCflI0gQ2hlY2tpbmcgZm9yIEFOWSBtYXRjaGVzIGZvciB1c2VyOiAke3VzZXJJZH1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFVzZSB0aGUgR1NJIHRvIGVmZmljaWVudGx5IHF1ZXJ5IG1hdGNoZXMgYnkgdXNlclxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgIEluZGV4TmFtZTogJ3VzZXJJZC10aW1lc3RhbXAtaW5kZXgnLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICd1c2VySWQgPSA6dXNlcklkJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIFNjYW5JbmRleEZvcndhcmQ6IGZhbHNlLCAvLyBTb3J0IGJ5IHRpbWVzdGFtcCBkZXNjZW5kaW5nIChuZXdlc3QgZmlyc3QpXHJcbiAgICAgICAgTGltaXQ6IDEwLCAvLyBMaW1pdCB0byBsYXN0IDEwIG1hdGNoZXMgZm9yIHBlcmZvcm1hbmNlXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSAocmVzdWx0Lkl0ZW1zIHx8IFtdKSBhcyBNYXRjaFtdO1xyXG4gICAgICBjb25zb2xlLmxvZyhg4pyFIEZvdW5kICR7bWF0Y2hlcy5sZW5ndGh9IG1hdGNoZXMgZm9yIHVzZXIgJHt1c2VySWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAobWF0Y2hlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4sgUmVjZW50IG1hdGNoZXM6YCwgbWF0Y2hlcy5tYXAobSA9PiAoe1xyXG4gICAgICAgICAgaWQ6IG0uaWQsXHJcbiAgICAgICAgICB0aXRsZTogbS50aXRsZSxcclxuICAgICAgICAgIHJvb21JZDogbS5yb29tSWQsXHJcbiAgICAgICAgICB0aW1lc3RhbXA6IG0udGltZXN0YW1wXHJcbiAgICAgICAgfSkpKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgcmV0dXJuIG1hdGNoZXM7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGNoZWNraW5nIHVzZXIgbWF0Y2hlczonLCBlcnJvcik7XHJcbiAgICAgIFxyXG4gICAgICAvLyBGYWxsYmFjayB0byBzY2FuIG1ldGhvZCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxyXG4gICAgICBjb25zb2xlLmxvZygn8J+UhCBGYWxsaW5nIGJhY2sgdG8gc2NhbiBtZXRob2QuLi4nKTtcclxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuc2NhblVzZXJNYXRjaGVzKHVzZXJJZCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHNjYW5Vc2VyTWF0Y2hlcyh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8TWF0Y2hbXT4ge1xyXG4gICAgY29uc29sZS5sb2coYFNjYW5uaW5nIG1hdGNoZXMgZm9yIHVzZXI6ICR7dXNlcklkfSAoZmFsbGJhY2sgbWV0aG9kKWApO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBTY2FuIHRoZSBlbnRpcmUgbWF0Y2hlcyB0YWJsZSBhbmQgZmlsdGVyIGJ5IHVzZXJcclxuICAgICAgLy8gVGhpcyBpcyBpbmVmZmljaWVudCBidXQgd29ya3MgYXMgYSBmYWxsYmFja1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgU2NhbkNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ2NvbnRhaW5zKG1hdGNoZWRVc2VycywgOnVzZXJJZCknLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6dXNlcklkJzogdXNlcklkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgTGltaXQ6IDUwLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBtYXRjaGVzID0gKHJlc3VsdC5JdGVtcyB8fCBbXSkgYXMgTWF0Y2hbXTtcclxuICAgICAgY29uc29sZS5sb2coYFNjYW4gZm91bmQgJHttYXRjaGVzLmxlbmd0aH0gbWF0Y2hlcyBmb3IgdXNlciAke3VzZXJJZH1gKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiBtYXRjaGVzO1xyXG4gICAgICBcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHNjYW5uaW5nIHVzZXIgbWF0Y2hlczonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlVXNlckFjdGl2aXR5KHVzZXJJZHM6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gICAgLy8gVXBkYXRlIGxhc3RBY3RpdmVBdCBmb3IgYWxsIG1hdGNoZWQgdXNlcnNcclxuICAgIGNvbnN0IHVwZGF0ZVByb21pc2VzID0gdXNlcklkcy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIENoZWNrIGlmIHVzZXIgZXhpc3RzLCBjcmVhdGUgaWYgbm90XHJcbiAgICAgICAgY29uc3QgZXhpc3RpbmdVc2VyID0gYXdhaXQgdGhpcy5nZXRVc2VyKHVzZXJJZCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGV4aXN0aW5nVXNlcikge1xyXG4gICAgICAgICAgLy8gVXBkYXRlIGV4aXN0aW5nIHVzZXIncyBsYXN0IGFjdGl2aXR5XHJcbiAgICAgICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy51c2Vyc1RhYmxlLFxyXG4gICAgICAgICAgICBJdGVtOiB7XHJcbiAgICAgICAgICAgICAgLi4uZXhpc3RpbmdVc2VyLFxyXG4gICAgICAgICAgICAgIGxhc3RBY3RpdmVBdDogdGltZXN0YW1wLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSkpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAvLyBDcmVhdGUgbmV3IHVzZXIgcmVjb3JkXHJcbiAgICAgICAgICBjb25zdCBuZXdVc2VyOiBVc2VyID0ge1xyXG4gICAgICAgICAgICBpZDogdXNlcklkLFxyXG4gICAgICAgICAgICBlbWFpbDogJycsIC8vIFdpbGwgYmUgcG9wdWxhdGVkIGZyb20gQ29nbml0byB3aGVuIGF2YWlsYWJsZVxyXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IHRpbWVzdGFtcCxcclxuICAgICAgICAgICAgbGFzdEFjdGl2ZUF0OiB0aW1lc3RhbXAsXHJcbiAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnVzZXJzVGFibGUsXHJcbiAgICAgICAgICAgIEl0ZW06IG5ld1VzZXIsXHJcbiAgICAgICAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfbm90X2V4aXN0cyhpZCknLCAvLyBQcmV2ZW50IG92ZXJ3cml0aW5nXHJcbiAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zb2xlLmxvZyhgVXBkYXRlZCBhY3Rpdml0eSBmb3IgdXNlcjogJHt1c2VySWR9YCk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgdXBkYXRpbmcgdXNlciBhY3Rpdml0eSBmb3IgJHt1c2VySWR9OmAsIGVycm9yKTtcclxuICAgICAgICAvLyBDb250aW51ZSB3aXRoIG90aGVyIHVzZXJzIGV2ZW4gaWYgb25lIGZhaWxzXHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZCh1cGRhdGVQcm9taXNlcyk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldFVzZXIodXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPFVzZXIgfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnVzZXJzVGFibGUsXHJcbiAgICAgICAgS2V5OiB7IGlkOiB1c2VySWQgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgcmV0dXJuIHJlc3VsdC5JdGVtIGFzIFVzZXIgfHwgbnVsbDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGdldHRpbmcgdXNlciAke3VzZXJJZH06YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIHByb2Nlc3NNYXRjaE5vdGlmaWNhdGlvbihtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIC8vIEZ1dHVyZSBpbXBsZW1lbnRhdGlvbiBmb3IgcmVhbC10aW1lIG5vdGlmaWNhdGlvbnNcclxuICAgIC8vIENvdWxkIGludGVncmF0ZSB3aXRoOlxyXG4gICAgLy8gLSBBcHBTeW5jIHN1YnNjcmlwdGlvbnNcclxuICAgIC8vIC0gU05TIGZvciBwdXNoIG5vdGlmaWNhdGlvbnNcclxuICAgIC8vIC0gV2ViU29ja2V0IGNvbm5lY3Rpb25zXHJcbiAgICAvLyAtIEVtYWlsIG5vdGlmaWNhdGlvbnNcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgTWF0Y2ggbm90aWZpY2F0aW9uOiAke21hdGNoLnRpdGxlfSBtYXRjaGVkIGluIHJvb20gJHttYXRjaC5yb29tSWR9YCk7XHJcbiAgICBcclxuICAgIC8vIEZvciBNVlAsIGp1c3QgbG9nIHRoZSBub3RpZmljYXRpb25cclxuICAgIC8vIEluIHByb2R1Y3Rpb24sIGltcGxlbWVudCBhY3R1YWwgbm90aWZpY2F0aW9uIGRlbGl2ZXJ5XHJcbiAgfVxyXG59XHJcblxyXG4vLyBMYW1iZGEgSGFuZGxlclxyXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlcjxNYXRjaEV2ZW50LCBNYXRjaFJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdNYXRjaCBMYW1iZGEgcmVjZWl2ZWQgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IG1hdGNoU2VydmljZSA9IG5ldyBNYXRjaFNlcnZpY2UoKTtcclxuXHJcbiAgICBzd2l0Y2ggKGV2ZW50Lm9wZXJhdGlvbikge1xyXG4gICAgICBjYXNlICdwdWJsaXNoUm9vbU1hdGNoJzoge1xyXG4gICAgICAgIGNvbnN0IHsgcm9vbUlkLCBtYXRjaERhdGEgfSA9IGV2ZW50O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5qAIENSSVRJQ0FMIEZJWDogUHJvY2Vzc2luZyBwdWJsaXNoUm9vbU1hdGNoIGZvciByb29tOiAke3Jvb21JZH1gKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+OrCBNb3ZpZTogJHttYXRjaERhdGEubW92aWVUaXRsZX1gKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+RpSBNYXRjaGVkIHVzZXJzOiAke21hdGNoRGF0YS5tYXRjaGVkVXNlcnMuam9pbignLCAnKX1gKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDUklUSUNBTCBGSVg6IFJldHVybiB0aGUgY29ycmVjdCByb29tTWF0Y2hFdmVudCBzdHJ1Y3R1cmUgdGhhdCBBcHBTeW5jIGV4cGVjdHNcclxuICAgICAgICAvLyBUaGUgQXBwU3luYyByZXNvbHZlciB3aWxsIHVzZSB0aGlzIHRvIHRyaWdnZXIgdGhlIHJvb21NYXRjaCBzdWJzY3JpcHRpb25cclxuICAgICAgICBcclxuICAgICAgICBjb25zdCByb29tTWF0Y2hFdmVudCA9IHtcclxuICAgICAgICAgIHJvb21JZDogcm9vbUlkLFxyXG4gICAgICAgICAgbWF0Y2hJZDogbWF0Y2hEYXRhLm1hdGNoSWQsXHJcbiAgICAgICAgICBtb3ZpZUlkOiBTdHJpbmcobWF0Y2hEYXRhLm1vdmllSWQpLCAvLyBDb252ZXJ0IHRvIHN0cmluZyBmb3IgY29uc2lzdGVuY3lcclxuICAgICAgICAgIG1vdmllVGl0bGU6IG1hdGNoRGF0YS5tb3ZpZVRpdGxlLFxyXG4gICAgICAgICAgcG9zdGVyUGF0aDogbWF0Y2hEYXRhLnBvc3RlclBhdGggfHwgbnVsbCxcclxuICAgICAgICAgIG1hdGNoZWRVc2VyczogbWF0Y2hEYXRhLm1hdGNoZWRVc2VycyxcclxuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgICAgbWF0Y2hEZXRhaWxzOiBtYXRjaERhdGEubWF0Y2hEZXRhaWxzXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coJ/Cfk6EgUmV0dXJuaW5nIHJvb21NYXRjaEV2ZW50IGZvciBBcHBTeW5jIHN1YnNjcmlwdGlvbiB0cmlnZ2VyJyk7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ+KchSBBcHBTeW5jIHdpbGwgYnJvYWRjYXN0IHRoaXMgdG8gYWxsIHJvb21NYXRjaCBzdWJzY3JpYmVycycpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5SUIEFsbCB1c2VycyBzdWJzY3JpYmVkIHRvIHJvb21NYXRjaCgke3Jvb21JZH0pIHdpbGwgYmUgbm90aWZpZWRgKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDUklUSUNBTDogUmV0dXJuIHRoZSByb29tTWF0Y2hFdmVudCBpbiB0aGUgYm9keSBzbyBBcHBTeW5jIHJlc29sdmVyIGNhbiB1c2UgaXRcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgICAgYm9keTogeyBcclxuICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgcm9vbU1hdGNoRXZlbnQ6IHJvb21NYXRjaEV2ZW50LFxyXG4gICAgICAgICAgICBtZXNzYWdlOiAnUm9vbSBtYXRjaCBldmVudCBwcmVwYXJlZCBmb3IgQXBwU3luYyBzdWJzY3JpcHRpb24gYnJvYWRjYXN0J1xyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdjcmVhdGVNYXRjaCc6IHtcclxuICAgICAgICBjb25zdCB7IGlucHV0IH0gPSBldmVudDtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDcmVhdGUgdGhlIG1hdGNoIG9iamVjdFxyXG4gICAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgICAgICBjb25zdCBtYXRjaElkID0gYCR7aW5wdXQucm9vbUlkfSMke2lucHV0Lm1vdmllSWR9YDtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBtYXRjaDogTWF0Y2ggPSB7XHJcbiAgICAgICAgICBpZDogbWF0Y2hJZCxcclxuICAgICAgICAgIHJvb21JZDogaW5wdXQucm9vbUlkLFxyXG4gICAgICAgICAgbW92aWVJZDogaW5wdXQubW92aWVJZCxcclxuICAgICAgICAgIHRpdGxlOiBpbnB1dC50aXRsZSxcclxuICAgICAgICAgIHBvc3RlclBhdGg6IGlucHV0LnBvc3RlclBhdGgsXHJcbiAgICAgICAgICBtZWRpYVR5cGU6ICdNT1ZJRScsIC8vIERlZmF1bHQsIHNob3VsZCBiZSBwYXNzZWQgZnJvbSBpbnB1dFxyXG4gICAgICAgICAgbWF0Y2hlZFVzZXJzOiBpbnB1dC5tYXRjaGVkVXNlcnMsXHJcbiAgICAgICAgICB0aW1lc3RhbXAsXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfjokgQ3JlYXRlTWF0Y2ggbXV0YXRpb24gZXhlY3V0ZWQgdmlhIEFwcFN5bmMgcmVzb2x2ZXJgKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+ToSBUaGlzIHdpbGwgYXV0b21hdGljYWxseSB0cmlnZ2VyIEFwcFN5bmMgc3Vic2NyaXB0aW9uc2ApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn46sIE1hdGNoOiAke21hdGNoLnRpdGxlfWApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5GlIE5vdGlmeWluZyAke21hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGh9IHVzZXJzOiAke21hdGNoLm1hdGNoZWRVc2Vycy5qb2luKCcsICcpfWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENSSVRJQ0FMOiBXaGVuIHRoaXMgcmVzb2x2ZXIgcmV0dXJucyB0aGUgbWF0Y2ggb2JqZWN0LCBBcHBTeW5jIHdpbGwgYXV0b21hdGljYWxseVxyXG4gICAgICAgIC8vIHRyaWdnZXIgdGhlIG9uTWF0Y2hDcmVhdGVkIHN1YnNjcmlwdGlvbiBmb3IgYWxsIGNvbm5lY3RlZCBjbGllbnRzLlxyXG4gICAgICAgIC8vIFRoZSBzdWJzY3JpcHRpb24gaXMgY29uZmlndXJlZCBpbiBzY2hlbWEuZ3JhcGhxbCBhczpcclxuICAgICAgICAvLyBvbk1hdGNoQ3JlYXRlZDogTWF0Y2ggQGF3c19zdWJzY3JpYmUobXV0YXRpb25zOiBbXCJjcmVhdGVNYXRjaFwiXSlcclxuICAgICAgICBcclxuICAgICAgICAvLyBUaGlzIG1lYW5zIGFueSBjbGllbnQgc3Vic2NyaWJlZCB0byBvbk1hdGNoQ3JlYXRlZCB3aWxsIHJlY2VpdmUgdGhpcyBtYXRjaFxyXG4gICAgICAgIC8vIFRoZSBjbGllbnQtc2lkZSBmaWx0ZXJpbmcgaW4gc3Vic2NyaXB0aW9ucy50cyB3aWxsIGVuc3VyZSBlYWNoIHVzZXIgb25seVxyXG4gICAgICAgIC8vIHByb2Nlc3NlcyBtYXRjaGVzIHdoZXJlIHRoZXkgYXJlIGluIHRoZSBtYXRjaGVkVXNlcnMgYXJyYXlcclxuICAgICAgICBcclxuICAgICAgICBjb25zb2xlLmxvZygn4pyFIFJldHVybmluZyBtYXRjaCBvYmplY3QgdG8gQXBwU3luYyBmb3Igc3Vic2NyaXB0aW9uIGJyb2FkY2FzdCcpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgICBib2R5OiB7IG1hdGNoIH0sXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY2FzZSAnbWF0Y2hDcmVhdGVkJzoge1xyXG4gICAgICAgIGNvbnN0IHsgbWF0Y2ggfSA9IGV2ZW50O1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFByb2Nlc3MgdGhlIG1hdGNoIGNyZWF0aW9uXHJcbiAgICAgICAgYXdhaXQgbWF0Y2hTZXJ2aWNlLmhhbmRsZU1hdGNoQ3JlYXRlZChtYXRjaCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gU2VuZCBub3RpZmljYXRpb25zIChmdXR1cmUgaW1wbGVtZW50YXRpb24pXHJcbiAgICAgICAgYXdhaXQgbWF0Y2hTZXJ2aWNlLnByb2Nlc3NNYXRjaE5vdGlmaWNhdGlvbihtYXRjaCk7XHJcblxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgICBib2R5OiB7IHN1Y2Nlc3M6IHRydWUgfSxcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdnZXRVc2VyTWF0Y2hlcyc6IHtcclxuICAgICAgICBjb25zdCB7IHVzZXJJZCB9ID0gZXZlbnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVXNlciBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgbWF0Y2hlcyA9IGF3YWl0IG1hdGNoU2VydmljZS5nZXRVc2VyTWF0Y2hlcyh1c2VySWQpO1xyXG5cclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgICAgYm9keTogeyBtYXRjaGVzIH0sXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY2FzZSAnY2hlY2tVc2VyTWF0Y2hlcyc6IHtcclxuICAgICAgICBjb25zdCB7IHVzZXJJZCB9ID0gZXZlbnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVXNlciBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgbWF0Y2hlcyA9IGF3YWl0IG1hdGNoU2VydmljZS5jaGVja1VzZXJNYXRjaGVzKHVzZXJJZCk7XHJcblxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgICBib2R5OiB7IG1hdGNoZXMgfSxcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdjaGVja1Jvb21NYXRjaCc6IHtcclxuICAgICAgICBjb25zdCB7IHJvb21JZCB9ID0gZXZlbnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFyb29tSWQpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBhd2FpdCBtYXRjaFNlcnZpY2UuY2hlY2tSb29tTWF0Y2gocm9vbUlkKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgICAgIGJvZHk6IHsgbWF0Y2g6IG1hdGNoIHx8IHVuZGVmaW5lZCB9LFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ25vdGlmeU1hdGNoJzoge1xyXG4gICAgICAgIGNvbnN0IHsgbWF0Y2ggfSA9IGV2ZW50O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghbWF0Y2gpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTWF0Y2ggaXMgcmVxdWlyZWQnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGF3YWl0IG1hdGNoU2VydmljZS5ub3RpZnlNYXRjaFRvVXNlcnMobWF0Y2gpO1xyXG5cclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgICAgYm9keTogeyBzdWNjZXNzOiB0cnVlIH0sXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgZGVmYXVsdDpcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3BlcmF0aW9uOiAkeyhldmVudCBhcyBhbnkpLm9wZXJhdGlvbn1gKTtcclxuICAgIH1cclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ01hdGNoIExhbWJkYSBlcnJvcjonLCBlcnJvcik7XHJcbiAgICBcclxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA0MDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcclxuICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICB9XHJcbn07Il19