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
        if (!this.matchesTable) {
            throw new Error('MATCHES_TABLE environment variable is required');
        }
        // USERS_TABLE is optional - we can work without it
        this.usersTable = process.env.USERS_TABLE || '';
        if (!this.usersTable) {
            console.warn('USERS_TABLE not configured - user activity tracking disabled');
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
            // Scan the matches table and filter by matchedUsers array
            // Since we store matches with matchedUsers as an array, we need to scan and filter
            const result = await docClient.send(new lib_dynamodb_1.ScanCommand({
                TableName: this.matchesTable,
                FilterExpression: 'contains(matchedUsers, :userId)',
                ExpressionAttributeValues: {
                    ':userId': userId,
                },
                Limit: 50,
            }));
            const matches = (result.Items || []);
            console.log(`Found ${matches.length} matches for user ${userId}`);
            // Sort by timestamp descending (newest first)
            matches.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            return matches;
        }
        catch (error) {
            console.error('Error getting user matches:', error);
            return [];
        }
    }
    async checkUserMatches(userId) {
        try {
            console.log(`🔍 Checking for ANY matches for user: ${userId}`);
            // Scan the matches table and filter by matchedUsers array
            const result = await docClient.send(new lib_dynamodb_1.ScanCommand({
                TableName: this.matchesTable,
                FilterExpression: 'contains(matchedUsers, :userId)',
                ExpressionAttributeValues: {
                    ':userId': userId,
                },
                Limit: 10,
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
            // Sort by timestamp descending (newest first)
            matches.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            return matches;
        }
        catch (error) {
            console.error('❌ Error checking user matches:', error);
            return [];
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
        // Skip if USERS_TABLE is not configured
        if (!this.usersTable) {
            console.log('Skipping user activity update - USERS_TABLE not configured');
            return;
        }
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
        // Skip if USERS_TABLE is not configured
        if (!this.usersTable) {
            return null;
        }
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
// Lambda Handler for AppSync
const handler = async (event) => {
    console.log('Match Lambda received AppSync event:', JSON.stringify(event));
    try {
        const matchService = new MatchService();
        // Extract user ID from AppSync context
        const userId = event.identity?.claims?.sub || event.identity?.username;
        // Determine operation from AppSync field name
        const fieldName = event.info?.fieldName;
        switch (fieldName) {
            case 'getMyMatches': {
                if (!userId) {
                    console.error('User not authenticated for getMyMatches');
                    return []; // Return empty array instead of throwing
                }
                try {
                    const matches = await matchService.getUserMatches(userId);
                    // CRITICAL FIX: Always return an array, never null or undefined
                    if (!matches) {
                        console.log('No matches found for user, returning empty array');
                        return [];
                    }
                    if (!Array.isArray(matches)) {
                        console.error('getUserMatches returned non-array value:', typeof matches);
                        return [];
                    }
                    return matches;
                }
                catch (error) {
                    console.error('Error in getMyMatches:', error);
                    return []; // Return empty array on error
                }
            }
            case 'checkUserMatches': {
                if (!userId) {
                    console.error('User not authenticated for checkUserMatches');
                    return []; // Return empty array instead of throwing
                }
                try {
                    const matches = await matchService.checkUserMatches(userId);
                    return matches || []; // Ensure we always return an array
                }
                catch (error) {
                    console.error('Error in checkUserMatches:', error);
                    return []; // Return empty array on error
                }
            }
            case 'checkRoomMatch': {
                const { roomId } = event.arguments;
                if (!roomId) {
                    throw new Error('Room ID is required');
                }
                const match = await matchService.checkRoomMatch(roomId);
                return match;
            }
            case 'createMatch': {
                const { input } = event.arguments;
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
                return match;
            }
            case 'publishRoomMatch': {
                const { roomId, matchData } = event.arguments;
                console.log(`🚀 CRITICAL FIX: Processing publishRoomMatch for room: ${roomId}`);
                console.log(`🎬 Movie: ${matchData.movieTitle}`);
                console.log(`👥 Matched users: ${matchData.matchedUsers.join(', ')}`);
                // Return the roomMatchEvent structure that AppSync expects
                const roomMatchEvent = {
                    roomId: roomId,
                    matchId: matchData.matchId,
                    movieId: String(matchData.movieId),
                    movieTitle: matchData.movieTitle,
                    posterPath: matchData.posterPath || null,
                    matchedUsers: matchData.matchedUsers,
                    timestamp: new Date().toISOString(),
                    matchDetails: matchData.matchDetails
                };
                console.log('📡 Returning roomMatchEvent for AppSync subscription trigger');
                return roomMatchEvent;
            }
            case 'publishUserMatch': {
                const { userId: targetUserId, matchData } = event.arguments;
                console.log(`🚀 Processing publishUserMatch for user: ${targetUserId}`);
                console.log(`🎬 Movie: ${matchData.movieTitle}`);
                // Return the userMatchEvent structure that AppSync expects
                const userMatchEvent = {
                    userId: targetUserId,
                    roomId: matchData.roomId,
                    matchId: matchData.matchId,
                    movieId: String(matchData.movieId),
                    movieTitle: matchData.movieTitle,
                    posterPath: matchData.posterPath || null,
                    matchedUsers: matchData.matchedUsers,
                    timestamp: new Date().toISOString(),
                    matchDetails: matchData.matchDetails
                };
                console.log('📡 Returning userMatchEvent for AppSync subscription trigger');
                return userMatchEvent;
            }
            default:
                throw new Error(`Unknown field: ${fieldName}`);
        }
    }
    catch (error) {
        console.error('Match Lambda error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        throw new Error(errorMessage);
    }
};
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvbWF0Y2gvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsOERBQTBEO0FBQzFELHdEQUFrSDtBQUVsSCx5QkFBeUI7QUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFzRjVELGdCQUFnQjtBQUNoQixNQUFNLFlBQVk7SUFJaEI7UUFDRSxJQUFJLENBQUMsWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxJQUFJLEVBQUUsQ0FBQztRQUVwRCxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3ZCLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0RBQWdELENBQUMsQ0FBQztRQUNwRSxDQUFDO1FBRUQsbURBQW1EO1FBQ25ELElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDckIsT0FBTyxDQUFDLElBQUksQ0FBQyw4REFBOEQsQ0FBQyxDQUFDO1FBQy9FLENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLGtCQUFrQixDQUFDLEtBQVk7UUFDbkMsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsS0FBSyxDQUFDLEVBQUUsU0FBUyxLQUFLLENBQUMsWUFBWSxDQUFDLE1BQU0sUUFBUSxDQUFDLENBQUM7UUFFN0YsNkNBQTZDO1FBQzdDLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUVsRCwwQ0FB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TUFBTTtvQkFDeEIsT0FBTyxFQUFFLFNBQVMsQ0FBQyxPQUFPO29CQUMxQixPQUFPLEVBQUUsTUFBTSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUM7b0JBQ2xDLFVBQVUsRUFBRSxTQUFTLENBQUMsVUFBVTtvQkFDaEMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxVQUFVLElBQUksSUFBSTtvQkFDeEMsWUFBWSxFQUFFLFNBQVMsQ0FBQyxZQUFZO29CQUNwQyxTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7b0JBQ25DLFlBQVksRUFBRSxTQUFTLENBQUMsWUFBWTtpQkFDckMsQ0FBQztnQkFFRixPQUFPLENBQUMsR0FBRyxDQUFDLDhEQUE4RCxDQUFDLENBQUM7Z0JBRTVFLE9BQU8sY0FBYyxDQUFDO1lBQ3hCLENBQUM7WUFFRDtnQkFDRSxNQUFNLElBQUksS0FBSyxDQUFDLGtCQUFrQixTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBQ25ELENBQUM7SUFFSCxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMscUJBQXFCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFNUMsTUFBTSxZQUFZLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUM7UUFDdkYsTUFBTSxJQUFJLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQztJQUNoQyxDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBbkpXLFFBQUEsT0FBTyxXQW1KbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IER5bmFtb0RCQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcclxuaW1wb3J0IHsgRHluYW1vREJEb2N1bWVudENsaWVudCwgUXVlcnlDb21tYW5kLCBHZXRDb21tYW5kLCBQdXRDb21tYW5kLCBTY2FuQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2xpYi1keW5hbW9kYic7XHJcblxyXG4vLyBJbml0aWFsaXplIEFXUyBjbGllbnRzXHJcbmNvbnN0IGR5bmFtb0NsaWVudCA9IG5ldyBEeW5hbW9EQkNsaWVudCh7IHJlZ2lvbjogcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB9KTtcclxuY29uc3QgZG9jQ2xpZW50ID0gRHluYW1vREJEb2N1bWVudENsaWVudC5mcm9tKGR5bmFtb0NsaWVudCk7XHJcblxyXG4vLyBUeXBlc1xyXG5pbnRlcmZhY2UgTWF0Y2gge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgbW92aWVJZDogbnVtYmVyO1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aD86IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIG1hdGNoZWRVc2Vyczogc3RyaW5nW107XHJcbiAgdGltZXN0YW1wOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBVc2VyIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIGVtYWlsOiBzdHJpbmc7XHJcbiAgY3JlYXRlZEF0OiBzdHJpbmc7XHJcbiAgbGFzdEFjdGl2ZUF0OiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBDcmVhdGVNYXRjaEV2ZW50IHtcclxuICBvcGVyYXRpb246ICdjcmVhdGVNYXRjaCc7XHJcbiAgaW5wdXQ6IHtcclxuICAgIHJvb21JZDogc3RyaW5nO1xyXG4gICAgbW92aWVJZDogbnVtYmVyO1xyXG4gICAgdGl0bGU6IHN0cmluZztcclxuICAgIHBvc3RlclBhdGg/OiBzdHJpbmc7XHJcbiAgICBtYXRjaGVkVXNlcnM6IHN0cmluZ1tdO1xyXG4gIH07XHJcbn1cclxuXHJcbmludGVyZmFjZSBHZXRVc2VyTWF0Y2hlc0V2ZW50IHtcclxuICBvcGVyYXRpb246ICdnZXRVc2VyTWF0Y2hlcyc7XHJcbiAgdXNlcklkOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBDaGVja1Jvb21NYXRjaEV2ZW50IHtcclxuICBvcGVyYXRpb246ICdjaGVja1Jvb21NYXRjaCc7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbn1cclxuXHJcbmludGVyZmFjZSBOb3RpZnlNYXRjaEV2ZW50IHtcclxuICBvcGVyYXRpb246ICdub3RpZnlNYXRjaCc7XHJcbiAgbWF0Y2g6IE1hdGNoO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTWF0Y2hDcmVhdGVkRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ21hdGNoQ3JlYXRlZCc7XHJcbiAgbWF0Y2g6IE1hdGNoO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgQ2hlY2tVc2VyTWF0Y2hlc0V2ZW50IHtcclxuICBvcGVyYXRpb246ICdjaGVja1VzZXJNYXRjaGVzJztcclxuICB1c2VySWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIFB1Ymxpc2hSb29tTWF0Y2hFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAncHVibGlzaFJvb21NYXRjaCc7XHJcbiAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgbWF0Y2hEYXRhOiB7XHJcbiAgICBtYXRjaElkOiBzdHJpbmc7XHJcbiAgICBtb3ZpZUlkOiBzdHJpbmc7XHJcbiAgICBtb3ZpZVRpdGxlOiBzdHJpbmc7XHJcbiAgICBwb3N0ZXJQYXRoPzogc3RyaW5nO1xyXG4gICAgbWF0Y2hlZFVzZXJzOiBzdHJpbmdbXTtcclxuICAgIG1hdGNoRGV0YWlsczoge1xyXG4gICAgICB2b3RlQ291bnQ6IG51bWJlcjtcclxuICAgICAgcmVxdWlyZWRWb3RlczogbnVtYmVyO1xyXG4gICAgICBtYXRjaFR5cGU6IHN0cmluZztcclxuICAgIH07XHJcbiAgfTtcclxufVxyXG5cclxudHlwZSBNYXRjaEV2ZW50ID0gQ3JlYXRlTWF0Y2hFdmVudCB8IE1hdGNoQ3JlYXRlZEV2ZW50IHwgR2V0VXNlck1hdGNoZXNFdmVudCB8IENoZWNrUm9vbU1hdGNoRXZlbnQgfCBDaGVja1VzZXJNYXRjaGVzRXZlbnQgfCBOb3RpZnlNYXRjaEV2ZW50IHwgUHVibGlzaFJvb21NYXRjaEV2ZW50O1xyXG5cclxuaW50ZXJmYWNlIE1hdGNoUmVzcG9uc2Uge1xyXG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcclxuICBib2R5OiB7XHJcbiAgICBtYXRjaGVzPzogTWF0Y2hbXTtcclxuICAgIG1hdGNoPzogTWF0Y2g7XHJcbiAgICBzdWNjZXNzPzogYm9vbGVhbjtcclxuICAgIGVycm9yPzogc3RyaW5nO1xyXG4gIH07XHJcbn1cclxuXHJcbi8vIE1hdGNoIFNlcnZpY2VcclxuY2xhc3MgTWF0Y2hTZXJ2aWNlIHtcclxuICBwcml2YXRlIHJlYWRvbmx5IG1hdGNoZXNUYWJsZTogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgdXNlcnNUYWJsZTogc3RyaW5nO1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMubWF0Y2hlc1RhYmxlID0gcHJvY2Vzcy5lbnYuTUFUQ0hFU19UQUJMRSB8fCAnJztcclxuXHJcbiAgICBpZiAoIXRoaXMubWF0Y2hlc1RhYmxlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTUFUQ0hFU19UQUJMRSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBVU0VSU19UQUJMRSBpcyBvcHRpb25hbCAtIHdlIGNhbiB3b3JrIHdpdGhvdXQgaXRcclxuICAgIHRoaXMudXNlcnNUYWJsZSA9IHByb2Nlc3MuZW52LlVTRVJTX1RBQkxFIHx8ICcnO1xyXG4gICAgaWYgKCF0aGlzLnVzZXJzVGFibGUpIHtcclxuICAgICAgY29uc29sZS53YXJuKCdVU0VSU19UQUJMRSBub3QgY29uZmlndXJlZCAtIHVzZXIgYWN0aXZpdHkgdHJhY2tpbmcgZGlzYWJsZWQnKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGhhbmRsZU1hdGNoQ3JlYXRlZChtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIG1hdGNoIGNyZWF0ZWQ6ICR7bWF0Y2guaWR9IHdpdGggJHttYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RofSB1c2Vyc2ApO1xyXG5cclxuICAgIC8vIFVwZGF0ZSB1c2VyIGFjdGl2aXR5IGZvciBhbGwgbWF0Y2hlZCB1c2Vyc1xyXG4gICAgYXdhaXQgdGhpcy51cGRhdGVVc2VyQWN0aXZpdHkobWF0Y2gubWF0Y2hlZFVzZXJzKTtcclxuXHJcbiAgICAvLyBTZW5kIG5vdGlmaWNhdGlvbnMgdG8gYWxsIG1hdGNoZWQgdXNlcnNcclxuICAgIGF3YWl0IHRoaXMubm90aWZ5TWF0Y2hUb1VzZXJzKG1hdGNoKTtcclxuXHJcbiAgICAvLyBMb2cgbWF0Y2ggY3JlYXRpb24gZm9yIGFuYWx5dGljc1xyXG4gICAgY29uc29sZS5sb2coYE1hdGNoIHN1Y2Nlc3NmdWxseSBwcm9jZXNzZWQ6ICR7bWF0Y2gudGl0bGV9ICgke21hdGNoLm1lZGlhVHlwZX0pIG1hdGNoZWQgYnkgdXNlcnM6ICR7bWF0Y2gubWF0Y2hlZFVzZXJzLmpvaW4oJywgJyl9YCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBub3RpZnlNYXRjaFRvVXNlcnMobWF0Y2g6IE1hdGNoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgU2VuZGluZyBtYXRjaCBub3RpZmljYXRpb25zIHRvICR7bWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aH0gdXNlcnNgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEluIGEgcmVhbCBpbXBsZW1lbnRhdGlvbiwgeW91IHdvdWxkIHVzZSBBcHBTeW5jIHN1YnNjcmlwdGlvbnMgb3IgcHVzaCBub3RpZmljYXRpb25zXHJcbiAgICAgIC8vIEZvciBub3csIHdlJ2xsIGxvZyB0aGUgbm90aWZpY2F0aW9uIGFuZCBzdG9yZSBpdCBmb3IgdGhlIGZyb250ZW5kIHRvIHBvbGxcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IG5vdGlmaWNhdGlvblByb21pc2VzID0gbWF0Y2gubWF0Y2hlZFVzZXJzLm1hcChhc3luYyAodXNlcklkKSA9PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIC8vIFN0b3JlIG5vdGlmaWNhdGlvbiBpbiB1c2VyJ3MgcmVjb3JkIG9yIHNlbmQgdmlhIEFwcFN5bmMgc3Vic2NyaXB0aW9uXHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgTm90aWZ5aW5nIHVzZXIgJHt1c2VySWR9IGFib3V0IG1hdGNoOiAke21hdGNoLnRpdGxlfWApO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBIZXJlIHlvdSB3b3VsZCB0eXBpY2FsbHk6XHJcbiAgICAgICAgICAvLyAxLiBTZW5kIEFwcFN5bmMgc3Vic2NyaXB0aW9uIG5vdGlmaWNhdGlvblxyXG4gICAgICAgICAgLy8gMi4gU2VuZCBwdXNoIG5vdGlmaWNhdGlvblxyXG4gICAgICAgICAgLy8gMy4gU3RvcmUgbm90aWZpY2F0aW9uIGluIHVzZXIncyBpbmJveFxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICByZXR1cm4geyB1c2VySWQsIHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIG5vdGlmeSB1c2VyICR7dXNlcklkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICByZXR1cm4geyB1c2VySWQsIHN1Y2Nlc3M6IGZhbHNlLCBlcnJvciB9O1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKG5vdGlmaWNhdGlvblByb21pc2VzKTtcclxuICAgICAgY29uc3Qgc3VjY2Vzc2Z1bCA9IHJlc3VsdHMuZmlsdGVyKHIgPT4gci5zdGF0dXMgPT09ICdmdWxmaWxsZWQnKS5sZW5ndGg7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhgTWF0Y2ggbm90aWZpY2F0aW9ucyBzZW50OiAke3N1Y2Nlc3NmdWx9LyR7bWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aH0gc3VjY2Vzc2Z1bGApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igc2VuZGluZyBtYXRjaCBub3RpZmljYXRpb25zOicsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGNoZWNrUm9vbU1hdGNoKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTxNYXRjaCB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBDaGVja2luZyBmb3IgZXhpc3RpbmcgbWF0Y2ggaW4gcm9vbTogJHtyb29tSWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBRdWVyeSBtYXRjaGVzIHRhYmxlIGZvciBhbnkgbWF0Y2ggaW4gdGhpcyByb29tXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgTGltaXQ6IDEsIC8vIFdlIG9ubHkgbmVlZCB0byBrbm93IGlmIHRoZXJlJ3MgYW55IG1hdGNoXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGlmIChyZXN1bHQuSXRlbXMgJiYgcmVzdWx0Lkl0ZW1zLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zdCBtYXRjaCA9IHJlc3VsdC5JdGVtc1swXSBhcyBNYXRjaDtcclxuICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgZXhpc3RpbmcgbWF0Y2ggaW4gcm9vbSAke3Jvb21JZH06ICR7bWF0Y2gudGl0bGV9YCk7XHJcbiAgICAgICAgcmV0dXJuIG1hdGNoO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgTm8gbWF0Y2ggZm91bmQgaW4gcm9vbTogJHtyb29tSWR9YCk7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgY2hlY2tpbmcgcm9vbSBtYXRjaCBmb3IgJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRVc2VyTWF0Y2hlcyh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8TWF0Y2hbXT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYEdldHRpbmcgbWF0Y2hlcyBmb3IgdXNlcjogJHt1c2VySWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBTY2FuIHRoZSBtYXRjaGVzIHRhYmxlIGFuZCBmaWx0ZXIgYnkgbWF0Y2hlZFVzZXJzIGFycmF5XHJcbiAgICAgIC8vIFNpbmNlIHdlIHN0b3JlIG1hdGNoZXMgd2l0aCBtYXRjaGVkVXNlcnMgYXMgYW4gYXJyYXksIHdlIG5lZWQgdG8gc2NhbiBhbmQgZmlsdGVyXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBTY2FuQ29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnY29udGFpbnMobWF0Y2hlZFVzZXJzLCA6dXNlcklkKScsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBMaW1pdDogNTAsXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSAocmVzdWx0Lkl0ZW1zIHx8IFtdKSBhcyBNYXRjaFtdO1xyXG4gICAgICBjb25zb2xlLmxvZyhgRm91bmQgJHttYXRjaGVzLmxlbmd0aH0gbWF0Y2hlcyBmb3IgdXNlciAke3VzZXJJZH1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFNvcnQgYnkgdGltZXN0YW1wIGRlc2NlbmRpbmcgKG5ld2VzdCBmaXJzdClcclxuICAgICAgbWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBuZXcgRGF0ZShiLnRpbWVzdGFtcCkuZ2V0VGltZSgpIC0gbmV3IERhdGUoYS50aW1lc3RhbXApLmdldFRpbWUoKSk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gbWF0Y2hlcztcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBnZXR0aW5nIHVzZXIgbWF0Y2hlczonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGNoZWNrVXNlck1hdGNoZXModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPE1hdGNoW10+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5SNIENoZWNraW5nIGZvciBBTlkgbWF0Y2hlcyBmb3IgdXNlcjogJHt1c2VySWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBTY2FuIHRoZSBtYXRjaGVzIHRhYmxlIGFuZCBmaWx0ZXIgYnkgbWF0Y2hlZFVzZXJzIGFycmF5XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBTY2FuQ29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnY29udGFpbnMobWF0Y2hlZFVzZXJzLCA6dXNlcklkKScsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBMaW1pdDogMTAsXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSAocmVzdWx0Lkl0ZW1zIHx8IFtdKSBhcyBNYXRjaFtdO1xyXG4gICAgICBjb25zb2xlLmxvZyhg4pyFIEZvdW5kICR7bWF0Y2hlcy5sZW5ndGh9IG1hdGNoZXMgZm9yIHVzZXIgJHt1c2VySWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAobWF0Y2hlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4sgUmVjZW50IG1hdGNoZXM6YCwgbWF0Y2hlcy5tYXAobSA9PiAoe1xyXG4gICAgICAgICAgaWQ6IG0uaWQsXHJcbiAgICAgICAgICB0aXRsZTogbS50aXRsZSxcclxuICAgICAgICAgIHJvb21JZDogbS5yb29tSWQsXHJcbiAgICAgICAgICB0aW1lc3RhbXA6IG0udGltZXN0YW1wXHJcbiAgICAgICAgfSkpKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gU29ydCBieSB0aW1lc3RhbXAgZGVzY2VuZGluZyAobmV3ZXN0IGZpcnN0KVxyXG4gICAgICBtYXRjaGVzLnNvcnQoKGEsIGIpID0+IG5ldyBEYXRlKGIudGltZXN0YW1wKS5nZXRUaW1lKCkgLSBuZXcgRGF0ZShhLnRpbWVzdGFtcCkuZ2V0VGltZSgpKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiBtYXRjaGVzO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBjaGVja2luZyB1c2VyIG1hdGNoZXM6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHNjYW5Vc2VyTWF0Y2hlcyh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8TWF0Y2hbXT4ge1xyXG4gICAgY29uc29sZS5sb2coYFNjYW5uaW5nIG1hdGNoZXMgZm9yIHVzZXI6ICR7dXNlcklkfSAoZmFsbGJhY2sgbWV0aG9kKWApO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBTY2FuIHRoZSBlbnRpcmUgbWF0Y2hlcyB0YWJsZSBhbmQgZmlsdGVyIGJ5IHVzZXJcclxuICAgICAgLy8gVGhpcyBpcyBpbmVmZmljaWVudCBidXQgd29ya3MgYXMgYSBmYWxsYmFja1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgU2NhbkNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ2NvbnRhaW5zKG1hdGNoZWRVc2VycywgOnVzZXJJZCknLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6dXNlcklkJzogdXNlcklkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgTGltaXQ6IDUwLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBtYXRjaGVzID0gKHJlc3VsdC5JdGVtcyB8fCBbXSkgYXMgTWF0Y2hbXTtcclxuICAgICAgY29uc29sZS5sb2coYFNjYW4gZm91bmQgJHttYXRjaGVzLmxlbmd0aH0gbWF0Y2hlcyBmb3IgdXNlciAke3VzZXJJZH1gKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiBtYXRjaGVzO1xyXG4gICAgICBcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHNjYW5uaW5nIHVzZXIgbWF0Y2hlczonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlVXNlckFjdGl2aXR5KHVzZXJJZHM6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAvLyBTa2lwIGlmIFVTRVJTX1RBQkxFIGlzIG5vdCBjb25maWd1cmVkXHJcbiAgICBpZiAoIXRoaXMudXNlcnNUYWJsZSkge1xyXG4gICAgICBjb25zb2xlLmxvZygnU2tpcHBpbmcgdXNlciBhY3Rpdml0eSB1cGRhdGUgLSBVU0VSU19UQUJMRSBub3QgY29uZmlndXJlZCcpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAgIC8vIFVwZGF0ZSBsYXN0QWN0aXZlQXQgZm9yIGFsbCBtYXRjaGVkIHVzZXJzXHJcbiAgICBjb25zdCB1cGRhdGVQcm9taXNlcyA9IHVzZXJJZHMubWFwKGFzeW5jICh1c2VySWQpID0+IHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBDaGVjayBpZiB1c2VyIGV4aXN0cywgY3JlYXRlIGlmIG5vdFxyXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nVXNlciA9IGF3YWl0IHRoaXMuZ2V0VXNlcih1c2VySWQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChleGlzdGluZ1VzZXIpIHtcclxuICAgICAgICAgIC8vIFVwZGF0ZSBleGlzdGluZyB1c2VyJ3MgbGFzdCBhY3Rpdml0eVxyXG4gICAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMudXNlcnNUYWJsZSxcclxuICAgICAgICAgICAgSXRlbToge1xyXG4gICAgICAgICAgICAgIC4uLmV4aXN0aW5nVXNlcixcclxuICAgICAgICAgICAgICBsYXN0QWN0aXZlQXQ6IHRpbWVzdGFtcCxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0pKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgLy8gQ3JlYXRlIG5ldyB1c2VyIHJlY29yZFxyXG4gICAgICAgICAgY29uc3QgbmV3VXNlcjogVXNlciA9IHtcclxuICAgICAgICAgICAgaWQ6IHVzZXJJZCxcclxuICAgICAgICAgICAgZW1haWw6ICcnLCAvLyBXaWxsIGJlIHBvcHVsYXRlZCBmcm9tIENvZ25pdG8gd2hlbiBhdmFpbGFibGVcclxuICAgICAgICAgICAgY3JlYXRlZEF0OiB0aW1lc3RhbXAsXHJcbiAgICAgICAgICAgIGxhc3RBY3RpdmVBdDogdGltZXN0YW1wLFxyXG4gICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy51c2Vyc1RhYmxlLFxyXG4gICAgICAgICAgICBJdGVtOiBuZXdVc2VyLFxyXG4gICAgICAgICAgICBDb25kaXRpb25FeHByZXNzaW9uOiAnYXR0cmlidXRlX25vdF9leGlzdHMoaWQpJywgLy8gUHJldmVudCBvdmVyd3JpdGluZ1xyXG4gICAgICAgICAgfSkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYFVwZGF0ZWQgYWN0aXZpdHkgZm9yIHVzZXI6ICR7dXNlcklkfWApO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHVwZGF0aW5nIHVzZXIgYWN0aXZpdHkgZm9yICR7dXNlcklkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgLy8gQ29udGludWUgd2l0aCBvdGhlciB1c2VycyBldmVuIGlmIG9uZSBmYWlsc1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQodXBkYXRlUHJvbWlzZXMpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBnZXRVc2VyKHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxVc2VyIHwgbnVsbD4ge1xyXG4gICAgLy8gU2tpcCBpZiBVU0VSU19UQUJMRSBpcyBub3QgY29uZmlndXJlZFxyXG4gICAgaWYgKCF0aGlzLnVzZXJzVGFibGUpIHtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy51c2Vyc1RhYmxlLFxyXG4gICAgICAgIEtleTogeyBpZDogdXNlcklkIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIHJldHVybiByZXN1bHQuSXRlbSBhcyBVc2VyIHx8IG51bGw7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBnZXR0aW5nIHVzZXIgJHt1c2VySWR9OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBwcm9jZXNzTWF0Y2hOb3RpZmljYXRpb24obWF0Y2g6IE1hdGNoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAvLyBGdXR1cmUgaW1wbGVtZW50YXRpb24gZm9yIHJlYWwtdGltZSBub3RpZmljYXRpb25zXHJcbiAgICAvLyBDb3VsZCBpbnRlZ3JhdGUgd2l0aDpcclxuICAgIC8vIC0gQXBwU3luYyBzdWJzY3JpcHRpb25zXHJcbiAgICAvLyAtIFNOUyBmb3IgcHVzaCBub3RpZmljYXRpb25zXHJcbiAgICAvLyAtIFdlYlNvY2tldCBjb25uZWN0aW9uc1xyXG4gICAgLy8gLSBFbWFpbCBub3RpZmljYXRpb25zXHJcblxyXG4gICAgY29uc29sZS5sb2coYE1hdGNoIG5vdGlmaWNhdGlvbjogJHttYXRjaC50aXRsZX0gbWF0Y2hlZCBpbiByb29tICR7bWF0Y2gucm9vbUlkfWApO1xyXG4gICAgXHJcbiAgICAvLyBGb3IgTVZQLCBqdXN0IGxvZyB0aGUgbm90aWZpY2F0aW9uXHJcbiAgICAvLyBJbiBwcm9kdWN0aW9uLCBpbXBsZW1lbnQgYWN0dWFsIG5vdGlmaWNhdGlvbiBkZWxpdmVyeVxyXG4gIH1cclxufVxyXG5cclxuLy8gTGFtYmRhIEhhbmRsZXIgZm9yIEFwcFN5bmNcclxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXIgPSBhc3luYyAoZXZlbnQpID0+IHtcclxuICBjb25zb2xlLmxvZygnTWF0Y2ggTGFtYmRhIHJlY2VpdmVkIEFwcFN5bmMgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IG1hdGNoU2VydmljZSA9IG5ldyBNYXRjaFNlcnZpY2UoKTtcclxuXHJcbiAgICAvLyBFeHRyYWN0IHVzZXIgSUQgZnJvbSBBcHBTeW5jIGNvbnRleHRcclxuICAgIGNvbnN0IHVzZXJJZCA9IGV2ZW50LmlkZW50aXR5Py5jbGFpbXM/LnN1YiB8fCBldmVudC5pZGVudGl0eT8udXNlcm5hbWU7XHJcbiAgICBcclxuICAgIC8vIERldGVybWluZSBvcGVyYXRpb24gZnJvbSBBcHBTeW5jIGZpZWxkIG5hbWVcclxuICAgIGNvbnN0IGZpZWxkTmFtZSA9IGV2ZW50LmluZm8/LmZpZWxkTmFtZTtcclxuICAgIFxyXG4gICAgc3dpdGNoIChmaWVsZE5hbWUpIHtcclxuICAgICAgY2FzZSAnZ2V0TXlNYXRjaGVzJzoge1xyXG4gICAgICAgIGlmICghdXNlcklkKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKCdVc2VyIG5vdCBhdXRoZW50aWNhdGVkIGZvciBnZXRNeU1hdGNoZXMnKTtcclxuICAgICAgICAgIHJldHVybiBbXTsgLy8gUmV0dXJuIGVtcHR5IGFycmF5IGluc3RlYWQgb2YgdGhyb3dpbmdcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCBtYXRjaGVzID0gYXdhaXQgbWF0Y2hTZXJ2aWNlLmdldFVzZXJNYXRjaGVzKHVzZXJJZCk7XHJcbiAgICAgICAgICAvLyBDUklUSUNBTCBGSVg6IEFsd2F5cyByZXR1cm4gYW4gYXJyYXksIG5ldmVyIG51bGwgb3IgdW5kZWZpbmVkXHJcbiAgICAgICAgICBpZiAoIW1hdGNoZXMpIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ05vIG1hdGNoZXMgZm91bmQgZm9yIHVzZXIsIHJldHVybmluZyBlbXB0eSBhcnJheScpO1xyXG4gICAgICAgICAgICByZXR1cm4gW107XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkobWF0Y2hlcykpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignZ2V0VXNlck1hdGNoZXMgcmV0dXJuZWQgbm9uLWFycmF5IHZhbHVlOicsIHR5cGVvZiBtYXRjaGVzKTtcclxuICAgICAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgcmV0dXJuIG1hdGNoZXM7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGdldE15TWF0Y2hlczonLCBlcnJvcik7XHJcbiAgICAgICAgICByZXR1cm4gW107IC8vIFJldHVybiBlbXB0eSBhcnJheSBvbiBlcnJvclxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgY2FzZSAnY2hlY2tVc2VyTWF0Y2hlcyc6IHtcclxuICAgICAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcignVXNlciBub3QgYXV0aGVudGljYXRlZCBmb3IgY2hlY2tVc2VyTWF0Y2hlcycpO1xyXG4gICAgICAgICAgcmV0dXJuIFtdOyAvLyBSZXR1cm4gZW1wdHkgYXJyYXkgaW5zdGVhZCBvZiB0aHJvd2luZ1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGNvbnN0IG1hdGNoZXMgPSBhd2FpdCBtYXRjaFNlcnZpY2UuY2hlY2tVc2VyTWF0Y2hlcyh1c2VySWQpO1xyXG4gICAgICAgICAgcmV0dXJuIG1hdGNoZXMgfHwgW107IC8vIEVuc3VyZSB3ZSBhbHdheXMgcmV0dXJuIGFuIGFycmF5XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGluIGNoZWNrVXNlck1hdGNoZXM6JywgZXJyb3IpO1xyXG4gICAgICAgICAgcmV0dXJuIFtdOyAvLyBSZXR1cm4gZW1wdHkgYXJyYXkgb24gZXJyb3JcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2NoZWNrUm9vbU1hdGNoJzoge1xyXG4gICAgICAgIGNvbnN0IHsgcm9vbUlkIH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFyb29tSWQpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUm9vbSBJRCBpcyByZXF1aXJlZCcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgbWF0Y2ggPSBhd2FpdCBtYXRjaFNlcnZpY2UuY2hlY2tSb29tTWF0Y2gocm9vbUlkKTtcclxuICAgICAgICByZXR1cm4gbWF0Y2g7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2NyZWF0ZU1hdGNoJzoge1xyXG4gICAgICAgIGNvbnN0IHsgaW5wdXQgfSA9IGV2ZW50LmFyZ3VtZW50cztcclxuICAgICAgICBcclxuICAgICAgICAvLyBDcmVhdGUgdGhlIG1hdGNoIG9iamVjdFxyXG4gICAgICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuICAgICAgICBjb25zdCBtYXRjaElkID0gYCR7aW5wdXQucm9vbUlkfSMke2lucHV0Lm1vdmllSWR9YDtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBtYXRjaDogTWF0Y2ggPSB7XHJcbiAgICAgICAgICBpZDogbWF0Y2hJZCxcclxuICAgICAgICAgIHJvb21JZDogaW5wdXQucm9vbUlkLFxyXG4gICAgICAgICAgbW92aWVJZDogaW5wdXQubW92aWVJZCxcclxuICAgICAgICAgIHRpdGxlOiBpbnB1dC50aXRsZSxcclxuICAgICAgICAgIHBvc3RlclBhdGg6IGlucHV0LnBvc3RlclBhdGgsXHJcbiAgICAgICAgICBtZWRpYVR5cGU6ICdNT1ZJRScsIC8vIERlZmF1bHQsIHNob3VsZCBiZSBwYXNzZWQgZnJvbSBpbnB1dFxyXG4gICAgICAgICAgbWF0Y2hlZFVzZXJzOiBpbnB1dC5tYXRjaGVkVXNlcnMsXHJcbiAgICAgICAgICB0aW1lc3RhbXAsXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfjokgQ3JlYXRlTWF0Y2ggbXV0YXRpb24gZXhlY3V0ZWQgdmlhIEFwcFN5bmMgcmVzb2x2ZXJgKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+ToSBUaGlzIHdpbGwgYXV0b21hdGljYWxseSB0cmlnZ2VyIEFwcFN5bmMgc3Vic2NyaXB0aW9uc2ApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn46sIE1hdGNoOiAke21hdGNoLnRpdGxlfWApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5GlIE5vdGlmeWluZyAke21hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGh9IHVzZXJzOiAke21hdGNoLm1hdGNoZWRVc2Vycy5qb2luKCcsICcpfWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBtYXRjaDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY2FzZSAncHVibGlzaFJvb21NYXRjaCc6IHtcclxuICAgICAgICBjb25zdCB7IHJvb21JZCwgbWF0Y2hEYXRhIH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfmoAgQ1JJVElDQUwgRklYOiBQcm9jZXNzaW5nIHB1Ymxpc2hSb29tTWF0Y2ggZm9yIHJvb206ICR7cm9vbUlkfWApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn46sIE1vdmllOiAke21hdGNoRGF0YS5tb3ZpZVRpdGxlfWApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5GlIE1hdGNoZWQgdXNlcnM6ICR7bWF0Y2hEYXRhLm1hdGNoZWRVc2Vycy5qb2luKCcsICcpfWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFJldHVybiB0aGUgcm9vbU1hdGNoRXZlbnQgc3RydWN0dXJlIHRoYXQgQXBwU3luYyBleHBlY3RzXHJcbiAgICAgICAgY29uc3Qgcm9vbU1hdGNoRXZlbnQgPSB7XHJcbiAgICAgICAgICByb29tSWQ6IHJvb21JZCxcclxuICAgICAgICAgIG1hdGNoSWQ6IG1hdGNoRGF0YS5tYXRjaElkLFxyXG4gICAgICAgICAgbW92aWVJZDogU3RyaW5nKG1hdGNoRGF0YS5tb3ZpZUlkKSxcclxuICAgICAgICAgIG1vdmllVGl0bGU6IG1hdGNoRGF0YS5tb3ZpZVRpdGxlLFxyXG4gICAgICAgICAgcG9zdGVyUGF0aDogbWF0Y2hEYXRhLnBvc3RlclBhdGggfHwgbnVsbCxcclxuICAgICAgICAgIG1hdGNoZWRVc2VyczogbWF0Y2hEYXRhLm1hdGNoZWRVc2VycyxcclxuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgICAgbWF0Y2hEZXRhaWxzOiBtYXRjaERhdGEubWF0Y2hEZXRhaWxzXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coJ/Cfk6EgUmV0dXJuaW5nIHJvb21NYXRjaEV2ZW50IGZvciBBcHBTeW5jIHN1YnNjcmlwdGlvbiB0cmlnZ2VyJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHJvb21NYXRjaEV2ZW50O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdwdWJsaXNoVXNlck1hdGNoJzoge1xyXG4gICAgICAgIGNvbnN0IHsgdXNlcklkOiB0YXJnZXRVc2VySWQsIG1hdGNoRGF0YSB9ID0gZXZlbnQuYXJndW1lbnRzO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5qAIFByb2Nlc3NpbmcgcHVibGlzaFVzZXJNYXRjaCBmb3IgdXNlcjogJHt0YXJnZXRVc2VySWR9YCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfjqwgTW92aWU6ICR7bWF0Y2hEYXRhLm1vdmllVGl0bGV9YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmV0dXJuIHRoZSB1c2VyTWF0Y2hFdmVudCBzdHJ1Y3R1cmUgdGhhdCBBcHBTeW5jIGV4cGVjdHNcclxuICAgICAgICBjb25zdCB1c2VyTWF0Y2hFdmVudCA9IHtcclxuICAgICAgICAgIHVzZXJJZDogdGFyZ2V0VXNlcklkLFxyXG4gICAgICAgICAgcm9vbUlkOiBtYXRjaERhdGEucm9vbUlkLFxyXG4gICAgICAgICAgbWF0Y2hJZDogbWF0Y2hEYXRhLm1hdGNoSWQsXHJcbiAgICAgICAgICBtb3ZpZUlkOiBTdHJpbmcobWF0Y2hEYXRhLm1vdmllSWQpLFxyXG4gICAgICAgICAgbW92aWVUaXRsZTogbWF0Y2hEYXRhLm1vdmllVGl0bGUsXHJcbiAgICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaERhdGEucG9zdGVyUGF0aCB8fCBudWxsLFxyXG4gICAgICAgICAgbWF0Y2hlZFVzZXJzOiBtYXRjaERhdGEubWF0Y2hlZFVzZXJzLFxyXG4gICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICBtYXRjaERldGFpbHM6IG1hdGNoRGF0YS5tYXRjaERldGFpbHNcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjb25zb2xlLmxvZygn8J+ToSBSZXR1cm5pbmcgdXNlck1hdGNoRXZlbnQgZm9yIEFwcFN5bmMgc3Vic2NyaXB0aW9uIHRyaWdnZXInKTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gdXNlck1hdGNoRXZlbnQ7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGZpZWxkOiAke2ZpZWxkTmFtZX1gKTtcclxuICAgIH1cclxuXHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ01hdGNoIExhbWJkYSBlcnJvcjonLCBlcnJvcik7XHJcbiAgICBcclxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnO1xyXG4gICAgdGhyb3cgbmV3IEVycm9yKGVycm9yTWVzc2FnZSk7XHJcbiAgfVxyXG59OyJdfQ==