#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TrinityStack } from '../lib/trinity-stack';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = new cdk.App();

new TrinityStack(app, 'TrinityStack', {
  env: {
    account: process.env.AWS_ACCOUNT_ID || '847850007406',
    region: process.env.AWS_REGION || 'eu-west-1',
  },
  description: 'Trinity Movie Voting Application - Serverless Backend Infrastructure',
});