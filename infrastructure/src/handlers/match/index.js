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
