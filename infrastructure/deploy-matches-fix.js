#!/usr/bin/env node

/**
 * Trinity App - Deploy Matches Fix
 * 
 * This script deploys the fixes for the "Mis Matches" functionality:
 * 1. Adds GSI to TrinityMatches table for user-based queries
 * 2. Updates Match Lambda with proper getUserMatches implementation
 * 3. Updates Vote Lambda to create individual user match records
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Trinity App - Deploying Matches Fix');
console.log('=====================================');

// Check if we're in the right directory
if (!fs.existsSync('cdk.json')) {
  console.error('❌ Error: Must run from infrastructure directory');
  console.error('   cd infrastructure && node deploy-matches-fix.js');
  process.exit(1);
}

// Check if AWS credentials are configured
try {
  execSync('aws sts get-caller-identity', { stdio: 'pipe' });
  console.log('✅ AWS credentials configured');
} catch (error) {
  console.error('❌ Error: AWS credentials not configured');
  console.error('   Run: aws configure');
  process.exit(1);
}

// Check if CDK is installed
try {
  execSync('cdk --version', { stdio: 'pipe' });
  console.log('✅ AWS CDK available');
} catch (error) {
  console.error('❌ Error: AWS CDK not installed');
  console.error('   Run: npm install -g aws-cdk');
  process.exit(1);
}

console.log('\n📋 Changes being deployed:');
console.log('  • Add userId-timestamp-index GSI to TrinityMatches table');
console.log('  • Update Match Lambda with proper getUserMatches implementation');
console.log('  • Update Vote Lambda to create individual user match records');
console.log('  • Enable efficient querying of matches by user ID');

console.log('\n⚠️  WARNING: This will modify the DynamoDB table structure');
console.log('   Existing matches may need to be migrated to work with new GSI');

// Ask for confirmation
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('\nDo you want to continue? (y/N): ', (answer) => {
  rl.close();
  
  if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
    console.log('❌ Deployment cancelled');
    process.exit(0);
  }

  console.log('\n🔨 Building Lambda functions...');
  
  try {
    // Build TypeScript Lambda functions
    console.log('  • Building Match Lambda...');
    execSync('cd src/handlers/match && npm run build', { stdio: 'inherit' });
    
    console.log('  • Building Vote Lambda...');
    execSync('cd src/handlers/vote && npm run build', { stdio: 'inherit' });
    
    console.log('✅ Lambda functions built successfully');
  } catch (error) {
    console.error('❌ Error building Lambda functions:', error.message);
    process.exit(1);
  }

  console.log('\n🚀 Deploying infrastructure changes...');
  
  try {
    // Deploy CDK stack
    execSync('cdk deploy --require-approval never', { stdio: 'inherit' });
    console.log('✅ Infrastructure deployed successfully');
  } catch (error) {
    console.error('❌ Error deploying infrastructure:', error.message);
    process.exit(1);
  }

  console.log('\n📱 Testing the fix...');
  
  try {
    // Test the GraphQL endpoint
    console.log('  • Testing GraphQL endpoint...');
    // This would require actual testing logic
    console.log('  • Manual testing required in mobile app');
  } catch (error) {
    console.warn('⚠️  Warning: Could not automatically test the fix');
    console.warn('   Please test manually in the mobile app');
  }

  console.log('\n✅ DEPLOYMENT COMPLETE!');
  console.log('======================');
  console.log('');
  console.log('🎉 The "Mis Matches" functionality should now work correctly!');
  console.log('');
  console.log('📋 What was fixed:');
  console.log('  • Added GSI to enable efficient user match queries');
  console.log('  • Fixed getUserMatches() to return actual user matches');
  console.log('  • Updated match creation to store individual user records');
  console.log('  • Enabled proper filtering and sorting of matches');
  console.log('');
  console.log('🧪 Next steps:');
  console.log('  1. Test the mobile app "Mis Matches" screen');
  console.log('  2. Create some test matches by voting in rooms');
  console.log('  3. Verify matches appear in the "Mis Matches" list');
  console.log('  4. Check that matches are sorted by newest first');
  console.log('');
  console.log('📊 Performance notes:');
  console.log('  • New GSI enables efficient user match queries');
  console.log('  • Fallback scan method available for backward compatibility');
  console.log('  • Limited to 50 matches per user for optimal performance');
  console.log('');
  console.log('🔧 If issues persist:');
  console.log('  1. Check CloudWatch logs for Lambda errors');
  console.log('  2. Verify GSI is active in DynamoDB console');
  console.log('  3. Test GraphQL queries directly in AppSync console');
  console.log('  4. Check mobile app authentication and network connectivity');
});