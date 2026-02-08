import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, Dimensions, Linking } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useMatchNotification } from '../context/MatchNotificationContext';
import { useSound } from '../context/SoundContext';
import { logger } from '../services/logger';
import { Icon, ChinIcon, CelebrationEffects } from '../components';

const { width, height } = Dimensions.get('window');

type MatchCelebrationScreenRouteProp = RouteProp<RootStackParamList, 'MatchCelebration'>;
type MatchCelebrationScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'MatchCelebration'>;

export default function MatchCelebrationScreen() {
  const navigation = useNavigation<MatchCelebrationScreenNavigationProp>();
  const route = useRoute<MatchCelebrationScreenRouteProp>();
  const { dismissNotification } = useMatchNotification();
  const { playSound } = useSound();
  
  const { match, wasInRoom } = route.params;
  const [showCelebration, setShowCelebration] = useState(true);

  useEffect(() => {
    logger.userAction('Screen loaded: MatchCelebration', {
      matchId: match.id,
      movieTitle: match.title,
      wasInRoom,
      timestamp: new Date().toISOString(),
    });

    // Play chin sound when celebration screen loads
    playSound('chin');

    // Dismiss the notification when the screen loads
    dismissNotification(match.id);
  }, [match.id]);

  const handleViewMatches = () => {
    logger.userAction('Match celebration: View Matches pressed', {
      matchId: match.id,
      wasInRoom,
    });

    // Navigate to MyMatches screen
    navigation.navigate('MyMatches');
  };

  const handleContinue = () => {
    logger.userAction('Match celebration: Continue pressed', {
      matchId: match.id,
      wasInRoom,
    });

    if (wasInRoom) {
      // User was in the voting room when match happened - go to Dashboard
      navigation.navigate('Dashboard');
    } else {
      // User was NOT in the voting room (received notification from another room)
      // Return to where they were before the notification
      navigation.goBack();
    }
  };

  const handlePlayTrailer = () => {
    // Construir query de búsqueda: "Título película trailer"
    const searchQuery = `${match.title} película trailer`;
    
    // URL encode para YouTube search
    const encodedQuery = encodeURIComponent(searchQuery);
    const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodedQuery}`;
    
    Linking.openURL(youtubeSearchUrl).catch(err => {
      console.error('Failed to open YouTube:', err);
    });
    
    logger.userAction('Trailer search opened from match celebration', { 
      movieId: match.movieId,
      title: match.title,
      searchQuery: searchQuery
    });
  };

  const posterUrl = match.posterPath
    ? `https://image.tmdb.org/t/p/w500${match.posterPath}`
    : null;

  return (
    <View style={styles.container}>
      {/* Efectos de celebración */}
      {showCelebration && (
        <CelebrationEffects onComplete={() => setShowCelebration(false)} />
      )}

      {/* Movie Poster and Details - Estilo Descubre */}
      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Poster Container con Play Button */}
        <View style={styles.posterContainer}>
          {posterUrl ? (
            <Image
              source={{ uri: posterUrl }}
              style={styles.poster}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder]}>
              <Icon name="film" size={80} color="#888888" />
            </View>
          )}
          
          {/* Play Button Overlay */}
          <TouchableOpacity 
            style={styles.playButton}
            onPress={handlePlayTrailer}
            activeOpacity={0.8}
          >
            <Icon name="play" size={32} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* Movie Info */}
        <View style={styles.movieInfo}>
          <Text style={styles.movieTitle}>{match.title}</Text>
          
          {/* Match Info */}
          <View style={styles.matchInfoContainer}>
            <ChinIcon size={20} color="#9333EA" />
            <Text style={styles.matchInfoText}>
              {match.matchedUsers?.length || 2} usuarios habéis hecho chin
            </Text>
          </View>
          
          <Text style={styles.movieDescription}>
            Esta es la película que todos eligieron. ¡Es hora de verla juntos!
          </Text>
        </View>
      </ScrollView>

      {/* Action Buttons - Lado a lado */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={handleViewMatches}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryButtonText}>Ver Mis Chines</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={handleContinue}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryButtonText}>Continuar</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  posterContainer: {
    position: 'relative',
    width: width * 0.85,
    aspectRatio: 2/3,
    marginVertical: 20,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#2a2a2a',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  posterPlaceholder: {
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
  movieInfo: {
    width: '100%',
    paddingHorizontal: 10,
  },
  movieTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 15,
  },
  matchInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  matchInfoText: {
    fontSize: 16,
    color: '#9333EA',
    fontWeight: '600',
  },
  movieDescription: {
    fontSize: 16,
    color: '#cccccc',
    lineHeight: 24,
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    padding: 20,
    paddingBottom: 40,
    gap: 12,
    backgroundColor: '#1a1a1a',
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#333333',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secondaryButton: {
    backgroundColor: '#333333',
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
