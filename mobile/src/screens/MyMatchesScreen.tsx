import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Image,
  Modal,
  Linking,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getClient, verifyAuthStatus, getAuthMode } from '../services/amplify';
import { GET_MATCHES } from '../services/graphql';
import { logger } from '../services/logger';
import { AppTabBar, Icon, ChinIcon, CustomAlert } from '../components';

interface Match {
  id: string;
  roomId: string;
  movieId: number;
  title: string;
  posterPath: string | null;
  timestamp: string;
}

interface MovieDetails {
  id: number;
  title: string;
  overview: string;
  posterPath: string | null;
  releaseDate: string;
  voteAverage: number;
}

export default function MyMatchesScreen() {
  const navigation = useNavigation();
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null);
  const [movieDetails, setMovieDetails] = useState<MovieDetails | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
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
    logger.userAction('Screen loaded: My Matches');
    loadMyMatches();
  }, []);

  const loadMyMatches = async () => {
    try {
      const authStatus = await verifyAuthStatus();
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for matches', null);
        setAlertConfig({
          visible: true,
          title: 'Error',
          message: 'Debes iniciar sesión para ver tus chines',
          buttons: [{ text: 'OK' }]
        });
        return;
      }

      logger.match('Loading user matches');

      const dynamicClient = await getClient();
      const response = await dynamicClient.graphql({
        query: GET_MATCHES,
      });

      const userMatches = response.data.getMyMatches || [];
      setMatches(userMatches);
      logger.match('User matches loaded', { matchCount: userMatches.length });

    } catch (error) {
      logger.matchError('Failed to load user matches', error);
      console.error('Error loading matches:', error);
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'No se pudieron cargar tus chines',
        buttons: [{ text: 'OK' }]
      });
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
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  };

  const getImageUrl = (posterPath: string | null) => {
    if (!posterPath) return null;
    return `https://image.tmdb.org/t/p/w500${posterPath}`;
  };

  const handleMatchPress = (item: Match) => {
    logger.userAction('Match card pressed', { movieId: item.movieId, title: item.title });
    setSelectedMatch(item);
    setShowModal(true);
    loadMovieDetails(item.movieId);
  };

  const loadMovieDetails = async (movieId: number) => {
    try {
      setLoadingDetails(true);
      const TMDB_READ_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJkYzRkYmNkMjQwNGMxY2E4NTJmOGViOTY0YWRkMjY3ZCIsIm5iZiI6MTc2NjAwMTAwMi40MDk5OTk4LCJzdWIiOiI2OTQzMDk2YTRjMGMxZmUzZDY3OWFjYmUiLCJzY29wZXMiOlsiYXBpX3JlYWQiXSwidmVyc2lvbiI6MX0.qK155c8oXB-_OUfYcNedwc7Fsbg8w7Y4d99oikb3SP8';
      
      const response = await fetch(
        `https://api.themoviedb.org/3/movie/${movieId}?language=es-ES`,
        {
          headers: {
            Authorization: `Bearer ${TMDB_READ_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch movie details');
      }

      const data = await response.json();
      
      setMovieDetails({
        id: data.id,
        title: data.title,
        overview: data.overview || 'Sin descripción disponible',
        posterPath: data.poster_path,
        releaseDate: data.release_date,
        voteAverage: data.vote_average,
      });

      logger.info('Movie details loaded', { movieId, title: data.title });
    } catch (error) {
      logger.error('Failed to load movie details', error);
      setMovieDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setTimeout(() => {
      setSelectedMatch(null);
      setMovieDetails(null);
    }, 300);
  };

  const handlePlayTrailer = () => {
    if (selectedMatch) {
      const searchQuery = `${selectedMatch.title} película trailer`;
      const encodedQuery = encodeURIComponent(searchQuery);
      const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodedQuery}`;
      
      Linking.openURL(youtubeSearchUrl).catch(err => {
        console.error('Failed to open YouTube:', err);
      });
      
      logger.userAction('Trailer search opened from match', { 
        movieId: selectedMatch.movieId,
        title: selectedMatch.title,
        searchQuery: searchQuery
      });
    }
  };

  const getYear = (dateString: string) => {
    if (!dateString) return '';
    return dateString.split('-')[0];
  };

  const renderMatchItem = ({ item }: { item: Match }) => (
    <TouchableOpacity 
      style={styles.matchCard}
      onPress={() => handleMatchPress(item)}
      activeOpacity={0.7}
    >
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
            {formatDate(item.timestamp)}
          </Text>
        </View>
      </View>
      
      <View style={styles.matchFooter}>
        <ChinIcon size={18} color="#9333EA" />
        <Text style={styles.matchSuccess}>¡Chin encontrado!</Text>
      </View>
    </TouchableOpacity>
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
      
      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        onDismiss={() => setAlertConfig({ ...alertConfig, visible: false })}
      />

      {/* Movie Detail Modal */}
      <Modal
        visible={showModal}
        animationType="fade"
        transparent={true}
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={styles.modalBackground}
            activeOpacity={1}
            onPress={handleCloseModal}
          >
            <ScrollView 
              style={styles.modalScrollView}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
                {selectedMatch && (
                  <>
                    {/* Movie Poster with Play Button */}
                    <View style={styles.posterContainerModal}>
                      {selectedMatch.posterPath ? (
                        <Image 
                          source={{ uri: getImageUrl(selectedMatch.posterPath) }} 
                          style={styles.modalPoster}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={[styles.modalPoster, styles.posterPlaceholderModal]}>
                          <Icon name="film" size={80} color="#888888" />
                        </View>
                      )}
                      <TouchableOpacity 
                        style={styles.playButton}
                        onPress={handlePlayTrailer}
                        activeOpacity={0.8}
                      >
                        <Icon name="play" size={32} color="#ffffff" />
                      </TouchableOpacity>
                    </View>

                    {/* Movie Info */}
                    <View style={styles.modalInfo}>
                      {loadingDetails ? (
                        <View style={styles.loadingDetailsContainer}>
                          <ActivityIndicator size="small" color="#9333EA" />
                          <Text style={styles.loadingDetailsText}>Cargando detalles...</Text>
                        </View>
                      ) : (
                        <>
                          <Text style={styles.modalTitle}>
                            {movieDetails?.title || selectedMatch.title}
                          </Text>
                          {movieDetails?.releaseDate && (
                            <Text style={styles.modalYear}>
                              {getYear(movieDetails.releaseDate)}
                            </Text>
                          )}
                          <Text style={styles.modalDescription}>
                            {movieDetails?.overview || 'Sin descripción disponible'}
                          </Text>
                        </>
                      )}
                    </View>

                    {/* Close Button */}
                    <TouchableOpacity 
                      style={styles.closeButton}
                      onPress={handleCloseModal}
                    >
                      <Icon name="close" size={28} color="#ffffff" />
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </ScrollView>
          </TouchableOpacity>
        </View>
      </Modal>

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
    color: '#9333EA',
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
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackground: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalScrollView: {
    flex: 1,
    width: '100%',
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    paddingVertical: 40,
  },
  modalContent: {
    backgroundColor: '#2a2a2a',
    borderRadius: 20,
    width: '100%',
    maxWidth: 400,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 10,
  },
  posterContainerModal: {
    position: 'relative',
    width: '100%',
    aspectRatio: 2/3,
    backgroundColor: '#1a1a1a',
  },
  modalPoster: {
    width: '100%',
    height: '100%',
  },
  posterPlaceholderModal: {
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    position: 'absolute',
    bottom: 15,
    right: 15,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(147, 51, 234, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalInfo: {
    padding: 20,
    minHeight: 150,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 5,
  },
  modalYear: {
    fontSize: 14,
    color: '#888888',
    marginBottom: 15,
  },
  modalDescription: {
    fontSize: 15,
    color: '#cccccc',
    lineHeight: 22,
  },
  closeButton: {
    position: 'absolute',
    top: 15,
    right: 15,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingDetailsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 20,
  },
  loadingDetailsText: {
    fontSize: 14,
    color: '#888888',
  },
});
