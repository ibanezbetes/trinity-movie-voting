import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { client, verifyAuthStatus } from '../services/amplify';
import { JOIN_ROOM } from '../services/graphql';
import { logger } from '../services/logger';
import { CustomAlert } from '../components';

type JoinRoomNavigationProp = StackNavigationProp<RootStackParamList, 'JoinRoom'>;

export default function JoinRoomScreen() {
  const navigation = useNavigation<JoinRoomNavigationProp>();
  const [roomCode, setRoomCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
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

  logger.userAction('Screen loaded: JoinRoom');

  const handleJoinRoom = async () => {
    logger.userAction('Join room button pressed', { roomCode });

    if (roomCode.length !== 6) {
      logger.userAction('Join room blocked - invalid code length', { 
        roomCode, 
        length: roomCode.length,
        required: 6 
      });
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'El código debe tener 6 caracteres',
        buttons: [{ text: 'OK' }]
      });
      return;
    }
    
    setIsJoining(true);
    logger.room('Starting room join process', {
      roomCode,
      timestamp: new Date().toISOString()
    });
    
    try {
      // Verify authentication status first
      logger.auth('Verifying authentication before room join');
      const authStatus = await verifyAuthStatus();
      
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for room join', null);
        setAlertConfig({
          visible: true,
          title: 'Error de Autenticación',
          message: 'Por favor inicia sesión nuevamente',
          buttons: [{ text: 'OK' }]
        });
        return;
      }

      logger.auth('Authentication verified for room join', {
        userId: authStatus.user?.userId,
        hasTokens: !!authStatus.session?.tokens
      });

      logger.apiRequest('joinRoom mutation', { code: roomCode });

      const response = await client.graphql({
        query: JOIN_ROOM,
        variables: {
          code: roomCode,
        },
        authMode: 'userPool', // Explicitly specify auth mode
      });

      logger.apiResponse('joinRoom mutation success', {
        roomId: response.data.joinRoom?.id,
        roomCode: response.data.joinRoom?.code,
        candidatesCount: response.data.joinRoom?.candidates?.length || 0
      });

      const room = response.data.joinRoom;
      
      if (room) {
        logger.room('Room joined successfully', {
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
        logger.roomError('Room join failed - no room data returned', null, response);
        setAlertConfig({
          visible: true,
          title: 'Error',
          message: 'Sala no encontrada. Verifica el código.',
          buttons: [{ text: 'OK' }]
        });
      }
    } catch (error: any) {
      logger.roomError('Room join failed', error, {
        roomCode,
        timestamp: new Date().toISOString()
      });
      console.error('Error joining room:', error);
      
      // Check for specific error messages
      const errorMessage = error?.errors?.[0]?.message || error?.message || 'Error desconocido';
      
      if (errorMessage.includes('está llena')) {
        setAlertConfig({
          visible: true,
          title: 'Sala Llena',
          message: 'Esta sala ya tiene el máximo de participantes permitidos.',
          buttons: [{ text: 'OK' }]
        });
      } else if (errorMessage.includes('not found')) {
        setAlertConfig({
          visible: true,
          title: 'Error',
          message: 'Sala no encontrada. Verifica el código.',
          buttons: [{ text: 'OK' }]
        });
      } else if (errorMessage.includes('expired')) {
        setAlertConfig({
          visible: true,
          title: 'Error',
          message: 'Esta sala ha expirado.',
          buttons: [{ text: 'OK' }]
        });
      } else {
        setAlertConfig({
          visible: true,
          title: 'Error',
          message: 'No se pudo unir a la sala. Inténtalo de nuevo.',
          buttons: [{ text: 'OK' }]
        });
      }
    } finally {
      setIsJoining(false);
      logger.room('Room join process completed', { isJoining: false });
    }
  };

  const handleCodeChange = (text: string) => {
    // Convert to uppercase and limit to 6 characters
    const formattedCode = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setRoomCode(formattedCode);
    
    logger.ui('Room code input changed', {
      originalInput: text,
      formattedCode,
      length: formattedCode.length,
      isValid: formattedCode.length === 6
    });
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
        <Text style={styles.title}>UNIRSE A SALA</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content with KeyboardAvoidingView */}
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <View style={styles.inputSection}>
          <Text style={styles.label}>Código de Sala</Text>
          <Text style={styles.description}>
            Ingresa el código de 6 caracteres que te compartieron
          </Text>
          
          <TextInput
            style={styles.codeInput}
            value={roomCode}
            onChangeText={handleCodeChange}
            placeholder="ABC123"
            placeholderTextColor="#666666"
            maxLength={6}
            autoCapitalize="characters"
            autoCorrect={false}
            textAlign="center"
            fontSize={24}
            fontWeight="bold"
            letterSpacing={4}
          />
          
          <View style={styles.codeIndicator}>
            {Array.from({ length: 6 }).map((_, index) => (
              <View
                key={index}
                style={[
                  styles.codeBox,
                  index < roomCode.length && styles.codeBoxFilled
                ]}
              >
                <Text style={styles.codeBoxText}>
                  {roomCode[index] || ''}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Join Button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.joinButton, (roomCode.length !== 6 || isJoining) && styles.joinButtonDisabled]}
          onPress={handleJoinRoom}
          disabled={roomCode.length !== 6 || isJoining}
        >
          {isJoining ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.joinButtonText}>UNIRSE A LA SALA</Text>
          )}
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
    justifyContent: 'flex-start',
    padding: 20,
    paddingTop: 60,
  },
  inputSection: {
    alignItems: 'center',
  },
  label: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 10,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: '#888888',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 22,
  },
  codeInput: {
    width: '100%',
    height: 80,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#333333',
    color: '#ffffff',
    marginBottom: 20,
  },
  codeIndicator: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  codeBox: {
    width: 40,
    height: 50,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#333333',
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxFilled: {
    borderColor: '#9333ea',
    backgroundColor: '#9333ea',
  },
  codeBoxText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#333333',
  },
  joinButton: {
    backgroundColor: '#9333ea',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
  },
  joinButtonDisabled: {
    backgroundColor: '#333333',
  },
  joinButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1,
  },
});