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
import { useProactiveMatchCheck, ACTION_NAMES } from '../hooks/useProactiveMatchCheck';
import { roomSubscriptionService, userSubscriptionService } from '../services/subscriptions';

type VotingRoomRouteProp = RouteProp<RootStackParamList, 'VotingRoom'>;

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const CARD_WIDTH = screenWidth - 40;
const CARD_HEIGHT = screenHeight * 0.7;

export default function VotingRoomScreen() {
  const navigation = useNavigation();
  const route = useRoute<VotingRoomRouteProp>();
  const { roomId, roomCode } = route.params;
  const { addActiveRoom, removeActiveRoom, executeWithMatchCheck } = useProactiveMatchCheck();

  const [candidates, setCandidates] = useState<MovieCandidate[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasExistingMatch, setHasExistingMatch] = useState(false);
  const [existingMatch, setExistingMatch] = useState<any>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Animation values
  const pan = new Animated.ValueXY();
  const scale = new Animated.Value(1);

  useEffect(() => {
    logger.userAction('Screen loaded: VotingRoom', {
      roomId,
      roomCode,
      timestamp: new Date().toISOString()
    });
    
    // Add this room to active rooms for match checking
    addActiveRoom(roomId);
    
    // CRITICAL FIX: Set up subscriptions FIRST, then load data
    setupRoomSubscription();
    loadRoomData();

    // Cleanup: remove room from active rooms and unsubscribe when leaving
    return () => {
      removeActiveRoom(roomId);
      roomSubscriptionService.unsubscribeFromRoom(roomId);
      if (currentUserId) {
        userSubscriptionService.unsubscribeFromUser(currentUserId);
      }
    };
  }, []);

  // Verificar matches periódicamente mientras la pantalla esté activa
  useEffect(() => {
    if (hasExistingMatch || isLoading) return;

    const interval = setInterval(async () => {
      logger.room('🔍 AGGRESSIVE periodic match check', { roomId });
      const hasMatch = await checkForExistingMatch();
      if (hasMatch) {
        // If match found, navigate to MatchCelebration screen
        // The navigation will be handled by the context provider
        logger.room('Match found via periodic check - navigation handled by context');
      }
    }, 2000); // Verificar cada 2 segundos (más agresivo)

    return () => clearInterval(interval);
  }, [hasExistingMatch, isLoading, roomId]);

  const setupRoomSubscription = async () => {
    try {
      const authStatus = await verifyAuthStatus();
      if (!authStatus.isAuthenticated || !authStatus.user?.userId) {
        logger.authError('User not authenticated for room subscription setup', null);
        return;
      }

      const userId = authStatus.user.userId;
      setCurrentUserId(userId);

      logger.room('🔔 Setting up CRITICAL room subscription system', { roomId, userId });

      // CRITICAL FIX: Use ONLY room-based subscription for immediate notifications
      // This ensures ALL users in the room get notified when ANY match occurs
      roomSubscriptionService.subscribeToRoom(roomId, userId, (roomMatchEvent) => {
        logger.room('🎉 ROOM MATCH NOTIFICATION RECEIVED in VotingRoom', {
          roomId: roomMatchEvent.roomId,
          matchId: roomMatchEvent.matchId,
          movieTitle: roomMatchEvent.movieTitle,
          matchedUsers: roomMatchEvent.matchedUsers,
          currentUserId: userId,
          subscriptionType: 'room-based-realtime'
        });

        // Update state to show match found
        setHasExistingMatch(true);
        setExistingMatch({
          id: roomMatchEvent.matchId,
          title: roomMatchEvent.movieTitle,
          movieId: parseInt(roomMatchEvent.movieId),
          posterPath: roomMatchEvent.posterPath,
          timestamp: roomMatchEvent.timestamp,
        });

        // Navigation to MatchCelebration will be handled by the context provider
        logger.room('Match notification received - navigation handled by context');
      });
      
      logger.room('✅ Room subscription system established for real-time notifications', { roomId, userId });

    } catch (error) {
      logger.roomError('Failed to setup room subscription', error, { roomId });
      console.error('Failed to setup room subscription:', error);
    }
  };

  const checkForExistingMatch = async (): Promise<boolean> => {
    try {
      logger.room('🔍 ENHANCED checking for existing match using getMyMatches', { roomId });
      
      const authStatus = await verifyAuthStatus();
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for checking match', null);
        return false;
      }

      const response = await client.graphql({
        query: `
          query GetMatches {
            getMyMatches {
              id
              roomId
              movieId
              title
              posterPath
              timestamp
              matchedUsers
            }
          }
        `,
        authMode: 'userPool',
      });

      const matches = response.data.getMyMatches || [];
      const roomMatch = matches.find(match => match.roomId === roomId);
      
      if (roomMatch) {
        logger.room('🎉 EXISTING MATCH FOUND!', {
          matchId: roomMatch.id,
          movieTitle: roomMatch.title,
          movieId: roomMatch.movieId,
          timestamp: roomMatch.timestamp,
          matchedUsers: roomMatch.matchedUsers
        });
        
        setHasExistingMatch(true);
        setExistingMatch(roomMatch);
        
        // Navigation to MatchCelebration will be handled by the context provider
        logger.room('Existing match found - navigation handled by context');
        
        return true;
      } else {
        logger.room('No existing match found', { roomId, totalMatches: matches.length });
        return false;
      }
    } catch (error) {
      logger.roomError('Error checking for existing match', error, { roomId });
      return false;
    }
  };

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

      // Check for existing match BEFORE loading room data
      const hasMatch = await checkForExistingMatch();
      if (hasMatch) {
        setIsLoading(false);
        return; // Don't load candidates if there's already a match
      }

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
    if (currentIndex >= candidates.length) return;

    const currentMovie = candidates[currentIndex];
    
    logger.vote('🚀 OPTIMISTIC UI: Vote attempt with immediate card transition', {
      movieId: currentMovie.id,
      movieTitle: currentMovie.title,
      vote,
      currentIndex,
      totalCandidates: candidates.length,
      roomId,
      roomCode,
      hasExistingMatch
    });

    // 1. OPTIMISTIC UPDATE: Move to next card IMMEDIATELY (UI First)
    const nextIndex = currentIndex + 1;
    setCurrentIndex(nextIndex);
    
    logger.vote('✅ IMMEDIATE UI UPDATE: Card transitioned optimistically', {
      previousIndex: currentIndex,
      nextIndex,
      remainingCandidates: candidates.length - nextIndex,
      movieTitle: currentMovie.title,
      vote
    });

    // Check if we've reached the end of candidates
    if (nextIndex >= candidates.length) {
      logger.vote('All candidates voted - showing completion message', {
        totalCandidates: candidates.length,
        roomId,
        roomCode
      });
      
      Alert.alert(
        'Votación Completada',
        'Has votado todas las películas. Espera a que otros usuarios terminen de votar.',
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    }

    // 2. FIRE AND FORGET: Send vote to server in background (Network Background)
    // This runs in parallel without blocking the UI
    executeWithMatchCheck(async () => {
      logger.vote('🔄 BACKGROUND PROCESSING: Sending vote to server', {
        movieId: currentMovie.id,
        movieTitle: currentMovie.title,
        vote,
        roomId,
        roomCode
      });

      try {
        // Verify authentication status first
        logger.auth('Verifying authentication before voting');
        const authStatus = await verifyAuthStatus();
        
        if (!authStatus.isAuthenticated) {
          logger.authError('User not authenticated for voting', null);
          // Don't show alert here as it would interrupt the flow
          console.error('Authentication failed during background vote');
          return;
        }

        logger.auth('Authentication verified for voting', {
          userId: authStatus.user?.userId,
          hasTokens: !!authStatus.session?.tokens
        });

        // FINAL CHECK: Verify room still exists before voting
        logger.vote('🔍 Final room existence check before vote submission');
        const roomCheckResponse = await client.graphql({
          query: GET_ROOM,
          variables: { id: roomId },
          authMode: 'userPool',
        });

        if (!roomCheckResponse.data.getRoom) {
          logger.voteError('Room no longer exists - vote blocked', null, {
            roomId,
            movieId: currentMovie.id,
            vote
          });
          
          // Room no longer exists - likely due to match
          // Navigation will be handled by the context provider
          logger.vote('Room disappeared - navigation handled by context');
          return;
        }

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
          authMode: 'userPool',
        });

        logger.apiResponse('vote mutation success', {
          success: response.data.vote?.success,
          hasMatch: !!response.data.vote?.match,
          matchTitle: response.data.vote?.match?.title
        });

        const result = response.data.vote;
      
        // 3. INTERRUPT ON MATCH: If match detected, interrupt current flow
        if (result.match) {
          logger.vote('🎉 MATCH DETECTED - INTERRUPTING USER FLOW!', {
            matchId: result.match.id,
            movieTitle: result.match.title,
            movieId: result.match.movieId,
            roomId: result.match.roomId,
            timestamp: result.match.timestamp
          });

          // Update state to prevent further voting
          setHasExistingMatch(true);
          setExistingMatch(result.match);

          // Navigation to MatchCelebration will be handled by the context provider
          logger.vote('Match detected - navigation handled by context');
        } else {
          logger.vote('✅ BACKGROUND VOTE COMPLETED: No match, continuing flow', {
            movieTitle: currentMovie.title,
            vote,
            nextIndex
          });
        }

      } catch (error) {
        logger.voteError('Background vote failed', error, {
          movieId: currentMovie.id,
          movieTitle: currentMovie.title,
          vote,
          roomId,
          roomCode
        });
        console.error('Error in background vote:', error);
        
        // Check if error is due to room not found (potential match)
        const errorMessage = error?.message || error?.toString() || '';
        if (errorMessage.includes('Room not found') || errorMessage.includes('has expired')) {
          // Room disappeared, likely due to match
          // Navigation will be handled by the context provider
          logger.voteError('Room not found error - navigation handled by context', error);
        }
        // For other errors, don't interrupt the user flow
        // The vote failed but the user can continue voting
      }
    }, ACTION_NAMES.SUBMIT_VOTE)
    .catch((error) => {
      // Handle any errors from executeWithMatchCheck
      logger.voteError('ExecuteWithMatchCheck failed', error, {
        movieId: currentMovie.id,
        movieTitle: currentMovie.title,
        vote,
        roomId,
        roomCode
      });
      console.error('Error in executeWithMatchCheck:', error);
    });
  };

  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => {
      // Allow gestures even if there's an existing match (rooms persist now)
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
    onPanResponderRelease: async (_, gestureState) => {
      pan.flattenOffset();
      
      logger.userAction('Swipe gesture detected - processing vote', {
        gestureX: gestureState.dx,
        gestureY: gestureState.dy
      });
      
      const swipeThreshold = 120;
      
      if (gestureState.dx > swipeThreshold) {
        // Swipe right - Like
        logger.userAction('Swipe right detected - processing like vote with optimistic UI');
        Animated.timing(pan, {
          toValue: { x: screenWidth, y: gestureState.dy },
          duration: 200,
          useNativeDriver: false,
        }).start(() => {
          // Reset animation for next card
          pan.setValue({ x: 0, y: 0 });
          scale.setValue(1);
          
          // Process vote with optimistic UI
          handleVote(true);
        });
      } else if (gestureState.dx < -swipeThreshold) {
        // Swipe left - Dislike
        logger.userAction('Swipe left detected - processing dislike vote with optimistic UI');
        Animated.timing(pan, {
          toValue: { x: -screenWidth, y: gestureState.dy },
          duration: 200,
          useNativeDriver: false,
        }).start(() => {
          // Reset animation for next card
          pan.setValue({ x: 0, y: 0 });
          scale.setValue(1);
          
          // Process vote with optimistic UI
          handleVote(false);
        });
      } else {
        // Snap back
        logger.userAction('Swipe gesture too small - snapping back');
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

  if (hasExistingMatch && existingMatch) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
        
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backIcon}>←</Text>
          </TouchableOpacity>
          <Text style={styles.roomCode}>{roomCode}</Text>
          <View style={styles.placeholder} />
        </View>

        <View style={styles.completedContainer}>
          <Text style={styles.completedIcon}>🎉</Text>
          <Text style={styles.completedTitle}>¡MATCH ENCONTRADO!</Text>
          <Text style={styles.completedDescription}>
            Ya hay una película seleccionada en esta sala:
          </Text>
          <Text style={styles.matchTitle}>{existingMatch.title}</Text>
          <Text style={styles.matchDescription}>
            Todos los usuarios han votado positivamente por esta película.
          </Text>
          
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.navigate('MyMatches' as any)}
          >
            <Text style={styles.backButtonText}>Ver Mis Matches</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.backButton, { backgroundColor: '#666666', marginTop: 15 }]}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backButtonText}>Salir de la Sala</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

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
          style={[
            styles.actionButton, 
            styles.dislikeButton
          ]}
          onPress={() => {
            logger.userAction('Dislike button pressed - using optimistic UI');
            handleVote(false);
          }}
        >
          <Text style={styles.actionButtonText}>👎</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.actionButton, 
            styles.likeButton
          ]}
          onPress={() => {
            logger.userAction('Like button pressed - using optimistic UI');
            handleVote(true);
          }}
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
  disabledButton: {
    backgroundColor: '#666666',
    opacity: 0.5,
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
  matchTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#42c767',
    textAlign: 'center',
    marginVertical: 15,
  },
  matchDescription: {
    fontSize: 14,
    color: '#cccccc',
    textAlign: 'center',
    marginBottom: 30,
    lineHeight: 20,
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