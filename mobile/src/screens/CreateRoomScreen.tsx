import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { MOVIE_GENRES, TV_GENRES, Genre, RootStackParamList } from '../types';
import { client, verifyAuthStatus } from '../services/amplify';
import { CREATE_ROOM } from '../services/graphql';
import { logger } from '../services/logger';

type CreateRoomNavigationProp = StackNavigationProp<RootStackParamList, 'CreateRoom'>;

export default function CreateRoomScreen() {
  const navigation = useNavigation<CreateRoomNavigationProp>();
  const [mediaType, setMediaType] = useState<'MOVIE' | 'TV'>('MOVIE');
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  const [maxParticipants, setMaxParticipants] = useState<number>(2);
  const [isCreating, setIsCreating] = useState(false);

  const currentGenres = mediaType === 'MOVIE' ? MOVIE_GENRES : TV_GENRES;

  logger.userAction('Screen loaded: CreateRoom', {
    mediaType,
    availableGenres: currentGenres.length
  });

  const handleGenreToggle = (genreId: number) => {
    logger.userAction('Genre toggle attempted', { 
      genreId, 
      genreName: currentGenres.find(g => g.id === genreId)?.name,
      currentSelection: selectedGenres 
    });

    if (selectedGenres.includes(genreId)) {
      const newSelection = selectedGenres.filter(id => id !== genreId);
      setSelectedGenres(newSelection);
      logger.userAction('Genre deselected', { 
        genreId, 
        newSelection,
        totalSelected: newSelection.length 
      });
    } else if (selectedGenres.length < 2) {
      const newSelection = [...selectedGenres, genreId];
      setSelectedGenres(newSelection);
      logger.userAction('Genre selected', { 
        genreId, 
        newSelection,
        totalSelected: newSelection.length 
      });
    } else {
      logger.userAction('Genre selection blocked - limit reached', { 
        genreId, 
        currentSelection: selectedGenres,
        limit: 2 
      });
      Alert.alert('Límite alcanzado', 'Máximo 2 géneros permitidos');
    }
  };

  const handleCreateRoom = async () => {
    logger.userAction('Create room button pressed', {
      mediaType,
      selectedGenres,
      maxParticipants,
      genreNames: selectedGenres.map(id => currentGenres.find(g => g.id === id)?.name)
    });

    if (selectedGenres.length === 0) {
      logger.userAction('Create room blocked - no genres selected');
      Alert.alert('Error', 'Selecciona al menos un género');
      return;
    }
    
    setIsCreating(true);
    logger.room('Starting room creation process', {
      mediaType,
      genreIds: selectedGenres,
      maxParticipants,
      timestamp: new Date().toISOString()
    });
    
    try {
      // Verify authentication status first
      logger.auth('Verifying authentication before room creation');
      const authStatus = await verifyAuthStatus();
      
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for room creation', null);
        Alert.alert('Error de Autenticación', 'Por favor inicia sesión nuevamente');
        return;
      }

      logger.auth('Authentication verified for room creation', {
        userId: authStatus.user?.userId,
        hasTokens: !!authStatus.session?.tokens
      });

      logger.apiRequest('createRoom mutation', {
        input: {
          mediaType,
          genreIds: selectedGenres,
          maxParticipants,
        },
      });

      const response = await client.graphql({
        query: CREATE_ROOM,
        variables: {
          input: {
            mediaType,
            genreIds: selectedGenres,
            maxParticipants,
          },
        },
        authMode: 'userPool', // Explicitly specify auth mode
      });

      logger.apiResponse('createRoom mutation success', {
        roomId: response.data.createRoom?.id,
        roomCode: response.data.createRoom?.code,
        candidatesCount: response.data.createRoom?.candidates?.length || 0
      });

      const room = response.data.createRoom;
      
      if (room) {
        logger.room('Room created successfully', {
          roomId: room.id,
          roomCode: room.code,
          mediaType: room.mediaType,
          genreIds: room.genreIds,
          candidatesCount: room.candidates?.length || 0
        });

        logger.navigation('Navigating to VotingRoom', {
          roomId: room.id,
          roomCode: room.code
        });

        // Navigate to VotingRoom with room details
        navigation.navigate('VotingRoom', {
          roomId: room.id,
          roomCode: room.code,
        });
      } else {
        logger.roomError('Room creation failed - no room data returned', null, response);
        Alert.alert('Error', 'No se pudo crear la sala. Respuesta vacía del servidor.');
      }
    } catch (error) {
      logger.roomError('Room creation failed', error, {
        mediaType,
        selectedGenres,
        timestamp: new Date().toISOString()
      });
      console.error('Error creating room:', error);
      Alert.alert('Error', 'No se pudo crear la sala. Inténtalo de nuevo.');
    } finally {
      setIsCreating(false);
      logger.room('Room creation process completed', { isCreating: false });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>CREAR SALA</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content}>
        {/* Media Type Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tipo de Contenido</Text>
          <View style={styles.radioContainer}>
            <TouchableOpacity
              style={[styles.radioButton, mediaType === 'MOVIE' && styles.radioButtonSelected]}
              onPress={() => setMediaType('MOVIE')}
            >
              <Text style={[styles.radioText, mediaType === 'MOVIE' && styles.radioTextSelected]}>
                🎬 PELÍCULA
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.radioButton, mediaType === 'TV' && styles.radioButtonSelected]}
              onPress={() => setMediaType('TV')}
            >
              <Text style={[styles.radioText, mediaType === 'TV' && styles.radioTextSelected]}>
                📺 SERIE
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Genre Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Géneros ({selectedGenres.length}/2)
          </Text>
          <View style={styles.genreGrid}>
            {currentGenres.map((genre) => (
              <TouchableOpacity
                key={genre.id}
                style={[
                  styles.genreChip,
                  selectedGenres.includes(genre.id) && styles.genreChipSelected
                ]}
                onPress={() => handleGenreToggle(genre.id)}
              >
                <Text style={[
                  styles.genreText,
                  selectedGenres.includes(genre.id) && styles.genreTextSelected
                ]}>
                  {genre.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Participants Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            ¿Cuántas personas votarán?
          </Text>
          <Text style={styles.sectionSubtitle}>
            Se producirá match cuando {maxParticipants} personas voten "Sí" a la misma película
          </Text>
          <View style={styles.participantsContainer}>
            {[2, 3, 4, 5, 6].map((num) => (
              <TouchableOpacity
                key={num}
                style={[
                  styles.participantButton,
                  maxParticipants === num && styles.participantButtonSelected
                ]}
                onPress={() => setMaxParticipants(num)}
              >
                <Text style={[
                  styles.participantText,
                  maxParticipants === num && styles.participantTextSelected
                ]}>
                  {num}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Create Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.createButton, (selectedGenres.length === 0 || isCreating) && styles.createButtonDisabled]}
          onPress={handleCreateRoom}
          disabled={selectedGenres.length === 0 || isCreating}
        >
          {isCreating ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.createButtonText}>CREAR SALA</Text>
          )}
        </TouchableOpacity>
      </View>
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
  backButtonText: {
    fontSize: 20,
    color: '#ffffff',
    fontWeight: 'bold',
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
  content: {
    flex: 1,
    padding: 20,
  },
  section: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 15,
  },
  radioContainer: {
    flexDirection: 'row',
    gap: 15,
  },
  radioButton: {
    flex: 1,
    padding: 15,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#333333',
    alignItems: 'center',
  },
  radioButtonSelected: {
    borderColor: '#4CAF50',
    backgroundColor: '#4CAF50',
  },
  radioText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#888888',
  },
  radioTextSelected: {
    color: '#ffffff',
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  genreChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#2a2a2a',
  },
  genreChipSelected: {
    borderColor: '#2196F3',
    backgroundColor: '#2196F3',
  },
  genreText: {
    fontSize: 14,
    color: '#888888',
    fontWeight: '500',
  },
  genreTextSelected: {
    color: '#ffffff',
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#333333',
  },
  createButton: {
    backgroundColor: '#4CAF50',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  createButtonDisabled: {
    backgroundColor: '#333333',
  },
  createButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#888888',
    marginBottom: 15,
    lineHeight: 20,
  },
  participantsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  participantButton: {
    flex: 1,
    paddingVertical: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#333333',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
  },
  participantButtonSelected: {
    borderColor: '#FF9800',
    backgroundColor: '#FF9800',
  },
  participantText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#888888',
  },
  participantTextSelected: {
    color: '#ffffff',
  },
});