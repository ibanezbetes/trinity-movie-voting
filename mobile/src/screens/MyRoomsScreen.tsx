import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { getClient, verifyAuthStatus, getAuthMode } from '../services/amplify';
import { GET_MY_ROOMS } from '../services/graphql';
import { logger } from '../services/logger';
import { AppTabBar, Icon, CustomAlert } from '../components';

type MyRoomsNavigationProp = StackNavigationProp<RootStackParamList, 'MyRooms'>;

interface Room {
  id: string;
  code: string;
  hostId: string;
  mediaType: string;
  genreIds: number[];
  createdAt: string;
  isHost: boolean;
  participantCount?: number;
}

// GraphQL query to get user's rooms - imported from graphql service

export default function MyRoomsScreen() {
  const navigation = useNavigation<MyRoomsNavigationProp>();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [alertConfig, setAlertConfig] = useState<{
    visible: boolean;
    title: string;
    message?: string;
    buttons?: Array<{ text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' }>;
  }>({
    visible: false,
    title: '',
    message: '',
    buttons: [{ text: 'OK' }]
  });

  useEffect(() => {
    logger.userAction('Screen loaded: My Rooms');
    loadMyRooms();
  }, []);

  const loadMyRooms = async () => {
    try {
      const authStatus = await verifyAuthStatus();
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for rooms', null);
        setAlertConfig({
          visible: true,
          title: 'Error',
          message: 'Debes iniciar sesión para ver tus salas',
          buttons: [{ text: 'OK' }]
        });
        return;
      }

      logger.room('Loading user rooms');

      const dynamicClient = await getClient();
      const response = await dynamicClient.graphql({
        query: GET_MY_ROOMS,
      });

      const userRooms = response.data.getMyRooms || [];
      const currentUserId = authStatus.user?.userId;

      // Mark which rooms the user is host of
      const roomsWithHostInfo = userRooms.map((room: any) => ({
        ...room,
        isHost: room.hostId === currentUserId,
      }));

      setRooms(roomsWithHostInfo);
      logger.room('User rooms loaded', { roomCount: roomsWithHostInfo.length });

    } catch (error) {
      logger.roomError('Failed to load user rooms', error);
      console.error('Error loading rooms:', error);
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'No se pudieron cargar tus salas',
        buttons: [{ text: 'OK' }]
      });
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadMyRooms();
  };

  const handleCopyCode = (code: string) => {
    Clipboard.setString(code);
    logger.userAction('Room code copied', { code });
  };

  const handleJoinRoom = (room: Room) => {
    logger.userAction('Join room from My Rooms', { roomId: room.id, roomCode: room.code });
    navigation.navigate('VotingRoom', { roomId: room.id, roomCode: room.code });
  };

  const getMediaTypeText = (mediaType: string) => {
    return mediaType === 'movie' ? 'Películas' : 'Series';
  };

  const getGenreText = (genreIds: number[]) => {
    // Simple genre mapping - in a real app you'd have a proper genre service
    const genreMap: { [key: number]: string } = {
      28: 'Acción',
      12: 'Aventura',
      16: 'Animación',
      35: 'Comedia',
      80: 'Crimen',
      99: 'Documental',
      18: 'Drama',
      10751: 'Familiar',
      14: 'Fantasía',
      36: 'Historia',
      27: 'Terror',
      10402: 'Música',
      9648: 'Misterio',
      10749: 'Romance',
      878: 'Ciencia Ficción',
      10770: 'TV Movie',
      53: 'Thriller',
      10752: 'Guerra',
      37: 'Western'
    };

    return genreIds.map(id => genreMap[id] || 'Desconocido').join(', ');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const renderRoomItem = ({ item }: { item: Room }) => (
    <TouchableOpacity
      style={styles.roomCard}
      onPress={() => handleJoinRoom(item)}
      activeOpacity={0.8}
    >
      <View style={styles.roomHeader}>
        <View style={styles.roomCodeContainer}>
          <Text style={styles.roomCode}>{item.code}</Text>
          <TouchableOpacity
            style={styles.copyButton}
            onPress={(e) => {
              e.stopPropagation();
              handleCopyCode(item.code);
            }}
            activeOpacity={0.7}
          >
            <Icon name="copy" size={20} color="#9333EA" />
          </TouchableOpacity>
        </View>
        <Text style={styles.roomDate}>{formatDate(item.createdAt)}</Text>
      </View>
      
      <View style={styles.roomDetails}>
        <Text style={styles.mediaType}>{getMediaTypeText(item.mediaType)}</Text>
        <Text style={styles.genres}>{getGenreText(item.genreIds)}</Text>
      </View>

      <View style={styles.roomFooter}>
        <Text style={styles.statusText}>
          {item.isHost ? 'Sala creada por ti' : 'Te uniste a esta sala'}
        </Text>
        <Icon name="arrow-forward" size={20} color="#9333EA" />
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Icon name="film" size={80} color="#888888" />
      <Text style={styles.emptyTitle}>No tienes salas activas</Text>
      <Text style={styles.emptySubtitle}>
        Las salas aparecen aquí cuando las creas o te unes a ellas. Una vez que se produce un chin, la sala se cierra
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Salas</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9333EA" />
          <Text style={styles.loadingText}>Cargando tus salas...</Text>
        </View>
      ) : (
        <FlatList
          data={rooms}
          renderItem={renderRoomItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={['#9333EA']}
              tintColor="#9333EA"
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
      
      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        onDismiss={() => setAlertConfig({ ...alertConfig, visible: false })}
      />

      {/* Floating Tab Bar */}
      <AppTabBar activeTab="home" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1,
  },
  placeholder: {
    width: 40,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#888888',
    marginTop: 15,
  },
  listContainer: {
    padding: 20,
    paddingBottom: 100, // Space for floating tab bar
    flexGrow: 1,
  },
  roomCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#333333',
  },
  roomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  roomCodeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  roomCode: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#9333EA',
    letterSpacing: 2,
  },
  copyButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomDate: {
    fontSize: 12,
    color: '#888888',
  },
  roomDetails: {
    marginBottom: 10,
  },
  mediaType: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '600',
    marginBottom: 4,
  },
  genres: {
    fontSize: 14,
    color: '#cccccc',
  },
  roomFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    color: '#888888',
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 20,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 10,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 24,
  },
});
