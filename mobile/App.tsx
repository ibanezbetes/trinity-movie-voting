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
      logger.auth('User is authenticated', {
        userId: user.userId,
        username: user.username
      });
      setIsAuthenticated(true);
    } catch (error) {
      logger.auth('User is not authenticated');
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
      logger.auth('Authentication check completed');
    }
  };

  const handleAuthSuccess = () => {
    logger.auth('Authentication successful, updating app state');
    setIsAuthenticated(true);
  };

  const handleSignOut = () => {
    logger.auth('User signed out, updating app state');
    setIsAuthenticated(false);
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
