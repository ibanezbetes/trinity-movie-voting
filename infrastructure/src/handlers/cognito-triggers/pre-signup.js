"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client = new client_dynamodb_1.DynamoDBClient({});
const docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(client);
const USERNAMES_TABLE = process.env.USERNAMES_TABLE || 'trinity-usernames';
/**
 * Cognito Pre Sign-up Trigger
 * Auto-confirms users and their email addresses
 * Validates username availability (does NOT store it yet)
 */
const handler = async (event) => {
    console.log('Pre Sign-up Trigger invoked', {
        userPoolId: event.userPoolId,
        userName: event.userName,
        email: event.request.userAttributes.email,
        preferredUsername: event.request.userAttributes.preferred_username,
    });
    // Auto-confirm the user
    event.response.autoConfirmUser = true;
    // Auto-verify the email
    if (event.request.userAttributes.email) {
        event.response.autoVerifyEmail = true;
    }
    // Validate username availability if preferred_username is provided
    const preferredUsername = event.request.userAttributes.preferred_username;
    if (preferredUsername) {
        try {
            const result = await docClient.send(new lib_dynamodb_1.GetCommand({
                TableName: USERNAMES_TABLE,
                Key: {
                    username: preferredUsername.toLowerCase().trim(),
                },
            }));
            // If username exists, fail the registration
            if (result.Item) {
                console.error('Username already exists', { username: preferredUsername });
                throw new Error('El nombre de usuario ya está en uso');
            }
            console.log('Username available', { username: preferredUsername });
        }
        catch (error) {
            if (error.message === 'El nombre de usuario ya está en uso') {
                throw error;
            }
            console.error('Failed to check username availability', error);
            // Don't fail registration if DynamoDB check fails
        }
    }
    console.log('User auto-confirmed', {
        userName: event.userName,
        autoConfirmUser: event.response.autoConfirmUser,
        autoVerifyEmail: event.response.autoVerifyEmail,
    });
    return event;
};
exports.handler = handler;
