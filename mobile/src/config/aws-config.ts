// Auto-generated AWS configuration
// Generated on: 2026-02-03T08:30:30.421Z
// Stack: TrinityStack

export interface AWSConfig {
  region: string;
  userPoolId: string;
  userPoolWebClientId: string;
  identityPoolId: string;
  graphqlEndpoint: string;
  authenticationType: string;
  oauth?: {
    domain: string;
    scope: string[];
    redirectSignIn: string;
    redirectSignOut: string;
    responseType: string;
  };
}

export const awsConfig: AWSConfig = {
  region: 'eu-west-1',
  userPoolId: 'eu-west-1_RPkdnO7Ju',
  userPoolWebClientId: '61nf41i2bff1c4oc4qo9g36m1k',
  identityPoolId: 'eu-west-1:b4eec05c-2426-4e5e-80e9-5316a6acbcc2',
  graphqlEndpoint: 'https://ctpyevpldfe53jtmmabeld4hhm.appsync-api.eu-west-1.amazonaws.com/graphql',
  authenticationType: 'AMAZON_COGNITO_USER_POOLS',
  oauth: {
    domain: 'trinity-app.auth.eu-west-1.amazoncognito.com',
    scope: ['email', 'profile', 'openid'],
    redirectSignIn: 'myapp://callback',
    redirectSignOut: 'myapp://signout',
    responseType: 'code',
  },
};

// Environment variables for Expo
export const expoConfig = {
  EXPO_PUBLIC_AWS_REGION: 'eu-west-1',
  EXPO_PUBLIC_USER_POOL_ID: 'eu-west-1_RPkdnO7Ju',
  EXPO_PUBLIC_USER_POOL_CLIENT_ID: '61nf41i2bff1c4oc4qo9g36m1k',
  EXPO_PUBLIC_IDENTITY_POOL_ID: 'eu-west-1:b4eec05c-2426-4e5e-80e9-5316a6acbcc2',
  EXPO_PUBLIC_GRAPHQL_ENDPOINT: 'https://ctpyevpldfe53jtmmabeld4hhm.appsync-api.eu-west-1.amazonaws.com/graphql',
  EXPO_PUBLIC_AUTH_TYPE: 'AMAZON_COGNITO_USER_POOLS',
};
