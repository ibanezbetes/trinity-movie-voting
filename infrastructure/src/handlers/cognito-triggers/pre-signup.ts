import { PreSignUpTriggerEvent, PreSignUpTriggerHandler } from 'aws-lambda';

/**
 * Cognito Pre Sign-up Trigger
 * Auto-confirms users and their email addresses
 */
export const handler: PreSignUpTriggerHandler = async (
  event: PreSignUpTriggerEvent
): Promise<PreSignUpTriggerEvent> => {
  console.log('Pre Sign-up Trigger invoked', {
    userPoolId: event.userPoolId,
    userName: event.userName,
    email: event.request.userAttributes.email,
  });

  // Auto-confirm the user
  event.response.autoConfirmUser = true;

  // Auto-verify the email
  if (event.request.userAttributes.email) {
    event.response.autoVerifyEmail = true;
  }

  console.log('User auto-confirmed', {
    userName: event.userName,
    autoConfirmUser: event.response.autoConfirmUser,
    autoVerifyEmail: event.response.autoVerifyEmail,
  });

  return event;
};
