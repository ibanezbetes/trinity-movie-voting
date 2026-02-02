import { signUp, signIn, getCurrentUser, signOut } from 'aws-amplify/auth';

export interface AuthUser {
  userId: string;
  username: string;
}

// Simple guest authentication for testing
// In a real app, you'd implement proper sign up/sign in flows
export const authenticateAsGuest = async (): Promise<AuthUser> => {
  try {
    // Try to get current user first
    const currentUser = await getCurrentUser();
    return {
      userId: currentUser.userId,
      username: currentUser.username,
    };
  } catch (error) {
    // If no current user, create a guest user
    const guestUsername = `guest_${Date.now()}`;
    const guestPassword = 'TempPass123!';
    
    try {
      // Try to sign up as guest
      await signUp({
        username: guestUsername,
        password: guestPassword,
        options: {
          autoSignIn: true,
        },
      });
      
      // Sign in the guest user
      const signInResult = await signIn({
        username: guestUsername,
        password: guestPassword,
      });
      
      return {
        userId: signInResult.userId || guestUsername,
        username: guestUsername,
      };
    } catch (authError) {
      console.error('Guest authentication failed:', authError);
      throw new Error('Authentication failed');
    }
  }
};

export const signOutUser = async (): Promise<void> => {
  try {
    await signOut();
  } catch (error) {
    console.error('Sign out failed:', error);
  }
};