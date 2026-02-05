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
                    return matches || []; // Ensure we always return an array
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvbWF0Y2gvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsOERBQTBEO0FBQzFELHdEQUFrSDtBQUVsSCx5QkFBeUI7QUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFzRjVELGdCQUFnQjtBQUNoQixNQUFNLFlBQVk7SUFJaEI7UUFDRSxJQUFJLENBQUMsWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxJQUFJLEVBQUUsQ0FBQztRQUVwRCxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3ZCLE1BQU0sSUFBSSxLQUFLLENBQUMsZ0RBQWdELENBQUMsQ0FBQztRQUNwRSxDQUFDO1FBRUQsbURBQW1EO1FBQ25ELElBQUksQ0FBQyxVQUFVLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxXQUFXLElBQUksRUFBRSxDQUFDO1FBQ2hELElBQUksQ0FBQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDckIsT0FBTyxDQUFDLElBQUksQ0FBQyw4REFBOEQsQ0FBQyxDQUFDO1FBQy9FLENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLGtCQUFrQixDQUFDLEtBQVk7UUFDbkMsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsS0FBSyxDQUFDLEVBQUUsU0FBUyxLQUFLLENBQUMsWUFBWSxDQUFDLE1BQU0sUUFBUSxDQUFDLENBQUM7UUFFN0YsNkNBQTZDO1FBQzdDLE1BQU0sSUFBSSxDQUFDLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUVsRCwwQ0FBMEM7UUFDMUMsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsS0FBSyxDQUFDLENBQUM7UUFFckMsbUNBQW1DO1FBQ25DLE9BQU8sQ0FBQyxHQUFHLENBQUMsaUNBQWlDLEtBQUssQ0FBQyxLQUFLLEtBQUssS0FBSyxDQUFDLFNBQVMsdUJBQXVCLEtBQUssQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUN0SSxDQUFDO0lBRUQsS0FBSyxDQUFDLGtCQUFrQixDQUFDLEtBQVk7UUFDbkMsSUFBSSxDQUFDO1lBQ0gsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQ0FBa0MsS0FBSyxDQUFDLFlBQVksQ0FBQyxNQUFNLFFBQVEsQ0FBQyxDQUFDO1lBRWpGLHNGQUFzRjtZQUN0Riw0RUFBNEU7WUFFNUUsTUFBTSxvQkFBb0IsR0FBRyxLQUFLLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUU7Z0JBQ25FLElBQUksQ0FBQztvQkFDSCx1RUFBdUU7b0JBQ3ZFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLE1BQU0saUJBQWlCLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDO29CQUVwRSw0QkFBNEI7b0JBQzVCLDRDQUE0QztvQkFDNUMsNEJBQTRCO29CQUM1Qix3Q0FBd0M7b0JBRXhDLE9BQU8sRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDO2dCQUNuQyxDQUFDO2dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7b0JBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyx5QkFBeUIsTUFBTSxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7b0JBQ3pELE9BQU8sRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsQ0FBQztnQkFDM0MsQ0FBQztZQUNILENBQUMsQ0FBQyxDQUFDO1lBRUgsTUFBTSxPQUFPLEdBQUcsTUFBTSxPQUFPLENBQUMsVUFBVSxDQUFDLG9CQUFvQixDQUFDLENBQUM7WUFDL0QsTUFBTSxVQUFVLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLEtBQUssV0FBVyxDQUFDLENBQUMsTUFBTSxDQUFDO1lBRXhFLE9BQU8sQ0FBQyxHQUFHLENBQUMsNkJBQTZCLFVBQVUsSUFBSSxLQUFLLENBQUMsWUFBWSxDQUFDLE1BQU0sYUFBYSxDQUFDLENBQUM7UUFDakcsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLG9DQUFvQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzdELENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLGNBQWMsQ0FBQyxNQUFjO1FBQ2pDLElBQUksQ0FBQztZQUNILE9BQU8sQ0FBQyxHQUFHLENBQUMsd0NBQXdDLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFFOUQsaURBQWlEO1lBQ2pELE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLDJCQUFZLENBQUM7Z0JBQ25ELFNBQVMsRUFBRSxJQUFJLENBQUMsWUFBWTtnQkFDNUIsc0JBQXNCLEVBQUUsa0JBQWtCO2dCQUMxQyx5QkFBeUIsRUFBRTtvQkFDekIsU0FBUyxFQUFFLE1BQU07aUJBQ2xCO2dCQUNELEtBQUssRUFBRSxDQUFDLEVBQUUsNENBQTRDO2FBQ3ZELENBQUMsQ0FBQyxDQUFDO1lBRUosSUFBSSxNQUFNLENBQUMsS0FBSyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUM1QyxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBVSxDQUFDO2dCQUN2QyxPQUFPLENBQUMsR0FBRyxDQUFDLGdDQUFnQyxNQUFNLEtBQUssS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7Z0JBQ3RFLE9BQU8sS0FBSyxDQUFDO1lBQ2YsQ0FBQztZQUVELE9BQU8sQ0FBQyxHQUFHLENBQUMsMkJBQTJCLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFDakQsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsaUNBQWlDLE1BQU0sR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ2pFLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsY0FBYyxDQUFDLE1BQWM7UUFDakMsSUFBSSxDQUFDO1lBQ0gsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUVuRCwwREFBMEQ7WUFDMUQsbUZBQW1GO1lBQ25GLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLDBCQUFXLENBQUM7Z0JBQ2xELFNBQVMsRUFBRSxJQUFJLENBQUMsWUFBWTtnQkFDNUIsZ0JBQWdCLEVBQUUsaUNBQWlDO2dCQUNuRCx5QkFBeUIsRUFBRTtvQkFDekIsU0FBUyxFQUFFLE1BQU07aUJBQ2xCO2dCQUNELEtBQUssRUFBRSxFQUFFO2FBQ1YsQ0FBQyxDQUFDLENBQUM7WUFFSixNQUFNLE9BQU8sR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFZLENBQUM7WUFDaEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxTQUFTLE9BQU8sQ0FBQyxNQUFNLHFCQUFxQixNQUFNLEVBQUUsQ0FBQyxDQUFDO1lBRWxFLDhDQUE4QztZQUM5QyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxHQUFHLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1lBRTFGLE9BQU8sT0FBTyxDQUFDO1FBRWpCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyw2QkFBNkIsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUNwRCxPQUFPLEVBQUUsQ0FBQztRQUNaLENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLGdCQUFnQixDQUFDLE1BQWM7UUFDbkMsSUFBSSxDQUFDO1lBQ0gsT0FBTyxDQUFDLEdBQUcsQ0FBQyx5Q0FBeUMsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUUvRCwwREFBMEQ7WUFDMUQsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksMEJBQVcsQ0FBQztnQkFDbEQsU0FBUyxFQUFFLElBQUksQ0FBQyxZQUFZO2dCQUM1QixnQkFBZ0IsRUFBRSxpQ0FBaUM7Z0JBQ25ELHlCQUF5QixFQUFFO29CQUN6QixTQUFTLEVBQUUsTUFBTTtpQkFDbEI7Z0JBQ0QsS0FBSyxFQUFFLEVBQUU7YUFDVixDQUFDLENBQUMsQ0FBQztZQUVKLE1BQU0sT0FBTyxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUssSUFBSSxFQUFFLENBQVksQ0FBQztZQUNoRCxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVcsT0FBTyxDQUFDLE1BQU0scUJBQXFCLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFFcEUsSUFBSSxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRSxDQUFDO2dCQUN2QixPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFvQixFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO29CQUNsRCxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUU7b0JBQ1IsS0FBSyxFQUFFLENBQUMsQ0FBQyxLQUFLO29CQUNkLE1BQU0sRUFBRSxDQUFDLENBQUMsTUFBTTtvQkFDaEIsU0FBUyxFQUFFLENBQUMsQ0FBQyxTQUFTO2lCQUN2QixDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ1AsQ0FBQztZQUVELDhDQUE4QztZQUM5QyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDLE9BQU8sRUFBRSxHQUFHLElBQUksSUFBSSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxDQUFDO1lBRTFGLE9BQU8sT0FBTyxDQUFDO1FBRWpCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxnQ0FBZ0MsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN2RCxPQUFPLEVBQUUsQ0FBQztRQUNaLENBQUM7SUFDSCxDQUFDO0lBRU8sS0FBSyxDQUFDLGVBQWUsQ0FBQyxNQUFjO1FBQzFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsOEJBQThCLE1BQU0sb0JBQW9CLENBQUMsQ0FBQztRQUV0RSxJQUFJLENBQUM7WUFDSCxtREFBbUQ7WUFDbkQsOENBQThDO1lBQzlDLE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLDBCQUFXLENBQUM7Z0JBQ2xELFNBQVMsRUFBRSxJQUFJLENBQUMsWUFBWTtnQkFDNUIsZ0JBQWdCLEVBQUUsaUNBQWlDO2dCQUNuRCx5QkFBeUIsRUFBRTtvQkFDekIsU0FBUyxFQUFFLE1BQU07aUJBQ2xCO2dCQUNELEtBQUssRUFBRSxFQUFFO2FBQ1YsQ0FBQyxDQUFDLENBQUM7WUFFSixNQUFNLE9BQU8sR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLLElBQUksRUFBRSxDQUFZLENBQUM7WUFDaEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLE9BQU8sQ0FBQyxNQUFNLHFCQUFxQixNQUFNLEVBQUUsQ0FBQyxDQUFDO1lBRXZFLE9BQU8sT0FBTyxDQUFDO1FBRWpCLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyw4QkFBOEIsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUNyRCxPQUFPLEVBQUUsQ0FBQztRQUNaLENBQUM7SUFDSCxDQUFDO0lBRU8sS0FBSyxDQUFDLGtCQUFrQixDQUFDLE9BQWlCO1FBQ2hELHdDQUF3QztRQUN4QyxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1lBQ3JCLE9BQU8sQ0FBQyxHQUFHLENBQUMsNERBQTRELENBQUMsQ0FBQztZQUMxRSxPQUFPO1FBQ1QsQ0FBQztRQUVELE1BQU0sU0FBUyxHQUFHLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFLENBQUM7UUFFM0MsNENBQTRDO1FBQzVDLE1BQU0sY0FBYyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQ2xELElBQUksQ0FBQztnQkFDSCxzQ0FBc0M7Z0JBQ3RDLE1BQU0sWUFBWSxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFFaEQsSUFBSSxZQUFZLEVBQUUsQ0FBQztvQkFDakIsdUNBQXVDO29CQUN2QyxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSx5QkFBVSxDQUFDO3dCQUNsQyxTQUFTLEVBQUUsSUFBSSxDQUFDLFVBQVU7d0JBQzFCLElBQUksRUFBRTs0QkFDSixHQUFHLFlBQVk7NEJBQ2YsWUFBWSxFQUFFLFNBQVM7eUJBQ3hCO3FCQUNGLENBQUMsQ0FBQyxDQUFDO2dCQUNOLENBQUM7cUJBQU0sQ0FBQztvQkFDTix5QkFBeUI7b0JBQ3pCLE1BQU0sT0FBTyxHQUFTO3dCQUNwQixFQUFFLEVBQUUsTUFBTTt3QkFDVixLQUFLLEVBQUUsRUFBRSxFQUFFLGdEQUFnRDt3QkFDM0QsU0FBUyxFQUFFLFNBQVM7d0JBQ3BCLFlBQVksRUFBRSxTQUFTO3FCQUN4QixDQUFDO29CQUVGLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLHlCQUFVLENBQUM7d0JBQ2xDLFNBQVMsRUFBRSxJQUFJLENBQUMsVUFBVTt3QkFDMUIsSUFBSSxFQUFFLE9BQU87d0JBQ2IsbUJBQW1CLEVBQUUsMEJBQTBCLEVBQUUsc0JBQXNCO3FCQUN4RSxDQUFDLENBQUMsQ0FBQztnQkFDTixDQUFDO2dCQUVELE9BQU8sQ0FBQyxHQUFHLENBQUMsOEJBQThCLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFDdEQsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQ0FBb0MsTUFBTSxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7Z0JBQ3BFLDhDQUE4QztZQUNoRCxDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUM7UUFFSCxNQUFNLE9BQU8sQ0FBQyxVQUFVLENBQUMsY0FBYyxDQUFDLENBQUM7SUFDM0MsQ0FBQztJQUVPLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBYztRQUNsQyx3Q0FBd0M7UUFDeEMsSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUNyQixPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSx5QkFBVSxDQUFDO2dCQUNqRCxTQUFTLEVBQUUsSUFBSSxDQUFDLFVBQVU7Z0JBQzFCLEdBQUcsRUFBRSxFQUFFLEVBQUUsRUFBRSxNQUFNLEVBQUU7YUFDcEIsQ0FBQyxDQUFDLENBQUM7WUFFSixPQUFPLE1BQU0sQ0FBQyxJQUFZLElBQUksSUFBSSxDQUFDO1FBQ3JDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsTUFBTSxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDdEQsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyx3QkFBd0IsQ0FBQyxLQUFZO1FBQ3pDLG9EQUFvRDtRQUNwRCx3QkFBd0I7UUFDeEIsMEJBQTBCO1FBQzFCLCtCQUErQjtRQUMvQiwwQkFBMEI7UUFDMUIsd0JBQXdCO1FBRXhCLE9BQU8sQ0FBQyxHQUFHLENBQUMsdUJBQXVCLEtBQUssQ0FBQyxLQUFLLG9CQUFvQixLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztRQUVsRixxQ0FBcUM7UUFDckMsd0RBQXdEO0lBQzFELENBQUM7Q0FDRjtBQUVELDZCQUE2QjtBQUN0QixNQUFNLE9BQU8sR0FBWSxLQUFLLEVBQUUsS0FBSyxFQUFFLEVBQUU7SUFDOUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxzQ0FBc0MsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7SUFFM0UsSUFBSSxDQUFDO1FBQ0gsTUFBTSxZQUFZLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQztRQUV4Qyx1Q0FBdUM7UUFDdkMsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLFFBQVEsRUFBRSxNQUFNLEVBQUUsR0FBRyxJQUFJLEtBQUssQ0FBQyxRQUFRLEVBQUUsUUFBUSxDQUFDO1FBRXZFLDhDQUE4QztRQUM5QyxNQUFNLFNBQVMsR0FBRyxLQUFLLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQztRQUV4QyxRQUFRLFNBQVMsRUFBRSxDQUFDO1lBQ2xCLEtBQUssY0FBYyxDQUFDLENBQUMsQ0FBQztnQkFDcEIsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO29CQUNaLE9BQU8sQ0FBQyxLQUFLLENBQUMseUNBQXlDLENBQUMsQ0FBQztvQkFDekQsT0FBTyxFQUFFLENBQUMsQ0FBQyx5Q0FBeUM7Z0JBQ3RELENBQUM7Z0JBRUQsSUFBSSxDQUFDO29CQUNILE1BQU0sT0FBTyxHQUFHLE1BQU0sWUFBWSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQztvQkFDMUQsT0FBTyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsbUNBQW1DO2dCQUMzRCxDQUFDO2dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7b0JBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyx3QkFBd0IsRUFBRSxLQUFLLENBQUMsQ0FBQztvQkFDL0MsT0FBTyxFQUFFLENBQUMsQ0FBQyw4QkFBOEI7Z0JBQzNDLENBQUM7WUFDSCxDQUFDO1lBRUQsS0FBSyxrQkFBa0IsQ0FBQyxDQUFDLENBQUM7Z0JBQ3hCLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztvQkFDWixPQUFPLENBQUMsS0FBSyxDQUFDLDZDQUE2QyxDQUFDLENBQUM7b0JBQzdELE9BQU8sRUFBRSxDQUFDLENBQUMseUNBQXlDO2dCQUN0RCxDQUFDO2dCQUVELElBQUksQ0FBQztvQkFDSCxNQUFNLE9BQU8sR0FBRyxNQUFNLFlBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsQ0FBQztvQkFDNUQsT0FBTyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsbUNBQW1DO2dCQUMzRCxDQUFDO2dCQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7b0JBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyw0QkFBNEIsRUFBRSxLQUFLLENBQUMsQ0FBQztvQkFDbkQsT0FBTyxFQUFFLENBQUMsQ0FBQyw4QkFBOEI7Z0JBQzNDLENBQUM7WUFDSCxDQUFDO1lBRUQsS0FBSyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUM7Z0JBQ3RCLE1BQU0sRUFBRSxNQUFNLEVBQUUsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDO2dCQUVuQyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7b0JBQ1osTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO2dCQUN6QyxDQUFDO2dCQUVELE1BQU0sS0FBSyxHQUFHLE1BQU0sWUFBWSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFDeEQsT0FBTyxLQUFLLENBQUM7WUFDZixDQUFDO1lBRUQsS0FBSyxhQUFhLENBQUMsQ0FBQyxDQUFDO2dCQUNuQixNQUFNLEVBQUUsS0FBSyxFQUFFLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQztnQkFFbEMsMEJBQTBCO2dCQUMxQixNQUFNLFNBQVMsR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDO2dCQUMzQyxNQUFNLE9BQU8sR0FBRyxHQUFHLEtBQUssQ0FBQyxNQUFNLElBQUksS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUVuRCxNQUFNLEtBQUssR0FBVTtvQkFDbkIsRUFBRSxFQUFFLE9BQU87b0JBQ1gsTUFBTSxFQUFFLEtBQUssQ0FBQyxNQUFNO29CQUNwQixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87b0JBQ3RCLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztvQkFDbEIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO29CQUM1QixTQUFTLEVBQUUsT0FBTyxFQUFFLHVDQUF1QztvQkFDM0QsWUFBWSxFQUFFLEtBQUssQ0FBQyxZQUFZO29CQUNoQyxTQUFTO2lCQUNWLENBQUM7Z0JBRUYsT0FBTyxDQUFDLEdBQUcsQ0FBQyx1REFBdUQsQ0FBQyxDQUFDO2dCQUNyRSxPQUFPLENBQUMsR0FBRyxDQUFDLDBEQUEwRCxDQUFDLENBQUM7Z0JBQ3hFLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQztnQkFDeEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0IsS0FBSyxDQUFDLFlBQVksQ0FBQyxNQUFNLFdBQVcsS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO2dCQUVqRyxPQUFPLEtBQUssQ0FBQztZQUNmLENBQUM7WUFFRCxLQUFLLGtCQUFrQixDQUFDLENBQUMsQ0FBQztnQkFDeEIsTUFBTSxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUUsR0FBRyxLQUFLLENBQUMsU0FBUyxDQUFDO2dCQUU5QyxPQUFPLENBQUMsR0FBRyxDQUFDLDBEQUEwRCxNQUFNLEVBQUUsQ0FBQyxDQUFDO2dCQUNoRixPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsU0FBUyxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7Z0JBQ2pELE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCLFNBQVMsQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFFdEUsMkRBQTJEO2dCQUMzRCxNQUFNLGNBQWMsR0FBRztvQkFDckIsTUFBTSxFQUFFLE1BQU07b0JBQ2QsT0FBTyxFQUFFLFNBQVMsQ0FBQyxPQUFPO29CQUMxQixPQUFPLEVBQUUsTUFBTSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUM7b0JBQ2xDLFVBQVUsRUFBRSxTQUFTLENBQUMsVUFBVTtvQkFDaEMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxVQUFVLElBQUksSUFBSTtvQkFDeEMsWUFBWSxFQUFFLFNBQVMsQ0FBQyxZQUFZO29CQUNwQyxTQUFTLEVBQUUsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUU7b0JBQ25DLFlBQVksRUFBRSxTQUFTLENBQUMsWUFBWTtpQkFDckMsQ0FBQztnQkFFRixPQUFPLENBQUMsR0FBRyxDQUFDLDhEQUE4RCxDQUFDLENBQUM7Z0JBRTVFLE9BQU8sY0FBYyxDQUFDO1lBQ3hCLENBQUM7WUFFRCxLQUFLLGtCQUFrQixDQUFDLENBQUMsQ0FBQztnQkFDeEIsTUFBTSxFQUFFLE1BQU0sRUFBRSxZQUFZLEVBQUUsU0FBUyxFQUFFLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQztnQkFFNUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyw0Q0FBNEMsWUFBWSxFQUFFLENBQUMsQ0FBQztnQkFDeEUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLFNBQVMsQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO2dCQUVqRCwyREFBMkQ7Z0JBQzNELE1BQU0sY0FBYyxHQUFHO29CQUNyQixNQUFNLEVBQUUsWUFBWTtvQkFDcEIsTUFBTSxFQUFFLFNBQVMsQ0FBQyxNQUFNO29CQUN4QixPQUFPLEVBQUUsU0FBUyxDQUFDLE9BQU87b0JBQzFCLE9BQU8sRUFBRSxNQUFNLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQztvQkFDbEMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxVQUFVO29CQUNoQyxVQUFVLEVBQUUsU0FBUyxDQUFDLFVBQVUsSUFBSSxJQUFJO29CQUN4QyxZQUFZLEVBQUUsU0FBUyxDQUFDLFlBQVk7b0JBQ3BDLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtvQkFDbkMsWUFBWSxFQUFFLFNBQVMsQ0FBQyxZQUFZO2lCQUNyQyxDQUFDO2dCQUVGLE9BQU8sQ0FBQyxHQUFHLENBQUMsOERBQThELENBQUMsQ0FBQztnQkFFNUUsT0FBTyxjQUFjLENBQUM7WUFDeEIsQ0FBQztZQUVEO2dCQUNFLE1BQU0sSUFBSSxLQUFLLENBQUMsa0JBQWtCLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDbkQsQ0FBQztJQUVILENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUU1QyxNQUFNLFlBQVksR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQztRQUN2RixNQUFNLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQ2hDLENBQUM7QUFDSCxDQUFDLENBQUM7QUExSVcsUUFBQSxPQUFPLFdBMElsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBRdWVyeUNvbW1hbmQsIEdldENvbW1hbmQsIFB1dENvbW1hbmQsIFNjYW5Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcclxuXHJcbi8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcclxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KTtcclxuXHJcbi8vIFR5cGVzXHJcbmludGVyZmFjZSBNYXRjaCB7XHJcbiAgaWQ6IHN0cmluZztcclxuICByb29tSWQ6IHN0cmluZztcclxuICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBwb3N0ZXJQYXRoPzogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgbWF0Y2hlZFVzZXJzOiBzdHJpbmdbXTtcclxuICB0aW1lc3RhbXA6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIFVzZXIge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgZW1haWw6IHN0cmluZztcclxuICBjcmVhdGVkQXQ6IHN0cmluZztcclxuICBsYXN0QWN0aXZlQXQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIENyZWF0ZU1hdGNoRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2NyZWF0ZU1hdGNoJztcclxuICBpbnB1dDoge1xyXG4gICAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgICB0aXRsZTogc3RyaW5nO1xyXG4gICAgcG9zdGVyUGF0aD86IHN0cmluZztcclxuICAgIG1hdGNoZWRVc2Vyczogc3RyaW5nW107XHJcbiAgfTtcclxufVxyXG5cclxuaW50ZXJmYWNlIEdldFVzZXJNYXRjaGVzRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2dldFVzZXJNYXRjaGVzJztcclxuICB1c2VySWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIENoZWNrUm9vbU1hdGNoRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2NoZWNrUm9vbU1hdGNoJztcclxuICByb29tSWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIE5vdGlmeU1hdGNoRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ25vdGlmeU1hdGNoJztcclxuICBtYXRjaDogTWF0Y2g7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNYXRjaENyZWF0ZWRFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnbWF0Y2hDcmVhdGVkJztcclxuICBtYXRjaDogTWF0Y2g7XHJcbn1cclxuXHJcbmludGVyZmFjZSBDaGVja1VzZXJNYXRjaGVzRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2NoZWNrVXNlck1hdGNoZXMnO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgUHVibGlzaFJvb21NYXRjaEV2ZW50IHtcclxuICBvcGVyYXRpb246ICdwdWJsaXNoUm9vbU1hdGNoJztcclxuICByb29tSWQ6IHN0cmluZztcclxuICBtYXRjaERhdGE6IHtcclxuICAgIG1hdGNoSWQ6IHN0cmluZztcclxuICAgIG1vdmllSWQ6IHN0cmluZztcclxuICAgIG1vdmllVGl0bGU6IHN0cmluZztcclxuICAgIHBvc3RlclBhdGg/OiBzdHJpbmc7XHJcbiAgICBtYXRjaGVkVXNlcnM6IHN0cmluZ1tdO1xyXG4gICAgbWF0Y2hEZXRhaWxzOiB7XHJcbiAgICAgIHZvdGVDb3VudDogbnVtYmVyO1xyXG4gICAgICByZXF1aXJlZFZvdGVzOiBudW1iZXI7XHJcbiAgICAgIG1hdGNoVHlwZTogc3RyaW5nO1xyXG4gICAgfTtcclxuICB9O1xyXG59XHJcblxyXG50eXBlIE1hdGNoRXZlbnQgPSBDcmVhdGVNYXRjaEV2ZW50IHwgTWF0Y2hDcmVhdGVkRXZlbnQgfCBHZXRVc2VyTWF0Y2hlc0V2ZW50IHwgQ2hlY2tSb29tTWF0Y2hFdmVudCB8IENoZWNrVXNlck1hdGNoZXNFdmVudCB8IE5vdGlmeU1hdGNoRXZlbnQgfCBQdWJsaXNoUm9vbU1hdGNoRXZlbnQ7XHJcblxyXG5pbnRlcmZhY2UgTWF0Y2hSZXNwb25zZSB7XHJcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xyXG4gIGJvZHk6IHtcclxuICAgIG1hdGNoZXM/OiBNYXRjaFtdO1xyXG4gICAgbWF0Y2g/OiBNYXRjaDtcclxuICAgIHN1Y2Nlc3M/OiBib29sZWFuO1xyXG4gICAgZXJyb3I/OiBzdHJpbmc7XHJcbiAgfTtcclxufVxyXG5cclxuLy8gTWF0Y2ggU2VydmljZVxyXG5jbGFzcyBNYXRjaFNlcnZpY2Uge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbWF0Y2hlc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB1c2Vyc1RhYmxlOiBzdHJpbmc7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUgPSBwcm9jZXNzLmVudi5NQVRDSEVTX1RBQkxFIHx8ICcnO1xyXG5cclxuICAgIGlmICghdGhpcy5tYXRjaGVzVGFibGUpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNQVRDSEVTX1RBQkxFIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFVTRVJTX1RBQkxFIGlzIG9wdGlvbmFsIC0gd2UgY2FuIHdvcmsgd2l0aG91dCBpdFxyXG4gICAgdGhpcy51c2Vyc1RhYmxlID0gcHJvY2Vzcy5lbnYuVVNFUlNfVEFCTEUgfHwgJyc7XHJcbiAgICBpZiAoIXRoaXMudXNlcnNUYWJsZSkge1xyXG4gICAgICBjb25zb2xlLndhcm4oJ1VTRVJTX1RBQkxFIG5vdCBjb25maWd1cmVkIC0gdXNlciBhY3Rpdml0eSB0cmFja2luZyBkaXNhYmxlZCcpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgaGFuZGxlTWF0Y2hDcmVhdGVkKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc29sZS5sb2coYFByb2Nlc3NpbmcgbWF0Y2ggY3JlYXRlZDogJHttYXRjaC5pZH0gd2l0aCAke21hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGh9IHVzZXJzYCk7XHJcblxyXG4gICAgLy8gVXBkYXRlIHVzZXIgYWN0aXZpdHkgZm9yIGFsbCBtYXRjaGVkIHVzZXJzXHJcbiAgICBhd2FpdCB0aGlzLnVwZGF0ZVVzZXJBY3Rpdml0eShtYXRjaC5tYXRjaGVkVXNlcnMpO1xyXG5cclxuICAgIC8vIFNlbmQgbm90aWZpY2F0aW9ucyB0byBhbGwgbWF0Y2hlZCB1c2Vyc1xyXG4gICAgYXdhaXQgdGhpcy5ub3RpZnlNYXRjaFRvVXNlcnMobWF0Y2gpO1xyXG5cclxuICAgIC8vIExvZyBtYXRjaCBjcmVhdGlvbiBmb3IgYW5hbHl0aWNzXHJcbiAgICBjb25zb2xlLmxvZyhgTWF0Y2ggc3VjY2Vzc2Z1bGx5IHByb2Nlc3NlZDogJHttYXRjaC50aXRsZX0gKCR7bWF0Y2gubWVkaWFUeXBlfSkgbWF0Y2hlZCBieSB1c2VyczogJHttYXRjaC5tYXRjaGVkVXNlcnMuam9pbignLCAnKX1gKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIG5vdGlmeU1hdGNoVG9Vc2VycyhtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBTZW5kaW5nIG1hdGNoIG5vdGlmaWNhdGlvbnMgdG8gJHttYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RofSB1c2Vyc2ApO1xyXG4gICAgICBcclxuICAgICAgLy8gSW4gYSByZWFsIGltcGxlbWVudGF0aW9uLCB5b3Ugd291bGQgdXNlIEFwcFN5bmMgc3Vic2NyaXB0aW9ucyBvciBwdXNoIG5vdGlmaWNhdGlvbnNcclxuICAgICAgLy8gRm9yIG5vdywgd2UnbGwgbG9nIHRoZSBub3RpZmljYXRpb24gYW5kIHN0b3JlIGl0IGZvciB0aGUgZnJvbnRlbmQgdG8gcG9sbFxyXG4gICAgICBcclxuICAgICAgY29uc3Qgbm90aWZpY2F0aW9uUHJvbWlzZXMgPSBtYXRjaC5tYXRjaGVkVXNlcnMubWFwKGFzeW5jICh1c2VySWQpID0+IHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgLy8gU3RvcmUgbm90aWZpY2F0aW9uIGluIHVzZXIncyByZWNvcmQgb3Igc2VuZCB2aWEgQXBwU3luYyBzdWJzY3JpcHRpb25cclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBOb3RpZnlpbmcgdXNlciAke3VzZXJJZH0gYWJvdXQgbWF0Y2g6ICR7bWF0Y2gudGl0bGV9YCk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIEhlcmUgeW91IHdvdWxkIHR5cGljYWxseTpcclxuICAgICAgICAgIC8vIDEuIFNlbmQgQXBwU3luYyBzdWJzY3JpcHRpb24gbm90aWZpY2F0aW9uXHJcbiAgICAgICAgICAvLyAyLiBTZW5kIHB1c2ggbm90aWZpY2F0aW9uXHJcbiAgICAgICAgICAvLyAzLiBTdG9yZSBub3RpZmljYXRpb24gaW4gdXNlcidzIGluYm94XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIHJldHVybiB7IHVzZXJJZCwgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKGBGYWlsZWQgdG8gbm90aWZ5IHVzZXIgJHt1c2VySWR9OmAsIGVycm9yKTtcclxuICAgICAgICAgIHJldHVybiB7IHVzZXJJZCwgc3VjY2VzczogZmFsc2UsIGVycm9yIH07XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQobm90aWZpY2F0aW9uUHJvbWlzZXMpO1xyXG4gICAgICBjb25zdCBzdWNjZXNzZnVsID0gcmVzdWx0cy5maWx0ZXIociA9PiByLnN0YXR1cyA9PT0gJ2Z1bGZpbGxlZCcpLmxlbmd0aDtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGBNYXRjaCBub3RpZmljYXRpb25zIHNlbnQ6ICR7c3VjY2Vzc2Z1bH0vJHttYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RofSBzdWNjZXNzZnVsYCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzZW5kaW5nIG1hdGNoIG5vdGlmaWNhdGlvbnM6JywgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgY2hlY2tSb29tTWF0Y2gocm9vbUlkOiBzdHJpbmcpOiBQcm9taXNlPE1hdGNoIHwgbnVsbD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYENoZWNraW5nIGZvciBleGlzdGluZyBtYXRjaCBpbiByb29tOiAke3Jvb21JZH1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFF1ZXJ5IG1hdGNoZXMgdGFibGUgZm9yIGFueSBtYXRjaCBpbiB0aGlzIHJvb21cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFF1ZXJ5Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBLZXlDb25kaXRpb25FeHByZXNzaW9uOiAncm9vbUlkID0gOnJvb21JZCcsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzpyb29tSWQnOiByb29tSWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBMaW1pdDogMSwgLy8gV2Ugb25seSBuZWVkIHRvIGtub3cgaWYgdGhlcmUncyBhbnkgbWF0Y2hcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgaWYgKHJlc3VsdC5JdGVtcyAmJiByZXN1bHQuSXRlbXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnN0IG1hdGNoID0gcmVzdWx0Lkl0ZW1zWzBdIGFzIE1hdGNoO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCBleGlzdGluZyBtYXRjaCBpbiByb29tICR7cm9vbUlkfTogJHttYXRjaC50aXRsZX1gKTtcclxuICAgICAgICByZXR1cm4gbWF0Y2g7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnNvbGUubG9nKGBObyBtYXRjaCBmb3VuZCBpbiByb29tOiAke3Jvb21JZH1gKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBjaGVja2luZyByb29tIG1hdGNoIGZvciAke3Jvb21JZH06YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGdldFVzZXJNYXRjaGVzKHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxNYXRjaFtdPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgR2V0dGluZyBtYXRjaGVzIGZvciB1c2VyOiAke3VzZXJJZH1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFNjYW4gdGhlIG1hdGNoZXMgdGFibGUgYW5kIGZpbHRlciBieSBtYXRjaGVkVXNlcnMgYXJyYXlcclxuICAgICAgLy8gU2luY2Ugd2Ugc3RvcmUgbWF0Y2hlcyB3aXRoIG1hdGNoZWRVc2VycyBhcyBhbiBhcnJheSwgd2UgbmVlZCB0byBzY2FuIGFuZCBmaWx0ZXJcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFNjYW5Db21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdjb250YWlucyhtYXRjaGVkVXNlcnMsIDp1c2VySWQpJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIExpbWl0OiA1MCxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgbWF0Y2hlcyA9IChyZXN1bHQuSXRlbXMgfHwgW10pIGFzIE1hdGNoW107XHJcbiAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke21hdGNoZXMubGVuZ3RofSBtYXRjaGVzIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICBcclxuICAgICAgLy8gU29ydCBieSB0aW1lc3RhbXAgZGVzY2VuZGluZyAobmV3ZXN0IGZpcnN0KVxyXG4gICAgICBtYXRjaGVzLnNvcnQoKGEsIGIpID0+IG5ldyBEYXRlKGIudGltZXN0YW1wKS5nZXRUaW1lKCkgLSBuZXcgRGF0ZShhLnRpbWVzdGFtcCkuZ2V0VGltZSgpKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiBtYXRjaGVzO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIGdldHRpbmcgdXNlciBtYXRjaGVzOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgY2hlY2tVc2VyTWF0Y2hlcyh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8TWF0Y2hbXT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYPCflI0gQ2hlY2tpbmcgZm9yIEFOWSBtYXRjaGVzIGZvciB1c2VyOiAke3VzZXJJZH1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFNjYW4gdGhlIG1hdGNoZXMgdGFibGUgYW5kIGZpbHRlciBieSBtYXRjaGVkVXNlcnMgYXJyYXlcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFNjYW5Db21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdjb250YWlucyhtYXRjaGVkVXNlcnMsIDp1c2VySWQpJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIExpbWl0OiAxMCxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgbWF0Y2hlcyA9IChyZXN1bHQuSXRlbXMgfHwgW10pIGFzIE1hdGNoW107XHJcbiAgICAgIGNvbnNvbGUubG9nKGDinIUgRm91bmQgJHttYXRjaGVzLmxlbmd0aH0gbWF0Y2hlcyBmb3IgdXNlciAke3VzZXJJZH1gKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChtYXRjaGVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+TiyBSZWNlbnQgbWF0Y2hlczpgLCBtYXRjaGVzLm1hcChtID0+ICh7XHJcbiAgICAgICAgICBpZDogbS5pZCxcclxuICAgICAgICAgIHRpdGxlOiBtLnRpdGxlLFxyXG4gICAgICAgICAgcm9vbUlkOiBtLnJvb21JZCxcclxuICAgICAgICAgIHRpbWVzdGFtcDogbS50aW1lc3RhbXBcclxuICAgICAgICB9KSkpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBTb3J0IGJ5IHRpbWVzdGFtcCBkZXNjZW5kaW5nIChuZXdlc3QgZmlyc3QpXHJcbiAgICAgIG1hdGNoZXMuc29ydCgoYSwgYikgPT4gbmV3IERhdGUoYi50aW1lc3RhbXApLmdldFRpbWUoKSAtIG5ldyBEYXRlKGEudGltZXN0YW1wKS5nZXRUaW1lKCkpO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIG1hdGNoZXM7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGNoZWNraW5nIHVzZXIgbWF0Y2hlczonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBbXTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc2NhblVzZXJNYXRjaGVzKHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxNYXRjaFtdPiB7XHJcbiAgICBjb25zb2xlLmxvZyhgU2Nhbm5pbmcgbWF0Y2hlcyBmb3IgdXNlcjogJHt1c2VySWR9IChmYWxsYmFjayBtZXRob2QpYCk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFNjYW4gdGhlIGVudGlyZSBtYXRjaGVzIHRhYmxlIGFuZCBmaWx0ZXIgYnkgdXNlclxyXG4gICAgICAvLyBUaGlzIGlzIGluZWZmaWNpZW50IGJ1dCB3b3JrcyBhcyBhIGZhbGxiYWNrXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBTY2FuQ29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnY29udGFpbnMobWF0Y2hlZFVzZXJzLCA6dXNlcklkKScsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBMaW1pdDogNTAsXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSAocmVzdWx0Lkl0ZW1zIHx8IFtdKSBhcyBNYXRjaFtdO1xyXG4gICAgICBjb25zb2xlLmxvZyhgU2NhbiBmb3VuZCAke21hdGNoZXMubGVuZ3RofSBtYXRjaGVzIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIG1hdGNoZXM7XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igc2Nhbm5pbmcgdXNlciBtYXRjaGVzOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyB1cGRhdGVVc2VyQWN0aXZpdHkodXNlcklkczogc3RyaW5nW10pOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIC8vIFNraXAgaWYgVVNFUlNfVEFCTEUgaXMgbm90IGNvbmZpZ3VyZWRcclxuICAgIGlmICghdGhpcy51c2Vyc1RhYmxlKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdTa2lwcGluZyB1c2VyIGFjdGl2aXR5IHVwZGF0ZSAtIFVTRVJTX1RBQkxFIG5vdCBjb25maWd1cmVkJyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcblxyXG4gICAgLy8gVXBkYXRlIGxhc3RBY3RpdmVBdCBmb3IgYWxsIG1hdGNoZWQgdXNlcnNcclxuICAgIGNvbnN0IHVwZGF0ZVByb21pc2VzID0gdXNlcklkcy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIENoZWNrIGlmIHVzZXIgZXhpc3RzLCBjcmVhdGUgaWYgbm90XHJcbiAgICAgICAgY29uc3QgZXhpc3RpbmdVc2VyID0gYXdhaXQgdGhpcy5nZXRVc2VyKHVzZXJJZCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGV4aXN0aW5nVXNlcikge1xyXG4gICAgICAgICAgLy8gVXBkYXRlIGV4aXN0aW5nIHVzZXIncyBsYXN0IGFjdGl2aXR5XHJcbiAgICAgICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy51c2Vyc1RhYmxlLFxyXG4gICAgICAgICAgICBJdGVtOiB7XHJcbiAgICAgICAgICAgICAgLi4uZXhpc3RpbmdVc2VyLFxyXG4gICAgICAgICAgICAgIGxhc3RBY3RpdmVBdDogdGltZXN0YW1wLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfSkpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAvLyBDcmVhdGUgbmV3IHVzZXIgcmVjb3JkXHJcbiAgICAgICAgICBjb25zdCBuZXdVc2VyOiBVc2VyID0ge1xyXG4gICAgICAgICAgICBpZDogdXNlcklkLFxyXG4gICAgICAgICAgICBlbWFpbDogJycsIC8vIFdpbGwgYmUgcG9wdWxhdGVkIGZyb20gQ29nbml0byB3aGVuIGF2YWlsYWJsZVxyXG4gICAgICAgICAgICBjcmVhdGVkQXQ6IHRpbWVzdGFtcCxcclxuICAgICAgICAgICAgbGFzdEFjdGl2ZUF0OiB0aW1lc3RhbXAsXHJcbiAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnVzZXJzVGFibGUsXHJcbiAgICAgICAgICAgIEl0ZW06IG5ld1VzZXIsXHJcbiAgICAgICAgICAgIENvbmRpdGlvbkV4cHJlc3Npb246ICdhdHRyaWJ1dGVfbm90X2V4aXN0cyhpZCknLCAvLyBQcmV2ZW50IG92ZXJ3cml0aW5nXHJcbiAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zb2xlLmxvZyhgVXBkYXRlZCBhY3Rpdml0eSBmb3IgdXNlcjogJHt1c2VySWR9YCk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgdXBkYXRpbmcgdXNlciBhY3Rpdml0eSBmb3IgJHt1c2VySWR9OmAsIGVycm9yKTtcclxuICAgICAgICAvLyBDb250aW51ZSB3aXRoIG90aGVyIHVzZXJzIGV2ZW4gaWYgb25lIGZhaWxzXHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZCh1cGRhdGVQcm9taXNlcyk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldFVzZXIodXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPFVzZXIgfCBudWxsPiB7XHJcbiAgICAvLyBTa2lwIGlmIFVTRVJTX1RBQkxFIGlzIG5vdCBjb25maWd1cmVkXHJcbiAgICBpZiAoIXRoaXMudXNlcnNUYWJsZSkge1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgR2V0Q29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLnVzZXJzVGFibGUsXHJcbiAgICAgICAgS2V5OiB7IGlkOiB1c2VySWQgfSxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgcmV0dXJuIHJlc3VsdC5JdGVtIGFzIFVzZXIgfHwgbnVsbDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGdldHRpbmcgdXNlciAke3VzZXJJZH06YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIHByb2Nlc3NNYXRjaE5vdGlmaWNhdGlvbihtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIC8vIEZ1dHVyZSBpbXBsZW1lbnRhdGlvbiBmb3IgcmVhbC10aW1lIG5vdGlmaWNhdGlvbnNcclxuICAgIC8vIENvdWxkIGludGVncmF0ZSB3aXRoOlxyXG4gICAgLy8gLSBBcHBTeW5jIHN1YnNjcmlwdGlvbnNcclxuICAgIC8vIC0gU05TIGZvciBwdXNoIG5vdGlmaWNhdGlvbnNcclxuICAgIC8vIC0gV2ViU29ja2V0IGNvbm5lY3Rpb25zXHJcbiAgICAvLyAtIEVtYWlsIG5vdGlmaWNhdGlvbnNcclxuXHJcbiAgICBjb25zb2xlLmxvZyhgTWF0Y2ggbm90aWZpY2F0aW9uOiAke21hdGNoLnRpdGxlfSBtYXRjaGVkIGluIHJvb20gJHttYXRjaC5yb29tSWR9YCk7XHJcbiAgICBcclxuICAgIC8vIEZvciBNVlAsIGp1c3QgbG9nIHRoZSBub3RpZmljYXRpb25cclxuICAgIC8vIEluIHByb2R1Y3Rpb24sIGltcGxlbWVudCBhY3R1YWwgbm90aWZpY2F0aW9uIGRlbGl2ZXJ5XHJcbiAgfVxyXG59XHJcblxyXG4vLyBMYW1iZGEgSGFuZGxlciBmb3IgQXBwU3luY1xyXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlciA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdNYXRjaCBMYW1iZGEgcmVjZWl2ZWQgQXBwU3luYyBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCkpO1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgbWF0Y2hTZXJ2aWNlID0gbmV3IE1hdGNoU2VydmljZSgpO1xyXG5cclxuICAgIC8vIEV4dHJhY3QgdXNlciBJRCBmcm9tIEFwcFN5bmMgY29udGV4dFxyXG4gICAgY29uc3QgdXNlcklkID0gZXZlbnQuaWRlbnRpdHk/LmNsYWltcz8uc3ViIHx8IGV2ZW50LmlkZW50aXR5Py51c2VybmFtZTtcclxuICAgIFxyXG4gICAgLy8gRGV0ZXJtaW5lIG9wZXJhdGlvbiBmcm9tIEFwcFN5bmMgZmllbGQgbmFtZVxyXG4gICAgY29uc3QgZmllbGROYW1lID0gZXZlbnQuaW5mbz8uZmllbGROYW1lO1xyXG4gICAgXHJcbiAgICBzd2l0Y2ggKGZpZWxkTmFtZSkge1xyXG4gICAgICBjYXNlICdnZXRNeU1hdGNoZXMnOiB7XHJcbiAgICAgICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1VzZXIgbm90IGF1dGhlbnRpY2F0ZWQgZm9yIGdldE15TWF0Y2hlcycpO1xyXG4gICAgICAgICAgcmV0dXJuIFtdOyAvLyBSZXR1cm4gZW1wdHkgYXJyYXkgaW5zdGVhZCBvZiB0aHJvd2luZ1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGNvbnN0IG1hdGNoZXMgPSBhd2FpdCBtYXRjaFNlcnZpY2UuZ2V0VXNlck1hdGNoZXModXNlcklkKTtcclxuICAgICAgICAgIHJldHVybiBtYXRjaGVzIHx8IFtdOyAvLyBFbnN1cmUgd2UgYWx3YXlzIHJldHVybiBhbiBhcnJheVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBnZXRNeU1hdGNoZXM6JywgZXJyb3IpO1xyXG4gICAgICAgICAgcmV0dXJuIFtdOyAvLyBSZXR1cm4gZW1wdHkgYXJyYXkgb24gZXJyb3JcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2NoZWNrVXNlck1hdGNoZXMnOiB7XHJcbiAgICAgICAgaWYgKCF1c2VySWQpIHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1VzZXIgbm90IGF1dGhlbnRpY2F0ZWQgZm9yIGNoZWNrVXNlck1hdGNoZXMnKTtcclxuICAgICAgICAgIHJldHVybiBbXTsgLy8gUmV0dXJuIGVtcHR5IGFycmF5IGluc3RlYWQgb2YgdGhyb3dpbmdcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBjb25zdCBtYXRjaGVzID0gYXdhaXQgbWF0Y2hTZXJ2aWNlLmNoZWNrVXNlck1hdGNoZXModXNlcklkKTtcclxuICAgICAgICAgIHJldHVybiBtYXRjaGVzIHx8IFtdOyAvLyBFbnN1cmUgd2UgYWx3YXlzIHJldHVybiBhbiBhcnJheVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBpbiBjaGVja1VzZXJNYXRjaGVzOicsIGVycm9yKTtcclxuICAgICAgICAgIHJldHVybiBbXTsgLy8gUmV0dXJuIGVtcHR5IGFycmF5IG9uIGVycm9yXHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdjaGVja1Jvb21NYXRjaCc6IHtcclxuICAgICAgICBjb25zdCB7IHJvb21JZCB9ID0gZXZlbnQuYXJndW1lbnRzO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghcm9vbUlkKSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Jvb20gSUQgaXMgcmVxdWlyZWQnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IG1hdGNoID0gYXdhaXQgbWF0Y2hTZXJ2aWNlLmNoZWNrUm9vbU1hdGNoKHJvb21JZCk7XHJcbiAgICAgICAgcmV0dXJuIG1hdGNoO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdjcmVhdGVNYXRjaCc6IHtcclxuICAgICAgICBjb25zdCB7IGlucHV0IH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ3JlYXRlIHRoZSBtYXRjaCBvYmplY3RcclxuICAgICAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XHJcbiAgICAgICAgY29uc3QgbWF0Y2hJZCA9IGAke2lucHV0LnJvb21JZH0jJHtpbnB1dC5tb3ZpZUlkfWA7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgbWF0Y2g6IE1hdGNoID0ge1xyXG4gICAgICAgICAgaWQ6IG1hdGNoSWQsXHJcbiAgICAgICAgICByb29tSWQ6IGlucHV0LnJvb21JZCxcclxuICAgICAgICAgIG1vdmllSWQ6IGlucHV0Lm1vdmllSWQsXHJcbiAgICAgICAgICB0aXRsZTogaW5wdXQudGl0bGUsXHJcbiAgICAgICAgICBwb3N0ZXJQYXRoOiBpbnB1dC5wb3N0ZXJQYXRoLFxyXG4gICAgICAgICAgbWVkaWFUeXBlOiAnTU9WSUUnLCAvLyBEZWZhdWx0LCBzaG91bGQgYmUgcGFzc2VkIGZyb20gaW5wdXRcclxuICAgICAgICAgIG1hdGNoZWRVc2VyczogaW5wdXQubWF0Y2hlZFVzZXJzLFxyXG4gICAgICAgICAgdGltZXN0YW1wLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn46JIENyZWF0ZU1hdGNoIG11dGF0aW9uIGV4ZWN1dGVkIHZpYSBBcHBTeW5jIHJlc29sdmVyYCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk6EgVGhpcyB3aWxsIGF1dG9tYXRpY2FsbHkgdHJpZ2dlciBBcHBTeW5jIHN1YnNjcmlwdGlvbnNgKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+OrCBNYXRjaDogJHttYXRjaC50aXRsZX1gKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+RpSBOb3RpZnlpbmcgJHttYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RofSB1c2VyczogJHttYXRjaC5tYXRjaGVkVXNlcnMuam9pbignLCAnKX1gKTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbWF0Y2g7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ3B1Ymxpc2hSb29tTWF0Y2gnOiB7XHJcbiAgICAgICAgY29uc3QgeyByb29tSWQsIG1hdGNoRGF0YSB9ID0gZXZlbnQuYXJndW1lbnRzO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5qAIENSSVRJQ0FMIEZJWDogUHJvY2Vzc2luZyBwdWJsaXNoUm9vbU1hdGNoIGZvciByb29tOiAke3Jvb21JZH1gKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+OrCBNb3ZpZTogJHttYXRjaERhdGEubW92aWVUaXRsZX1gKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+RpSBNYXRjaGVkIHVzZXJzOiAke21hdGNoRGF0YS5tYXRjaGVkVXNlcnMuam9pbignLCAnKX1gKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBSZXR1cm4gdGhlIHJvb21NYXRjaEV2ZW50IHN0cnVjdHVyZSB0aGF0IEFwcFN5bmMgZXhwZWN0c1xyXG4gICAgICAgIGNvbnN0IHJvb21NYXRjaEV2ZW50ID0ge1xyXG4gICAgICAgICAgcm9vbUlkOiByb29tSWQsXHJcbiAgICAgICAgICBtYXRjaElkOiBtYXRjaERhdGEubWF0Y2hJZCxcclxuICAgICAgICAgIG1vdmllSWQ6IFN0cmluZyhtYXRjaERhdGEubW92aWVJZCksXHJcbiAgICAgICAgICBtb3ZpZVRpdGxlOiBtYXRjaERhdGEubW92aWVUaXRsZSxcclxuICAgICAgICAgIHBvc3RlclBhdGg6IG1hdGNoRGF0YS5wb3N0ZXJQYXRoIHx8IG51bGwsXHJcbiAgICAgICAgICBtYXRjaGVkVXNlcnM6IG1hdGNoRGF0YS5tYXRjaGVkVXNlcnMsXHJcbiAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICAgIG1hdGNoRGV0YWlsczogbWF0Y2hEYXRhLm1hdGNoRGV0YWlsc1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5OhIFJldHVybmluZyByb29tTWF0Y2hFdmVudCBmb3IgQXBwU3luYyBzdWJzY3JpcHRpb24gdHJpZ2dlcicpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiByb29tTWF0Y2hFdmVudDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY2FzZSAncHVibGlzaFVzZXJNYXRjaCc6IHtcclxuICAgICAgICBjb25zdCB7IHVzZXJJZDogdGFyZ2V0VXNlcklkLCBtYXRjaERhdGEgfSA9IGV2ZW50LmFyZ3VtZW50cztcclxuICAgICAgICBcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+agCBQcm9jZXNzaW5nIHB1Ymxpc2hVc2VyTWF0Y2ggZm9yIHVzZXI6ICR7dGFyZ2V0VXNlcklkfWApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn46sIE1vdmllOiAke21hdGNoRGF0YS5tb3ZpZVRpdGxlfWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFJldHVybiB0aGUgdXNlck1hdGNoRXZlbnQgc3RydWN0dXJlIHRoYXQgQXBwU3luYyBleHBlY3RzXHJcbiAgICAgICAgY29uc3QgdXNlck1hdGNoRXZlbnQgPSB7XHJcbiAgICAgICAgICB1c2VySWQ6IHRhcmdldFVzZXJJZCxcclxuICAgICAgICAgIHJvb21JZDogbWF0Y2hEYXRhLnJvb21JZCxcclxuICAgICAgICAgIG1hdGNoSWQ6IG1hdGNoRGF0YS5tYXRjaElkLFxyXG4gICAgICAgICAgbW92aWVJZDogU3RyaW5nKG1hdGNoRGF0YS5tb3ZpZUlkKSxcclxuICAgICAgICAgIG1vdmllVGl0bGU6IG1hdGNoRGF0YS5tb3ZpZVRpdGxlLFxyXG4gICAgICAgICAgcG9zdGVyUGF0aDogbWF0Y2hEYXRhLnBvc3RlclBhdGggfHwgbnVsbCxcclxuICAgICAgICAgIG1hdGNoZWRVc2VyczogbWF0Y2hEYXRhLm1hdGNoZWRVc2VycyxcclxuICAgICAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAgICAgbWF0Y2hEZXRhaWxzOiBtYXRjaERhdGEubWF0Y2hEZXRhaWxzXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coJ/Cfk6EgUmV0dXJuaW5nIHVzZXJNYXRjaEV2ZW50IGZvciBBcHBTeW5jIHN1YnNjcmlwdGlvbiB0cmlnZ2VyJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHVzZXJNYXRjaEV2ZW50O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBkZWZhdWx0OlxyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBmaWVsZDogJHtmaWVsZE5hbWV9YCk7XHJcbiAgICB9XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdNYXRjaCBMYW1iZGEgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgXHJcbiAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yIG9jY3VycmVkJztcclxuICAgIHRocm93IG5ldyBFcnJvcihlcnJvck1lc3NhZ2UpO1xyXG4gIH1cclxufTsiXX0=