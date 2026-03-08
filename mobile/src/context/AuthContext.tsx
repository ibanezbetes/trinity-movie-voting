import React, { createContext, useContext, ReactNode, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { refreshAuthSession, verifyAuthStatus } from '../services/amplify';
import { logger } from '../services/logger';

interface AuthContextType {
  onSignOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
  onSignOut: () => void;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children, onSignOut }) => {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Subscribe to app state changes
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, []);

  const handleAppStateChange = async (nextAppState: AppStateStatus) => {
    // When app comes to foreground from background
    if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
      logger.info('AUTH', 'App came to foreground, checking auth status');
      
      try {
        // Verify current auth status
        const authStatus = await verifyAuthStatus();
        
        if (authStatus.isAuthenticated) {
          logger.info('AUTH', 'User is authenticated, refreshing session');
          
          try {
            // Try to refresh the session
            await refreshAuthSession();
            logger.info('AUTH', 'Session refreshed successfully');
          } catch (refreshError) {
            logger.error('AUTH', 'Failed to refresh session', refreshError);
            
            // If refresh fails, user needs to log in again
            logger.info('AUTH', 'Session expired, signing out user');
            onSignOut();
          }
        } else {
          logger.info('AUTH', 'User is not authenticated');
        }
      } catch (error) {
        logger.error('AUTH', 'Error checking auth status', error);
      }
    }

    appState.current = nextAppState;
  };

  return (
    <AuthContext.Provider value={{ onSignOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};