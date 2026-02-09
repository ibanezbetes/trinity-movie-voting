import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { MOVIE_GENRES, TV_GENRES, Genre, RootStackParamList } from '../types';
import { getClient, verifyAuthStatus, getAuthMode } from '../services/amplify';
import { CREATE_ROOM } from '../services/graphql';
import { logger } from '../services/logger';
import { Avatar, Card, Typography, Button, Chip, Icon, CustomAlert } from '../components';

type CreateRoomNavigationProp = StackNavigationProp<RootStackParamList, 'CreateRoom'>;

export default function CreateRoomScreen() {
  const navigation = useNavigation<CreateRoomNavigationProp>();
  const [mediaType, setMediaType] = useState<'MOVIE' | 'TV'>('MOVIE');
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  const [maxParticipants, setMaxParticipants] = useState<number>(2);
  const [isCreating, setIsCreating] = useState(false);
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
      // Silently ignore - don't show alert, just don't select
      logger.userAction('Genre selection blocked - limit reached', { 
        genreId, 
        currentSelection: selectedGenres,
        limit: 2 
      });
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
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'Selecciona al menos un género',
        buttons: [{ text: 'OK' }]
      });
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
        setAlertConfig({
          visible: true,
          title: 'Error de Autenticación',
          message: 'Por favor inicia sesión nuevamente',
          buttons: [{ text: 'OK' }]
        });
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

      // Get the appropriate auth mode based on login type
      const authMode = await getAuthMode();
      logger.auth('Using auth mode for createRoom', { authMode });

      const dynamicClient = await getClient();
      const response = await dynamicClient.graphql({
        query: CREATE_ROOM,
        variables: {
          input: {
            mediaType,
            genreIds: selectedGenres,
            maxParticipants,
          },
        },
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
        setAlertConfig({
          visible: true,
          title: 'Error',
          message: 'No se pudo crear la sala. Respuesta vacía del servidor.',
          buttons: [{ text: 'OK' }]
        });
      }
    } catch (error) {
      logger.roomError('Room creation failed', error, {
        mediaType,
        selectedGenres,
        timestamp: new Date().toISOString()
      });
      console.error('Error creating room:', error);
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'No se pudo crear la sala. Inténtalo de nuevo.',
        buttons: [{ text: 'OK' }]
      });
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
          <Icon name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Crear Sala</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Participants Selection - PRIMERO */}
        <View style={styles.section}>
          <Typography variant="h3" style={styles.sectionTitle}>
            Participantes
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

        {/* Media Type Selection - SEGUNDO */}
        <View style={styles.section}>
          <Typography variant="h3" style={styles.sectionTitle}>Películas / Series</Typography>
          <View style={styles.radioContainer}>
            <Button
              title="Películas"
              variant={mediaType === 'MOVIE' ? 'primary' : 'outline'}
              size="medium"
              onPress={() => {
                setMediaType('MOVIE');
                setSelectedGenres([]); // Reset genres when changing media type
              }}
              style={styles.radioButton}
            />
            <Button
              title="Series"
              variant={mediaType === 'TV' ? 'primary' : 'outline'}
              size="medium"
              onPress={() => {
                setMediaType('TV');
                setSelectedGenres([]); // Reset genres when changing media type
              }}
              style={styles.radioButton}
            />
          </View>
        </View>

        {/* Genre Selection - TERCERO */}
        <View style={styles.section}>
          <Typography variant="h3" style={styles.sectionTitle}>
            Géneros
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
  content: {
    flex: 1,
    padding: 20,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    marginBottom: 16,
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
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
    borderColor: '#333333',
    alignItems: 'center',
    backgroundColor: '#2a2a2a',
  },
  participantButtonSelected: {
    borderColor: '#9333ea',
    backgroundColor: '#9333ea',
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
    borderTopColor: '#333333',
    backgroundColor: '#1a1a1a',
  },
  createButton: {
    width: '100%',
  },
});