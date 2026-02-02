import Constants from 'expo-constants';

// Auto-generated AWS configuration
// Generated on: 2026-02-02T13:21:11.547Z
// Stack: TrinityStack

export interface AWSConfig {
  region: string;
  userPoolId: string;
  userPoolWebClientId: string;
  graphqlEndpoint: string;
  authenticationType: string;
}

// Get configuration from Expo constants (works in production builds)
const getConfigValue = (key: string, fallback: string): string => {
  // Try to get from Expo constants first (production)
  const expoValue = Constants.expoConfig?.extra?.[key];
  if (expoValue) return expoValue;
  
  // Fallback to process.env (development)
  const envValue = process.env[key];
  if (envValue) return envValue;
  
  // Use hardcoded fallback
  return fallback;
};

export const awsConfig: AWSConfig = {
  region: getConfigValue('EXPO_PUBLIC_AWS_REGION', 'eu-west-1'),
  userPoolId: getConfigValue('EXPO_PUBLIC_USER_POOL_ID', 'eu-west-1_RPkdnO7Ju'),
  userPoolWebClientId: getConfigValue('EXPO_PUBLIC_USER_POOL_CLIENT_ID', '61nf41i2bff1c4oc4qo9g36m1k'),
  graphqlEndpoint: getConfigValue('EXPO_PUBLIC_GRAPHQL_ENDPOINT', 'https://nvokqs473bbfdizeq4n5oosjpy.appsync-api.eu-west-1.amazonaws.com/graphql'),
  authenticationType: getConfigValue('EXPO_PUBLIC_AUTH_TYPE', 'AMAZON_COGNITO_USER_POOLS'),
};

// Environment variables for Expo (legacy support)
export const expoConfig = {
  EXPO_PUBLIC_AWS_REGION: awsConfig.region,
  EXPO_PUBLIC_USER_POOL_ID: awsConfig.userPoolId,
  EXPO_PUBLIC_USER_POOL_CLIENT_ID: awsConfig.userPoolWebClientId,
  EXPO_PUBLIC_GRAPHQL_ENDPOINT: awsConfig.graphqlEndpoint,
  EXPO_PUBLIC_AUTH_TYPE: awsConfig.authenticationType,
};
