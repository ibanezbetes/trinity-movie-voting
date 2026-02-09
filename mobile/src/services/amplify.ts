import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { awsConfig } from '../config/aws-config';
import { logger } from './logger';

logger.info('AMPLIFY', 'Configuring AWS Amplify with enhanced real-time support', {
  region: awsConfig.region,
  endpoint: awsConfig.graphqlEndpoint,
  userPoolId: awsConfig.userPoolId,
  clientId: awsConfig.userPoolWebClientId
});

// CRITICAL: Configure Amplify with enhanced real-time support and OAuth
const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: awsConfig.userPoolId,
      userPoolClientId: awsConfig.userPoolWebClientId,
      identityPoolId: awsConfig.identityPoolId,
      region: awsConfig.region,
      loginWith: {
        oauth: awsConfig.oauth ? {
          domain: awsConfig.oauth.domain,
          scopes: awsConfig.oauth.scope,
          redirectSignIn: [awsConfig.oauth.redirectSignIn],
          redirectSignOut: [awsConfig.oauth.redirectSignOut],
          responseType: awsConfig.oauth.responseType as 'code',
        } : undefined,
      },
    },
  },
  API: {
    GraphQL: {
      endpoint: awsConfig.graphqlEndpoint,
      region: awsConfig.region,
      defaultAuthMode: 'userPool', // CRITICAL FIX: Use 'userPool' instead of 'AMAZON_COGNITO_USER_POOLS'
      apiKey: process.env.EXPO_PUBLIC_GRAPHQL_API_KEY,
    },
  },
};

Amplify.configure(amplifyConfig);

logger.info('AMPLIFY', 'AWS Amplify configured successfully with real-time support');

// Helper function to get the appropriate auth mode based on login type
export const getAuthMode = async (): Promise<'userPool' | 'iam'> => {
  try {
    const authType = await AsyncStorage.getItem('@trinity_auth_type');
    if (authType === 'google') {
      logger.info('AMPLIFY', 'Using IAM auth mode for Google login');
      return 'iam';
    }
    logger.info('AMPLIFY', 'Using User Pool auth mode');
    return 'userPool';
  } catch (error) {
    logger.error('AMPLIFY', 'Error getting auth mode, defaulting to userPool', error);
    return 'userPool';
  }
};

// Custom credentials provider for Google login
const googleCredentialsProvider = {
  getCredentialsAndIdentityId: async () => {
    try {
      const accessKey = await AsyncStorage.getItem('@trinity_aws_access_key');
      const secretKey = await AsyncStorage.getItem('@trinity_aws_secret_key');
      const sessionToken = await AsyncStorage.getItem('@trinity_aws_session_token');
      const expiration = await AsyncStorage.getItem('@trinity_aws_expiration');
      
      if (!accessKey || !secretKey) {
        throw new Error('No AWS credentials found in storage');
      }
      
      // Check if credentials are expired
      if (expiration) {
        const expirationDate = new Date(expiration);
        if (expirationDate < new Date()) {
          logger.auth('AWS credentials expired, need to refresh');
          // Try to refresh credentials
          const refreshed = await refreshAuthSession();
          if (refreshed && 'credentials' in refreshed) {
            return {
              credentials: {
                accessKeyId: refreshed.credentials.accessKeyId,
                secretAccessKey: refreshed.credentials.secretAccessKey,
                sessionToken: refreshed.credentials.sessionToken,
                expiration: refreshed.credentials.expiration,
              },
              identityId: undefined,
            };
          }
          throw new Error('Failed to refresh expired credentials');
        }
      }
      
      logger.auth('Retrieved AWS credentials from storage', {
        hasAccessKey: !!accessKey,
        hasSecretKey: !!secretKey,
        hasSessionToken: !!sessionToken,
        expiration,
      });
      
      return {
        credentials: {
          accessKeyId: accessKey,
          secretAccessKey: secretKey,
          sessionToken: sessionToken || undefined,
          expiration: expiration ? new Date(expiration) : undefined,
        },
        identityId: undefined,
      };
    } catch (error) {
      logger.error('AMPLIFY', 'Failed to get Google credentials from storage', error);
      throw error;
    }
  },
  clearCredentialsAndIdentityId: async () => {
    logger.auth('Clearing Google credentials from storage');
    await AsyncStorage.multiRemove([
      '@trinity_auth_type',
      '@trinity_google_token',
      '@trinity_google_email',
      '@trinity_google_name',
      '@trinity_aws_access_key',
      '@trinity_aws_secret_key',
      '@trinity_aws_session_token',
      '@trinity_aws_expiration',
      '@trinity_cognito_identity_id',
    ]);
  },
};

