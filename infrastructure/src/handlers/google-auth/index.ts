import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminInitiateAuthCommand, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const USER_POOL_ID = process.env.USER_POOL_ID!;
const USER_POOL_CLIENT_ID = process.env.USER_POOL_CLIENT_ID!;

interface GoogleTokenPayload {
  email: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  sub: string;
}

export const handler = async (event: any) => {
  console.log('Google Auth Handler - Event:', JSON.stringify(event, null, 2));

  const { googleIdToken } = event.arguments || {};

  if (!googleIdToken) {
    throw new Error('Google ID token is required');
  }

  try {
    // Decode the Google ID token (without verification for now - in production, verify it!)
    const tokenParts = googleIdToken.split('.');
    if (tokenParts.length !== 3) {
      throw new Error('Invalid Google ID token format');
    }

    const payload: GoogleTokenPayload = JSON.parse(
      Buffer.from(tokenParts[1], 'base64').toString('utf-8')
    );

    console.log('Decoded Google token:', { email: payload.email, sub: payload.sub });

    const email = payload.email;
    const googleSub = payload.sub;

    if (!email) {
      throw new Error('Email not found in Google token');
    }

    // Check if user exists in User Pool
    let userExists = false;
    try {
      await cognitoClient.send(new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
      }));
      userExists = true;
      console.log('User already exists:', email);
    } catch (error: any) {
      if (error.name !== 'UserNotFoundException') {
        throw error;
      }
      console.log('User does not exist, will create:', email);
    }

    // Create user if doesn't exist
    if (!userExists) {
      console.log('Creating new user in User Pool');
      
      await cognitoClient.send(new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'name', Value: payload.name || payload.given_name || email },
          { Name: 'preferred_username', Value: payload.given_name || email.split('@')[0] },
        ],
        MessageAction: 'SUPPRESS', // Don't send welcome email
      }));

      // Set a random password (user won't use it, they'll use Google)
      const randomPassword = `Temp${Math.random().toString(36).slice(-8)}!1A`;
      await cognitoClient.send(new AdminSetUserPasswordCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        Password: randomPassword,
        Permanent: true,
      }));

      console.log('User created successfully');
    }

    // Now initiate auth to get tokens
    // We'll use ADMIN_NO_SRP_AUTH flow
    const authResponse = await cognitoClient.send(new AdminInitiateAuthCommand({
      UserPoolId: USER_POOL_ID,
      ClientId: USER_POOL_CLIENT_ID,
      AuthFlow: 'CUSTOM_AUTH',
      AuthParameters: {
        USERNAME: email,
      },
    }));

    console.log('Auth response:', { 
      hasAccessToken: !!authResponse.AuthenticationResult?.AccessToken,
      hasIdToken: !!authResponse.AuthenticationResult?.IdToken,
      hasRefreshToken: !!authResponse.AuthenticationResult?.RefreshToken,
    });

    return {
      success: true,
      accessToken: authResponse.AuthenticationResult?.AccessToken,
      idToken: authResponse.AuthenticationResult?.IdToken,
      refreshToken: authResponse.AuthenticationResult?.RefreshToken,
      email: email,
    };

  } catch (error) {
    console.error('Error in Google auth handler:', error);
    throw error;
  }
};
