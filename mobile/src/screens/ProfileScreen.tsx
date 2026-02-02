import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  FlatList,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getCurrentUser, signOut, updatePassword } from 'aws-amplify/auth';
import { client, verifyAuthStatus } from '../services/amplify';
import { GET_MATCHES } from '../services/graphql';
import { logger } from '../services/logger';
import { useAuth } from '../context/AuthContext';

interface Match {
  id: string;
  roomId: string;
  movieId: number;
  title: string;
  posterPath?: string;
  timestamp: string;
}

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { onSignOut } = useAuth();
  const [userInfo, setUserInfo] = useState<any>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

  logger.userAction('Screen loaded: Profile');

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      logger.auth('Loading user profile data');
      
      // Get current user info
      const user = await getCurrentUser();
      setUserInfo(user);
      
      logger.auth('User profile loaded', {
        userId: user.userId,
        username: user.username
      });

      // Load user matches
      await loadMatches();
      
    } catch (error) {
      logger.authError('Failed to load user data', error);
      console.error('Error loading user data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMatches = async () => {
    try {
      // Verify authentication status first
      logger.auth('Verifying authentication before loading matches');
      const authStatus = await verifyAuthStatus();
      
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for loading matches', null);
        return;
      }

      logger.auth('Authentication verified for loading matches', {
        userId: authStatus.user?.userId,
        hasTokens: !!authStatus.session?.tokens
      });

      logger.apiRequest('getMatches query');
      
      const response = await client.graphql({
        query: GET_MATCHES,
        authMode: 'userPool', // Explicitly specify auth mode
      });

      const userMatches = response.data.getMyMatches || [];
      setMatches(userMatches);
      
      logger.apiResponse('getMatches query success', {
        matchesCount: userMatches.length,
        matchTitles: userMatches.map((m: Match) => m.title)
      });
      
    } catch (error) {
      logger.apiError('Failed to load matches', error);
      console.error('Error loading matches:', error);
      // Don't show error to user, just log it
    }
  };

  const handleChangePassword = () => {
    logger.userAction('Change password button pressed');
    
    Alert.prompt(
      'Cambiar Contraseña',
      'Ingresa tu contraseña actual:',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Siguiente',
          onPress: (currentPassword) => {
            if (currentPassword) {
              promptNewPassword(currentPassword);
            }
          },
        },
      ],
      'secure-text'
    );
  };

  const promptNewPassword = (currentPassword: string) => {
    Alert.prompt(
      'Nueva Contraseña',
      'Ingresa tu nueva contraseña (mínimo 8 caracteres):',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cambiar',
          onPress: async (newPassword) => {
            if (newPassword && newPassword.length >= 8) {
              await changePassword(currentPassword, newPassword);
            } else {
              Alert.alert('Error', 'La contraseña debe tener al menos 8 caracteres');
            }
          },
        },
      ],
      'secure-text'
    );
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    try {
      logger.auth('Password change attempt started');
      
      await updatePassword({
        oldPassword: currentPassword,
        newPassword: newPassword,
      });
      
      logger.auth('Password changed successfully');
      Alert.alert('Éxito', 'Contraseña cambiada correctamente');
      
    } catch (error) {
      logger.authError('Password change failed', error);
      console.error('Error changing password:', error);
      Alert.alert('Error', 'No se pudo cambiar la contraseña. Verifica tu contraseña actual.');
    }
  };

  const handleSignOut = async () => {
    logger.userAction('Sign out button pressed');
    
    Alert.alert(
      'Cerrar Sesión',
      '¿Estás seguro que quieres cerrar sesión?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar Sesión',
          style: 'destructive',
          onPress: async () => {
            setIsSigningOut(true);
            
            try {
              logger.auth('Sign out attempt started');
              await signOut();
              logger.auth('Sign out successful');
              onSignOut();
            } catch (error) {
              logger.authError('Sign out failed', error);
              console.error('Error signing out:', error);
              Alert.alert('Error', 'No se pudo cerrar sesión');
            } finally {
              setIsSigningOut(false);
            }
          },
        },
      ]
    );
  };

  const renderMatchItem = ({ item }: { item: Match }) => (
    <TouchableOpacity style={styles.matchItem}>
      {item.posterPath && (
        <Image
          source={{ uri: `https://image.tmdb.org/t/p/w200${item.posterPath}` }}
          style={styles.matchPoster}
          resizeMode="cover"
        />
      )}
      <View style={styles.matchInfo}>
        <Text style={styles.matchTitle}>{item.title}</Text>
        <Text style={styles.matchDate}>
          {new Date(item.timestamp).toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyMatches = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyIcon}>💔</Text>
      <Text style={styles.emptyTitle}>No tienes matches aún</Text>
      <Text style={styles.emptyDescription}>
        Únete a salas y vota películas para encontrar matches con otros usuarios
      </Text>
    </View>
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.loadingText}>Cargando perfil...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            logger.navigation('Back to Dashboard from Profile');
            navigation.goBack();
          }}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>MI PERFIL</Text>
        <View style={styles.placeholder} />
      </View>

      {/* User Info */}
      <View style={styles.userInfoContainer}>
        <View style={styles.avatarContainer}>
          <Text style={styles.avatarText}>
            {userInfo?.username?.charAt(0)?.toUpperCase() || 'U'}
          </Text>
        </View>
        <Text style={styles.userEmail}>{userInfo?.username || 'Usuario'}</Text>
      </View>

      {/* Matches Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Mis Matches ({matches.length})
        </Text>
        
        {matches.length > 0 ? (
          <FlatList
            data={matches}
            renderItem={renderMatchItem}
            keyExtractor={(item) => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.matchesList}
          />
        ) : (
          renderEmptyMatches()
        )}
      </View>

      {/* Action Buttons */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity
          style={[styles.actionButton, styles.changePasswordButton]}
          onPress={handleChangePassword}
        >
          <Text style={styles.actionButtonText}>🔒 CAMBIAR CONTRASEÑA</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.signOutButton]}
          onPress={handleSignOut}
          disabled={isSigningOut}
        >
          {isSigningOut ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.signOutButtonText}>🚪 CERRAR SESIÓN</Text>
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
  userInfoContainer: {
    alignItems: 'center',
    paddingVertical: 30,
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  userEmail: {
    fontSize: 16,
    color: '#cccccc',
  },
  section: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 15,
  },
  matchesList: {
    paddingBottom: 20,
  },
  matchItem: {
    flexDirection: 'row',
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
    alignItems: 'center',
  },
  matchPoster: {
    width: 50,
    height: 75,
    borderRadius: 8,
    marginRight: 15,
    backgroundColor: '#333333',
  },
  matchInfo: {
    flex: 1,
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 5,
  },
  matchDate: {
    fontSize: 14,
    color: '#888888',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyIcon: {
    fontSize: 60,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 10,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 20,
  },
  actionsContainer: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: '#333333',
    gap: 15,
  },
  actionButton: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  changePasswordButton: {
    backgroundColor: '#2196F3',
  },
  signOutButton: {
    backgroundColor: '#f44336',
  },
  actionButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1,
  },
  signOutButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1,
  },
});