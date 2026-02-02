#!/usr/bin/env node

/**
 * Trinity Deployment Script
 * 
 * This script automates the deployment process:
 * 1. Validates AWS credentials
 * 2. Builds the CDK stack
 * 3. Deploys to AWS
 * 4. Generates mobile configuration
 * 5. Runs basic verification
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class TrinityDeployer {
  constructor() {
    this.stackName = 'TrinityStack';
    this.region = 'eu-west-1';
    this.accountId = '847850007406';
  }

  async deploy() {
    console.log('🚀 Starting Trinity Infrastructure Deployment...\n');

    try {
      // Step 1: Validate prerequisites
      await this.validatePrerequisites();

      // Step 2: Build the project
      await this.buildProject();

      // Step 3: Bootstrap CDK (if needed)
      await this.bootstrapCDK();

      // Step 4: Deploy the stack
      await this.deployStack();

      // Step 5: Generate mobile configuration
      await this.generateMobileConfig();

      // Step 6: Verify deployment
      await this.verifyDeployment();

      console.log('\n✅ Deployment completed successfully!');
      console.log('\n📋 Next Steps:');
      console.log('   1. Run smoke test: node test-backend.js');
      console.log('   2. Check mobile config: mobile/src/config/aws-config.ts');
      console.log('   3. Proceed with mobile app development');

    } catch (error) {
      console.error('\n❌ Deployment failed:', error.message);
      console.error('\n🔍 Check the deployment guide: DEPLOYMENT_GUIDE.md');
      process.exit(1);
    }
  }

  async validatePrerequisites() {
    console.log('🔍 Validating prerequisites...');

    // Check AWS credentials
    try {
      const identity = execSync('aws sts get-caller-identity', { encoding: 'utf8' });
      const identityData = JSON.parse(identity);
      console.log(`   ✅ AWS credentials valid for account: ${identityData.Account}`);
      
      if (identityData.Account !== this.accountId) {
        throw new Error(`Account mismatch. Expected: ${this.accountId}, Got: ${identityData.Account}`);
      }
    } catch (error) {
      throw new Error(`AWS credentials validation failed: ${error.message}`);
    }

    // Check CDK CLI
    try {
      const cdkVersion = execSync('npx cdk --version', { encoding: 'utf8' });
      console.log(`   ✅ CDK CLI available: ${cdkVersion.trim()}`);
    } catch (error) {
      throw new Error('CDK CLI not available. Run: npm install -g aws-cdk');
    }

    // Check Node.js version
    const nodeVersion = process.version;
    console.log(`   ✅ Node.js version: ${nodeVersion}`);

    console.log('');
  }

  async buildProject() {
    console.log('🔨 Building project...');

    try {
      execSync('npm run build', { stdio: 'inherit' });
      console.log('   ✅ TypeScript compilation successful\n');
    } catch (error) {
      throw new Error('Build failed. Check TypeScript errors above.');
    }
  }

  async bootstrapCDK() {
    console.log('🏗️  Bootstrapping CDK...');

    try {
      // Check if already bootstrapped
      const stacks = execSync(`aws cloudformation list-stacks --region ${this.region} --query "StackSummaries[?StackName=='CDKToolkit' && StackStatus!='DELETE_COMPLETE'].StackName" --output text`, { encoding: 'utf8' });
      
      if (stacks.trim()) {
        console.log('   ✅ CDK already bootstrapped\n');
        return;
      }

      execSync(`npx cdk bootstrap aws://${this.accountId}/${this.region}`, { stdio: 'inherit' });
      console.log('   ✅ CDK bootstrap completed\n');
    } catch (error) {
      throw new Error(`CDK bootstrap failed: ${error.message}`);
    }
  }

  async deployStack() {
    console.log('🚀 Deploying Trinity stack...');

    try {
      execSync('npx cdk deploy --require-approval never', { stdio: 'inherit' });
      console.log('   ✅ Stack deployment completed\n');
    } catch (error) {
      throw new Error(`Stack deployment failed: ${error.message}`);
    }
  }

  async generateMobileConfig() {
    console.log('📱 Generating mobile configuration...');

    try {
      execSync('npm run generate-config', { stdio: 'inherit' });
      
      // Verify config file was created
      const configPath = path.join(__dirname, '../mobile/src/config/aws-config.ts');
      if (fs.existsSync(configPath)) {
        console.log('   ✅ Mobile configuration generated successfully\n');
      } else {
        throw new Error('Mobile configuration file not created');
      }
    } catch (error) {
      throw new Error(`Mobile config generation failed: ${error.message}`);
    }
  }

  async verifyDeployment() {
    console.log('✅ Verifying deployment...');

    try {
      // Check stack status
      const stackStatus = execSync(`aws cloudformation describe-stacks --stack-name ${this.stackName} --region ${this.region} --query "Stacks[0].StackStatus" --output text`, { encoding: 'utf8' });
      
      if (stackStatus.trim() !== 'CREATE_COMPLETE' && stackStatus.trim() !== 'UPDATE_COMPLETE') {
        throw new Error(`Stack in unexpected state: ${stackStatus.trim()}`);
      }

      // Check DynamoDB tables
      const tables = ['TrinityRooms', 'TrinityVotes', 'TrinityMatches', 'TrinityUsers'];
      for (const table of tables) {
        try {
          execSync(`aws dynamodb describe-table --table-name ${table} --region ${this.region}`, { stdio: 'pipe' });
          console.log(`   ✅ DynamoDB table ${table} exists`);
        } catch (error) {
          throw new Error(`DynamoDB table ${table} not found`);
        }
      }

      // Check Lambda functions
      const functions = ['trinity-tmdb-handler', 'trinity-room-handler', 'trinity-vote-handler', 'trinity-match-handler'];
      for (const func of functions) {
        try {
          execSync(`aws lambda get-function --function-name ${func} --region ${this.region}`, { stdio: 'pipe' });
          console.log(`   ✅ Lambda function ${func} exists`);
        } catch (error) {
          throw new Error(`Lambda function ${func} not found`);
        }
      }

      console.log('   ✅ All resources verified\n');
    } catch (error) {
      throw new Error(`Deployment verification failed: ${error.message}`);
    }
  }
}

// Run deployment if called directly
if (require.main === module) {
  const deployer = new TrinityDeployer();
  deployer.deploy();
}

module.exports = TrinityDeployer;