// Function to reconfigure Amplify for Google login
export const configureAmplifyForGoogle = async () => {
  try {
    logger.auth('Reconfiguring Amplify for Google login');
    
    Amplify.configure({
      Auth: {
        Cognito: {
          identityPoolId: awsConfig.identityPoolId,
          region: awsConfig.region,
        }
      },
      API: {
        GraphQL: {
          endpoint: awsConfig.graphqlEndpoint,
          region: awsConfig.region,
          defaultAuthMode: 'iam',
        },
      },
    }, {
      Auth: {
        credentialsProvider: googleCredentialsProvider,
      },
    });
    
    logger.auth('Amplify reconfigured for Google login with persistent credentials provider');
  } catch (error) {
    logger.error('AMPLIFY', 'Failed to reconfigure Amplify for Google', error);
    throw error;
  }
};

// CRITICAL FIX: Create GraphQL client factory that properly handles IAM credentials
// The client must be created dynamically to use the correct auth mode and credentials

// Helper to create a client with proper IAM credentials
const createClientWithAuth = async (authMode: 'userPool' | 'iam') => {
  if (authMode === 'iam') {
    // For IAM auth, we need to ensure Amplify uses the credentials from AsyncStorage
    logger.info('AMPLIFY', 'Creating GraphQL client with IAM auth mode');
    
    // Verify credentials are available
    const accessKey = await AsyncStorage.getItem('@trinity_aws_access_key');
    const secretKey = await AsyncStorage.getItem('@trinity_aws_secret_key');
    
    if (!accessKey || !secretKey) {
      logger.error('AMPLIFY', 'No AWS credentials found for IAM auth');
      throw new Error('No AWS credentials available for IAM authentication');
    }
    
    logger.info('AMPLIFY', 'AWS credentials verified for IAM auth', {
      hasAccessKey: !!accessKey,
      hasSecretKey: !!secretKey,
    });
    
    // CRITICAL FIX: Reconfigure Amplify with credentials provider before creating client
    // This ensures the client uses the credentials from AsyncStorage
    await configureAmplifyForGoogle();
  }
  
  return generateClient({ authMode });
};

// Create GraphQL client with dynamic authentication
// This will be recreated after login to use the correct auth mode
let _client: any = null;
let _realtimeClient: any = null;

export const getClient = async () => {
  const authMode = await getAuthMode();
  
  // Always recreate client to ensure fresh credentials for IAM
  if (authMode === 'iam' || !_client) {
    _client = await createClientWithAuth(authMode);
    logger.info('AMPLIFY', `GraphQL client created with ${authMode} auth mode`);
  }
  
  return _client;
};

export const getRealtimeClient = async () => {
  const authMode = await getAuthMode();
  
  // Always recreate client to ensure fresh credentials for IAM
  if (authMode === 'iam' || !_realtimeClient) {
    _realtimeClient = await createClientWithAuth(authMode);
    logger.info('AMPLIFY', `Realtime client created with ${authMode} auth mode`);
  }
  
  return _realtimeClient;
};

// Reset clients (call this after login/logout)
export const resetClients = () => {
  _client = null;
  _realtimeClient = null;
  logger.info('AMPLIFY', 'GraphQL clients reset');
};

// CRITICAL FIX: Export dynamic clients that check auth mode at runtime
// These replace the legacy static exports
export const client = {
  graphql: async (options: any) => {
    const dynamicClient = await getClient();
    return dynamicClient.graphql(options);
  }
};

export const realtimeClient = {
  graphql: async (options: any) => {
    const dynamicClient = await getRealtimeClient();
    return dynamicClient.graphql(options);
  }
};

logger.info('AMPLIFY', 'GraphQL clients created successfully (standard + realtime)');

