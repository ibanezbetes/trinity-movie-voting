#!/usr/bin/env node

const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const fs = require('fs');
const path = require('path');

const STACK_NAME = 'TrinityStack';
const MOBILE_CONFIG_PATH = path.join(__dirname, '../../mobile/src/config/aws-config.ts');

async function generateMobileConfig() {
  try {
    console.log('Generating mobile configuration from deployed stack...');

    // Initialize CloudFormation client
    const cfClient = new CloudFormationClient({ region: process.env.AWS_REGION || 'eu-west-1' });

    // Get stack outputs
    const command = new DescribeStacksCommand({ StackName: STACK_NAME });
    const response = await cfClient.send(command);

    if (!response.Stacks || response.Stacks.length === 0) {
      throw new Error(`Stack ${STACK_NAME} not found. Please deploy the infrastructure first.`);
    }

    const stack = response.Stacks[0];
    const outputs = stack.Outputs || [];

    // Extract required outputs
    const getOutput = (key) => {
      const output = outputs.find(o => o.OutputKey === key);
      if (!output || !output.OutputValue) {
        throw new Error(`Output ${key} not found in stack`);
      }
      return output.OutputValue;
    };

    const config = {
      userPoolId: getOutput('UserPoolId'),
      userPoolClientId: getOutput('UserPoolClientId'),
      graphqlEndpoint: getOutput('GraphQLEndpoint'),
      region: getOutput('Region'),
    };

    // Generate TypeScript configuration file
    const configContent = `// Auto-generated AWS configuration
// Generated on: ${new Date().toISOString()}
// Stack: ${STACK_NAME}

export interface AWSConfig {
  region: string;
  userPoolId: string;
  userPoolWebClientId: string;
  graphqlEndpoint: string;
  authenticationType: string;
}

export const awsConfig: AWSConfig = {
  region: '${config.region}',
  userPoolId: '${config.userPoolId}',
  userPoolWebClientId: '${config.userPoolClientId}',
  graphqlEndpoint: '${config.graphqlEndpoint}',
  authenticationType: 'AMAZON_COGNITO_USER_POOLS',
};

// Environment variables for Expo
export const expoConfig = {
  EXPO_PUBLIC_AWS_REGION: '${config.region}',
  EXPO_PUBLIC_USER_POOL_ID: '${config.userPoolId}',
  EXPO_PUBLIC_USER_POOL_CLIENT_ID: '${config.userPoolClientId}',
  EXPO_PUBLIC_GRAPHQL_ENDPOINT: '${config.graphqlEndpoint}',
  EXPO_PUBLIC_AUTH_TYPE: 'AMAZON_COGNITO_USER_POOLS',
};
`;

    // Ensure mobile config directory exists
    const configDir = path.dirname(MOBILE_CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
      console.log(`Created directory: ${configDir}`);
    }

    // Write configuration file
    fs.writeFileSync(MOBILE_CONFIG_PATH, configContent);

    console.log('✅ Mobile configuration generated successfully!');
    console.log(`📁 Config file: ${MOBILE_CONFIG_PATH}`);
    console.log('\n📋 Configuration:');
    console.log(`   Region: ${config.region}`);
    console.log(`   User Pool ID: ${config.userPoolId}`);
    console.log(`   User Pool Client ID: ${config.userPoolClientId}`);
    console.log(`   GraphQL Endpoint: ${config.graphqlEndpoint}`);

  } catch (error) {
    console.error('❌ Error generating mobile configuration:', error.message);
    process.exit(1);
  }
}

// Run the script
generateMobileConfig();