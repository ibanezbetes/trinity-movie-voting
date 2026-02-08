import { PreSignUpTriggerHandler } from 'aws-lambda';
/**
 * Cognito Pre Sign-up Trigger
 * Auto-confirms users and their email addresses
 * Validates username availability (does NOT store it yet)
 */
export declare const handler: PreSignUpTriggerHandler;
