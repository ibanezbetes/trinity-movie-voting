import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
  Switch,
  Modal,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getCurrentUser, signOut, deleteUser } from 'aws-amplify/auth';
import { logger } from '../services/logger';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSound } from '../context/SoundContext';

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
  const { isDarkMode, toggleTheme, colors } = useTheme();
  const { isMuted, toggleSound } = useSound();
  const [userInfo, setUserInfo] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  
  // Modal state
  const [showAboutModal, setShowAboutModal] = useState(false);

  logger.userAction('Screen loaded: Profile');

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      logger.auth('Loading user profile data');
      
      const user = await getCurrentUser();
      setUserInfo(user);
      
      logger.auth('User profile loaded', {
        userId: user.userId,
        username: user.username
      });
      
    } catch (error) {
      logger.authError('Failed to load user data', error);
      console.error('Error loading user data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = () => {
    logger.userAction('Change password button pressed');
    console.log('Navigate to change password screen');
    Alert.alert('Cambiar Contraseña', 'Funcionalidad próximamente disponible');
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

  const handleDeleteAccount = () => {
    logger.userAction('Delete account button pressed');
    
    Alert.alert(
      'Eliminar Cuenta',
      '¿Estás seguro? Esta acción es irreversible y eliminará todos tus datos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setIsDeletingAccount(true);
            
            try {
              logger.auth('Delete account attempt started');
              
              // Delete user from Cognito
              await deleteUser();
              
              logger.auth('Account deleted successfully');
              Alert.alert(
                'Cuenta Eliminada',
                'Tu cuenta ha sido eliminada exitosamente.',
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      onSignOut();
                    },
                  },
                ]
              );
            } catch (error) {
              logger.authError('Account deletion failed', error);
              console.error('Error deleting account:', error);
              Alert.alert(
                'Error',
                'No se pudo eliminar la cuenta. Por favor, intenta de nuevo más tarde.'
              );
            } finally {
              setIsDeletingAccount(false);
            }
          },
        },
      ]
    );
  };

  const handleOpenURL = (url: string, label: string) => {
    logger.userAction(`Opening external link: ${label}`);
    Linking.openURL(url).catch(err => {
      console.error('Failed to open URL:', err);
      Alert.alert('Error', 'No se pudo abrir el enlace');
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
            Cargando perfil...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* SECCIÓN 1: CABECERA (Header) */}
        <View style={[styles.headerSection, { backgroundColor: colors.surface }]}>
          <View style={styles.profileImageContainer}>
            {userInfo?.photoURL ? (
              <Image 
                source={{ uri: userInfo.photoURL }} 
                style={styles.profileImage}
              />
            ) : (
              <View style={[styles.profilePlaceholder, { backgroundColor: colors.primary }]}>
                <Text style={styles.profilePlaceholderText}>
                  {userInfo?.username?.charAt(0)?.toUpperCase() || 'U'}
                </Text>
              </View>
            )}
          </View>
          
          <Text style={[styles.userName, { color: colors.text }]}>
            {userInfo?.username || 'Usuario'}
          </Text>
          
          <TouchableOpacity 
            style={styles.changePasswordLink}
            onPress={handleChangePassword}
          >
            <Text style={[styles.changePasswordText, { color: colors.primary }]}>
              Cambiar contraseña
            </Text>
          </TouchableOpacity>
        </View>

        {/* SECCIÓN 2: ACTIVIDAD */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ACTIVIDAD</Text>
          
          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={() => {
              logger.navigation('Navigate to MyMatches from Profile');
              navigation.navigate('MyMatches' as never);
            }}
          >
            <Text style={styles.menuItemIcon}>🎬</Text>
            <Text style={[styles.menuItemText, { color: colors.text }]}>Mis Matches</Text>
            <Text style={styles.menuItemArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* SECCIÓN 3: PREFERENCIAS */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>PREFERENCIAS</Text>
          
          <View style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <Text style={styles.menuItemIcon}>🌙</Text>
            <Text style={[styles.menuItemText, { color: colors.text }]}>Tema Oscuro</Text>
            <Switch
              value={isDarkMode}
              onValueChange={toggleTheme}
              trackColor={{ false: '#767577', true: colors.primary }}
              thumbColor={isDarkMode ? '#ffffff' : '#f4f3f4'}
            />
          </View>

          <View style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <Text style={styles.menuItemIcon}>🔇</Text>
            <Text style={[styles.menuItemText, { color: colors.text }]}>Silenciar Sonidos</Text>
            <Switch
              value={isMuted}
              onValueChange={toggleSound}
              trackColor={{ false: '#767577', true: colors.primary }}
              thumbColor={isMuted ? '#ffffff' : '#f4f3f4'}
            />
          </View>
        </View>

        {/* SECCIÓN 4: SOPORTE */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SOPORTE</Text>
          
          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={() => handleOpenURL('https://google.com', 'Ayuda / FAQs')}
          >
            <Text style={styles.menuItemIcon}>❓</Text>
            <Text style={[styles.menuItemText, { color: colors.text }]}>Ayuda / FAQs</Text>
            <Text style={styles.menuItemArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={() => handleOpenURL('https://google.com', 'Valorar App')}
          >
            <Text style={styles.menuItemIcon}>⭐</Text>
            <Text style={[styles.menuItemText, { color: colors.text }]}>Valorar App</Text>
            <Text style={styles.menuItemArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* SECCIÓN 5: INFORMACIÓN */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>INFORMACIÓN</Text>
          
          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={() => setShowAboutModal(true)}
          >
            <Text style={styles.menuItemIcon}>ℹ️</Text>
            <Text style={[styles.menuItemText, { color: colors.text }]}>Sobre Trinity</Text>
            <Text style={styles.menuItemArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* SECCIÓN 6: ZONA DE PELIGRO */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>CUENTA</Text>
          
          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={handleSignOut}
            disabled={isSigningOut}
          >
            <Text style={styles.menuItemIcon}>🚪</Text>
            <Text style={[styles.menuItemText, { color: colors.text }]}>Cerrar Sesión</Text>
            {isSigningOut ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.menuItemArrow}>›</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={handleDeleteAccount}
            disabled={isDeletingAccount}
          >
            <Text style={styles.menuItemIcon}>⚠️</Text>
            <Text style={[styles.menuItemText, styles.dangerText]}>Eliminar Cuenta</Text>
            {isDeletingAccount ? (
              <ActivityIndicator size="small" color="#f44336" />
            ) : (
              <Text style={styles.menuItemArrow}>›</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Modal "Sobre Trinity" */}
      <Modal
        visible={showAboutModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAboutModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <ScrollView 
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              {/* Logo de la App */}
              <View style={styles.modalLogoContainer}>
                <View style={[styles.modalAppLogo, { backgroundColor: colors.primary }]}>
                  <Text style={styles.modalAppLogoText}>🎬</Text>
                </View>
                <Text style={[styles.modalAppName, { color: colors.text }]}>Trinity</Text>
              </View>

              {/* Versión */}
              <Text style={[styles.modalVersion, { color: colors.textSecondary }]}>
                Versión 1.0.0
              </Text>

              {/* Separador */}
              <View style={[styles.modalDivider, { backgroundColor: colors.border }]} />

              {/* Logo TMDB y texto legal */}
              <View style={styles.tmdbSection}>
                <View style={styles.tmdbLogoContainer}>
                  <Text style={styles.tmdbLogoText}>TMDB</Text>
                </View>
                <Text style={[styles.tmdbLegalText, { color: colors.textSecondary }]}>
                  This product uses the TMDB API but is not endorsed or certified by TMDB.
                </Text>
              </View>

              {/* Separador */}
              <View style={[styles.modalDivider, { backgroundColor: colors.border }]} />

              {/* Links legales */}
              <View style={styles.legalLinksContainer}>
                <TouchableOpacity 
                  style={styles.legalLink}
                  onPress={() => handleOpenURL('https://google.com', 'Política de Privacidad')}
                >
                  <Text style={[styles.legalLinkText, { color: colors.primary }]}>
                    Política de Privacidad
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.legalLink}
                  onPress={() => handleOpenURL('https://google.com', 'Términos de Uso')}
                >
                  <Text style={[styles.legalLinkText, { color: colors.primary }]}>
                    Términos de Uso
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Botón Cerrar */}
              <TouchableOpacity 
                style={[styles.modalCloseButton, { backgroundColor: colors.primary }]}
                onPress={() => setShowAboutModal(false)}
              >
                <Text style={styles.modalCloseButtonText}>Cerrar</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 16,
    marginTop: 20,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  
  // SECCIÓN 1: CABECERA
  headerSection: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  profileImageContainer: {
    marginBottom: 15,
  },
  profileImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  profilePlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePlaceholderText: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  userName: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 8,
  },
  changePasswordLink: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  changePasswordText: {
    fontSize: 14,
    fontWeight: '500',
  },
  
  // SECCIONES
  section: {
    marginBottom: 20,
    paddingVertical: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888888',
    letterSpacing: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#f5f5f5',
  },
  
  // ITEMS DE MENÚ
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  menuItemIcon: {
    fontSize: 22,
    marginRight: 15,
    width: 30,
  },
  menuItemText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  menuItemArrow: {
    fontSize: 24,
    color: '#cccccc',
    fontWeight: '300',
  },
  dangerText: {
    color: '#f44336',
  },
  
  // MODAL
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    borderRadius: 20,
    width: '100%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalScrollContent: {
    padding: 30,
    alignItems: 'center',
  },
  modalLogoContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  modalAppLogo: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  modalAppLogoText: {
    fontSize: 40,
  },
  modalAppName: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  modalVersion: {
    fontSize: 16,
    marginBottom: 20,
  },
  modalDivider: {
    width: '100%',
    height: 1,
    marginVertical: 20,
  },
  tmdbSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  tmdbLogoContainer: {
    backgroundColor: '#01b4e4',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 15,
  },
  tmdbLogoText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 2,
  },
  tmdbLegalText: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: 10,
  },
  legalLinksContainer: {
    width: '100%',
    marginBottom: 20,
  },
  legalLink: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  legalLinkText: {
    fontSize: 14,
    fontWeight: '500',
  },
  modalCloseButton: {
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 25,
    marginTop: 10,
  },
  modalCloseButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  
  bottomSpacer: {
    height: 40,
  },
});