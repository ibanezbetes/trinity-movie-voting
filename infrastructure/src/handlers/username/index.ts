import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient, AdminDeleteUserCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const cognitoClient = new CognitoIdentityProviderClient({});

const USERNAMES_TABLE = process.env.USERNAMES_TABLE || 'trinity-usernames';
const ROOMS_TABLE = process.env.ROOMS_TABLE || 'trinity-rooms';
const VOTES_TABLE = process.env.VOTES_TABLE || 'trinity-votes';
const MATCHES_TABLE = process.env.MATCHES_TABLE || 'trinity-matches';
const USER_POOL_ID = process.env.USER_POOL_ID || '';

interface AppSyncEvent {
  info: {
    fieldName: string;
  };
  arguments: {
    username?: string;
  };
  identity: {
    claims: {
      sub: string;
      email: string;
      preferred_username?: string;
    };
  };
}

export const handler = async (event: AppSyncEvent) => {
  console.log('Username handler invoked', {
    fieldName: event.info.fieldName,
    arguments: event.arguments,
  });

  const { fieldName } = event.info;

  try {
    switch (fieldName) {
      case 'getUsernameEmail':
        return await getUsernameEmail(event.arguments.username!);
      case 'deleteUserAccount':
        return await deleteUserAccount(event);
      default:
        throw new Error(`Unknown field: ${fieldName}`);
    }
  } catch (error) {
    console.error('Error in username handler', error);
    throw error;
  }
};

async function getUsernameEmail(username: string) {
  console.log('Getting email for username', { username });

  const normalizedUsername = username.toLowerCase().trim();

  const result = await docClient.send(
    new GetCommand({
      TableName: USERNAMES_TABLE,
      Key: {
        username: normalizedUsername,
      },
    })
  );

  if (!result.Item) {
    console.log('Username not found', { username: normalizedUsername });
    return null;
  }

  console.log('Username found', {
    username: normalizedUsername,
    email: result.Item.email,
  });

  return {
    username: result.Item.username,
    email: result.Item.email,
  };
}

async function deleteUserAccount(event: AppSyncEvent) {
  const userId = event.identity.claims.sub;
  const email = event.identity.claims.email;
  const username = event.identity.claims.preferred_username;

  console.log('Deleting user account', { userId, email, username });

  const deletedItems = {
    username: false,
    rooms: 0,
    votes: 0,
    matches: 0,
  };

  try {
    // 1. Delete username mapping
    if (username) {
      try {
        await docClient.send(
          new DeleteCommand({
            TableName: USERNAMES_TABLE,
            Key: {
              username: username.toLowerCase().trim(),
            },
          })
        );
        deletedItems.username = true;
        console.log('Username mapping deleted', { username });
      } catch (error) {
        console.error('Failed to delete username mapping', error);
      }
    }

    // 2. Delete user's rooms (where user is host)
    try {
      const roomsResult = await docClient.send(
        new QueryCommand({
          TableName: ROOMS_TABLE,
          IndexName: 'hostId-index', // Assuming we have this GSI
          KeyConditionExpression: 'hostId = :hostId',
          ExpressionAttributeValues: {
            ':hostId': userId,
          },
        })
      );

      if (roomsResult.Items && roomsResult.Items.length > 0) {
        // Delete rooms in batches of 25 (DynamoDB limit)
        for (let i = 0; i < roomsResult.Items.length; i += 25) {
          const batch = roomsResult.Items.slice(i, i + 25);
          await docClient.send(
            new BatchWriteCommand({
              RequestItems: {
                [ROOMS_TABLE]: batch.map(room => ({
                  DeleteRequest: {
                    Key: { id: room.id },
                  },
                })),
              },
            })
          );
          deletedItems.rooms += batch.length;
        }
        console.log('User rooms deleted', { count: deletedItems.rooms });
      }
    } catch (error) {
      console.error('Failed to delete rooms', error);
    }

    // 3. Delete user's votes
    try {
      // Query all votes by scanning (not ideal but necessary without GSI)
      const votesResult = await docClient.send(
        new QueryCommand({
          TableName: VOTES_TABLE,
          FilterExpression: 'userId = :userId',
          ExpressionAttributeValues: {
            ':userId': userId,
          },
        })
      );

      if (votesResult.Items && votesResult.Items.length > 0) {
        for (let i = 0; i < votesResult.Items.length; i += 25) {
          const batch = votesResult.Items.slice(i, i + 25);
          await docClient.send(
            new BatchWriteCommand({
              RequestItems: {
                [VOTES_TABLE]: batch.map(vote => ({
                  DeleteRequest: {
                    Key: {
                      roomId: vote.roomId,
                      userMovieId: vote.userMovieId,
                    },
                  },
                })),
              },
            })
          );
          deletedItems.votes += batch.length;
        }
        console.log('User votes deleted', { count: deletedItems.votes });
      }
    } catch (error) {
      console.error('Failed to delete votes', error);
    }

    // 4. Delete user from Cognito
    try {
      await cognitoClient.send(
        new AdminDeleteUserCommand({
          UserPoolId: USER_POOL_ID,
          Username: email, // Cognito username is email
        })
      );
      console.log('User deleted from Cognito', { email });
    } catch (error) {
      console.error('Failed to delete user from Cognito', error);
      throw new Error('Failed to delete user from Cognito');
    }

    return {
      success: true,
      message: 'User account deleted successfully',
      deletedItems,
    };
  } catch (error) {
    console.error('Error deleting user account', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `Failed to delete user account: ${errorMessage}`,
      deletedItems,
    };
  }
}
