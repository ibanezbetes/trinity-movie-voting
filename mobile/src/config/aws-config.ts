// Auto-generated AWS configuration
// Generated on: 2026-02-03T02:13:01.327Z
// Stack: TrinityStack

export interface AWSConfig {
  region: string;
  userPoolId: string;
  userPoolWebClientId: string;
  graphqlEndpoint: string;
  authenticationType: string;
  // CRITICAL: Add real-time endpoint for subscriptions
  realtimeEndpoint?: string;
}

export const awsConfig: AWSConfig = {
  region: 'eu-west-1',
  userPoolId: 'eu-west-1_RPkdnO7Ju',
  userPoolWebClientId: '61nf41i2bff1c4oc4qo9g36m1k',
  graphqlEndpoint: 'https://nvokqs473bbfdizeq4n5oosjpy.appsync-api.eu-west-1.amazonaws.com/graphql',
  // CRITICAL: Add real-time endpoint for WebSocket subscriptions
  realtimeEndpoint: 'wss://nvokqs473bbfdizeq4n5oosjpy.appsync-realtime-api.eu-west-1.amazonaws.com/graphql',
  authenticationType: 'AMAZON_COGNITO_USER_POOLS',
};

// Environment variables for Expo
export const expoConfig = {
  EXPO_PUBLIC_AWS_REGION: 'eu-west-1',
  EXPO_PUBLIC_USER_POOL_ID: 'eu-west-1_RPkdnO7Ju',
  EXPO_PUBLIC_USER_POOL_CLIENT_ID: '61nf41i2bff1c4oc4qo9g36m1k',
  EXPO_PUBLIC_GRAPHQL_ENDPOINT: 'https://nvokqs473bbfdizeq4n5oosjpy.appsync-api.eu-west-1.amazonaws.com/graphql',
  EXPO_PUBLIC_REALTIME_ENDPOINT: 'wss://nvokqs473bbfdizeq4n5oosjpy.appsync-realtime-api.eu-west-1.amazonaws.com/graphql',
  EXPO_PUBLIC_AUTH_TYPE: 'AMAZON_COGNITO_USER_POOLS',
};

// CRITICAL: Enhanced Amplify configuration for real-time subscriptions
export const amplifyConfig = {
  aws_project_region: 'eu-west-1',
  aws_appsync_graphqlEndpoint: 'https://nvokqs473bbfdizeq4n5oosjpy.appsync-api.eu-west-1.amazonaws.com/graphql',
  aws_appsync_region: 'eu-west-1',
  aws_appsync_authenticationType: 'AMAZON_COGNITO_USER_POOLS',
  // CRITICAL: Add real-time configuration for WebSocket subscriptions
  aws_appsync_realtimeEndpoint: 'wss://nvokqs473bbfdizeq4n5oosjpy.appsync-realtime-api.eu-west-1.amazonaws.com/graphql',
  aws_cognito_region: 'eu-west-1',
  aws_user_pools_id: 'eu-west-1_RPkdnO7Ju',
  aws_user_pools_web_client_id: '61nf41i2bff1c4oc4qo9g36m1k',
  // CRITICAL: Enable WebSocket for real-time subscriptions
  aws_appsync_dangerously_connect_to_http_endpoint_for_testing: false,
};
