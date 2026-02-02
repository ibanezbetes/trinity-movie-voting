import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { awsConfig } from '../config/aws-config';
import { logger } from './logger';

logger.info('AMPLIFY', 'Configuring AWS Amplify', {
  region: awsConfig.region,
  endpoint: awsConfig.graphqlEndpoint,
  userPoolId: awsConfig.userPoolId,
  clientId: awsConfig.userPoolWebClientId
});

// Configure Amplify
Amplify.configure({
  API: {
    GraphQL: {
      endpoint: awsConfig.graphqlEndpoint,
      region: awsConfig.region,
      defaultAuthMode: 'userPool',
    },
  },
  Auth: {
    Cognito: {
      userPoolId: awsConfig.userPoolId,
      userPoolClientId: awsConfig.userPoolWebClientId,
      region: awsConfig.region,
    },
  },
});

logger.info('AMPLIFY', 'AWS Amplify configured successfully');

// Create GraphQL client with authentication
export const client = generateClient({
  authMode: 'userPool',
});

logger.info('AMPLIFY', 'GraphQL client created successfully');

// Helper function to verify authentication status
export const verifyAuthStatus = async () => {
  try {
    const user = await getCurrentUser();
    const session = await fetchAuthSession();
    
    logger.auth('Auth status verified', {
      userId: user.userId,
      username: user.username,
      hasTokens: !!session.tokens,
      hasAccessToken: !!session.tokens?.accessToken,
      hasIdToken: !!session.tokens?.idToken,
    });
    
    return {
      isAuthenticated: true,
      user,
      session,
    };
  } catch (error) {
    logger.authError('Auth status verification failed', error);
    return {
      isAuthenticated: false,
      user: null,
      session: null,
    };
  }
};