import { PostConfirmationTriggerEvent, PostConfirmationTriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const USERNAMES_TABLE = process.env.USERNAMES_TABLE || 'trinity-usernames';

/**
 * Cognito Post Confirmation Trigger
 * Stores username -> email mapping in DynamoDB after successful user creation
 */
export const handler: PostConfirmationTriggerHandler = async (
  event: PostConfirmationTriggerEvent
): Promise<PostConfirmationTriggerEvent> => {
  console.log('Post Confirmation Trigger invoked', {
    userPoolId: event.userPoolId,
    userName: event.userName,
    email: event.request.userAttributes.email,
    preferredUsername: event.request.userAttributes.preferred_username,
    triggerSource: event.triggerSource,
  });

  // Store username -> email mapping if preferred_username is provided
  const preferredUsername = event.request.userAttributes.preferred_username;
  const email = event.request.userAttributes.email;

  if (preferredUsername && email) {
    try {
      await docClient.send(
        new PutCommand({
          TableName: USERNAMES_TABLE,
          Item: {
            username: preferredUsername.toLowerCase().trim(),
            email: email.toLowerCase().trim(),
            createdAt: new Date().toISOString(),
          },
          // Prevent overwriting existing username (should not happen, but just in case)
          ConditionExpression: 'attribute_not_exists(username)',
        })
      );

      console.log('Username mapping stored successfully', {
        username: preferredUsername,
        email: email,
      });
    } catch (error: any) {
      console.error('Failed to store username mapping', error);
      // Don't fail the confirmation if DynamoDB fails
      // User is already created in Cognito at this point
    }
  }

  return event;
};
