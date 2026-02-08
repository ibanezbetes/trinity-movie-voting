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
import { Typography, Button, AppTabBar, Icon } from '../components';

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
  const { colors } = useTheme();
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
          
          <Typography variant="h2" style={styles.userName}>
            {userInfo?.username || 'Usuario'}
          </Typography>
          
          <TouchableOpacity 
            style={styles.changePasswordLink}
            onPress={handleChangePassword}
          >
            <Typography variant="caption" style={[styles.changePasswordText, { color: colors.primary }]}>
              Cambiar contraseña
            </Typography>
          </TouchableOpacity>
        </View>

        {/* SECCIÓN 2: ACTIVIDAD */}
        <View style={styles.section}>
          <Typography variant="label" style={styles.sectionLabel}>ACTIVIDAD</Typography>
          
          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={() => {
              logger.navigation('Navigate to MyMatches from Profile');
              navigation.navigate('MyMatches' as never);
            }}
          >
            <Icon name="film" size={22} color={colors.text} />
            <Typography variant="body" style={[styles.menuItemText, { color: colors.text }]}>
              Mis Matches
            </Typography>
            <Icon name="arrow-forward" size={20} color="#cccccc" />
          </TouchableOpacity>
        </View>

        {/* SECCIÓN 3: PREFERENCIAS */}
        <View style={styles.section}>
          <Typography variant="label" style={styles.sectionLabel}>PREFERENCIAS</Typography>
          
          <View style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <Icon name={isMuted ? 'volume-mute' : 'volume-high'} size={22} color={colors.text} />
            <Typography variant="body" style={[styles.menuItemText, { color: colors.text }]}>
              Silenciar Sonidos
            </Typography>
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
          <Typography variant="label" style={styles.sectionLabel}>SOPORTE</Typography>
          
          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={() => handleOpenURL('https://google.com', 'Ayuda / FAQs')}
          >
            <Icon name="help-circle" size={22} color={colors.text} />
            <Typography variant="body" style={[styles.menuItemText, { color: colors.text }]}>
              Ayuda / FAQs
            </Typography>
            <Icon name="arrow-forward" size={20} color="#cccccc" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={() => handleOpenURL('https://google.com', 'Valorar App')}
          >
            <Icon name="star" size={22} color={colors.text} />
            <Typography variant="body" style={[styles.menuItemText, { color: colors.text }]}>
              Valorar App
            </Typography>
            <Icon name="arrow-forward" size={20} color="#cccccc" />
          </TouchableOpacity>
        </View>

        {/* SECCIÓN 5: INFORMACIÓN */}
        <View style={styles.section}>
          <Typography variant="label" style={styles.sectionLabel}>INFORMACIÓN</Typography>
          
          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={() => setShowAboutModal(true)}
          >
            <Icon name="information-circle" size={22} color={colors.text} />
            <Typography variant="body" style={[styles.menuItemText, { color: colors.text }]}>
              Sobre Trinity
            </Typography>
            <Icon name="arrow-forward" size={20} color="#cccccc" />
          </TouchableOpacity>
        </View>

        {/* SECCIÓN 6: ZONA DE PELIGRO */}
        <View style={styles.section}>
          <Typography variant="label" style={styles.sectionLabel}>CUENTA</Typography>
          
          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={handleSignOut}
            disabled={isSigningOut}
          >
            <Icon name="exit" size={22} color={colors.text} />
            <Typography variant="body" style={[styles.menuItemText, { color: colors.text }]}>
              Cerrar Sesión
            </Typography>
            {isSigningOut ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon name="arrow-forward" size={20} color="#cccccc" />
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={handleDeleteAccount}
            disabled={isDeletingAccount}
          >
            <Icon name="warning" size={22} color="#ef4444" />
            <Typography variant="body" style={[styles.menuItemText, styles.dangerText]}>
              Eliminar Cuenta
            </Typography>
            {isDeletingAccount ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <Icon name="arrow-forward" size={20} color="#cccccc" />
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
                  <Text style={styles.modalAppLogoText}>T</Text>
                </View>
                <Typography variant="h1" style={styles.modalAppName}>Trinity</Typography>
              </View>

              {/* Versión */}
              <Typography variant="caption" style={styles.modalVersion}>
                Versión 2.2.2
              </Typography>

              {/* Separador */}
              <View style={[styles.modalDivider, { backgroundColor: colors.border }]} />

              {/* Logo TMDB y texto legal */}
              <View style={styles.tmdbSection}>
                <View style={styles.tmdbLogoContainer}>
                  <Text style={styles.tmdbLogoText}>TMDB</Text>
                </View>
                <Typography variant="caption" style={[styles.tmdbLegalText, { color: colors.textSecondary }]}>
                  This product uses the TMDB API but is not endorsed or certified by TMDB.
                </Typography>
              </View>

              {/* Separador */}
              <View style={[styles.modalDivider, { backgroundColor: colors.border }]} />

              {/* Links legales */}
              <View style={styles.legalLinksContainer}>
                <TouchableOpacity 
                  style={styles.legalLink}
                  onPress={() => handleOpenURL('https://google.com', 'Política de Privacidad')}
                >
                  <Typography variant="body" style={[styles.legalLinkText, { color: colors.primary }]}>
                    Política de Privacidad
                  </Typography>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.legalLink}
                  onPress={() => handleOpenURL('https://google.com', 'Términos de Uso')}
                >
                  <Typography variant="body" style={[styles.legalLinkText, { color: colors.primary }]}>
                    Términos de Uso
                  </Typography>
                </TouchableOpacity>
              </View>

              {/* Botón Cerrar */}
              <Button
                title="Cerrar"
                variant="primary"
                size="large"
                onPress={() => setShowAboutModal(false)}
                style={styles.modalCloseButton}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Floating Tab Bar */}
      <AppTabBar activeTab="profile" />
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
    paddingBottom: 100, // Space for floating tab bar
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
    gap: 15,
  },
  menuItemText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  dangerText: {
    color: '#ef4444',
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
    fontWeight: 'bold',
    color: '#ffffff',
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