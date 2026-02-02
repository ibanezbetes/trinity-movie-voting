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
    
    // Verify that we have valid tokens
    const hasValidTokens = !!(
      session.tokens?.accessToken && 
      session.tokens?.idToken &&
      session.tokens.accessToken.toString() &&
      session.tokens.idToken.toString()
    );
    
    logger.auth('Auth status verified', {
      userId: user.userId,
      username: user.username,
      hasTokens: !!session.tokens,
      hasAccessToken: !!session.tokens?.accessToken,
      hasIdToken: !!session.tokens?.idToken,
      hasValidTokens,
    });
    
    if (!hasValidTokens) {
      logger.authError('Invalid or missing tokens', { session: session.tokens });
      throw new Error('Invalid authentication tokens');
    }
    
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

// Helper function to refresh authentication session
export const refreshAuthSession = async () => {
  try {
    logger.auth('Refreshing auth session');
    const session = await fetchAuthSession({ forceRefresh: true });
    
    const hasValidTokens = !!(
      session.tokens?.accessToken && 
      session.tokens?.idToken &&
      session.tokens.accessToken.toString() &&
      session.tokens.idToken.toString()
    );
    
    if (!hasValidTokens) {
      throw new Error('Failed to refresh tokens');
    }
    
    logger.auth('Auth session refreshed successfully');
    return session;
  } catch (error) {
    logger.authError('Failed to refresh auth session', error);
    throw error;
  }
};