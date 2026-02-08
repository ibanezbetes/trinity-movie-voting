import { PostAuthenticationTriggerEvent, PostAuthenticationTriggerHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const USERNAMES_TABLE = process.env.USERNAMES_TABLE || 'trinity-usernames';
const ROOMS_TABLE = process.env.ROOMS_TABLE || 'trinity-rooms';
const VOTES_TABLE = process.env.VOTES_TABLE || 'trinity-votes';
const MATCHES_TABLE = process.env.MATCHES_TABLE || 'trinity-matches';

/**
 * Cognito Post Authentication Trigger
 * Handles user deletion cleanup
 */
export const handler: PostAuthenticationTriggerHandler = async (
  event: PostAuthenticationTriggerEvent
): Promise<PostAuthenticationTriggerEvent> => {
  console.log('Post Authentication Trigger invoked', {
    userPoolId: event.userPoolId,
    userName: event.userName,
    triggerSource: event.triggerSource,
  });

  // This trigger runs after successful authentication
  // We'll use a separate trigger for user deletion

  return event;
};
