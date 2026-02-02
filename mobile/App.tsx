import 'react-native-get-random-values'; // Must be first import for AWS Amplify
import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { getCurrentUser } from 'aws-amplify/auth';
import AppNavigator from './src/navigation/AppNavigator';
import AuthScreen from './src/screens/AuthScreen';
import './src/services/amplify'; // Initialize Amplify
import { logger } from './src/services/logger';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  logger.info('APP', 'Trinity app starting', {
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    logger.auth('Checking authentication status');
    
    try {
      const user = await getCurrentUser();
      
      // Also verify we have valid tokens
      const { verifyAuthStatus } = await import('./src/services/amplify');
      const authStatus = await verifyAuthStatus();
      
      if (authStatus.isAuthenticated) {
        logger.auth('User is authenticated with valid tokens', {
          userId: user.userId,
          username: user.username
        });
        setIsAuthenticated(true);
      } else {
        logger.auth('User found but tokens are invalid, signing out');
        setIsAuthenticated(false);
      }
    } catch (error) {
      logger.auth('User is not authenticated', { error: error.message });
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
      logger.auth('Authentication check completed');
    }
  };

  const handleAuthSuccess = async () => {
    logger.auth('Authentication successful, verifying tokens');
    
    // Double-check that we have valid tokens before proceeding
    try {
      const { verifyAuthStatus } = await import('./src/services/amplify');
      const authStatus = await verifyAuthStatus();
      
      if (authStatus.isAuthenticated) {
        logger.auth('Tokens verified, updating app state');
        setIsAuthenticated(true);
      } else {
        logger.authError('Token verification failed after auth success');
        setIsAuthenticated(false);
      }
    } catch (error) {
      logger.authError('Failed to verify tokens after auth success', error);
      setIsAuthenticated(false);
    }
  };

  const handleSignOut = async () => {
    logger.auth('User signing out');
    
    try {
      const { signOut } = await import('aws-amplify/auth');
      await signOut();
      logger.auth('User signed out successfully');
    } catch (error) {
      logger.authError('Error during sign out', error);
    } finally {
      setIsAuthenticated(false);
      logger.auth('App state updated to unauthenticated');
    }
  };

  if (isLoading) {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.loadingText}>Iniciando Trinity...</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#1a1a1a" />
      {isAuthenticated ? (
        <AppNavigator onSignOut={handleSignOut} />
      ) : (
        <AuthScreen onAuthSuccess={handleAuthSuccess} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#ffffff',
    marginTop: 20,
  },
});
