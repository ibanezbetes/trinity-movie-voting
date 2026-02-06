import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Image, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useMatchNotification } from '../context/MatchNotificationContext';
import { logger } from '../services/logger';

const { width, height } = Dimensions.get('window');
const POSTER_WIDTH = width * 0.7;
const POSTER_HEIGHT = POSTER_WIDTH * 1.5;

type MatchCelebrationScreenRouteProp = RouteProp<RootStackParamList, 'MatchCelebration'>;
type MatchCelebrationScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'MatchCelebration'>;

export default function MatchCelebrationScreen() {
  const navigation = useNavigation<MatchCelebrationScreenNavigationProp>();
  const route = useRoute<MatchCelebrationScreenRouteProp>();
  const { dismissNotification } = useMatchNotification();
  
  const { match, wasInRoom } = route.params;

  useEffect(() => {
    logger.userAction('Screen loaded: MatchCelebration', {
      matchId: match.id,
      movieTitle: match.title,
      wasInRoom,
      timestamp: new Date().toISOString(),
    });

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

  const posterUrl = match.posterPath
    ? `https://image.tmdb.org/t/p/w500${match.posterPath}`
    : null;

  return (
    <View style={styles.container}>
      {/* Celebration Header */}
      <View style={styles.header}>
        <Text style={styles.celebrationEmoji}>🎉</Text>
        <Text style={styles.title}>
          {wasInRoom ? '¡MATCH EN TU SALA!' : '¡MATCH ENCONTRADO!'}
        </Text>
        <Text style={styles.subtitle}>
          {wasInRoom 
            ? 'Todos votaron por la misma película'
            : 'Se encontró una película en común'}
        </Text>
      </View>

      {/* Movie Poster and Details */}
      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Poster */}
        <View style={styles.posterContainer}>
          {posterUrl ? (
            <Image
              source={{ uri: posterUrl }}
              style={styles.poster}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder]}>
              <Text style={styles.posterPlaceholderText}>🎬</Text>
            </View>
          )}
        </View>

        {/* Movie Title */}
        <Text style={styles.movieTitle}>{match.title}</Text>

        {/* Match Info */}
        <View style={styles.infoContainer}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Usuarios que coincidieron:</Text>
            <Text style={styles.infoValue}>{match.matchedUsers?.length || 2}</Text>
          </View>
          
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Fecha del match:</Text>
            <Text style={styles.infoValue}>
              {new Date(match.timestamp).toLocaleDateString('es-ES', {
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        </View>

        {/* Description placeholder */}
        <View style={styles.descriptionContainer}>
          <Text style={styles.descriptionTitle}>Sobre esta película</Text>
          <Text style={styles.descriptionText}>
            Esta es la película que todos eligieron. ¡Es hora de verla juntos!
          </Text>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={handleViewMatches}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryButtonText}>Ver Mis Matches</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={handleContinue}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryButtonText}>
            {wasInRoom ? 'Ir al Inicio' : 'Continuar'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  celebrationEmoji: {
    fontSize: 60,
    marginBottom: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#a0a0a0',
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  posterContainer: {
    marginVertical: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  poster: {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    borderRadius: 12,
  },
  posterPlaceholder: {
    backgroundColor: '#2a2a3e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterPlaceholderText: {
    fontSize: 80,
  },
  movieTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 20,
    paddingHorizontal: 20,
  },
  infoContainer: {
    width: '100%',
    backgroundColor: '#2a2a3e',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: '#a0a0a0',
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  descriptionContainer: {
    width: '100%',
    backgroundColor: '#2a2a3e',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  descriptionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  descriptionText: {
    fontSize: 14,
    color: '#a0a0a0',
    lineHeight: 20,
  },
  buttonContainer: {
    padding: 20,
    paddingBottom: 40,
    gap: 12,
  },
  button: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#e94560',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#e94560',
  },
  secondaryButtonText: {
    color: '#e94560',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
