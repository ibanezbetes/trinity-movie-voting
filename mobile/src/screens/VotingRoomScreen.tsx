import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Image,
  Dimensions,
  ActivityIndicator,
  PanResponder,
  Animated,
  Clipboard,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { RootStackParamList, MovieCandidate } from '../types';
import { getClient, verifyAuthStatus, getAuthMode } from '../services/amplify';
import { GET_ROOM, VOTE } from '../services/graphql';
import { logger } from '../services/logger';
import { useProactiveMatchCheck, ACTION_NAMES } from '../hooks/useProactiveMatchCheck';
import { roomSubscriptionService, userSubscriptionService } from '../services/subscriptions';
import { Icon, CustomAlert } from '../components';
import { useSound } from '../context/SoundContext';
import { useMatchNotification } from '../context/MatchNotificationContext';

type VotingRoomRouteProp = RouteProp<RootStackParamList, 'VotingRoom'>;

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const CARD_WIDTH = screenWidth - 40;
const CARD_HEIGHT = screenHeight * 0.7;

export default function VotingRoomScreen() {
  const navigation = useNavigation();
  const route = useRoute<VotingRoomRouteProp>();
  const { roomId, roomCode } = route.params;
  const { addActiveRoom, removeActiveRoom, executeWithMatchCheck } = useProactiveMatchCheck();
  const { playSound } = useSound();
  
  // CRITICAL: Get the match notification context to trigger navigation
  const matchNotificationContext = useMatchNotification();

  const [candidates, setCandidates] = useState<MovieCandidate[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasExistingMatch, setHasExistingMatch] = useState(false);
  const [existingMatch, setExistingMatch] = useState<any>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
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

  // Animation values
  const pan = new Animated.ValueXY();
  const scale = new Animated.Value(1);

  const handleCopyCode = () => {
    Clipboard.setString(roomCode);
    logger.userAction('Room code copied from voting screen', { roomCode });
  };

  // CRITICAL: Helper function to handle match detection and navigation
  const handleMatchDetected = (match: any) => {
    logger.match('🎉 MATCH DETECTED IN VOTING ROOM - NAVIGATING', {
      matchId: match.id,
      title: match.title,
      roomId: match.roomId,
    });

    // Play chin sound
    playSound('chin');

    // Update state to prevent further voting
    setHasExistingMatch(true);
    setExistingMatch(match);

    // CRITICAL: Navigate to MatchCelebration screen
    navigation.navigate('MatchCelebration', { 
      match, 
      wasInRoom: true 
    });
  };

  const handlePlayTrailer = (movie: MovieCandidate) => {
    // Construir query de búsqueda: "Título película/serie trailer"
    const mediaTypeText = movie.mediaType === 'MOVIE' ? 'película' : 'serie';
    const searchQuery = `${movie.title} ${mediaTypeText} trailer`;
    
    // URL encode para YouTube search
    const encodedQuery = encodeURIComponent(searchQuery);
    const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodedQuery}`;
    
    Linking.openURL(youtubeSearchUrl).catch(err => {
      console.error('Failed to open YouTube:', err);
    });
    
    logger.userAction('Trailer search opened from voting screen', { 
      movieId: movie.id,
      title: movie.title,
      mediaType: movie.mediaType,
      searchQuery: searchQuery
    });
  };

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
      if (hasMatch && existingMatch) {
        // CRITICAL: Navigate to MatchCelebration screen
        logger.room('Match found via periodic check - navigating to celebration');
        handleMatchDetected(existingMatch);
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

      logger.room('🔔 Setting up user-specific match subscription', { roomId, userId });

      // CRITICAL FIX: Use user-specific subscription instead of room-based
      // This ensures EACH user gets their own notification directly
      // Backend sends individual notifications to each user via publishUserMatch
      userSubscriptionService.subscribeToUser(userId, (userMatchEvent) => {
        logger.room('🎉 USER MATCH NOTIFICATION RECEIVED in VotingRoom', {
          userId: userMatchEvent.userId,
          roomId: userMatchEvent.roomId,
          matchId: userMatchEvent.matchId,
          movieTitle: userMatchEvent.movieTitle,
          matchedUsers: userMatchEvent.matchedUsers,
          currentUserId: userId,
          subscriptionType: 'user-specific-realtime'
        });

        // Convert to match format
        const match = {
          id: userMatchEvent.matchId,
          title: userMatchEvent.movieTitle,
          movieId: parseInt(userMatchEvent.movieId),
          posterPath: userMatchEvent.posterPath,
          timestamp: userMatchEvent.timestamp,
          roomId: userMatchEvent.roomId,
        };

        // CRITICAL: Navigate to MatchCelebration screen
        handleMatchDetected(match);
      });
      
      logger.room('✅ User-specific match subscription established', { roomId, userId });

    } catch (error) {
      logger.roomError('Failed to setup user subscription', error, { roomId, userId });
      console.error('Failed to setup user subscription:', error);
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

      const dynamicClient = await getClient();
      const response = await dynamicClient.graphql({
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
        
        // CRITICAL: Navigate to MatchCelebration screen
        logger.room('Existing match found - navigating to celebration');
        handleMatchDetected(roomMatch);
        
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
        setAlertConfig({
          visible: true,
          title: 'Error de Autenticación',
          message: 'Por favor inicia sesión nuevamente',
          buttons: [{ text: 'OK', onPress: () => navigation.goBack() }]
        });
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

      const dynamicClient = await getClient();
      const response = await dynamicClient.graphql({
        query: GET_ROOM,
        variables: { id: roomId },
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
        setAlertConfig({
          visible: true,
          title: 'Error',
          message: 'No se encontraron películas en esta sala',
          buttons: [{ text: 'OK' }]
        });
      }
    } catch (error) {
      logger.roomError('Failed to load room data', error, { roomId, roomCode });
      console.error('Error loading room data:', error);
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'No se pudieron cargar las películas',
        buttons: [{ text: 'OK' }]
      });
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
    
    // Play sound based on vote
    playSound(vote ? 'votoSi' : 'votoNo');
    
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
      
      setAlertConfig({
        visible: true,
        title: 'Votación Completada',
        message: 'Has votado todas las películas. Espera a que otros usuarios terminen de votar.',
        buttons: [{ text: 'OK' }]
      });
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
        const dynamicClient = await getClient();
        const roomCheckResponse = await dynamicClient.graphql({
          query: GET_ROOM,
          variables: { id: roomId },
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

        const dynamicClient2 = await getClient();
        const response = await dynamicClient2.graphql({
          query: VOTE,
          variables: {
            input: {
              roomId,
              movieId: currentMovie.id,
              vote,
            },
          },
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

          // CRITICAL: Navigate to MatchCelebration screen
          handleMatchDetected(result.match);
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
          // Room disappeared, likely due to match - check for match
          logger.voteError('Room not found error - checking for match', error);
          await checkForExistingMatch();
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
            style={styles.matchButton}
            onPress={() => navigation.navigate('Dashboard')}
          >
            <Text style={styles.matchButtonText}>Volver al Dashboard</Text>
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
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{roomCode}</Text>
          <TouchableOpacity
            style={styles.copyButtonHeader}
            onPress={handleCopyCode}
            activeOpacity={0.7}
          >
            <Icon name="copy" size={20} color="#9C27B0" />
          </TouchableOpacity>
        </View>
        <View style={styles.placeholder} />
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
          
          {/* Play button overlay */}
          <TouchableOpacity
            style={styles.playButton}
            onPress={() => handlePlayTrailer(currentMovie)}
            activeOpacity={0.8}
          >
            <Icon name="play" size={24} color="#ffffff" />
          </TouchableOpacity>
          
          {/* Overlay with movie info */}
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.95)']}
            style={styles.overlay}
          >
            <View style={styles.movieInfo}>
              <Text style={styles.movieTitle}>{currentMovie.title}</Text>
              <Text style={styles.movieYear}>
                {new Date(currentMovie.releaseDate).getFullYear()}
              </Text>
              <Text style={styles.movieDescription}>
                {currentMovie.overview}
              </Text>
            </View>
          </LinearGradient>
        </Animated.View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity
          style={styles.actionButtonCircle}
          onPress={() => {
            logger.userAction('Dislike button pressed - using optimistic UI');
            handleVote(false);
          }}
          activeOpacity={0.8}
        >
          <Image
            source={require('../../assets/botonNo.png')}
            style={styles.buttonImage}
            resizeMode="contain"
          />
        </TouchableOpacity>
        
        <TouchableOpacity
          style={styles.actionButtonCircle}
          onPress={() => {
            logger.userAction('Like button pressed - using optimistic UI');
            handleVote(true);
          }}
          activeOpacity={0.8}
        >
          <Image
            source={require('../../assets/botonSi.png')}
            style={styles.buttonImage}
            resizeMode="contain"
          />
        </TouchableOpacity>
      </View>
      
      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        onDismiss={() => setAlertConfig({ ...alertConfig, visible: false })}
      />
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
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 2,
  },
  copyButtonHeader: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    width: 40,
  },
  cardContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#2a2a2a',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  playButton: {
    position: 'absolute',
    bottom: 15,
    right: 15,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(147, 51, 234, 0.5)', // Morado con 50% de transparencia
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    minHeight: '50%',
    justifyContent: 'flex-end',
  },
  movieInfo: {
    padding: 20,
    paddingBottom: 25,
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
    paddingHorizontal: 40,
    paddingVertical: 30,
    gap: 60,
  },
  actionButtonCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonImage: {
    width: 50,
    height: 50,
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
});
