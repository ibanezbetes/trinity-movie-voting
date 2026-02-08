import 'react-native-get-random-values'; // Must be first import for AWS Amplify
import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Text, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { getCurrentUser } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import AppNavigator from './src/navigation/AppNavigator';
import AuthScreen from './src/screens/AuthScreen';
import './src/services/amplify'; // Initialize Amplify
import { logger } from './src/services/logger';
import { ThemeProvider } from './src/context/ThemeContext';
import { SoundProvider, useSound } from './src/context/SoundContext';

function AppContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { playSound } = useSound();

  logger.info('APP', 'Trinity app starting', {
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });

  useEffect(() => {
    checkAuthStatus();
    
    // Listen for OAuth callbacks
    const handleUrl = async (event: { url: string }) => {
      logger.auth('Deep link received', { url: event.url });
      
      if (event.url.includes('callback')) {
        logger.auth('OAuth callback detected, checking auth status');
        // Wait a bit for Amplify to process the OAuth callback
        setTimeout(() => {
          checkAuthStatus();
        }, 1000);
      }
    };

    // Add URL listener for deep links
    const subscription = Linking.addEventListener('url', handleUrl);

    // Check if app was opened with a URL
    Linking.getInitialURL().then((url) => {
      if (url) {
        logger.auth('App opened with URL', { url });
        handleUrl({ url });
      }
    });

    // Listen for Auth Hub events
    const hubListener = Hub.listen('auth', (data) => {
      const { payload } = data;
      logger.auth('Auth Hub event', { event: payload.event });
      
      switch (payload.event) {
        case 'signedIn':
          logger.auth('User signed in via OAuth');
          checkAuthStatus();
          break;
        case 'signInWithRedirect':
          logger.auth('OAuth redirect initiated');
          break;
        case 'signInWithRedirect_failure':
          logger.authError('OAuth redirect failed', payload.data);
          break;
        case 'customOAuthState':
          logger.auth('Custom OAuth state received', payload.data);
          break;
      }
    });

    return () => {
      subscription.remove();
      hubListener();
    };
  }, []);

  useEffect(() => {
    // Play inicio sound when app finishes loading
    if (!isLoading) {
      playSound('inicioApp');
    }
  }, [isLoading]);

  const checkAuthStatus = async () => {
    logger.auth('Checking authentication status');
    
    try {
      // First check if user logged in with Google
      const AsyncStorage = await import('@react-native-async-storage/async-storage');
      const authType = await AsyncStorage.default.getItem('@trinity_auth_type');
      
      if (authType === 'google') {
        logger.auth('Google login detected, reconfiguring Amplify');
        
        // Reconfigure Amplify for Google login
        const { configureAmplifyForGoogle, verifyAuthStatus } = await import('./src/services/amplify');
        await configureAmplifyForGoogle();
        
        // Verify Google credentials are still valid
        const authStatus = await verifyAuthStatus();
        
        if (authStatus.isAuthenticated) {
          logger.auth('Google user is authenticated with valid credentials');
          setIsAuthenticated(true);
        } else {
          logger.auth('Google credentials are invalid or expired');
          setIsAuthenticated(false);
        }
      } else {
        // Regular User Pool login
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={styles.loadingText}>Iniciando Trinity...</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" backgroundColor="#1a1a1a" />
      {isAuthenticated ? (
        <AppNavigator onSignOut={handleSignOut} />
      ) : (
        <AuthScreen onAuthSuccess={handleAuthSuccess} />
      )}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SoundProvider>
          <AppContent />
        </SoundProvider>
      </ThemeProvider>
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
