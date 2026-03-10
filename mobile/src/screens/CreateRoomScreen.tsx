import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Slider from '@react-native-community/slider';
import { MOVIE_GENRES, TV_GENRES, COMBINED_GENRES, SPECIAL_GENRE_IDS, STREAMING_PLATFORMS, Genre, RootStackParamList } from '../types';
import { getClient, verifyAuthStatus, getAuthMode } from '../services/amplify';
import { CREATE_ROOM } from '../services/graphql';
import { logger } from '../services/logger';
import { Avatar, Card, Typography, Button, Chip, Icon, CustomAlert } from '../components';

type CreateRoomNavigationProp = StackNavigationProp<RootStackParamList, 'CreateRoom'>;

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 1950;
const MAX_YEAR = CURRENT_YEAR;

export default function CreateRoomScreen() {
  const navigation = useNavigation<CreateRoomNavigationProp>();
  
  // State for wizard steps
  const [currentStep, setCurrentStep] = useState(1);
  const TOTAL_STEPS = 6;
  
  // Room configuration state
  const [maxParticipants, setMaxParticipants] = useState<number>(2);
  const [mediaType, setMediaType] = useState<'MOVIE' | 'TV' | 'BOTH'>('MOVIE');
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  const [minYear, setMinYear] = useState<number>(MIN_YEAR);
  const [maxYear, setMaxYear] = useState<number>(MAX_YEAR);
  const [selectedPlatforms, setSelectedPlatforms] = useState<number[]>([]);
  
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

  const currentGenres = mediaType === 'MOVIE' ? MOVIE_GENRES : mediaType === 'TV' ? TV_GENRES : COMBINED_GENRES;

  logger.userAction('Screen loaded: CreateRoom', {
    mediaType,
    availableGenres: currentGenres.length
  });

  const handleNext = () => {
    // Validate current step before proceeding
    if (currentStep === 3 && selectedGenres.length === 0) {
      setAlertConfig({
        visible: true,
        title: 'Selecciona al menos un género',
        message: 'Debes elegir al menos un género para continuar',
        buttons: [{ text: 'OK' }]
      });
      return;
    }

    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1);
      logger.userAction('Wizard step advanced', { 
        from: currentStep, 
        to: currentStep + 1 
      });
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      logger.userAction('Wizard step back', { 
        from: currentStep, 
        to: currentStep - 1 
      });
    } else {
      navigation.goBack();
    }
  };

  const handleEdit = () => {
    setCurrentStep(1);
    logger.userAction('Edit room configuration from summary');
  };

  const handleGenreToggle = (genreId: number) => {
    logger.userAction('Genre toggle attempted', { 
      genreId, 
      genreName: currentGenres.find(g => g.id === genreId)?.name,
      currentSelection: selectedGenres 
    });

    const isSpecialGenre = genreId === SPECIAL_GENRE_IDS.RANDOM || genreId === SPECIAL_GENRE_IDS.ANY;

    if (selectedGenres.includes(genreId)) {
      // Deseleccionar el género
      const newSelection = selectedGenres.filter(id => id !== genreId);
      setSelectedGenres(newSelection);
      logger.userAction('Genre deselected', { 
        genreId, 
        newSelection,
        totalSelected: newSelection.length 
      });
    } else {
      // Seleccionar el género
      if (isSpecialGenre) {
        // Si es "Aleatorio" o "Cualquiera", reemplazar toda la selección
        const newSelection = [genreId];
        setSelectedGenres(newSelection);
        logger.userAction('Special genre selected - replacing all', { 
          genreId,
          genreName: currentGenres.find(g => g.id === genreId)?.name,
          newSelection 
        });
      } else {
        // Si hay un género especial seleccionado, reemplazarlo
        const hasSpecialGenre = selectedGenres.some(id => 
          id === SPECIAL_GENRE_IDS.RANDOM || id === SPECIAL_GENRE_IDS.ANY
        );
        
        if (hasSpecialGenre) {
          const newSelection = [genreId];
          setSelectedGenres(newSelection);
          logger.userAction('Normal genre selected - replacing special genre', { 
            genreId,
            newSelection 
          });
        } else if (selectedGenres.length < 2) {
          // Selección normal (máximo 2 géneros)
          const newSelection = [...selectedGenres, genreId];
          setSelectedGenres(newSelection);
          logger.userAction('Genre selected', { 
            genreId, 
            newSelection,
            totalSelected: newSelection.length 
          });
        } else {
          // Límite alcanzado
          logger.userAction('Genre selection blocked - limit reached', { 
            genreId, 
            currentSelection: selectedGenres,
            limit: 2 
          });
        }
      }
    }
  };

  const handlePlatformToggle = (platformId: number) => {
    logger.userAction('Platform toggle attempted', {
      platformId,
      platformName: STREAMING_PLATFORMS.find(p => p.id === platformId)?.name,
      currentSelection: selectedPlatforms
    });

    if (selectedPlatforms.includes(platformId)) {
      // Deseleccionar plataforma
      const newSelection = selectedPlatforms.filter(id => id !== platformId);
      setSelectedPlatforms(newSelection);
      logger.userAction('Platform deselected', {
        platformId,
        newSelection,
        totalSelected: newSelection.length
      });
    } else {
      // Seleccionar plataforma (sin límite)
      const newSelection = [...selectedPlatforms, platformId];
      setSelectedPlatforms(newSelection);
      logger.userAction('Platform selected', {
        platformId,
        newSelection,
        totalSelected: newSelection.length
      });
    }
  };

  // Render functions for each step
  const renderStep1 = () => (
    <View style={styles.stepContainer}>
      <Typography variant="h2" style={styles.stepTitle}>
        ¿Cuántos participantes?
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
  );

  const renderStep2 = () => (
    <View style={styles.stepContainer}>
      <Typography variant="h2" style={styles.stepTitle}>
        ¿Qué quieres ver?
      </Typography>
      <View style={styles.mediaTypeContainer}>
        <Button
          title="Películas"
          variant={mediaType === 'MOVIE' ? 'primary' : 'outline'}
          size="large"
          onPress={() => {
            setMediaType('MOVIE');
            setSelectedGenres([]); // Reset genres when changing media type
          }}
          style={styles.mediaTypeButton}
        />
        <Button
          title="Series"
          variant={mediaType === 'TV' ? 'primary' : 'outline'}
          size="large"
          onPress={() => {
            setMediaType('TV');
            setSelectedGenres([]); // Reset genres when changing media type
          }}
          style={styles.mediaTypeButton}
        />
        <Button
          title="Películas y series"
          variant={mediaType === 'BOTH' ? 'primary' : 'outline'}
          size="large"
          onPress={() => {
            setMediaType('BOTH');
            setSelectedGenres([]); // Reset genres when changing media type
          }}
          style={styles.mediaTypeButton}
        />
      </View>
    </View>
  );

  const renderStep3 = () => {
    // Separar géneros especiales de géneros normales
    const specialGenres = currentGenres.filter(g => g.isSpecial);
    const normalGenres = currentGenres.filter(g => !g.isSpecial);

    return (
      <View style={styles.stepContainer}>
        <Typography variant="h2" style={styles.stepTitle}>
          Selecciona géneros
        </Typography>
        
        <ScrollView 
          style={styles.genreScrollView}
          showsVerticalScrollIndicator={false}
        >
          {/* Géneros especiales en la primera línea */}
          <View style={styles.specialGenresRow}>
            {specialGenres.map((genre) => (
              <Chip
                key={genre.id}
                label={genre.name}
                selected={selectedGenres.includes(genre.id)}
                onPress={() => handleGenreToggle(genre.id)}
                style={styles.genreChip}
              />
            ))}
          </View>

          {/* Texto "Máximo 2 géneros" */}
          <Text style={styles.genreSubtitle}>
            Máximo 2 géneros
          </Text>

          {/* Géneros normales */}
          <View style={styles.genreGrid}>
            {normalGenres.map((genre) => (
              <Chip
                key={genre.id}
                label={genre.name}
                selected={selectedGenres.includes(genre.id)}
                onPress={() => handleGenreToggle(genre.id)}
                style={styles.genreChip}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderStep4 = () => (
    <View style={styles.stepContainer}>
      <Typography variant="h2" style={styles.stepTitle}>
        Rango de años
      </Typography>
      <View style={styles.yearRangeContainerFullWidth}>
        <View style={styles.yearSliderSection}>
          <View style={styles.yearLabelRow}>
            <Text style={styles.yearLabelText}>Desde:</Text>
            <Text style={styles.yearValueText}>{minYear}</Text>
          </View>
          <Slider
            style={styles.sliderFullWidth}
            minimumValue={MIN_YEAR}
            maximumValue={maxYear}
            step={1}
            value={minYear}
            onValueChange={(value) => setMinYear(Math.round(value))}
            minimumTrackTintColor="#9333ea"
            maximumTrackTintColor="#333333"
            thumbTintColor="#9333ea"
          />
        </View>

        <View style={styles.yearSliderSection}>
          <View style={styles.yearLabelRow}>
            <Text style={styles.yearLabelText}>Hasta:</Text>
            <Text style={styles.yearValueText}>{maxYear}</Text>
          </View>
          <Slider
            style={styles.sliderFullWidth}
            minimumValue={minYear}
            maximumValue={MAX_YEAR}
            step={1}
            value={maxYear}
            onValueChange={(value) => setMaxYear(Math.round(value))}
            minimumTrackTintColor="#9333ea"
            maximumTrackTintColor="#333333"
            thumbTintColor="#9333ea"
          />
        </View>
      </View>
    </View>
  );

  const renderStep5 = () => (
    <View style={styles.stepContainer}>
      <Typography variant="h2" style={styles.stepTitle}>
        Plataformas de streaming
      </Typography>
      <Text style={styles.stepSubtitle}>
        {selectedPlatforms.length === 0 
          ? 'Opcional - Sin selección se muestra todo'
          : `${selectedPlatforms.length} seleccionada${selectedPlatforms.length > 1 ? 's' : ''}`
        }
      </Text>
      <View style={styles.platformsGrid}>
        {STREAMING_PLATFORMS.map((platform) => (
          <TouchableOpacity
            key={platform.id}
            style={[
              styles.platformButton,
              selectedPlatforms.includes(platform.id) && styles.platformButtonSelected
            ]}
            onPress={() => handlePlatformToggle(platform.id)}
            activeOpacity={0.7}
          >
            <Image
              source={platform.logo}
              style={styles.platformLogo}
              resizeMode="contain"
            />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const renderStep6 = () => {
    const mediaTypeText = mediaType === 'MOVIE' ? 'Películas' : mediaType === 'TV' ? 'Series' : 'Películas y Series';
    const genreNames = selectedGenres.map(id => currentGenres.find(g => g.id === id)?.name).filter(Boolean);
    const platformNames = selectedPlatforms.map(id => STREAMING_PLATFORMS.find(p => p.id === id)?.name).filter(Boolean);

    return (
      <View style={styles.stepContainer}>
        <Typography variant="h2" style={styles.stepTitle}>
          Resumen de la sala
        </Typography>
        <ScrollView 
          style={styles.summaryScrollView}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.summaryContainer}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Participantes:</Text>
              <Text style={styles.summaryValue}>{maxParticipants}</Text>
            </View>

            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Tipo de contenido:</Text>
              <Text style={styles.summaryValue}>{mediaTypeText}</Text>
            </View>

            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Géneros:</Text>
              <Text style={styles.summaryValue}>{genreNames.join(', ')}</Text>
            </View>

            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Años:</Text>
              <Text style={styles.summaryValue}>{minYear} - {maxYear}</Text>
            </View>

            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Plataformas:</Text>
              <Text style={styles.summaryValue}>
                {platformNames.length > 0 ? platformNames.join(', ') : 'Todas'}
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      case 5: return renderStep5();
      case 6: return renderStep6();
      default: return null;
    }
  };

  const handleCreateRoom = async () => {
    logger.userAction('Create room button pressed', {
      mediaType,
      selectedGenres,
      maxParticipants,
      yearRange: { min: minYear, max: maxYear },
      platformIds: selectedPlatforms,
      genreNames: selectedGenres.map(id => currentGenres.find(g => g.id === id)?.name),
      platformNames: selectedPlatforms.map(id => STREAMING_PLATFORMS.find(p => p.id === id)?.name)
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
      yearRange: { min: minYear, max: maxYear },
      platformIds: selectedPlatforms,
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
          yearRange: { min: minYear, max: maxYear },
          platformIds: selectedPlatforms.length > 0 ? selectedPlatforms : undefined,
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
            yearRange: { min: minYear, max: maxYear },
            platformIds: selectedPlatforms.length > 0 ? selectedPlatforms : undefined,
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

        // Navigate directly to VotingRoom without popup
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
      
      {/* Header with Back Button */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={handleBack}
        >
          <Icon name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>Crear Sala</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Progress Indicator */}
      <View style={styles.progressIndicator}>
        <Text style={styles.progressText}>Paso {currentStep} de {TOTAL_STEPS}</Text>
      </View>

      {/* Step Content */}
      <View style={styles.content}>
        {renderCurrentStep()}
      </View>

      {/* Footer with Navigation Buttons */}
      <View style={styles.wizardFooter}>
        {currentStep < TOTAL_STEPS ? (
          <Button
            title="Continuar"
            variant="primary"
            size="large"
            onPress={handleNext}
            disabled={isCreating}
            style={styles.createButton}
          />
        ) : (
          <Button
            title="Crear"
            variant="primary"
            size="large"
            onPress={handleCreateRoom}
            disabled={isCreating}
            loading={isCreating}
            style={styles.createButton}
          />
        )}
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
    paddingHorizontal: 20,
    paddingTop: 5,
    paddingBottom: 5,
    justifyContent: 'center',
  },
  progressIndicator: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: '#2a2a2a',
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
  },
  progressText: {
    fontSize: 14,
    color: '#9333ea',
    fontWeight: '600',
    textAlign: 'center',
  },
  stepContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 10,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 12,
  },
  stepSubtitle: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    marginBottom: 24,
  },
  mediaTypeContainer: {
    width: '100%',
    gap: 12,
  },
  mediaTypeButton: {
    width: '100%',
  },
  genreScrollView: {
    width: '100%',
    maxHeight: '75%',
    paddingBottom: 20,
  },
  summaryScrollView: {
    width: '100%',
    maxHeight: '70%',
  },
  summaryContainer: {
    width: '100%',
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 20,
    gap: 16,
  },
  summaryItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
    paddingBottom: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#888888',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '500',
  },
  wizardFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#333333',
    backgroundColor: '#1a1a1a',
  },
  summaryButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  editButton: {
    flex: 1,
  },
  createButton: {
    width: '100%',
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
  specialGenresRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
    justifyContent: 'center',
  },
  genreSubtitle: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    marginBottom: 16,
  },
  genreChip: {
    minWidth: '30%',
    flexGrow: 1,
  },
  yearRangeContainerFullWidth: {
    width: '100%',
    paddingVertical: 20,
  },
  yearSliderSection: {
    marginBottom: 32,
  },
  yearLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  yearLabelText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
  },
  yearValueText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#9333ea',
  },
  sliderFullWidth: {
    width: '100%',
    height: 40,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#888888',
    marginBottom: 12,
  },
  platformsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
  },
  platformButton: {
    width: 100,
    height: 60,
    borderRadius: 12,
    backgroundColor: '#2a2a2a',
    borderWidth: 2,
    borderColor: '#333333',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  platformButtonSelected: {
    borderColor: '#9333ea',
    backgroundColor: '#3a2a4a',
  },
  platformLogo: {
    width: '100%',
    height: '100%',
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
});