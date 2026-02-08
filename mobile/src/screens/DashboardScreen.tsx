import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { getCurrentUser } from 'aws-amplify/auth';
import { RootStackParamList } from '../types';
import { logger } from '../services/logger';
import { useProactiveMatchCheck, ACTION_NAMES } from '../hooks/useProactiveMatchCheck';
import { Avatar, AppTabBar, Card, Typography, Button, Icon } from '../components';

type DashboardNavigationProp = StackNavigationProp<RootStackParamList, 'Dashboard'>;

export default function DashboardScreen() {
  const navigation = useNavigation<DashboardNavigationProp>();
  const { navigateWithMatchCheck } = useProactiveMatchCheck();
  const [userName, setUserName] = useState('');
  const [roomsCount, setRoomsCount] = useState(0);
  const [matchesCount, setMatchesCount] = useState(0);

  useEffect(() => {
    logger.userAction('Screen loaded: Dashboard', {
      timestamp: new Date().toISOString()
    });
    loadUserName();
    loadCounts();
  }, []);

  // Reload counts when screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadCounts();
    });

    return unsubscribe;
  }, [navigation]);

  const loadUserName = async () => {
    try {
      const user = await getCurrentUser();
      // Try to get preferred_username from user attributes
      // If not available, fall back to username
      const { fetchUserAttributes } = await import('aws-amplify/auth');
      const attributes = await fetchUserAttributes();
      const displayName = attributes.preferred_username || user.username || 'Usuario';
      setUserName(displayName);
    } catch (error) {
      logger.error('Failed to load user name', error);
      setUserName('Usuario');
    }
  };

  const loadCounts = async () => {
    try {
      // Importar las queries necesarias
      const { client } = await import('../services/amplify');
      const { GET_MY_ROOMS, GET_MATCHES } = await import('../services/graphql');

      // Obtener salas
      const roomsResponse = await client.graphql({
        query: GET_MY_ROOMS,
        authMode: 'userPool',
      });
      setRoomsCount(roomsResponse.data.getMyRooms?.length || 0);

      // Obtener matches
      const matchesResponse = await client.graphql({
        query: GET_MATCHES,
        authMode: 'userPool',
      });
      setMatchesCount(matchesResponse.data.getMyMatches?.length || 0);

      logger.info('Dashboard counts loaded', {
        rooms: roomsResponse.data.getMyRooms?.length || 0,
        matches: matchesResponse.data.getMyMatches?.length || 0,
      });
    } catch (error) {
      logger.error('Failed to load counts', error);
    }
  };

  const handleCreateRoom = async () => {
    logger.userAction('Dashboard button pressed: Create Room');
    await navigateWithMatchCheck(
      () => navigation.navigate('CreateRoom'),
      ACTION_NAMES.NAVIGATE_TO_CREATE_ROOM
    );
  };

  const handleJoinRoom = async () => {
    logger.userAction('Dashboard button pressed: Join Room');
    await navigateWithMatchCheck(
      () => navigation.navigate('JoinRoom'),
      ACTION_NAMES.NAVIGATE_TO_JOIN_ROOM
    );
  };

  const handleMyMatches = async () => {
    logger.userAction('Dashboard button pressed: My Matches');
    navigation.navigate('MyMatches');
  };

  const handleMyRooms = async () => {
    logger.userAction('Dashboard button pressed: My Rooms');
    navigation.navigate('MyRooms');
  };

  const handleRecommendations = async () => {
    logger.userAction('Dashboard button pressed: Recommendations');
    navigation.navigate('Recommendations');
  };

  const handleProfile = async () => {
    logger.userAction('Dashboard button pressed: Profile');
    navigation.navigate('Profile');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      
      {/* Header with Avatar */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View>
            <Typography variant="h1" style={styles.title}>
              ¡Hola {userName}!
            </Typography>
          </View>
          <Avatar onPress={handleProfile} size={44} />
        </View>
      </View>

      {/* Main Content */}
      <View style={styles.content}>
        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <Button
            title="Crear nueva sala"
            icon="add"
            variant="primary"
            size="large"
            onPress={handleCreateRoom}
            style={styles.primaryAction}
          />
          
          <Button
            title="Unirse a sala"
            icon="enter"
            variant="outline"
            size="large"
            onPress={handleJoinRoom}
          />
        </View>

        {/* Stats Cards - Solo 2 */}
        <View style={styles.statsGrid}>
          <Card style={styles.statCard} onPress={handleMyRooms}>
            <Icon name="film" size={32} color="#7c3aed" />
            <Typography variant="h3" align="center">{roomsCount}</Typography>
            <Typography variant="caption" align="center">Salas</Typography>
          </Card>
          
          <Card style={styles.statCard} onPress={handleMyMatches}>
            <Icon name="heart" size={32} color="#7c3aed" />
            <Typography variant="h3" align="center">{matchesCount}</Typography>
            <Typography variant="caption" align="center">Matches</Typography>
          </Card>
        </View>
      </View>

      {/* Floating Tab Bar - 5 tabs */}
      <AppTabBar activeTab="home" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    marginBottom: 4,
  },
  subtitle: {
    marginTop: 0,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 100, // Space for floating tab bar
  },
  actionButtons: {
    gap: 12,
    marginBottom: 24,
  },
  primaryAction: {
    backgroundColor: '#7c3aed',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
  },
});