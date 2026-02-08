import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { client, verifyAuthStatus } from '../services/amplify';
import { GET_MATCHES } from '../services/graphql';
import { logger } from '../services/logger';
import { AppTabBar, Icon, ChinIcon } from '../components';

interface Match {
  id: string;
  roomId: string;
  movieId: number;
  title: string;
  posterPath: string | null;
  timestamp: string;
}

export default function MyMatchesScreen() {
  const navigation = useNavigation();
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    logger.userAction('Screen loaded: My Matches');
    loadMyMatches();
  }, []);

  const loadMyMatches = async () => {
    try {
      const authStatus = await verifyAuthStatus();
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for matches', null);
        Alert.alert('Error', 'Debes iniciar sesión para ver tus chines');
        return;
      }

      logger.match('Loading user matches');

      const response = await client.graphql({
        query: GET_MATCHES,
        authMode: 'userPool',
      });

      const userMatches = response.data.getMyMatches || [];
      setMatches(userMatches);
      logger.match('User matches loaded', { matchCount: userMatches.length });

    } catch (error) {
      logger.matchError('Failed to load user matches', error);
      console.error('Error loading matches:', error);
      Alert.alert('Error', 'No se pudieron cargar tus chines');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadMyMatches();
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

  const getImageUrl = (posterPath: string | null) => {
    if (!posterPath) return null;
    return `https://image.tmdb.org/t/p/w500${posterPath}`;
  };

  const renderMatchItem = ({ item }: { item: Match }) => (
    <View style={styles.matchCard}>
      <View style={styles.matchContent}>
        {item.posterPath ? (
          <Image
            source={{ uri: getImageUrl(item.posterPath) }}
            style={styles.poster}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.posterPlaceholder}>
            <Icon name="film" size={40} color="#888888" />
          </View>
        )}
        
        <View style={styles.matchInfo}>
          <Text style={styles.matchTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.matchDate}>
            Chin: {formatDate(item.timestamp)}
          </Text>
          <Text style={styles.matchId}>
            ID: {item.movieId}
          </Text>
        </View>
      </View>
      
      <View style={styles.matchFooter}>
        <Icon name="sparkles" size={18} color="#E91E63" />
        <Text style={styles.matchSuccess}>¡Chin encontrado!</Text>
      </View>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <ChinIcon size={80} color="#888888" />
      <Text style={styles.emptyTitle}>No tienes chines aún</Text>
      <Text style={styles.emptyDescription}>
        Únete o crea una sala y comienza a votar para intentar hacer chin con otros usuarios
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Chines</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#E91E63" />
          <Text style={styles.loadingText}>Cargando tus chines...</Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.id}
          renderItem={renderMatchItem}
          ListEmptyComponent={renderEmptyState}
          contentContainerStyle={matches.length === 0 ? styles.emptyList : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={['#E91E63']}
              tintColor="#E91E63"
            />
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Floating Tab Bar */}
      <AppTabBar activeTab="matches" />
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
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#333333',
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
  list: {
    padding: 20,
    paddingBottom: 100, // Space for floating tab bar
  },
  emptyList: {
    flex: 1,
  },
  matchCard: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#333333',
  },
  matchContent: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  poster: {
    width: 80,
    height: 120,
    borderRadius: 8,
    backgroundColor: '#333333',
  },
  posterPlaceholder: {
    width: 80,
    height: 120,
    borderRadius: 8,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchInfo: {
    flex: 1,
    marginLeft: 16,
    justifyContent: 'space-between',
  },
  matchTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
    lineHeight: 24,
  },
  matchDate: {
    fontSize: 14,
    color: '#888888',
    marginBottom: 4,
  },
  matchId: {
    fontSize: 12,
    color: '#666666',
  },
  matchFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#333333',
    gap: 8,
  },
  matchSuccess: {
    fontSize: 14,
    color: '#E91E63',
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 20,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 15,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: 16,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  emptyButton: {
    backgroundColor: '#E91E63',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
  },
  emptyButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
  },
});