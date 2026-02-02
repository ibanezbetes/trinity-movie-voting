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
                console.log(`CreateMatch mutation executed - triggering subscriptions for: ${match.title}`);
                console.log(`Notifying ${match.matchedUsers.length} users: ${match.matchedUsers.join(', ')}`);
                // CRITICAL: This mutation execution will automatically trigger AppSync subscriptions
                // All users subscribed to onMatchCreated(userId: $userId) will receive this match
                // The subscription is configured in schema.graphql as:
                // onMatchCreated(userId: String!): Match @aws_subscribe(mutations: ["createMatch"])
                // The AppSync resolver will return this match, and AppSync will automatically
                // send it to all subscribers who have userId in match.matchedUsers
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvbWF0Y2gvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsOERBQTBEO0FBQzFELHdEQUFrSDtBQUVsSCx5QkFBeUI7QUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztBQUM1RSxNQUFNLFNBQVMsR0FBRyxxQ0FBc0IsQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7QUFnRTVELGdCQUFnQjtBQUNoQixNQUFNLFlBQVk7SUFJaEI7UUFDRSxJQUFJLENBQUMsWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxJQUFJLEVBQUUsQ0FBQztRQUNwRCxJQUFJLENBQUMsVUFBVSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLEVBQUUsQ0FBQztRQUVoRCxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksSUFBSSxDQUFDLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztZQUMzQyxNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxDQUFDLENBQUM7UUFDdEUsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsa0JBQWtCLENBQUMsS0FBWTtRQUNuQyxPQUFPLENBQUMsR0FBRyxDQUFDLDZCQUE2QixLQUFLLENBQUMsRUFBRSxTQUFTLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTSxRQUFRLENBQUMsQ0FBQztRQUU3Riw2Q0FBNkM7UUFDN0MsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFDO1FBRWxELDBDQUEwQztRQUMxQyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUVyQyxtQ0FBbUM7UUFDbkMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQ0FBaUMsS0FBSyxDQUFDLEtBQUssS0FBSyxLQUFLLENBQUMsU0FBUyx1QkFBdUIsS0FBSyxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3RJLENBQUM7SUFFRCxLQUFLLENBQUMsa0JBQWtCLENBQUMsS0FBWTtRQUNuQyxJQUFJLENBQUM7WUFDSCxPQUFPLENBQUMsR0FBRyxDQUFDLGtDQUFrQyxLQUFLLENBQUMsWUFBWSxDQUFDLE1BQU0sUUFBUSxDQUFDLENBQUM7WUFFakYsc0ZBQXNGO1lBQ3RGLDRFQUE0RTtZQUU1RSxNQUFNLG9CQUFvQixHQUFHLEtBQUssQ0FBQyxZQUFZLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsRUFBRTtnQkFDbkUsSUFBSSxDQUFDO29CQUNILHVFQUF1RTtvQkFDdkUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsTUFBTSxpQkFBaUIsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7b0JBRXBFLDRCQUE0QjtvQkFDNUIsNENBQTRDO29CQUM1Qyw0QkFBNEI7b0JBQzVCLHdDQUF3QztvQkFFeEMsT0FBTyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUM7Z0JBQ25DLENBQUM7Z0JBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztvQkFDZixPQUFPLENBQUMsS0FBSyxDQUFDLHlCQUF5QixNQUFNLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztvQkFDekQsT0FBTyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxDQUFDO2dCQUMzQyxDQUFDO1lBQ0gsQ0FBQyxDQUFDLENBQUM7WUFFSCxNQUFNLE9BQU8sR0FBRyxNQUFNLE9BQU8sQ0FBQyxVQUFVLENBQUMsb0JBQW9CLENBQUMsQ0FBQztZQUMvRCxNQUFNLFVBQVUsR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE1BQU0sS0FBSyxXQUFXLENBQUMsQ0FBQyxNQUFNLENBQUM7WUFFeEUsT0FBTyxDQUFDLEdBQUcsQ0FBQyw2QkFBNkIsVUFBVSxJQUFJLEtBQUssQ0FBQyxZQUFZLENBQUMsTUFBTSxhQUFhLENBQUMsQ0FBQztRQUNqRyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMsb0NBQW9DLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDN0QsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsY0FBYyxDQUFDLE1BQWM7UUFDakMsSUFBSSxDQUFDO1lBQ0gsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3Q0FBd0MsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUU5RCxpREFBaUQ7WUFDakQsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksMkJBQVksQ0FBQztnQkFDbkQsU0FBUyxFQUFFLElBQUksQ0FBQyxZQUFZO2dCQUM1QixzQkFBc0IsRUFBRSxrQkFBa0I7Z0JBQzFDLHlCQUF5QixFQUFFO29CQUN6QixTQUFTLEVBQUUsTUFBTTtpQkFDbEI7Z0JBQ0QsS0FBSyxFQUFFLENBQUMsRUFBRSw0Q0FBNEM7YUFDdkQsQ0FBQyxDQUFDLENBQUM7WUFFSixJQUFJLE1BQU0sQ0FBQyxLQUFLLElBQUksTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQzVDLE1BQU0sS0FBSyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFVLENBQUM7Z0JBQ3ZDLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0NBQWdDLE1BQU0sS0FBSyxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUMsQ0FBQztnQkFDdEUsT0FBTyxLQUFLLENBQUM7WUFDZixDQUFDO1lBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQywyQkFBMkIsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUNqRCxPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxpQ0FBaUMsTUFBTSxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDakUsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxjQUFjLENBQUMsTUFBYztRQUNqQyxJQUFJLENBQUM7WUFDSCxPQUFPLENBQUMsR0FBRyxDQUFDLDZCQUE2QixNQUFNLEVBQUUsQ0FBQyxDQUFDO1lBRW5ELHVEQUF1RDtZQUN2RCxNQUFNLE1BQU0sR0FBRyxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSwyQkFBWSxDQUFDO2dCQUNuRCxTQUFTLEVBQUUsSUFBSSxDQUFDLFlBQVk7Z0JBQzVCLFNBQVMsRUFBRSx3QkFBd0I7Z0JBQ25DLHNCQUFzQixFQUFFLGtCQUFrQjtnQkFDMUMseUJBQXlCLEVBQUU7b0JBQ3pCLFNBQVMsRUFBRSxNQUFNO2lCQUNsQjtnQkFDRCxnQkFBZ0IsRUFBRSxLQUFLLEVBQUUsOENBQThDO2dCQUN2RSxLQUFLLEVBQUUsRUFBRSxFQUFFLDJDQUEyQzthQUN2RCxDQUFDLENBQUMsQ0FBQztZQUVKLE1BQU0sT0FBTyxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUssSUFBSSxFQUFFLENBQVksQ0FBQztZQUNoRCxPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVMsT0FBTyxDQUFDLE1BQU0scUJBQXFCLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFFbEUsT0FBTyxPQUFPLENBQUM7UUFFakIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLDZCQUE2QixFQUFFLEtBQUssQ0FBQyxDQUFDO1lBRXBELHFEQUFxRDtZQUNyRCxPQUFPLENBQUMsR0FBRyxDQUFDLGdDQUFnQyxDQUFDLENBQUM7WUFDOUMsT0FBTyxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDNUMsQ0FBQztJQUNILENBQUM7SUFFTyxLQUFLLENBQUMsZUFBZSxDQUFDLE1BQWM7UUFDMUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsTUFBTSxvQkFBb0IsQ0FBQyxDQUFDO1FBRXRFLElBQUksQ0FBQztZQUNILG1EQUFtRDtZQUNuRCw4Q0FBOEM7WUFDOUMsTUFBTSxNQUFNLEdBQUcsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUksMEJBQVcsQ0FBQztnQkFDbEQsU0FBUyxFQUFFLElBQUksQ0FBQyxZQUFZO2dCQUM1QixnQkFBZ0IsRUFBRSxpQ0FBaUM7Z0JBQ25ELHlCQUF5QixFQUFFO29CQUN6QixTQUFTLEVBQUUsTUFBTTtpQkFDbEI7Z0JBQ0QsS0FBSyxFQUFFLEVBQUU7YUFDVixDQUFDLENBQUMsQ0FBQztZQUVKLE1BQU0sT0FBTyxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUssSUFBSSxFQUFFLENBQVksQ0FBQztZQUNoRCxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWMsT0FBTyxDQUFDLE1BQU0scUJBQXFCLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFFdkUsT0FBTyxPQUFPLENBQUM7UUFFakIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLDhCQUE4QixFQUFFLEtBQUssQ0FBQyxDQUFDO1lBQ3JELE9BQU8sRUFBRSxDQUFDO1FBQ1osQ0FBQztJQUNILENBQUM7SUFFTyxLQUFLLENBQUMsa0JBQWtCLENBQUMsT0FBaUI7UUFDaEQsTUFBTSxTQUFTLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztRQUUzQyw0Q0FBNEM7UUFDNUMsTUFBTSxjQUFjLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDbEQsSUFBSSxDQUFDO2dCQUNILHNDQUFzQztnQkFDdEMsTUFBTSxZQUFZLEdBQUcsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUVoRCxJQUFJLFlBQVksRUFBRSxDQUFDO29CQUNqQix1Q0FBdUM7b0JBQ3ZDLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLHlCQUFVLENBQUM7d0JBQ2xDLFNBQVMsRUFBRSxJQUFJLENBQUMsVUFBVTt3QkFDMUIsSUFBSSxFQUFFOzRCQUNKLEdBQUcsWUFBWTs0QkFDZixZQUFZLEVBQUUsU0FBUzt5QkFDeEI7cUJBQ0YsQ0FBQyxDQUFDLENBQUM7Z0JBQ04sQ0FBQztxQkFBTSxDQUFDO29CQUNOLHlCQUF5QjtvQkFDekIsTUFBTSxPQUFPLEdBQVM7d0JBQ3BCLEVBQUUsRUFBRSxNQUFNO3dCQUNWLEtBQUssRUFBRSxFQUFFLEVBQUUsZ0RBQWdEO3dCQUMzRCxTQUFTLEVBQUUsU0FBUzt3QkFDcEIsWUFBWSxFQUFFLFNBQVM7cUJBQ3hCLENBQUM7b0JBRUYsTUFBTSxTQUFTLENBQUMsSUFBSSxDQUFDLElBQUkseUJBQVUsQ0FBQzt3QkFDbEMsU0FBUyxFQUFFLElBQUksQ0FBQyxVQUFVO3dCQUMxQixJQUFJLEVBQUUsT0FBTzt3QkFDYixtQkFBbUIsRUFBRSwwQkFBMEIsRUFBRSxzQkFBc0I7cUJBQ3hFLENBQUMsQ0FBQyxDQUFDO2dCQUNOLENBQUM7Z0JBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUN0RCxDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDZixPQUFPLENBQUMsS0FBSyxDQUFDLG9DQUFvQyxNQUFNLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztnQkFDcEUsOENBQThDO1lBQ2hELENBQUM7UUFDSCxDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sT0FBTyxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUMsQ0FBQztJQUMzQyxDQUFDO0lBRU8sS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFjO1FBQ2xDLElBQUksQ0FBQztZQUNILE1BQU0sTUFBTSxHQUFHLE1BQU0sU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLHlCQUFVLENBQUM7Z0JBQ2pELFNBQVMsRUFBRSxJQUFJLENBQUMsVUFBVTtnQkFDMUIsR0FBRyxFQUFFLEVBQUUsRUFBRSxFQUFFLE1BQU0sRUFBRTthQUNwQixDQUFDLENBQUMsQ0FBQztZQUVKLE9BQU8sTUFBTSxDQUFDLElBQVksSUFBSSxJQUFJLENBQUM7UUFDckMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLHNCQUFzQixNQUFNLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN0RCxPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLHdCQUF3QixDQUFDLEtBQVk7UUFDekMsb0RBQW9EO1FBQ3BELHdCQUF3QjtRQUN4QiwwQkFBMEI7UUFDMUIsK0JBQStCO1FBQy9CLDBCQUEwQjtRQUMxQix3QkFBd0I7UUFFeEIsT0FBTyxDQUFDLEdBQUcsQ0FBQyx1QkFBdUIsS0FBSyxDQUFDLEtBQUssb0JBQW9CLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBRWxGLHFDQUFxQztRQUNyQyx3REFBd0Q7SUFDMUQsQ0FBQztDQUNGO0FBRUQsaUJBQWlCO0FBQ1YsTUFBTSxPQUFPLEdBQXVDLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRTtJQUN6RSxPQUFPLENBQUMsR0FBRyxDQUFDLDhCQUE4QixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztJQUVuRSxJQUFJLENBQUM7UUFDSCxNQUFNLFlBQVksR0FBRyxJQUFJLFlBQVksRUFBRSxDQUFDO1FBRXhDLFFBQVEsS0FBSyxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ3hCLEtBQUssYUFBYSxDQUFDLENBQUMsQ0FBQztnQkFDbkIsTUFBTSxFQUFFLEtBQUssRUFBRSxHQUFHLEtBQUssQ0FBQztnQkFFeEIsMEJBQTBCO2dCQUMxQixNQUFNLFNBQVMsR0FBRyxJQUFJLElBQUksRUFBRSxDQUFDLFdBQVcsRUFBRSxDQUFDO2dCQUMzQyxNQUFNLE9BQU8sR0FBRyxHQUFHLEtBQUssQ0FBQyxNQUFNLElBQUksS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUVuRCxNQUFNLEtBQUssR0FBVTtvQkFDbkIsRUFBRSxFQUFFLE9BQU87b0JBQ1gsTUFBTSxFQUFFLEtBQUssQ0FBQyxNQUFNO29CQUNwQixPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87b0JBQ3RCLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztvQkFDbEIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO29CQUM1QixTQUFTLEVBQUUsT0FBTyxFQUFFLHVDQUF1QztvQkFDM0QsWUFBWSxFQUFFLEtBQUssQ0FBQyxZQUFZO29CQUNoQyxTQUFTO2lCQUNWLENBQUM7Z0JBRUYsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpRUFBaUUsS0FBSyxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7Z0JBQzVGLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxLQUFLLENBQUMsWUFBWSxDQUFDLE1BQU0sV0FBVyxLQUFLLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBRTlGLHFGQUFxRjtnQkFDckYsa0ZBQWtGO2dCQUNsRix1REFBdUQ7Z0JBQ3ZELG9GQUFvRjtnQkFFcEYsOEVBQThFO2dCQUM5RSxtRUFBbUU7Z0JBRW5FLE9BQU87b0JBQ0wsVUFBVSxFQUFFLEdBQUc7b0JBQ2YsSUFBSSxFQUFFLEVBQUUsS0FBSyxFQUFFO2lCQUNoQixDQUFDO1lBQ0osQ0FBQztZQUVELEtBQUssY0FBYyxDQUFDLENBQUMsQ0FBQztnQkFDcEIsTUFBTSxFQUFFLEtBQUssRUFBRSxHQUFHLEtBQUssQ0FBQztnQkFFeEIsNkJBQTZCO2dCQUM3QixNQUFNLFlBQVksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFFN0MsNkNBQTZDO2dCQUM3QyxNQUFNLFlBQVksQ0FBQyx3QkFBd0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFFbkQsT0FBTztvQkFDTCxVQUFVLEVBQUUsR0FBRztvQkFDZixJQUFJLEVBQUUsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFO2lCQUN4QixDQUFDO1lBQ0osQ0FBQztZQUVELEtBQUssZ0JBQWdCLENBQUMsQ0FBQyxDQUFDO2dCQUN0QixNQUFNLEVBQUUsTUFBTSxFQUFFLEdBQUcsS0FBSyxDQUFDO2dCQUV6QixJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7b0JBQ1osTUFBTSxJQUFJLEtBQUssQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDO2dCQUN6QyxDQUFDO2dCQUVELE1BQU0sT0FBTyxHQUFHLE1BQU0sWUFBWSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQztnQkFFMUQsT0FBTztvQkFDTCxVQUFVLEVBQUUsR0FBRztvQkFDZixJQUFJLEVBQUUsRUFBRSxPQUFPLEVBQUU7aUJBQ2xCLENBQUM7WUFDSixDQUFDO1lBRUQsS0FBSyxnQkFBZ0IsQ0FBQyxDQUFDLENBQUM7Z0JBQ3RCLE1BQU0sRUFBRSxNQUFNLEVBQUUsR0FBRyxLQUFLLENBQUM7Z0JBRXpCLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztvQkFDWixNQUFNLElBQUksS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUM7Z0JBQ3pDLENBQUM7Z0JBRUQsTUFBTSxLQUFLLEdBQUcsTUFBTSxZQUFZLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUV4RCxPQUFPO29CQUNMLFVBQVUsRUFBRSxHQUFHO29CQUNmLElBQUksRUFBRSxFQUFFLEtBQUssRUFBRSxLQUFLLElBQUksU0FBUyxFQUFFO2lCQUNwQyxDQUFDO1lBQ0osQ0FBQztZQUVELEtBQUssYUFBYSxDQUFDLENBQUMsQ0FBQztnQkFDbkIsTUFBTSxFQUFFLEtBQUssRUFBRSxHQUFHLEtBQUssQ0FBQztnQkFFeEIsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO29CQUNYLE1BQU0sSUFBSSxLQUFLLENBQUMsbUJBQW1CLENBQUMsQ0FBQztnQkFDdkMsQ0FBQztnQkFFRCxNQUFNLFlBQVksQ0FBQyxrQkFBa0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFFN0MsT0FBTztvQkFDTCxVQUFVLEVBQUUsR0FBRztvQkFDZixJQUFJLEVBQUUsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFO2lCQUN4QixDQUFDO1lBQ0osQ0FBQztZQUVEO2dCQUNFLE1BQU0sSUFBSSxLQUFLLENBQUMsc0JBQXVCLEtBQWEsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBQ3RFLENBQUM7SUFFSCxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUMscUJBQXFCLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFNUMsTUFBTSxZQUFZLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUM7UUFFdkYsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFO2dCQUNKLE9BQU8sRUFBRSxLQUFLO2dCQUNkLEtBQUssRUFBRSxZQUFZO2FBQ3BCO1NBQ0YsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUF2SFcsUUFBQSxPQUFPLFdBdUhsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IHsgRHluYW1vREJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZHluYW1vZGInO1xyXG5pbXBvcnQgeyBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LCBRdWVyeUNvbW1hbmQsIEdldENvbW1hbmQsIFB1dENvbW1hbmQsIFNjYW5Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvbGliLWR5bmFtb2RiJztcclxuXHJcbi8vIEluaXRpYWxpemUgQVdTIGNsaWVudHNcclxuY29uc3QgZHluYW1vQ2xpZW50ID0gbmV3IER5bmFtb0RCQ2xpZW50KHsgcmVnaW9uOiBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIH0pO1xyXG5jb25zdCBkb2NDbGllbnQgPSBEeW5hbW9EQkRvY3VtZW50Q2xpZW50LmZyb20oZHluYW1vQ2xpZW50KTtcclxuXHJcbi8vIFR5cGVzXHJcbmludGVyZmFjZSBNYXRjaCB7XHJcbiAgaWQ6IHN0cmluZztcclxuICByb29tSWQ6IHN0cmluZztcclxuICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBwb3N0ZXJQYXRoPzogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgbWF0Y2hlZFVzZXJzOiBzdHJpbmdbXTtcclxuICB0aW1lc3RhbXA6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIFVzZXIge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgZW1haWw6IHN0cmluZztcclxuICBjcmVhdGVkQXQ6IHN0cmluZztcclxuICBsYXN0QWN0aXZlQXQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIENyZWF0ZU1hdGNoRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2NyZWF0ZU1hdGNoJztcclxuICBpbnB1dDoge1xyXG4gICAgcm9vbUlkOiBzdHJpbmc7XHJcbiAgICBtb3ZpZUlkOiBudW1iZXI7XHJcbiAgICB0aXRsZTogc3RyaW5nO1xyXG4gICAgcG9zdGVyUGF0aD86IHN0cmluZztcclxuICAgIG1hdGNoZWRVc2Vyczogc3RyaW5nW107XHJcbiAgfTtcclxufVxyXG5cclxuaW50ZXJmYWNlIEdldFVzZXJNYXRjaGVzRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2dldFVzZXJNYXRjaGVzJztcclxuICB1c2VySWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIENoZWNrUm9vbU1hdGNoRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ2NoZWNrUm9vbU1hdGNoJztcclxuICByb29tSWQ6IHN0cmluZztcclxufVxyXG5cclxuaW50ZXJmYWNlIE5vdGlmeU1hdGNoRXZlbnQge1xyXG4gIG9wZXJhdGlvbjogJ25vdGlmeU1hdGNoJztcclxuICBtYXRjaDogTWF0Y2g7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNYXRjaENyZWF0ZWRFdmVudCB7XHJcbiAgb3BlcmF0aW9uOiAnbWF0Y2hDcmVhdGVkJztcclxuICBtYXRjaDogTWF0Y2g7XHJcbn1cclxuXHJcbnR5cGUgTWF0Y2hFdmVudCA9IENyZWF0ZU1hdGNoRXZlbnQgfCBNYXRjaENyZWF0ZWRFdmVudCB8IEdldFVzZXJNYXRjaGVzRXZlbnQgfCBDaGVja1Jvb21NYXRjaEV2ZW50IHwgTm90aWZ5TWF0Y2hFdmVudDtcclxuXHJcbmludGVyZmFjZSBNYXRjaFJlc3BvbnNlIHtcclxuICBzdGF0dXNDb2RlOiBudW1iZXI7XHJcbiAgYm9keToge1xyXG4gICAgbWF0Y2hlcz86IE1hdGNoW107XHJcbiAgICBtYXRjaD86IE1hdGNoO1xyXG4gICAgc3VjY2Vzcz86IGJvb2xlYW47XHJcbiAgICBlcnJvcj86IHN0cmluZztcclxuICB9O1xyXG59XHJcblxyXG4vLyBNYXRjaCBTZXJ2aWNlXHJcbmNsYXNzIE1hdGNoU2VydmljZSB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBtYXRjaGVzVGFibGU6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHVzZXJzVGFibGU6IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLm1hdGNoZXNUYWJsZSA9IHByb2Nlc3MuZW52Lk1BVENIRVNfVEFCTEUgfHwgJyc7XHJcbiAgICB0aGlzLnVzZXJzVGFibGUgPSBwcm9jZXNzLmVudi5VU0VSU19UQUJMRSB8fCAnJztcclxuXHJcbiAgICBpZiAoIXRoaXMubWF0Y2hlc1RhYmxlIHx8ICF0aGlzLnVzZXJzVGFibGUpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZXF1aXJlZCB0YWJsZSBlbnZpcm9ubWVudCB2YXJpYWJsZXMgYXJlIG1pc3NpbmcnKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGhhbmRsZU1hdGNoQ3JlYXRlZChtYXRjaDogTWF0Y2gpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnNvbGUubG9nKGBQcm9jZXNzaW5nIG1hdGNoIGNyZWF0ZWQ6ICR7bWF0Y2guaWR9IHdpdGggJHttYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RofSB1c2Vyc2ApO1xyXG5cclxuICAgIC8vIFVwZGF0ZSB1c2VyIGFjdGl2aXR5IGZvciBhbGwgbWF0Y2hlZCB1c2Vyc1xyXG4gICAgYXdhaXQgdGhpcy51cGRhdGVVc2VyQWN0aXZpdHkobWF0Y2gubWF0Y2hlZFVzZXJzKTtcclxuXHJcbiAgICAvLyBTZW5kIG5vdGlmaWNhdGlvbnMgdG8gYWxsIG1hdGNoZWQgdXNlcnNcclxuICAgIGF3YWl0IHRoaXMubm90aWZ5TWF0Y2hUb1VzZXJzKG1hdGNoKTtcclxuXHJcbiAgICAvLyBMb2cgbWF0Y2ggY3JlYXRpb24gZm9yIGFuYWx5dGljc1xyXG4gICAgY29uc29sZS5sb2coYE1hdGNoIHN1Y2Nlc3NmdWxseSBwcm9jZXNzZWQ6ICR7bWF0Y2gudGl0bGV9ICgke21hdGNoLm1lZGlhVHlwZX0pIG1hdGNoZWQgYnkgdXNlcnM6ICR7bWF0Y2gubWF0Y2hlZFVzZXJzLmpvaW4oJywgJyl9YCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBub3RpZnlNYXRjaFRvVXNlcnMobWF0Y2g6IE1hdGNoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgU2VuZGluZyBtYXRjaCBub3RpZmljYXRpb25zIHRvICR7bWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aH0gdXNlcnNgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEluIGEgcmVhbCBpbXBsZW1lbnRhdGlvbiwgeW91IHdvdWxkIHVzZSBBcHBTeW5jIHN1YnNjcmlwdGlvbnMgb3IgcHVzaCBub3RpZmljYXRpb25zXHJcbiAgICAgIC8vIEZvciBub3csIHdlJ2xsIGxvZyB0aGUgbm90aWZpY2F0aW9uIGFuZCBzdG9yZSBpdCBmb3IgdGhlIGZyb250ZW5kIHRvIHBvbGxcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IG5vdGlmaWNhdGlvblByb21pc2VzID0gbWF0Y2gubWF0Y2hlZFVzZXJzLm1hcChhc3luYyAodXNlcklkKSA9PiB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIC8vIFN0b3JlIG5vdGlmaWNhdGlvbiBpbiB1c2VyJ3MgcmVjb3JkIG9yIHNlbmQgdmlhIEFwcFN5bmMgc3Vic2NyaXB0aW9uXHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgTm90aWZ5aW5nIHVzZXIgJHt1c2VySWR9IGFib3V0IG1hdGNoOiAke21hdGNoLnRpdGxlfWApO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBIZXJlIHlvdSB3b3VsZCB0eXBpY2FsbHk6XHJcbiAgICAgICAgICAvLyAxLiBTZW5kIEFwcFN5bmMgc3Vic2NyaXB0aW9uIG5vdGlmaWNhdGlvblxyXG4gICAgICAgICAgLy8gMi4gU2VuZCBwdXNoIG5vdGlmaWNhdGlvblxyXG4gICAgICAgICAgLy8gMy4gU3RvcmUgbm90aWZpY2F0aW9uIGluIHVzZXIncyBpbmJveFxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICByZXR1cm4geyB1c2VySWQsIHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIG5vdGlmeSB1c2VyICR7dXNlcklkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICByZXR1cm4geyB1c2VySWQsIHN1Y2Nlc3M6IGZhbHNlLCBlcnJvciB9O1xyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKG5vdGlmaWNhdGlvblByb21pc2VzKTtcclxuICAgICAgY29uc3Qgc3VjY2Vzc2Z1bCA9IHJlc3VsdHMuZmlsdGVyKHIgPT4gci5zdGF0dXMgPT09ICdmdWxmaWxsZWQnKS5sZW5ndGg7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhgTWF0Y2ggbm90aWZpY2F0aW9ucyBzZW50OiAke3N1Y2Nlc3NmdWx9LyR7bWF0Y2gubWF0Y2hlZFVzZXJzLmxlbmd0aH0gc3VjY2Vzc2Z1bGApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igc2VuZGluZyBtYXRjaCBub3RpZmljYXRpb25zOicsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFzeW5jIGNoZWNrUm9vbU1hdGNoKHJvb21JZDogc3RyaW5nKTogUHJvbWlzZTxNYXRjaCB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBDaGVja2luZyBmb3IgZXhpc3RpbmcgbWF0Y2ggaW4gcm9vbTogJHtyb29tSWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBRdWVyeSBtYXRjaGVzIHRhYmxlIGZvciBhbnkgbWF0Y2ggaW4gdGhpcyByb29tXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3Jvb21JZCA9IDpyb29tSWQnLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6cm9vbUlkJzogcm9vbUlkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgTGltaXQ6IDEsIC8vIFdlIG9ubHkgbmVlZCB0byBrbm93IGlmIHRoZXJlJ3MgYW55IG1hdGNoXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGlmIChyZXN1bHQuSXRlbXMgJiYgcmVzdWx0Lkl0ZW1zLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zdCBtYXRjaCA9IHJlc3VsdC5JdGVtc1swXSBhcyBNYXRjaDtcclxuICAgICAgICBjb25zb2xlLmxvZyhgRm91bmQgZXhpc3RpbmcgbWF0Y2ggaW4gcm9vbSAke3Jvb21JZH06ICR7bWF0Y2gudGl0bGV9YCk7XHJcbiAgICAgICAgcmV0dXJuIG1hdGNoO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgTm8gbWF0Y2ggZm91bmQgaW4gcm9vbTogJHtyb29tSWR9YCk7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgY2hlY2tpbmcgcm9vbSBtYXRjaCBmb3IgJHtyb29tSWR9OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRVc2VyTWF0Y2hlcyh1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8TWF0Y2hbXT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYEdldHRpbmcgbWF0Y2hlcyBmb3IgdXNlcjogJHt1c2VySWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBVc2UgdGhlIG5ldyBHU0kgdG8gZWZmaWNpZW50bHkgcXVlcnkgbWF0Y2hlcyBieSB1c2VyXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBRdWVyeUNvbW1hbmQoe1xyXG4gICAgICAgIFRhYmxlTmFtZTogdGhpcy5tYXRjaGVzVGFibGUsXHJcbiAgICAgICAgSW5kZXhOYW1lOiAndXNlcklkLXRpbWVzdGFtcC1pbmRleCcsXHJcbiAgICAgICAgS2V5Q29uZGl0aW9uRXhwcmVzc2lvbjogJ3VzZXJJZCA9IDp1c2VySWQnLFxyXG4gICAgICAgIEV4cHJlc3Npb25BdHRyaWJ1dGVWYWx1ZXM6IHtcclxuICAgICAgICAgICc6dXNlcklkJzogdXNlcklkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgU2NhbkluZGV4Rm9yd2FyZDogZmFsc2UsIC8vIFNvcnQgYnkgdGltZXN0YW1wIGRlc2NlbmRpbmcgKG5ld2VzdCBmaXJzdClcclxuICAgICAgICBMaW1pdDogNTAsIC8vIExpbWl0IHRvIGxhc3QgNTAgbWF0Y2hlcyBmb3IgcGVyZm9ybWFuY2VcclxuICAgICAgfSkpO1xyXG5cclxuICAgICAgY29uc3QgbWF0Y2hlcyA9IChyZXN1bHQuSXRlbXMgfHwgW10pIGFzIE1hdGNoW107XHJcbiAgICAgIGNvbnNvbGUubG9nKGBGb3VuZCAke21hdGNoZXMubGVuZ3RofSBtYXRjaGVzIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIG1hdGNoZXM7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2V0dGluZyB1c2VyIG1hdGNoZXM6JywgZXJyb3IpO1xyXG4gICAgICBcclxuICAgICAgLy8gRmFsbGJhY2sgdG8gc2NhbiBtZXRob2QgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHlcclxuICAgICAgY29uc29sZS5sb2coJ0ZhbGxpbmcgYmFjayB0byBzY2FuIG1ldGhvZC4uLicpO1xyXG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5zY2FuVXNlck1hdGNoZXModXNlcklkKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc2NhblVzZXJNYXRjaGVzKHVzZXJJZDogc3RyaW5nKTogUHJvbWlzZTxNYXRjaFtdPiB7XHJcbiAgICBjb25zb2xlLmxvZyhgU2Nhbm5pbmcgbWF0Y2hlcyBmb3IgdXNlcjogJHt1c2VySWR9IChmYWxsYmFjayBtZXRob2QpYCk7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFNjYW4gdGhlIGVudGlyZSBtYXRjaGVzIHRhYmxlIGFuZCBmaWx0ZXIgYnkgdXNlclxyXG4gICAgICAvLyBUaGlzIGlzIGluZWZmaWNpZW50IGJ1dCB3b3JrcyBhcyBhIGZhbGxiYWNrXHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBTY2FuQ29tbWFuZCh7XHJcbiAgICAgICAgVGFibGVOYW1lOiB0aGlzLm1hdGNoZXNUYWJsZSxcclxuICAgICAgICBGaWx0ZXJFeHByZXNzaW9uOiAnY29udGFpbnMobWF0Y2hlZFVzZXJzLCA6dXNlcklkKScsXHJcbiAgICAgICAgRXhwcmVzc2lvbkF0dHJpYnV0ZVZhbHVlczoge1xyXG4gICAgICAgICAgJzp1c2VySWQnOiB1c2VySWQsXHJcbiAgICAgICAgfSxcclxuICAgICAgICBMaW1pdDogNTAsXHJcbiAgICAgIH0pKTtcclxuXHJcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSAocmVzdWx0Lkl0ZW1zIHx8IFtdKSBhcyBNYXRjaFtdO1xyXG4gICAgICBjb25zb2xlLmxvZyhgU2NhbiBmb3VuZCAke21hdGNoZXMubGVuZ3RofSBtYXRjaGVzIGZvciB1c2VyICR7dXNlcklkfWApO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIG1hdGNoZXM7XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignRXJyb3Igc2Nhbm5pbmcgdXNlciBtYXRjaGVzOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIFtdO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyB1cGRhdGVVc2VyQWN0aXZpdHkodXNlcklkczogc3RyaW5nW10pOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHRpbWVzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcclxuXHJcbiAgICAvLyBVcGRhdGUgbGFzdEFjdGl2ZUF0IGZvciBhbGwgbWF0Y2hlZCB1c2Vyc1xyXG4gICAgY29uc3QgdXBkYXRlUHJvbWlzZXMgPSB1c2VySWRzLm1hcChhc3luYyAodXNlcklkKSA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gQ2hlY2sgaWYgdXNlciBleGlzdHMsIGNyZWF0ZSBpZiBub3RcclxuICAgICAgICBjb25zdCBleGlzdGluZ1VzZXIgPSBhd2FpdCB0aGlzLmdldFVzZXIodXNlcklkKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoZXhpc3RpbmdVc2VyKSB7XHJcbiAgICAgICAgICAvLyBVcGRhdGUgZXhpc3RpbmcgdXNlcidzIGxhc3QgYWN0aXZpdHlcclxuICAgICAgICAgIGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBQdXRDb21tYW5kKHtcclxuICAgICAgICAgICAgVGFibGVOYW1lOiB0aGlzLnVzZXJzVGFibGUsXHJcbiAgICAgICAgICAgIEl0ZW06IHtcclxuICAgICAgICAgICAgICAuLi5leGlzdGluZ1VzZXIsXHJcbiAgICAgICAgICAgICAgbGFzdEFjdGl2ZUF0OiB0aW1lc3RhbXAsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9KSk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIC8vIENyZWF0ZSBuZXcgdXNlciByZWNvcmRcclxuICAgICAgICAgIGNvbnN0IG5ld1VzZXI6IFVzZXIgPSB7XHJcbiAgICAgICAgICAgIGlkOiB1c2VySWQsXHJcbiAgICAgICAgICAgIGVtYWlsOiAnJywgLy8gV2lsbCBiZSBwb3B1bGF0ZWQgZnJvbSBDb2duaXRvIHdoZW4gYXZhaWxhYmxlXHJcbiAgICAgICAgICAgIGNyZWF0ZWRBdDogdGltZXN0YW1wLFxyXG4gICAgICAgICAgICBsYXN0QWN0aXZlQXQ6IHRpbWVzdGFtcCxcclxuICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgYXdhaXQgZG9jQ2xpZW50LnNlbmQobmV3IFB1dENvbW1hbmQoe1xyXG4gICAgICAgICAgICBUYWJsZU5hbWU6IHRoaXMudXNlcnNUYWJsZSxcclxuICAgICAgICAgICAgSXRlbTogbmV3VXNlcixcclxuICAgICAgICAgICAgQ29uZGl0aW9uRXhwcmVzc2lvbjogJ2F0dHJpYnV0ZV9ub3RfZXhpc3RzKGlkKScsIC8vIFByZXZlbnQgb3ZlcndyaXRpbmdcclxuICAgICAgICAgIH0pKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBVcGRhdGVkIGFjdGl2aXR5IGZvciB1c2VyOiAke3VzZXJJZH1gKTtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciB1cGRhdGluZyB1c2VyIGFjdGl2aXR5IGZvciAke3VzZXJJZH06YCwgZXJyb3IpO1xyXG4gICAgICAgIC8vIENvbnRpbnVlIHdpdGggb3RoZXIgdXNlcnMgZXZlbiBpZiBvbmUgZmFpbHNcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKHVwZGF0ZVByb21pc2VzKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZ2V0VXNlcih1c2VySWQ6IHN0cmluZyk6IFByb21pc2U8VXNlciB8IG51bGw+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRvY0NsaWVudC5zZW5kKG5ldyBHZXRDb21tYW5kKHtcclxuICAgICAgICBUYWJsZU5hbWU6IHRoaXMudXNlcnNUYWJsZSxcclxuICAgICAgICBLZXk6IHsgaWQ6IHVzZXJJZCB9LFxyXG4gICAgICB9KSk7XHJcblxyXG4gICAgICByZXR1cm4gcmVzdWx0Lkl0ZW0gYXMgVXNlciB8fCBudWxsO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZ2V0dGluZyB1c2VyICR7dXNlcklkfTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgcHJvY2Vzc01hdGNoTm90aWZpY2F0aW9uKG1hdGNoOiBNYXRjaCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgLy8gRnV0dXJlIGltcGxlbWVudGF0aW9uIGZvciByZWFsLXRpbWUgbm90aWZpY2F0aW9uc1xyXG4gICAgLy8gQ291bGQgaW50ZWdyYXRlIHdpdGg6XHJcbiAgICAvLyAtIEFwcFN5bmMgc3Vic2NyaXB0aW9uc1xyXG4gICAgLy8gLSBTTlMgZm9yIHB1c2ggbm90aWZpY2F0aW9uc1xyXG4gICAgLy8gLSBXZWJTb2NrZXQgY29ubmVjdGlvbnNcclxuICAgIC8vIC0gRW1haWwgbm90aWZpY2F0aW9uc1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBNYXRjaCBub3RpZmljYXRpb246ICR7bWF0Y2gudGl0bGV9IG1hdGNoZWQgaW4gcm9vbSAke21hdGNoLnJvb21JZH1gKTtcclxuICAgIFxyXG4gICAgLy8gRm9yIE1WUCwganVzdCBsb2cgdGhlIG5vdGlmaWNhdGlvblxyXG4gICAgLy8gSW4gcHJvZHVjdGlvbiwgaW1wbGVtZW50IGFjdHVhbCBub3RpZmljYXRpb24gZGVsaXZlcnlcclxuICB9XHJcbn1cclxuXHJcbi8vIExhbWJkYSBIYW5kbGVyXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyPE1hdGNoRXZlbnQsIE1hdGNoUmVzcG9uc2U+ID0gYXN5bmMgKGV2ZW50KSA9PiB7XHJcbiAgY29uc29sZS5sb2coJ01hdGNoIExhbWJkYSByZWNlaXZlZCBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCkpO1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgbWF0Y2hTZXJ2aWNlID0gbmV3IE1hdGNoU2VydmljZSgpO1xyXG5cclxuICAgIHN3aXRjaCAoZXZlbnQub3BlcmF0aW9uKSB7XHJcbiAgICAgIGNhc2UgJ2NyZWF0ZU1hdGNoJzoge1xyXG4gICAgICAgIGNvbnN0IHsgaW5wdXQgfSA9IGV2ZW50O1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENyZWF0ZSB0aGUgbWF0Y2ggb2JqZWN0XHJcbiAgICAgICAgY29uc3QgdGltZXN0YW1wID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xyXG4gICAgICAgIGNvbnN0IG1hdGNoSWQgPSBgJHtpbnB1dC5yb29tSWR9IyR7aW5wdXQubW92aWVJZH1gO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IG1hdGNoOiBNYXRjaCA9IHtcclxuICAgICAgICAgIGlkOiBtYXRjaElkLFxyXG4gICAgICAgICAgcm9vbUlkOiBpbnB1dC5yb29tSWQsXHJcbiAgICAgICAgICBtb3ZpZUlkOiBpbnB1dC5tb3ZpZUlkLFxyXG4gICAgICAgICAgdGl0bGU6IGlucHV0LnRpdGxlLFxyXG4gICAgICAgICAgcG9zdGVyUGF0aDogaW5wdXQucG9zdGVyUGF0aCxcclxuICAgICAgICAgIG1lZGlhVHlwZTogJ01PVklFJywgLy8gRGVmYXVsdCwgc2hvdWxkIGJlIHBhc3NlZCBmcm9tIGlucHV0XHJcbiAgICAgICAgICBtYXRjaGVkVXNlcnM6IGlucHV0Lm1hdGNoZWRVc2VycyxcclxuICAgICAgICAgIHRpbWVzdGFtcCxcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjb25zb2xlLmxvZyhgQ3JlYXRlTWF0Y2ggbXV0YXRpb24gZXhlY3V0ZWQgLSB0cmlnZ2VyaW5nIHN1YnNjcmlwdGlvbnMgZm9yOiAke21hdGNoLnRpdGxlfWApO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBOb3RpZnlpbmcgJHttYXRjaC5tYXRjaGVkVXNlcnMubGVuZ3RofSB1c2VyczogJHttYXRjaC5tYXRjaGVkVXNlcnMuam9pbignLCAnKX1gKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDUklUSUNBTDogVGhpcyBtdXRhdGlvbiBleGVjdXRpb24gd2lsbCBhdXRvbWF0aWNhbGx5IHRyaWdnZXIgQXBwU3luYyBzdWJzY3JpcHRpb25zXHJcbiAgICAgICAgLy8gQWxsIHVzZXJzIHN1YnNjcmliZWQgdG8gb25NYXRjaENyZWF0ZWQodXNlcklkOiAkdXNlcklkKSB3aWxsIHJlY2VpdmUgdGhpcyBtYXRjaFxyXG4gICAgICAgIC8vIFRoZSBzdWJzY3JpcHRpb24gaXMgY29uZmlndXJlZCBpbiBzY2hlbWEuZ3JhcGhxbCBhczpcclxuICAgICAgICAvLyBvbk1hdGNoQ3JlYXRlZCh1c2VySWQ6IFN0cmluZyEpOiBNYXRjaCBAYXdzX3N1YnNjcmliZShtdXRhdGlvbnM6IFtcImNyZWF0ZU1hdGNoXCJdKVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFRoZSBBcHBTeW5jIHJlc29sdmVyIHdpbGwgcmV0dXJuIHRoaXMgbWF0Y2gsIGFuZCBBcHBTeW5jIHdpbGwgYXV0b21hdGljYWxseVxyXG4gICAgICAgIC8vIHNlbmQgaXQgdG8gYWxsIHN1YnNjcmliZXJzIHdobyBoYXZlIHVzZXJJZCBpbiBtYXRjaC5tYXRjaGVkVXNlcnNcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgICAgYm9keTogeyBtYXRjaCB9LFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ21hdGNoQ3JlYXRlZCc6IHtcclxuICAgICAgICBjb25zdCB7IG1hdGNoIH0gPSBldmVudDtcclxuICAgICAgICBcclxuICAgICAgICAvLyBQcm9jZXNzIHRoZSBtYXRjaCBjcmVhdGlvblxyXG4gICAgICAgIGF3YWl0IG1hdGNoU2VydmljZS5oYW5kbGVNYXRjaENyZWF0ZWQobWF0Y2gpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFNlbmQgbm90aWZpY2F0aW9ucyAoZnV0dXJlIGltcGxlbWVudGF0aW9uKVxyXG4gICAgICAgIGF3YWl0IG1hdGNoU2VydmljZS5wcm9jZXNzTWF0Y2hOb3RpZmljYXRpb24obWF0Y2gpO1xyXG5cclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgICAgYm9keTogeyBzdWNjZXNzOiB0cnVlIH0sXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY2FzZSAnZ2V0VXNlck1hdGNoZXMnOiB7XHJcbiAgICAgICAgY29uc3QgeyB1c2VySWQgfSA9IGV2ZW50O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghdXNlcklkKSB7XHJcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1VzZXIgSUQgaXMgcmVxdWlyZWQnKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IG1hdGNoZXMgPSBhd2FpdCBtYXRjaFNlcnZpY2UuZ2V0VXNlck1hdGNoZXModXNlcklkKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgICAgIGJvZHk6IHsgbWF0Y2hlcyB9LFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNhc2UgJ2NoZWNrUm9vbU1hdGNoJzoge1xyXG4gICAgICAgIGNvbnN0IHsgcm9vbUlkIH0gPSBldmVudDtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIXJvb21JZCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdSb29tIElEIGlzIHJlcXVpcmVkJyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBtYXRjaCA9IGF3YWl0IG1hdGNoU2VydmljZS5jaGVja1Jvb21NYXRjaChyb29tSWQpO1xyXG5cclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICAgICAgYm9keTogeyBtYXRjaDogbWF0Y2ggfHwgdW5kZWZpbmVkIH0sXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY2FzZSAnbm90aWZ5TWF0Y2gnOiB7XHJcbiAgICAgICAgY29uc3QgeyBtYXRjaCB9ID0gZXZlbnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFtYXRjaCkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdNYXRjaCBpcyByZXF1aXJlZCcpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgYXdhaXQgbWF0Y2hTZXJ2aWNlLm5vdGlmeU1hdGNoVG9Vc2VycyhtYXRjaCk7XHJcblxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgICAgICBib2R5OiB7IHN1Y2Nlc3M6IHRydWUgfSxcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBkZWZhdWx0OlxyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvcGVyYXRpb246ICR7KGV2ZW50IGFzIGFueSkub3BlcmF0aW9ufWApO1xyXG4gICAgfVxyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignTWF0Y2ggTGFtYmRhIGVycm9yOicsIGVycm9yKTtcclxuICAgIFxyXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCc7XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDQwMCxcclxuICAgICAgYm9keToge1xyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgIGVycm9yOiBlcnJvck1lc3NhZ2UsXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG4gIH1cclxufTsiXX0=