import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { logger } from '../services/logger';

type DashboardNavigationProp = StackNavigationProp<RootStackParamList, 'Dashboard'>;

const { width, height } = Dimensions.get('window');

export default function DashboardScreen() {
  const navigation = useNavigation<DashboardNavigationProp>();

  logger.userAction('Screen loaded: Dashboard', {
    timestamp: new Date().toISOString()
  });

  const handleCreateRoom = () => {
    logger.userAction('Dashboard button pressed: Create Room');
    navigation.navigate('CreateRoom');
  };

  const handleJoinRoom = () => {
    logger.userAction('Dashboard button pressed: Join Room');
    navigation.navigate('JoinRoom');
  };

  const handleMyMatches = () => {
    logger.userAction('Dashboard button pressed: My Matches');
    navigation.navigate('MyMatches');
  };

  const handleRecommendations = () => {
    logger.userAction('Dashboard button pressed: Recommendations');
    navigation.navigate('Recommendations');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>TRINITY</Text>
        <Text style={styles.subtitle}>Movie Voting</Text>
        <TouchableOpacity
          style={styles.profileButton}
          onPress={() => {
            logger.userAction('Dashboard button pressed: Profile');
            navigation.navigate('Profile');
          }}
        >
          <Text style={styles.profileButtonText}>👤</Text>
        </TouchableOpacity>
      </View>

      {/* 4-Button Grid */}
      <View style={styles.buttonGrid}>
        {/* Create Room Button */}
        <TouchableOpacity 
          style={[styles.button, styles.createButton]} 
          onPress={handleCreateRoom}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonIcon}>🏠</Text>
          <Text style={styles.buttonTitle}>CREAR SALA</Text>
          <Text style={styles.buttonSubtitle}>Create Room</Text>
        </TouchableOpacity>

        {/* Join Room Button */}
        <TouchableOpacity 
          style={[styles.button, styles.joinButton]} 
          onPress={handleJoinRoom}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonIcon}>🚪</Text>
          <Text style={styles.buttonTitle}>UNIRSE A SALA</Text>
          <Text style={styles.buttonSubtitle}>Join Room</Text>
        </TouchableOpacity>

        {/* My Matches Button */}
        <TouchableOpacity 
          style={[styles.button, styles.matchesButton]} 
          onPress={handleMyMatches}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonIcon}>❤️</Text>
          <Text style={styles.buttonTitle}>MIS MATCHES</Text>
          <Text style={styles.buttonSubtitle}>My Matches</Text>
        </TouchableOpacity>

        {/* Recommendations Button */}
        <TouchableOpacity 
          style={[styles.button, styles.recommendationsButton]} 
          onPress={handleRecommendations}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonIcon}>⭐</Text>
          <Text style={styles.buttonTitle}>RECOMENDACIONES</Text>
          <Text style={styles.buttonSubtitle}>Recommendations</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Swipe • Vote • Match</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    alignItems: 'center',
    paddingVertical: 30,
    paddingTop: 20,
    position: 'relative',
  },
  profileButton: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileButtonText: {
    fontSize: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 3,
  },
  subtitle: {
    fontSize: 16,
    color: '#888888',
    marginTop: 5,
    letterSpacing: 1,
  },
  buttonGrid: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 15,
  },
  button: {
    flex: 1,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: (height - 300) / 4 - 15, // Distribute remaining space equally
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  createButton: {
    backgroundColor: '#4CAF50',
  },
  joinButton: {
    backgroundColor: '#2196F3',
  },
  matchesButton: {
    backgroundColor: '#E91E63',
  },
  recommendationsButton: {
    backgroundColor: '#FF9800',
  },
  buttonIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  buttonTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 5,
    letterSpacing: 1,
  },
  buttonSubtitle: {
    fontSize: 14,
    color: '#ffffff',
    opacity: 0.8,
    textAlign: 'center',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingBottom: 30,
  },
  footerText: {
    fontSize: 14,
    color: '#666666',
    letterSpacing: 2,
  },
});