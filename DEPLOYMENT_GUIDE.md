# Trinity Deployment Guide

Complete step-by-step guide for deploying the Trinity Movie Voting application to AWS.

## 📋 Prerequisites

### Required Software
- **Node.js 18+** and npm
- **AWS CLI** configured with credentials
- **AWS CDK CLI**: `npm install -g aws-cdk`
- **Expo CLI**: `npm install -g @expo/cli`

### Required Accounts
- **AWS Account** with administrative permissions
- **TMDB Account** (free at https://www.themoviedb.org/settings/api)

## 🔧 Step 1: Environment Setup

### 1.1 Configure TMDB API
1. Create account at https://www.themoviedb.org/
2. Go to Settings → API
3. Request API key (free)
4. Copy both API Key and Read Access Token (Bearer Token)

### 1.2 Configure AWS Credentials

**Option A: AWS CLI (Recommended)**
```bash
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key  
# Enter region: eu-west-1
# Enter output format: json
```

**Option B: Environment Variables**
```bash
export AWS_ACCESS_KEY_ID=your_access_key
export AWS_SECRET_ACCESS_KEY=your_secret_key
export AWS_DEFAULT_REGION=eu-west-1
```

### 1.3 Verify AWS Access
```bash
aws sts get-caller-identity
```
Should return your account information without errors.

## 🏗️ Step 2: Infrastructure Deployment

### 2.1 Setup Infrastructure Environment
```bash
cd infrastructure
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your TMDB credentials
# AWS_REGION=eu-west-1
# TMDB_API_KEY=your_api_key_here
# TMDB_READ_TOKEN=your_bearer_token_here
# TMDB_BASE_URL=https://api.themoviedb.org/3
```

### 2.2 Bootstrap CDK (First Time Only)
```bash
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/eu-west-1
```

### 2.3 Deploy Infrastructure
```bash
npm run deploy
```

**Expected Output:**
```
✅  TrinityStack

Outputs:
TrinityStack.AWSRegion = eu-west-1
TrinityStack.GraphQLEndpoint = https://xxxxx.appsync-api.eu-west-1.amazonaws.com/graphql
TrinityStack.UserPoolId = eu-west-1_xxxxxxxxx
TrinityStack.UserPoolClientId = xxxxxxxxxxxxxxxxxx
```

### 2.4 Generate Mobile Configuration
```bash
npm run generate-config
```

This creates `mobile/src/config/aws-config.ts` with deployed resource details.

## 📱 Step 3: Mobile App Setup

### 3.1 Install Dependencies
```bash
cd mobile
npm install
```

### 3.2 Start Development Server
```bash
npm start
```

### 3.3 Test on Device
- Scan QR code with Expo Go app (iOS/Android)
- Or press 'a' for Android emulator
- Or press 'i' for iOS simulator

## ✅ Step 4: Verification

### 4.1 Test Authentication
1. Open mobile app
2. Register new user (auto-confirmation enabled)
3. Login with created credentials
4. Should reach dashboard with 4 buttons

### 4.2 Test Room Creation
1. Press "CREAR SALA"
2. Select Movie/TV and genres
3. Press "CREAR SALA"
4. Should navigate to voting screen with real TMDB movies

### 4.3 Verify AWS Resources

**DynamoDB Tables:**
```bash
aws dynamodb list-tables --region eu-west-1
```
Should show: TrinityRooms, TrinityVotes, TrinityMatches, TrinityUsers

**Lambda Functions:**
```bash
aws lambda list-functions --region eu-west-1 --query 'Functions[?starts_with(FunctionName, `trinity`)].FunctionName'
```
Should show: trinity-tmdb-handler, trinity-room-handler, trinity-vote-handler, trinity-match-handler

**AppSync API:**
```bash
aws appsync list-graphql-apis --region eu-west-1 --query 'graphqlApis[?name==`trinity-api`]'
```

## 🔧 Development Workflow

### Infrastructure Changes
```bash
cd infrastructure
npm run deploy          # Deploy changes
npm run diff           # Preview changes
npm run destroy        # Clean up resources
```

### Mobile Development
```bash
cd mobile
npm start              # Development server
npm run android        # Android emulator
npm run ios           # iOS simulator
```

## 🐛 Troubleshooting

### Common Issues

**1. CDK Bootstrap Error**
```bash
# Solution: Bootstrap with correct account ID
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/eu-west-1
```

**2. TMDB API Errors**
```bash
# Check your tokens are valid
curl -H "Authorization: Bearer YOUR_READ_TOKEN" "https://api.themoviedb.org/3/movie/popular"
```

**3. Mobile Config Missing**
```bash
# Regenerate config after infrastructure deployment
cd infrastructure
npm run generate-config
```

**4. Lambda UUID Errors**
```bash
# Recompile TypeScript handlers
cd infrastructure/src/handlers/room
npx tsc index.ts --target es2020 --module commonjs
```

**5. Authentication Issues**
- Verify Cognito User Pool is created
- Check auto-confirmation Lambda trigger is deployed
- Ensure mobile app uses correct auth configuration

### Debug Commands

**Check CloudFormation Stack:**
```bash
aws cloudformation describe-stacks --stack-name TrinityStack --region eu-west-1
```

**View Lambda Logs:**
```bash
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/trinity" --region eu-west-1
```

**Test GraphQL API:**
```bash
# Use AppSync console at:
# https://eu-west-1.console.aws.amazon.com/appsync/home?region=eu-west-1
```

## 🚀 Production Deployment

### Security Considerations
1. **Environment Variables**: Use AWS Systems Manager Parameter Store for production secrets
2. **IAM Roles**: Review and minimize Lambda permissions
3. **API Rate Limiting**: Configure AppSync throttling
4. **DynamoDB**: Enable point-in-time recovery for production

### Performance Optimization
1. **Lambda**: Increase memory for better performance
2. **DynamoDB**: Configure auto-scaling for production load
3. **AppSync**: Enable caching for frequently accessed data

### Monitoring
1. **CloudWatch**: Set up alarms for Lambda errors and DynamoDB throttling
2. **X-Ray**: Enable tracing for performance monitoring
3. **AppSync**: Monitor GraphQL query performance

## 📊 Resource Costs

**Estimated Monthly Costs (Light Usage):**
- DynamoDB: $1-5 (on-demand pricing)
- Lambda: $0-2 (1M requests free tier)
- AppSync: $0-5 (250K requests free tier)
- Cognito: $0 (50K MAU free tier)

**Total: ~$5-15/month for development/testing**

## 🔄 Cleanup

To remove all AWS resources:
```bash
cd infrastructure
npm run destroy
```

**Warning**: This will permanently delete all data in DynamoDB tables.

## 📞 Support

For deployment issues:
1. Check AWS CloudFormation events in console
2. Review Lambda function logs in CloudWatch
3. Verify all environment variables are correctly set
4. Ensure AWS account has necessary permissions for CDK deployment