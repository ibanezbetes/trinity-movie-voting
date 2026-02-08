import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  StatusBar,
  Modal,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { FlatList, ScrollView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getRecommendations, RecommendationCategory, RecommendationMovie } from '../services/recommendations';
import { AppTabBar, Icon } from '../components';
import { logger } from '../services/logger';

export default function RecommendationsScreen() {
  const navigation = useNavigation();
  const [categories, setCategories] = useState<RecommendationCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMovie, setSelectedMovie] = useState<RecommendationMovie | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadRecommendations();
  }, []);

  const loadRecommendations = async () => {
    try {
      setLoading(true);
      logger.info('Loading recommendations from DynamoDB');
      const data = await getRecommendations();
      setCategories(data);
      logger.info('Recommendations loaded', { count: data.length });
    } catch (error) {
      logger.error('Failed to load recommendations', error);
    } finally {
      setLoading(false);
    }
  };

  const getPosterUrl = (movie: RecommendationMovie): string => {
    const key = `${movie.movieId}`;
    
    // Si ya falló TMDB y hay URL alternativa, usar alternativa
    if (imageErrors.has(key) && movie.alternativePosterUrl) {
      return movie.alternativePosterUrl;
    }
    
    // Intentar TMDB primero
    return `https://image.tmdb.org/t/p/w500${movie.posterPath}`;
  };

  const handleImageError = (movie: RecommendationMovie) => {
    const key = `${movie.movieId}`;
    logger.warn('Image failed to load, trying alternative', {
      movieId: movie.movieId,
      title: movie.title,
      hasAlternative: !!movie.alternativePosterUrl,
    });
    setImageErrors(prev => new Set(prev).add(key));
  };

  const handleMoviePress = (movie: RecommendationMovie) => {
    setSelectedMovie(movie);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setTimeout(() => setSelectedMovie(null), 300);
  };

  const handlePlayTrailer = () => {
    if (selectedMovie) {
      // Construir query de búsqueda: "Título película trailer"
      // Las recomendaciones son siempre películas
      const searchQuery = `${selectedMovie.title} película trailer`;
      
      // URL encode para YouTube search
      const encodedQuery = encodeURIComponent(searchQuery);
      const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodedQuery}`;
      
      Linking.openURL(youtubeSearchUrl).catch(err => {
        console.error('Failed to open YouTube:', err);
      });
      
      logger.userAction('Trailer search opened from recommendations', { 
        movieId: selectedMovie.movieId,
        title: selectedMovie.title,
        searchQuery: searchQuery
      });
    }
  };

  const renderMovieCard = ({ item }: { item: RecommendationMovie }) => (
    <TouchableOpacity 
      style={styles.movieCard} 
      activeOpacity={0.8}
      onPress={() => handleMoviePress(item)}
    >
      <Image 
        source={{ uri: getPosterUrl(item) }} 
        style={styles.moviePoster}
        resizeMode="cover"
        defaultSource={require('../../assets/icon.png')}
        onError={() => handleImageError(item)}
      />
      <View style={styles.movieInfo}>
        <Text style={styles.movieTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.movieYear}>{item.year}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderCategory = ({ item }: { item: RecommendationCategory }) => (
    <View style={styles.categoryContainer}>
      <View style={styles.categoryHeader}>
        <Text style={styles.categoryTitle}>{item.title}</Text>
        <Text style={styles.categoryDescription}>{item.description}</Text>
      </View>
      
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.moviesContainer}
        style={styles.moviesList}
        decelerationRate="fast"
        snapToInterval={152}
        snapToAlignment="start"
        scrollEventThrottle={16}
        nestedScrollEnabled={true}
        directionalLockEnabled={true}
      >
        {item.movies.map((movie, index) => (
          <React.Fragment key={`${item.categoryId}-${movie.movieId}`}>
            {renderMovieCard({ item: movie })}
            {index < item.movies.length - 1 && <View style={{ width: 12 }} />}
          </React.Fragment>
        ))}
      </ScrollView>
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
        <Text style={styles.title}>Descubre</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Categories List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9333ea" />
          <Text style={styles.loadingText}>Cargando recomendaciones...</Text>
        </View>
      ) : categories.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No hay recomendaciones disponibles</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadRecommendations}>
            <Text style={styles.retryButtonText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.categoriesContainer}
          scrollEventThrottle={16}
        >
          {categories.map((category) => renderCategory({ item: category }))}
        </ScrollView>
      )}

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
                {selectedMovie && (
                  <>
                    {/* Movie Poster with Play Button */}
                    <View style={styles.posterContainer}>
                      <Image 
                        source={{ uri: getPosterUrl(selectedMovie) }} 
                        style={styles.modalPoster}
                        resizeMode="cover"
                        defaultSource={require('../../assets/icon.png')}
                        onError={() => handleImageError(selectedMovie)}
                      />
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
                      <Text style={styles.modalTitle}>{selectedMovie.title}</Text>
                      <Text style={styles.modalYear}>{selectedMovie.year}</Text>
                      <Text style={styles.modalDescription}>
                        {selectedMovie.description}
                      </Text>
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
      <AppTabBar activeTab="recommendations" />
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
  categoriesContainer: {
    paddingVertical: 20,
    paddingBottom: 100, // Space for floating tab bar
  },
  categoryContainer: {
    marginBottom: 30,
  },
  categoryHeader: {
    marginBottom: 15,
    paddingHorizontal: 20,
  },
  categoryTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 5,
  },
  categoryDescription: {
    fontSize: 14,
    color: '#888888',
    lineHeight: 20,
  },
  moviesContainer: {
    paddingLeft: 20,
    paddingRight: 20,
    flexDirection: 'row',
  },
  moviesList: {
    flexGrow: 0,
    overflow: 'visible',
  },
  movieCard: {
    width: 140,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  moviePoster: {
    width: '100%',
    height: 200,
    backgroundColor: '#333333',
  },
  movieInfo: {
    padding: 12,
  },
  movieTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
    lineHeight: 18,
  },
  movieYear: {
    fontSize: 12,
    color: '#888888',
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
  posterContainer: {
    position: 'relative',
    width: '100%',
    aspectRatio: 2/3,
    backgroundColor: '#1a1a1a',
  },
  modalPoster: {
    width: '100%',
    height: '100%',
  },
  playButton: {
    position: 'absolute',
    bottom: 15,
    right: 15,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(33, 150, 243, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  modalInfo: {
    padding: 20,
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 100,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#888888',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 100,
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#888888',
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#9333ea',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});