import { PreSignUpTriggerEvent, PreSignUpTriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const USERNAMES_TABLE = process.env.USERNAMES_TABLE || 'trinity-usernames';

/**
 * Cognito Pre Sign-up Trigger
 * Auto-confirms users and their email addresses
 * Validates username availability (does NOT store it yet)
 */
export const handler: PreSignUpTriggerHandler = async (
  event: PreSignUpTriggerEvent
): Promise<PreSignUpTriggerEvent> => {
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
      const result = await docClient.send(
        new GetCommand({
          TableName: USERNAMES_TABLE,
          Key: {
            username: preferredUsername.toLowerCase().trim(),
          },
        })
      );

      // If username exists, fail the registration
      if (result.Item) {
        console.error('Username already exists', { username: preferredUsername });
        throw new Error('El nombre de usuario ya está en uso');
      }

      console.log('Username available', { username: preferredUsername });
    } catch (error: any) {
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
