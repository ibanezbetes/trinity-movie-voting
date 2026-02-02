// Auto-generated AWS configuration
// Generated on: 2026-02-02T19:03:26.222Z
// Stack: TrinityStack

export interface AWSConfig {
  region: string;
  userPoolId: string;
  userPoolWebClientId: string;
  graphqlEndpoint: string;
  authenticationType: string;
}

export const awsConfig: AWSConfig = {
  region: 'eu-west-1',
  userPoolId: 'eu-west-1_RPkdnO7Ju',
  userPoolWebClientId: '61nf41i2bff1c4oc4qo9g36m1k',
  graphqlEndpoint: 'https://nvokqs473bbfdizeq4n5oosjpy.appsync-api.eu-west-1.amazonaws.com/graphql',
  authenticationType: 'AMAZON_COGNITO_USER_POOLS',
};

// Environment variables for Expo
export const expoConfig = {
  EXPO_PUBLIC_AWS_REGION: 'eu-west-1',
  EXPO_PUBLIC_USER_POOL_ID: 'eu-west-1_RPkdnO7Ju',
  EXPO_PUBLIC_USER_POOL_CLIENT_ID: '61nf41i2bff1c4oc4qo9g36m1k',
  EXPO_PUBLIC_GRAPHQL_ENDPOINT: 'https://nvokqs473bbfdizeq4n5oosjpy.appsync-api.eu-west-1.amazonaws.com/graphql',
  EXPO_PUBLIC_AUTH_TYPE: 'AMAZON_COGNITO_USER_POOLS',
};
