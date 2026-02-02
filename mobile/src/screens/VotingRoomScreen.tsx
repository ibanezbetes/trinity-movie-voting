import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Image,
  Dimensions,
  Alert,
  ActivityIndicator,
  PanResponder,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList, MovieCandidate } from '../types';
import { client, verifyAuthStatus } from '../services/amplify';
import { GET_ROOM, VOTE } from '../services/graphql';
import { logger } from '../services/logger';

type VotingRoomRouteProp = RouteProp<RootStackParamList, 'VotingRoom'>;

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const CARD_WIDTH = screenWidth - 40;
const CARD_HEIGHT = screenHeight * 0.7;

export default function VotingRoomScreen() {
  const navigation = useNavigation();
  const route = useRoute<VotingRoomRouteProp>();
  const { roomId, roomCode } = route.params;

  const [candidates, setCandidates] = useState<MovieCandidate[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isVoting, setIsVoting] = useState(false);

  // Animation values
  const pan = new Animated.ValueXY();
  const scale = new Animated.Value(1);

  useEffect(() => {
    logger.userAction('Screen loaded: VotingRoom', {
      roomId,
      roomCode,
      timestamp: new Date().toISOString()
    });
    loadRoomData();
  }, []);

  const loadRoomData = async () => {
    logger.room('Loading room data', { roomId, roomCode });
    
    try {
      // Verify authentication status first
      logger.auth('Verifying authentication before loading room data');
      const authStatus = await verifyAuthStatus();
      
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for loading room data', null);
        Alert.alert('Error de Autenticación', 'Por favor inicia sesión nuevamente');
        navigation.goBack();
        return;
      }

      logger.auth('Authentication verified for loading room data', {
        userId: authStatus.user?.userId,
        hasTokens: !!authStatus.session?.tokens
      });

      logger.apiRequest('getRoom query', { roomId });

      const response = await client.graphql({
        query: GET_ROOM,
        variables: { id: roomId },
        authMode: 'userPool', // Explicitly specify auth mode
      });

      logger.apiResponse('getRoom query success', {
        roomId: response.data.getRoom?.id,
        candidatesCount: response.data.getRoom?.candidates?.length || 0,
        mediaType: response.data.getRoom?.mediaType,
        genreIds: response.data.getRoom?.genreIds
      });

      const room = response.data.getRoom;
      if (room && room.candidates) {
        logger.room('Room candidates loaded', {
          roomId: room.id,
          candidatesCount: room.candidates.length,
          mediaType: room.mediaType,
          genreIds: room.genreIds,
          firstMovieTitle: room.candidates[0]?.title,
          candidateIds: room.candidates.map(c => c.id)
        });
        setCandidates(room.candidates);
      } else {
        logger.roomError('No candidates found in room', null, { roomId, room });
        Alert.alert('Error', 'No se encontraron películas en esta sala');
      }
    } catch (error) {
      logger.roomError('Failed to load room data', error, { roomId, roomCode });
      console.error('Error loading room data:', error);
      Alert.alert('Error', 'No se pudieron cargar las películas');
    } finally {
      setIsLoading(false);
      logger.room('Room data loading completed', { isLoading: false });
    }
  };

  const handleVote = async (vote: boolean) => {
    if (isVoting || currentIndex >= candidates.length) return;

    const currentMovie = candidates[currentIndex];
    
    logger.vote('Vote initiated', {
      movieId: currentMovie.id,
      movieTitle: currentMovie.title,
      vote,
      currentIndex,
      totalCandidates: candidates.length,
      roomId,
      roomCode
    });

    setIsVoting(true);

    try {
      // Verify authentication status first
      logger.auth('Verifying authentication before voting');
      const authStatus = await verifyAuthStatus();
      
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for voting', null);
        Alert.alert('Error de Autenticación', 'Por favor inicia sesión nuevamente');
        return;
      }

      logger.auth('Authentication verified for voting', {
        userId: authStatus.user?.userId,
        hasTokens: !!authStatus.session?.tokens
      });

      logger.apiRequest('vote mutation', {
        input: {
          roomId,
          movieId: currentMovie.id,
          vote,
        },
      });

      const response = await client.graphql({
        query: VOTE,
        variables: {
          input: {
            roomId,
            movieId: currentMovie.id,
            vote,
          },
        },
        authMode: 'userPool', // Explicitly specify auth mode
      });

      logger.apiResponse('vote mutation success', {
        success: response.data.vote?.success,
        hasMatch: !!response.data.vote?.match,
        matchTitle: response.data.vote?.match?.title
      });

      const result = response.data.vote;
      
      if (result.match) {
        logger.vote('MATCH DETECTED!', {
          matchId: result.match.id,
          movieTitle: result.match.title,
          movieId: result.match.movieId,
          roomId: result.match.roomId,
          timestamp: result.match.timestamp
        });

        // Show match notification
        Alert.alert(
          '🎉 ¡MATCH!',
          `¡Encontraste una película en común!\n\n${result.match.title}`,
          [{ text: 'Genial!', onPress: () => {} }]
        );
      } else {
        logger.vote('No match - continuing voting', {
          movieTitle: currentMovie.title,
          vote
        });
      }

      // Move to next card
      const nextIndex = currentIndex + 1;
      setCurrentIndex(nextIndex);
      
      logger.vote('Moving to next card', {
        previousIndex: currentIndex,
        nextIndex,
        remainingCards: candidates.length - nextIndex
      });
      
      // Reset animation
      pan.setValue({ x: 0, y: 0 });
      scale.setValue(1);

    } catch (error) {
      logger.voteError('Vote failed', error, {
        movieId: currentMovie.id,
        movieTitle: currentMovie.title,
        vote,
        roomId,
        roomCode
      });
      console.error('Error voting:', error);
      Alert.alert('Error', 'No se pudo registrar el voto');
    } finally {
      setIsVoting(false);
      logger.vote('Vote process completed', { isVoting: false });
    }
  };

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => {
      return Math.abs(gestureState.dx) > 20 || Math.abs(gestureState.dy) > 20;
    },
    onPanResponderGrant: () => {
      pan.setOffset({
        x: pan.x._value,
        y: pan.y._value,
      });
    },
    onPanResponderMove: (_, gestureState) => {
      pan.setValue({ x: gestureState.dx, y: gestureState.dy });
      
      // Scale effect based on distance
      const distance = Math.sqrt(gestureState.dx * gestureState.dx + gestureState.dy * gestureState.dy);
      const scaleValue = Math.max(0.95, 1 - distance / 1000);
      scale.setValue(scaleValue);
    },
    onPanResponderRelease: (_, gestureState) => {
      pan.flattenOffset();
      
      const swipeThreshold = 120;
      
      if (gestureState.dx > swipeThreshold) {
        // Swipe right - Like
        Animated.timing(pan, {
          toValue: { x: screenWidth, y: gestureState.dy },
          duration: 200,
          useNativeDriver: false,
        }).start(() => handleVote(true));
      } else if (gestureState.dx < -swipeThreshold) {
        // Swipe left - Dislike
        Animated.timing(pan, {
          toValue: { x: -screenWidth, y: gestureState.dy },
          duration: 200,
          useNativeDriver: false,
        }).start(() => handleVote(false));
      } else {
        // Snap back
        Animated.parallel([
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
          }),
          Animated.spring(scale, {
            toValue: 1,
            useNativeDriver: false,
          }),
        ]).start();
      }
    },
  });

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.loadingText}>Cargando películas...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (currentIndex >= candidates.length) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
        <View style={styles.completedContainer}>
          <Text style={styles.completedIcon}>🎬</Text>
          <Text style={styles.completedTitle}>¡Votación Completada!</Text>
          <Text style={styles.completedDescription}>
            Has votado todas las películas disponibles
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.navigate('Dashboard')}
          >
            <Text style={styles.backButtonText}>Volver al Dashboard</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const currentMovie = candidates[currentIndex];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.roomCode}>ROOM CODE: {roomCode}</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Progress Indicator */}
      <View style={styles.progressContainer}>
        <Text style={styles.progressText}>
          {currentIndex + 1} / {candidates.length}
        </Text>
      </View>

      {/* Movie Card */}
      <View style={styles.cardContainer}>
        <Animated.View
          style={[
            styles.card,
            {
              transform: [
                { translateX: pan.x },
                { translateY: pan.y },
                { scale: scale },
              ],
            },
          ]}
          {...panResponder.panHandlers}
        >
          <Image
            source={{ uri: `https://image.tmdb.org/t/p/w500${currentMovie.posterPath}` }}
            style={styles.poster}
            resizeMode="cover"
          />
          
          {/* Overlay with movie info */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.8)']}
            style={styles.overlay}
          >
            <View style={styles.movieInfo}>
              <Text style={styles.movieTitle}>{currentMovie.title}</Text>
              <Text style={styles.movieYear}>
                {new Date(currentMovie.releaseDate).getFullYear()}
              </Text>
              <Text style={styles.movieDescription} numberOfLines={3}>
                {currentMovie.overview}
              </Text>
            </View>
          </LinearGradient>
        </Animated.View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={[styles.actionButton, styles.dislikeButton]}
          onPress={() => handleVote(false)}
          disabled={isVoting}
        >
          <Text style={styles.actionButtonText}>👎</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.actionButton, styles.likeButton]}
          onPress={() => handleVote(true)}
          disabled={isVoting}
        >
          <Text style={styles.actionButtonText}>👍</Text>
        </TouchableOpacity>
      </View>

      {/* Instructions */}
      <Text style={styles.instructions}>
        Desliza ← para rechazar • Desliza → para aceptar
      </Text>
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
  },
  backIcon: {
    fontSize: 24,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  roomCode: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1,
  },
  placeholder: {
    width: 24,
  },
  progressContainer: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  progressText: {
    fontSize: 14,
    color: '#888888',
  },
  cardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#2a2a2a',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 16,
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
    justifyContent: 'flex-end',
  },
  movieInfo: {
    padding: 20,
  },
  movieTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 5,
  },
  movieYear: {
    fontSize: 16,
    color: '#cccccc',
    marginBottom: 10,
  },
  movieDescription: {
    fontSize: 14,
    color: '#cccccc',
    lineHeight: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 60,
    paddingVertical: 20,
    gap: 40,
  },
  actionButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  dislikeButton: {
    backgroundColor: '#ff4458',
  },
  likeButton: {
    backgroundColor: '#42c767',
  },
  actionButtonText: {
    fontSize: 24,
  },
  instructions: {
    textAlign: 'center',
    fontSize: 12,
    color: '#666666',
    paddingBottom: 20,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#ffffff',
    marginTop: 20,
  },
  completedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  completedIcon: {
    fontSize: 80,
    marginBottom: 20,
  },
  completedTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 15,
    textAlign: 'center',
  },
  completedDescription: {
    fontSize: 16,
    color: '#888888',
    textAlign: 'center',
    marginBottom: 30,
    lineHeight: 24,
  },
  backButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
  },
});