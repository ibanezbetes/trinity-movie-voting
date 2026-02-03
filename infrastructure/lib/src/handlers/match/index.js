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
                    throw new Error('User not authenticated');
                }
                const matches = await matchService.getUserMatches(userId);
                return matches;
            }
            case 'checkUserMatches': {
                if (!userId) {
                    throw new Error('User not authenticated');
                }
                const matches = await matchService.checkUserMatches(userId);
                return matches;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvbWF0Y2gvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsOERBQTBEO0FBQzFELHdEQUFrSDtBQUVsSCx5QkFBeUI7QUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFzRjVELGdCQUFnQjtBQUNoQixNQUFNLFlBQVk7SUFJaEI7UUFDRSxJQUFJLENBQUMsWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxJQUFJLEVBQUUsQ0FBQztRQUNwRCxJQUFJLENBQUMsVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQztRQUVoRCxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUMzQyxNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxDQUFDLENBQUM7UUFDdEUsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsa0JBQWtCLENBQUMsS0FBWTtRQUNuQyxPQUFPLENBQUMsR0FBRyxDQUFDLDZCQUE2QixLQUFLLENBQUMsRUFBRSxTQUFTLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTSxRQUFRLENBQUMsQ0FBQztRQUU3Riw2Q0FBNkM7UUFDN0MsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRWxELDBDQUEwQztRQUMxQyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUVyQyxtQ0FBbUM7UUFDbkMsT0FBTyxDQUFDLEdB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QU8sRUFBRSxNQUFNLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQztvQkFDbEMsVUFBVSxFQUFFLFNBQVMsQ0FBQyxVQUFVO29CQUNoQyxVQUFVLEVBQUUsU0FBUyxDQUFDLFVBQVUsSUFBSSxJQUFJO29CQUN4QyxZQUFZLEVBQUUsU0FBUyxDQUFDLFlBQVk7b0JBQ3BDLFNBQVMsRUFBRSxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRTtvQkFDbkMsWUFBWSxFQUFFLFNBQVMsQ0FBQyxZQUFZO2lCQUNyQyxDQUFDO2dCQUVGLE9BQU8sQ0FBQyxHQUFHLENBQUMsOERBQThELENBQUMsQ0FBQztnQkFFNUUsT0FBTyxjQUFjLENBQUM7WUFDeEIsQ0FBQztZQUVEO2dCQUNFLE1BQU0sSUFBSSxLQUFLLENBQUMsa0JBQWtCLFNBQVMsRUFBRSxDQUFDLENBQUM7UUFDbkQsQ0FBQztJQUVILENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxxQkFBcUIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUU1QyxNQUFNLFlBQVksR0FBRyxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyx3QkFBd0IsQ0FBQztRQUN2RixNQUFNLElBQUksS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO0lBQ2hDLENBQUM7QUFDSCxDQUFDLENBQUM7QUE5SFcsUUFBQSxPQUFPLFdBOEhsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBRdWVyeUNvbW1hbmQsIEdldENvbW1hbmQsIFB1dENvbW1hbmQsIFNjYW5Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcclxuXHJcbi8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcclxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KTtcclxuXHJcbi8vIFR5cGVzXHJcbmludGVyZmFjZSBNYXRjaCB7XHJcbiAgaWQ6IHN0cmluZztcclxuICByb29tSWQ6IHN0cmluZztcclxuICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBwb3N0ZXJQYXRoPzogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgbWF0Y2hlZFVzZXJzOiBzdHJpbmdbXTtcclxuICB0aW1lc3RhbXA6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIFVzZXIge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgZW1haWw6IHN0cmluZztcclxuICBjcmVhdGVkQXQ6IHN0cmluZztcclxuICBsYXN0QWN0aXZlQXQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIENyZWF0ZU1hdGNoRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2NyZWF0ZU1hdGNoJztcclxuICBpbnB1dDoge1xyXG4gICAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgICB0aXRsZTogc3RyaW5nO1xyXG4gICAgcG9zdGVyUGF0aD86IHN0cmluZztcclxuICAgIG1hdGNoZWRVc2Vyczogc3RyaW5nW107XHJcbiAgfTtcclxufVxyXG5cclxuaW50ZXJmYWNlIEdldFVzZXJNYXRjaGVzRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2dldFVzZXJNYXRjaGVzJztcclxuICB1c2VySWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIENoZWNrUm9vbU1hdGNoRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2NoZWNrUm9vbU1hdGNoJztcclxuICByb29tSWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIE5vdGlmeU1hdGNoRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ25vdGlmeU1hdGNoJztcclxuICBtYXRjaDogTWF0Y2g7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNYXRjaENyZWF0ZWRFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnbWF0Y2hDcmVhdGVkJztcclxuICBtYXRjaDogTWF0Y2g7XHJcbn1cclxuXHJcbmludGVyZmFjZSBDaGVja1VzZXJNYXRjaGVzRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2NoZWNrVXNlck1hdGNoZXMnO1xyXG4gIHVzZXJJZDogc3RyaW5nO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgUHVibGlzaFJvb21NYXRjaEV2ZW50IHtcclxuICBvcGVyYXRpb246ICdwdWJsaXNoUm9vbU1hdGNoJztcclxuICByb29tSWQ6IHN0cmluZztcclxuICBtYXRjaERhdGE6IHtcclxuICAgIG1hdGNoSWQ6IHN0cmluZztcclxuICAgIG1vdmllSWQ6IHN0cmluZztcclxuICAgIG1vdmllVGl0bGU6IHN0cmluZztcclxuICAgIHBvc3RlclBhdGg/OiBzdHJpbmc7XHJcbiAgICBtYXRjaGVkVXNlcnM6IHN0cmluZ1tdO1xyXG4gICAgbWF0Y2hEZXRhaWxzOiB7XHJcbiAgICAgIHZvdGVDb3VudDogbnVtYmVyO1xyXG4gICAgICByZXF1aXJlZFZvdGVzOiBudW1iZXI7XHJcbiAgICAgIG1hdGNoVHlwZTogc3RyaW5nO1xyXG4gICAgfTtcclxuICB9O1xyXG59XHJcblxyXG50eXBlIE1hdGNoRXZlbnQgPSBDcmVhdGVNYXRjaEV2ZW50IHwgTWF0Y2hDcmVhdGVkRXZlbnQgfCBHZXRVc2VyTWF0Y2hlc0V2ZW50IHwgQ2hlY2tSb29tTWF0Y2hFdmVudCB8IENoZWNrVXNlck1hdGNoZXNFdmVudCB8IE5vdGlmeU1hdGNoRXZlbnQgfCBQdWJsaXNoUm9vbU1hdGNoRXZlbnQ7XHJcblxyXG5pbnRlcmZhY2UgTWF0Y2hSZXNwb25zZSB7XHJcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xyXG4gIGJvZHk6IHtcclxuICAgIG1hdGNoZXM/OiBNYXRjaFtdO1xyXG4gICAgbWF0Y2g/OiBNYXRjaDtcclxuICAgIHN1Y2Nlc3M/OiBib29sZWFuO1xyXG4gICAgZXJyb3I/OiBzdHJpbmc7XHJcbiAgfTtcclxufVxyXG5cclxuLy8gTWF0Y2ggU2VydmljZVxyXG5jbGFzcyBNYXRjaFNlcnZpY2Uge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbWF0Y2hlc1RhYmxlOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB1c2Vyc1RhYmxlOiBzdHJpbmc7XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5tYXRjaGVzVGFibGUgPSBwcm9jZXNzLmVudi5NQVRDSEVTX1RBQkxFIHx8ICcnO1xyXG4gICAgdGhpcy51c2Vyc1RhYmxlID0gcHJvY2Vzcy5lbnYuVVNFUlNfVEFCTEUgfHwgJyc7XHJcblxyXG4gICAgaWYgKCF0aGlzLm1hdGNoZXNUYWJsZSB8fCAhdGhpcy51c2Vyc1RhYmxlKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVxdWlyZWQgdGFibGUgZW52aXJvbm1lbnQgdmFyaWFibGVzIGFyZSBtaXNzaW5nJyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBoYW5kbGVNYXRjaENyZWF0ZWQobWF0Y2g6IE1hdGNoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zb2xlLmxvZyhgUHJvY2Vzc2luZyBtYXRjaCBjcmVhdGVkOiAke21hdGNoLmlkfSB3aXRoICR7bWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aH0gdXNlcnNgKTtcclxuXHJcbiAgICAvLyBVcGRhdGUgdXNlciBhY3Rpdml0eSBmb3IgYWxsIG1hdGNoZWQgdXNlcnNcclxuICAgIGF3YWl0IHRoaXMudXBkYXRlVXNlckFjdGl2aXR5KG1hdGNoLm1hdGNoZWRVc2Vycyk7XHJcblxyXG4gICAgLy8gU2VuZCBub3RpZmljYXRpb25zIHRvIGFsbCBtYXRjaGVkIHVzZXJzXHJcbiAgICBhd2FpdCB0aGlzLm5vdGlmeU1hdGNoVG9Vc2VycyhtYXRjaCk7XHJcblxyXG4gICAgLy8gTG9nIG1hdGNoIGNyZWF0aW9uIGZvciBhbmFseXRpY3NcclxuICAgIGNvbnNvbGUubG9nKGBNYXRjaCBzdWNjZXNzZnVsbHkgcHJvY2Vzc2VkOiAke21hdGNoLnRpdGxlfSAoJHttYXRjaC5tZWRpYVR5cGV9KSBtYXRjaGVkIGJ5IHVzZXJzOiAke21hdGNoLm1hdGNoZWRVc2Vycy5qb2luKCcsICcpfWApO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgbm90aWZ5TWF0Y2hUb1VzZXJzKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYFNlbmRpbmcgbWF0Y2ggbm90aWZpY2F0aW9ucyB0byAke21hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGh9IHVzZXJzYCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBJbiBhIHJlYWwgaW1wbGVtZW50YXRpb24sIHlvdSB3b3VsZCB1c2UgQXBwU3luYyBzdWJzY3JpcHRpb25zIG9yIHB1c2ggbm90aWZpY2F0aW9uc1xyXG4gICAgICAvLyBGb3Igbm93LCB3ZSdsbCBsb2cgdGhlIG5vdGlmaWNhdGlvbiBhbmQgc3RvcmUgaXQgZm9yIHRoZSBmcm9udGVuZCB0byBwb2xsXHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBub3RpZmljYXRpb25Qcm9taXNlcyA9IG1hdGNoLm1hdGNoZWRVc2Vycy5tYXAoYXN5bmMgKHVzZXJJZCkgPT4ge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAvLyBTdG9yZSBub3RpZmljYXRpb24gaW4gdXNlcidzIHJlY29yZCBvciBzZW5kIHZpYSBBcHBTeW5jIHN1YnNjcmlwdGlvblxyXG4gICAgICAgICAgY29uc29sZS5sb2coYE5vdGlmeWluZyB1c2VyICR7dXNlcklkfSBhYm91dCBtYXRjaDogJHttYXRjaC50aXRsZX1gKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gSGVyZSB5b3Ugd291bGQgdHlwaWNhbGx5OlxyXG4gICAgICAgICAgLy8gMS4gU2VuZCBBcHBTeW5jIHN1YnNjcmlwdGlvbiBub3RpZmljYXRpb25cclxuICAgICAgICAgIC8vIDIuIFNlbmQgcHVzaCBub3RpZmljYXRpb25cclxuICAgICAgICAgIC8vIDMuIFN0b3JlIG5vdGlmaWNhdGlvbiBpbiB1c2VyJ3MgaW5ib3hcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgcmV0dXJuIHsgdXNlcklkLCBzdWNjZXNzOiB0cnVlIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYEZhaWxlZCB0byBub3RpZnkgdXNlciAke3VzZXJJZH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgcmV0dXJuIHsgdXNlcklkLCBzdWNjZXNzOiBmYWxzZSwgZXJyb3IgfTtcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IFByb21pc2UuYWxsU2V0dGxlZChub3RpZmljYXRpb25Qcm9taXNlcyk7XHJcbiAgICAgIGNvbnN0IHN1Y2Nlc3NmdWwgPSByZXN1bHRzLmZpbHRlcihyID0+IHIuc3RhdHVzID09PSAnZnVsZmlsbGVkJykubGVuZ3RoO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coYE1hdGNoIG5vdGlmaWNhdGlvbnMgc2VudDogJHtzdWNjZXNzZnVsfS8ke21hdGNoLm1hdGNoZWRVc2Vycy5sZW5ndGh9IHN1Y2Nlc3NmdWxgKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHNlbmRpbmcgbWF0Y2ggbm90aWZpY2F0aW9uczonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBjaGVja1Jvb21NYXRjaChyb29tSWQ6IHN0cmluZyk6IFByb21pc2U8TWF0Y2ggfCBudWxsPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgQ2hlY2tpbmcgZm9yIGV4aXN0aW5nIG1hdGNoIGluIHJvb206ICR7cm9vbUlkfWApO1xyXG4gICAgICBcclxuICAgICAgLy8gUXVlcnkgbWF0Y2hlcyB0YWJsZSBmb3IgYW55IG1hdGNoIGluIHRoaXMgcm9vbVxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUXVlcnlDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgIEtleUNvbmRpdGlvbkV4cHJlc3Npb246ICdyb29tSWQgPSA6cm9vbUlkJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnJvb21JZCc6IHJvb21JZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIExpbWl0OiAxLCAvLyBXZSBvbmx5IG5lZWQgdG8ga25vdyBpZiB0aGVyZSdzIGFueSBtYXRjaFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBpZiAocmVzdWx0Lkl0ZW1zICYmIHJlc3VsdC5JdGVtcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc3QgbWF0Y2ggPSByZXN1bHQuSXRlbXNbMF0gYXMgTWF0Y2g7XHJcbiAgICAgICAgY29uc29sZS5sb2coYEZvdW5kIGV4aXN0aW5nIG1hdGNoIGluIHJvb20gJHtyb29tSWR9OiAke21hdGNoLnRpdGxlfWApO1xyXG4gICAgICAgIHJldHVybiBtYXRjaDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc29sZS5sb2coYE5vIG1hdGNoIGZvdW5kIGluIHJvb206ICR7cm9vbUlkfWApO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIGNoZWNraW5nIHJvb20gbWF0Y2ggZm9yICR7cm9vbUlkfTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgZ2V0VXNlck1hdGNoZXModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPE1hdGNoW10+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBHZXR0aW5nIG1hdGNoZXMgZm9yIHVzZXI6ICR7dXNlcklkfWApO1xyXG4gICAgICBcclxuICAgICAgLy8gU2NhbiB0aGUgbWF0Y2hlcyB0YWJsZSBhbmQgZmlsdGVyIGJ5IG1hdGNoZWRVc2VycyBhcnJheVxyXG4gICAgICAvLyBTaW5jZSB3ZSBzdG9yZSBtYXRjaGVzIHdpdGggbWF0Y2hlZFVzZXJzIGFzIGFuIGFycmF5LCB3ZSBuZWVkIHRvIHNjYW4gYW5kIGZpbHRlclxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgU2NhbkNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ2NvbnRhaW5zKG1hdGNoZWRVc2VycywgOnVzZXJJZCknLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6dXNlcklkJzogdXNlcklkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgTGltaXQ6IDUwLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBtYXRjaGVzID0gKHJlc3VsdC5JdGVtcyB8fCBbXSkgYXMgTWF0Y2hbXTtcclxuICAgICAgY29uc29sZS5sb2coYEZvdW5kICR7bWF0Y2hlcy5sZW5ndGh9IG1hdGNoZXMgZm9yIHVzZXIgJHt1c2VySWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBTb3J0IGJ5IHRpbWVzdGFtcCBkZXNjZW5kaW5nIChuZXdlc3QgZmlyc3QpXHJcbiAgICAgIG1hdGNoZXMuc29ydCgoYSwgYikgPT4gbmV3IERhdGUoYi50aW1lc3RhbXApLmdldFRpbWUoKSAtIG5ldyBEYXRlKGEudGltZXN0YW1wKS5nZXRUaW1lKCkpO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIG1hdGNoZXM7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2V0dGluZyB1c2VyIG1hdGNoZXM6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBjaGVja1VzZXJNYXRjaGVzKHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxNYXRjaFtdPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZyhg8J+UjSBDaGVja2luZyBmb3IgQU5ZIG1hdGNoZXMgZm9yIHVzZXI6ICR7dXNlcklkfWApO1xyXG4gICAgICBcclxuICAgICAgLy8gU2NhbiB0aGUgbWF0Y2hlcyB0YWJsZSBhbmQgZmlsdGVyIGJ5IG1hdGNoZWRVc2VycyBhcnJheVxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgU2NhbkNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgRmlsdGVyRXhwcmVzc2lvbjogJ2NvbnRhaW5zKG1hdGNoZWRVc2VycywgOnVzZXJJZCknLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6dXNlcklkJzogdXNlcklkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgTGltaXQ6IDEwLFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICBjb25zdCBtYXRjaGVzID0gKHJlc3VsdC5JdGVtcyB8fCBbXSkgYXMgTWF0Y2hbXTtcclxuICAgICAgY29uc29sZS5sb2coYOKchSBGb3VuZCAke21hdGNoZXMubGVuZ3RofSBtYXRjaGVzIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICBcclxuICAgICAgaWYgKG1hdGNoZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OLIFJlY2VudCBtYXRjaGVzOmAsIG1hdGNoZXMubWFwKG0gPT4gKHtcclxuICAgICAgICAgIGlkOiBtLmlkLFxyXG4gICAgICAgICAgdGl0bGU6IG0udGl0bGUsXHJcbiAgICAgICAgICByb29tSWQ6IG0ucm9vbUlkLFxyXG4gICAgICAgICAgdGltZXN0YW1wOiBtLnRpbWVzdGFtcFxyXG4gICAgICAgIH0pKSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFNvcnQgYnkgdGltZXN0YW1wIGRlc2NlbmRpbmcgKG5ld2VzdCBmaXJzdClcclxuICAgICAgbWF0Y2hlcy5zb3J0KChhLCBiKSA9PiBuZXcgRGF0ZShiLnRpbWVzdGFtcCkuZ2V0VGltZSgpIC0gbmV3IERhdGUoYS50aW1lc3RhbXApLmdldFRpbWUoKSk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gbWF0Y2hlcztcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgY2hlY2tpbmcgdXNlciBtYXRjaGVzOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzY2FuVXNlck1hdGNoZXModXNlcklkOiBzdHJpbmcpOiBQcm9taXNlPE1hdGNoW10+IHtcclxuICAgIGNvbnNvbGUubG9nKGBTY2FubmluZyBtYXRjaGVzIGZvciB1c2VyOiAke3VzZXJJZH0gKGZhbGxiYWNrIG1ldGhvZClgKTtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gU2NhbiB0aGUgZW50aXJlIG1hdGNoZXMgdGFibGUgYW5kIGZpbHRlciBieSB1c2VyXHJcbiAgICAgIC8vIFRoaXMgaXMgaW5lZmZpY2llbnQgYnV0IHdvcmtzIGFzIGEgZmFsbGJhY2tcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFNjYW5Db21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMubWF0Y2hlc1RhYmxlLFxyXG4gICAgICAgIEZpbHRlckV4cHJlc3Npb246ICdjb250YWlucyhtYXRjaGVkVXNlcnMsIDp1c2VySWQpJyxcclxuICAgICAgICBFeHByZXNzaW9uQXR0cmlidXRlVmFsdWVzOiB7XHJcbiAgICAgICAgICAnOnVzZXJJZCc6IHVzZXJJZCxcclxuICAgICAgICB9LFxyXG4gICAgICAgIExpbWl0OiA1MCxcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgbWF0Y2hlcyA9IChyZXN1bHQuSXRlbXMgfHwgW10pIGFzIE1hdGNoW107XHJcbiAgICAgIGNvbnNvbGUubG9nKGBTY2FuIGZvdW5kICR7bWF0Y2hlcy5sZW5ndGh9IG1hdGNoZXMgZm9yIHVzZXIgJHt1c2VySWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gbWF0Y2hlcztcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzY2FubmluZyB1c2VyIG1hdGNoZXM6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gW107XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHVwZGF0ZVVzZXJBY3Rpdml0eSh1c2VySWRzOiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG5cclxuICAgIC8vIFVwZGF0ZSBsYXN0QWN0aXZlQXQgZm9yIGFsbCBtYXRjaGVkIHVzZXJzXHJcbiAgICBjb25zdCB1cGRhdGVQcm9taXNlcyA9IHVzZXJJZHMubWFwKGFzeW5jICh1c2VySWQpID0+IHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBDaGVjayBpZiB1c2VyIGV4aXN0cywgY3JlYXRlIGlmIG5vdFxyXG4gICAgICAgIGNvbnN0IGV4aXN0aW5nVXNlciA9IGF3YWl0IHRoaXMuZ2V0VXNlcih1c2VySWQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChleGlzdGluZ1VzZXIpIHtcclxuICAgICAgICAgIC8vIFVwZGF0ZSBleGlzdGluZyB1c2VyJ3MgbGFzdCBhY3Rpdml0eVxyXG4gICAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMudXNlcnNUYWJsZSxcclxuICAgICAgICAgICAgSXRlbToge1xyXG4gICAgICAgICAgICAgIC4uLmV4aXN0aW5nVXNlcixcclxuICAgICAgICAgICAgICBsYXN0QWN0aXZlQXQ6IHRpbWVzdGFtcCxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgIH0pKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgLy8gQ3JlYXRlIG5ldyB1c2VyIHJlY29yZFxyXG4gICAgICAgICAgY29uc3QgbmV3VXNlcjogVXNlciA9IHtcclxuICAgICAgICAgICAgaWQ6IHVzZXJJZCxcclxuICAgICAgICAgICAgZW1haWw6ICcnLCAvLyBXaWxsIGJlIHBvcHVsYXRlZCBmcm9tIENvZ25pdG8gd2hlbiBhdmFpbGFibGVcclxuICAgICAgICAgICAgY3JlYXRlZEF0OiB0aW1lc3RhbXAsXHJcbiAgICAgICAgICAgIGxhc3RBY3RpdmVBdDogdGltZXN0YW1wLFxyXG4gICAgICAgICAgfTtcclxuXHJcbiAgICAgICAgICBhd2FpdCBkb2NDbGllbnQuc2VuZChuZXcgUHV0Q29tbWFuZCh7XHJcbiAgICAgICAgICAgIFRhYmxlTmFtZTogdGhpcy51c2Vyc1RhYmxlLFxyXG4gICAgICAgICAgICBJdGVtOiBuZXdVc2VyLFxyXG4gICAgICAgICAgICBDb25kaXRpb25FeHByZXNzaW9uOiAnYXR0cmlidXRlX25vdF9leGlzdHMoaWQpJywgLy8gUHJldmVudCBvdmVyd3JpdGluZ1xyXG4gICAgICAgICAgfSkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc29sZS5sb2coYFVwZGF0ZWQgYWN0aXZpdHkgZm9yIHVzZXI6ICR7dXNlcklkfWApO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHVwZGF0aW5nIHVzZXIgYWN0aXZpdHkgZm9yICR7dXNlcklkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgLy8gQ29udGludWUgd2l0aCBvdGhlciB1c2VycyBldmVuIGlmIG9uZSBmYWlsc1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQodXBkYXRlUHJvbWlzZXMpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBnZXRVc2VyKHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxVc2VyIHwgbnVsbD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IEdldENvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy51c2Vyc1RhYmxlLFxyXG4gICAgICAgIEtleTogeyBpZDogdXNlcklkIH0sXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIHJldHVybiByZXN1bHQuSXRlbSBhcyBVc2VyIHx8IG51bGw7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBnZXR0aW5nIHVzZXIgJHt1c2VySWR9OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBwcm9jZXNzTWF0Y2hOb3RpZmljYXRpb24obWF0Y2g6IE1hdGNoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICAvLyBGdXR1cmUgaW1wbGVtZW50YXRpb24gZm9yIHJlYWwtdGltZSBub3RpZmljYXRpb25zXHJcbiAgICAvLyBDb3VsZCBpbnRlZ3JhdGUgd2l0aDpcclxuICAgIC8vIC0gQXBwU3luYyBzdWJzY3JpcHRpb25zXHJcbiAgICAvLyAtIFNOUyBmb3IgcHVzaCBub3RpZmljYXRpb25zXHJcbiAgICAvLyAtIFdlYlNvY2tldCBjb25uZWN0aW9uc1xyXG4gICAgLy8gLSBFbWFpbCBub3RpZmljYXRpb25zXHJcblxyXG4gICAgY29uc29sZS5sb2coYE1hdGNoIG5vdGlmaWNhdGlvbjogJHttYXRjaC50aXRsZX0gbWF0Y2hlZCBpbiByb29tICR7bWF0Y2gucm9vbUlkfWApO1xyXG4gICAgXHJcbiAgICAvLyBGb3IgTVZQLCBqdXN0IGxvZyB0aGUgbm90aWZpY2F0aW9uXHJcbiAgICAvLyBJbiBwcm9kdWN0aW9uLCBpbXBsZW1lbnQgYWN0dWFsIG5vdGlmaWNhdGlvbiBkZWxpdmVyeVxyXG4gIH1cclxufVxyXG5cclxuLy8gTGFtYmRhIEhhbmRsZXIgZm9yIEFwcFN5bmNcclxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXIgPSBhc3luYyAoZXZlbnQpID0+IHtcclxuICBjb25zb2xlLmxvZygnTWF0Y2ggTGFtYmRhIHJlY2VpdmVkIEFwcFN5bmMgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IG1hdGNoU2VydmljZSA9IG5ldyBNYXRjaFNlcnZpY2UoKTtcclxuXHJcbiAgICAvLyBFeHRyYWN0IHVzZXIgSUQgZnJvbSBBcHBTeW5jIGNvbnRleHRcclxuICAgIGNvbnN0IHVzZXJJZCA9IGV2ZW50LmlkZW50aXR5Py5jbGFpbXM/LnN1YiB8fCBldmVudC5pZGVudGl0eT8udXNlcm5hbWU7XHJcbiAgICBcclxuICAgIC8vIERldGVybWluZSBvcGVyYXRpb24gZnJvbSBBcHBTeW5jIGZpZWxkIG5hbWVcclxuICAgIGNvbnN0IGZpZWxkTmFtZSA9IGV2ZW50LmluZm8/LmZpZWxkTmFtZTtcclxuICAgIFxyXG4gICAgc3dpdGNoIChmaWVsZE5hbWUpIHtcclxuICAgICAgY2FzZSAnZ2V0TXlNYXRjaGVzJzoge1xyXG4gICAgICAgIGlmICghdXNlcklkKSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgbm90IGF1dGhlbnRpY2F0ZWQnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IG1hdGNoZXMgPSBhd2FpdCBtYXRjaFNlcnZpY2UuZ2V0VXNlck1hdGNoZXModXNlcklkKTtcclxuICAgICAgICByZXR1cm4gbWF0Y2hlcztcclxuICAgICAgfVxyXG5cclxuICAgICAgY2FzZSAnY2hlY2tVc2VyTWF0Y2hlcyc6IHtcclxuICAgICAgICBpZiAoIXVzZXJJZCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVc2VyIG5vdCBhdXRoZW50aWNhdGVkJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBtYXRjaGVzID0gYXdhaXQgbWF0Y2hTZXJ2aWNlLmNoZWNrVXNlck1hdGNoZXModXNlcklkKTtcclxuICAgICAgICByZXR1cm4gbWF0Y2hlcztcclxuICAgICAgfVxyXG5cclxuICAgICAgY2FzZSAnY2hlY2tSb29tTWF0Y2gnOiB7XHJcbiAgICAgICAgY29uc3QgeyByb29tSWQgfSA9IGV2ZW50LmFyZ3VtZW50cztcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXJvb21JZCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBtYXRjaCA9IGF3YWl0IG1hdGNoU2VydmljZS5jaGVja1Jvb21NYXRjaChyb29tSWQpO1xyXG4gICAgICAgIHJldHVybiBtYXRjaDtcclxuICAgICAgfVxyXG5cclxuICAgICAgY2FzZSAnY3JlYXRlTWF0Y2gnOiB7XHJcbiAgICAgICAgY29uc3QgeyBpbnB1dCB9ID0gZXZlbnQuYXJndW1lbnRzO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENyZWF0ZSB0aGUgbWF0Y2ggb2JqZWN0XHJcbiAgICAgICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG4gICAgICAgIGNvbnN0IG1hdGNoSWQgPSBgJHtpbnB1dC5yb29tSWR9IyR7aW5wdXQubW92aWVJZH1gO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IG1hdGNoOiBNYXRjaCA9IHtcclxuICAgICAgICAgIGlkOiBtYXRjaElkLFxyXG4gICAgICAgICAgcm9vbUlkOiBpbnB1dC5yb29tSWQsXHJcbiAgICAgICAgICBtb3ZpZUlkOiBpbnB1dC5tb3ZpZUlkLFxyXG4gICAgICAgICAgdGl0bGU6IGlucHV0LnRpdGxlLFxyXG4gICAgICAgICAgcG9zdGVyUGF0aDogaW5wdXQucG9zdGVyUGF0aCxcclxuICAgICAgICAgIG1lZGlhVHlwZTogJ01PVklFJywgLy8gRGVmYXVsdCwgc2hvdWxkIGJlIHBhc3NlZCBmcm9tIGlucHV0XHJcbiAgICAgICAgICBtYXRjaGVkVXNlcnM6IGlucHV0Lm1hdGNoZWRVc2VycyxcclxuICAgICAgICAgIHRpbWVzdGFtcCxcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+OiSBDcmVhdGVNYXRjaCBtdXRhdGlvbiBleGVjdXRlZCB2aWEgQXBwU3luYyByZXNvbHZlcmApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OhIFRoaXMgd2lsbCBhdXRvbWF0aWNhbGx5IHRyaWdnZXIgQXBwU3luYyBzdWJzY3JpcHRpb25zYCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfjqwgTWF0Y2g6ICR7bWF0Y2gudGl0bGV9YCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfkaUgTm90aWZ5aW5nICR7bWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aH0gdXNlcnM6ICR7bWF0Y2gubWF0Y2hlZFVzZXJzLmpvaW4oJywgJyl9YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG1hdGNoO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjYXNlICdwdWJsaXNoUm9vbU1hdGNoJzoge1xyXG4gICAgICAgIGNvbnN0IHsgcm9vbUlkLCBtYXRjaERhdGEgfSA9IGV2ZW50LmFyZ3VtZW50cztcclxuICAgICAgICBcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+agCBDUklUSUNBTCBGSVg6IFByb2Nlc3NpbmcgcHVibGlzaFJvb21NYXRjaCBmb3Igcm9vbTogJHtyb29tSWR9YCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfjqwgTW92aWU6ICR7bWF0Y2hEYXRhLm1vdmllVGl0bGV9YCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfkaUgTWF0Y2hlZCB1c2VyczogJHttYXRjaERhdGEubWF0Y2hlZFVzZXJzLmpvaW4oJywgJyl9YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmV0dXJuIHRoZSByb29tTWF0Y2hFdmVudCBzdHJ1Y3R1cmUgdGhhdCBBcHBTeW5jIGV4cGVjdHNcclxuICAgICAgICBjb25zdCByb29tTWF0Y2hFdmVudCA9IHtcclxuICAgICAgICAgIHJvb21JZDogcm9vbUlkLFxyXG4gICAgICAgICAgbWF0Y2hJZDogbWF0Y2hEYXRhLm1hdGNoSWQsXHJcbiAgICAgICAgICBtb3ZpZUlkOiBTdHJpbmcobWF0Y2hEYXRhLm1vdmllSWQpLFxyXG4gICAgICAgICAgbW92aWVUaXRsZTogbWF0Y2hEYXRhLm1vdmllVGl0bGUsXHJcbiAgICAgICAgICBwb3N0ZXJQYXRoOiBtYXRjaERhdGEucG9zdGVyUGF0aCB8fCBudWxsLFxyXG4gICAgICAgICAgbWF0Y2hlZFVzZXJzOiBtYXRjaERhdGEubWF0Y2hlZFVzZXJzLFxyXG4gICAgICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICBtYXRjaERldGFpbHM6IG1hdGNoRGF0YS5tYXRjaERldGFpbHNcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjb25zb2xlLmxvZygn8J+ToSBSZXR1cm5pbmcgcm9vbU1hdGNoRXZlbnQgZm9yIEFwcFN5bmMgc3Vic2NyaXB0aW9uIHRyaWdnZXInKTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gcm9vbU1hdGNoRXZlbnQ7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ3B1Ymxpc2hVc2VyTWF0Y2gnOiB7XHJcbiAgICAgICAgY29uc3QgeyB1c2VySWQ6IHRhcmdldFVzZXJJZCwgbWF0Y2hEYXRhIH0gPSBldmVudC5hcmd1bWVudHM7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfmoAgUHJvY2Vzc2luZyBwdWJsaXNoVXNlck1hdGNoIGZvciB1c2VyOiAke3RhcmdldFVzZXJJZH1gKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+OrCBNb3ZpZTogJHttYXRjaERhdGEubW92aWVUaXRsZX1gKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBSZXR1cm4gdGhlIHVzZXJNYXRjaEV2ZW50IHN0cnVjdHVyZSB0aGF0IEFwcFN5bmMgZXhwZWN0c1xyXG4gICAgICAgIGNvbnN0IHVzZXJNYXRjaEV2ZW50ID0ge1xyXG4gICAgICAgICAgdXNlcklkOiB0YXJnZXRVc2VySWQsXHJcbiAgICAgICAgICByb29tSWQ6IG1hdGNoRGF0YS5yb29tSWQsXHJcbiAgICAgICAgICBtYXRjaElkOiBtYXRjaERhdGEubWF0Y2hJZCxcclxuICAgICAgICAgIG1vdmllSWQ6IFN0cmluZyhtYXRjaERhdGEubW92aWVJZCksXHJcbiAgICAgICAgICBtb3ZpZVRpdGxlOiBtYXRjaERhdGEubW92aWVUaXRsZSxcclxuICAgICAgICAgIHBvc3RlclBhdGg6IG1hdGNoRGF0YS5wb3N0ZXJQYXRoIHx8IG51bGwsXHJcbiAgICAgICAgICBtYXRjaGVkVXNlcnM6IG1hdGNoRGF0YS5tYXRjaGVkVXNlcnMsXHJcbiAgICAgICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICAgIG1hdGNoRGV0YWlsczogbWF0Y2hEYXRhLm1hdGNoRGV0YWlsc1xyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn5OhIFJldHVybmluZyB1c2VyTWF0Y2hFdmVudCBmb3IgQXBwU3luYyBzdWJzY3JpcHRpb24gdHJpZ2dlcicpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiB1c2VyTWF0Y2hFdmVudDtcclxuICAgICAgfVxyXG5cclxuICAgICAgZGVmYXVsdDpcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gZmllbGQ6ICR7ZmllbGROYW1lfWApO1xyXG4gICAgfVxyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignTWF0Y2ggTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCc7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoZXJyb3JNZXNzYWdlKTtcclxuICB9XHJcbn07Il19