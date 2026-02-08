import { PostConfirmationTriggerHandler } from 'aws-lambda';
/**
 * Cognito Post Confirmation Trigger
 * Stores username -> email mapping in DynamoDB after successful user creation
 */
export declare const handler: PostConfirmationTriggerHandler;
