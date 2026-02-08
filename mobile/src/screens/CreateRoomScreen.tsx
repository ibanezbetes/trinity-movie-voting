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
import { Avatar, Card, Typography, Button, Chip } from '../components';

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
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Typography variant="h2">Crear Sala</Typography>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Trini Assistant Card */}
        <Card variant="elevated" style={styles.assistantCard}>
          <View style={styles.assistantHeader}>
            <View style={styles.triniIcon}>
              <Text style={styles.triniIconText}>T</Text>
            </View>
            <View style={styles.assistantTextContainer}>
              <Typography variant="h3" style={styles.assistantName}>Trini</Typography>
              <Typography variant="caption">Tu asistente de votación</Typography>
            </View>
          </View>
          <Typography variant="body" style={styles.assistantMessage}>
            Configura tu sala de votación. Selecciona el tipo de contenido y hasta 2 géneros para comenzar.
          </Typography>
        </Card>

        {/* Media Type Selection */}
        <View style={styles.section}>
          <Typography variant="h3" style={styles.sectionTitle}>Tipo de Contenido</Typography>
          <View style={styles.radioContainer}>
            <Button
              title="Película"
              variant={mediaType === 'MOVIE' ? 'primary' : 'outline'}
              size="medium"
              onPress={() => setMediaType('MOVIE')}
              style={styles.radioButton}
            />
            <Button
              title="Serie"
              variant={mediaType === 'TV' ? 'primary' : 'outline'}
              size="medium"
              onPress={() => setMediaType('TV')}
              style={styles.radioButton}
            />
          </View>
        </View>

        {/* Genre Selection */}
        <View style={styles.section}>
          <Typography variant="h3" style={styles.sectionTitle}>
            Géneros ({selectedGenres.length}/2)
          </Typography>
          <View style={styles.genreGrid}>
            {currentGenres.map((genre) => (
              <Chip
                key={genre.id}
                label={genre.name}
                selected={selectedGenres.includes(genre.id)}
                onPress={() => handleGenreToggle(genre.id)}
                style={styles.genreChip}
              />
            ))}
          </View>
        </View>

        {/* Participants Selection */}
        <View style={styles.section}>
          <Typography variant="h3" style={styles.sectionTitle}>
            Participantes
          </Typography>
          <Typography variant="caption" style={styles.sectionSubtitle}>
            Se producirá match cuando {maxParticipants} personas voten "Sí" a la misma película
          </Typography>
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
        <Button
          title="Crear Sala"
          variant="primary"
          size="large"
          onPress={handleCreateRoom}
          disabled={selectedGenres.length === 0 || isCreating}
          loading={isCreating}
          style={styles.createButton}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
  },
  backButtonText: {
    fontSize: 20,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  assistantCard: {
    marginBottom: 24,
  },
  assistantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  triniIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  triniIconText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  assistantTextContainer: {
    flex: 1,
  },
  assistantName: {
    marginBottom: 2,
  },
  assistantMessage: {
    lineHeight: 22,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  sectionSubtitle: {
    marginBottom: 16,
    lineHeight: 20,
  },
  radioContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  radioButton: {
    flex: 1,
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-start',
  },
  genreChip: {
    minWidth: '30%',
    flexGrow: 1,
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
    borderColor: '#2a2a2a',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  participantButtonSelected: {
    borderColor: '#7c3aed',
    backgroundColor: '#7c3aed',
  },
  participantText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#888888',
  },
  participantTextSelected: {
    color: '#ffffff',
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  createButton: {
    width: '100%',
  },
});