// Helper function to verify authentication status
export const verifyAuthStatus = async () => {
  try {
    // Check if using Google auth
    const authType = await AsyncStorage.getItem('@trinity_auth_type');
    
    if (authType === 'google') {
      // For Google auth, verify AWS credentials
      const accessKey = await AsyncStorage.getItem('@trinity_aws_access_key');
      const secretKey = await AsyncStorage.getItem('@trinity_aws_secret_key');
      const sessionToken = await AsyncStorage.getItem('@trinity_aws_session_token');
      const expiration = await AsyncStorage.getItem('@trinity_aws_expiration');
      
      if (!accessKey || !secretKey) {
        throw new Error('Missing AWS credentials');
      }
      
      // Check if credentials are expired
      if (expiration) {
        const expirationDate = new Date(expiration);
        if (expirationDate < new Date()) {
          throw new Error('AWS credentials expired');
        }
      }
      
      // CRITICAL FIX: Get Cognito Identity ID from credentials
      // This is the actual userId that backend uses for IAM auth
      let cognitoIdentityId = await AsyncStorage.getItem('@trinity_cognito_identity_id');
      
      // If not stored, extract it from the credentials
      if (!cognitoIdentityId) {
        try {
          const { fromCognitoIdentityPool } = await import('@aws-sdk/credential-providers');
          const googleToken = await AsyncStorage.getItem('@trinity_google_token');
          
          if (googleToken) {
            const credentialsProvider = fromCognitoIdentityPool({
              identityPoolId: awsConfig.identityPoolId,
              logins: {
                'accounts.google.com': googleToken
              },
              clientConfig: { region: awsConfig.region }
            });
            
            const creds = await credentialsProvider();
            // The identity ID is available in the credentials object
            // @ts-ignore - identityId is not in the types but exists at runtime
            cognitoIdentityId = creds.identityId;
            
            if (cognitoIdentityId) {
              await AsyncStorage.setItem('@trinity_cognito_identity_id', cognitoIdentityId);
              logger.auth('Cognito Identity ID extracted and stored', { cognitoIdentityId });
            }
          }
        } catch (error) {
          logger.authError('Failed to extract Cognito Identity ID', error);
        }
      }
      
      const email = await AsyncStorage.getItem('@trinity_google_email');
      
      logger.auth('Google auth status verified', {
        email,
        hasCredentials: true,
        expiration,
        cognitoIdentityId,
      });
      
      // CRITICAL: Use cognitoIdentityId as userId for Google users
      // This matches what the backend receives in event.identity.cognitoIdentityId
      return {
        isAuthenticated: true,
        user: { 
          userId: cognitoIdentityId || email, // Fallback to email if identity ID not available
          username: email,
          email,
        },
        session: { credentials: { accessKeyId: accessKey, secretAccessKey: secretKey, sessionToken } },
      };
    }
    
    // For User Pool auth, use standard verification
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
    
    // Check if using Google auth
    const authType = await AsyncStorage.getItem('@trinity_auth_type');
    
    if (authType === 'google') {
      // For Google auth, refresh AWS credentials using the Google token
      const googleToken = await AsyncStorage.getItem('@trinity_google_token');
      
      if (!googleToken) {
        throw new Error('No Google token found');
      }
      
      // Import credentials provider
      const { fromCognitoIdentityPool } = await import('@aws-sdk/credential-providers');
      
      const credentialsProvider = fromCognitoIdentityPool({
        identityPoolId: awsConfig.identityPoolId,
        logins: {
          'accounts.google.com': googleToken
        },
        clientConfig: { region: awsConfig.region }
      });
      
      const credentials = await credentialsProvider();
      
      // Update stored credentials
      await AsyncStorage.setItem('@trinity_aws_access_key', credentials.accessKeyId);
      await AsyncStorage.setItem('@trinity_aws_secret_key', credentials.secretAccessKey);
      await AsyncStorage.setItem('@trinity_aws_session_token', credentials.sessionToken || '');
      await AsyncStorage.setItem('@trinity_aws_expiration', credentials.expiration?.toISOString() || '');
      
      logger.auth('Google auth session refreshed successfully');
      
      return { credentials };
    }
    
    // For User Pool auth, use standard refresh
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