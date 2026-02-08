import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Image,
  Switch,
  Modal,
  Linking,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getCurrentUser, signOut, deleteUser, fetchUserAttributes, updatePassword } from 'aws-amplify/auth';
import { logger } from '../services/logger';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useSound } from '../context/SoundContext';
import { Typography, Button, AppTabBar, Icon, ChinIcon, CustomAlert } from '../components';
import Svg, { Defs, LinearGradient, Stop, G, Path } from 'react-native-svg';

interface Match {
  id: string;
  roomId: string;
  movieId: number;
  title: string;
  posterPath?: string;
  timestamp: string;
}

// TMDB Logo Component
const TMDBLogo = ({ width = 120, height = 40 }: { width?: number; height?: number }) => (
  <Svg width={width} height={height} viewBox="0 0 185.04 133.4">
    <Defs>
      <LinearGradient id="linear-gradient" x1="0" y1="66.7" x2="185.04" y2="66.7" gradientUnits="userSpaceOnUse">
        <Stop offset="0" stopColor="#90cea1" />
        <Stop offset="0.56" stopColor="#3cbec9" />
        <Stop offset="1" stopColor="#00b3e5" />
      </LinearGradient>
    </Defs>
    <G>
      <G>
        <Path
          fill="url(#linear-gradient)"
          d="M51.06,66.7h0A17.67,17.67,0,0,1,68.73,49h-.1A17.67,17.67,0,0,1,86.3,66.7h0A17.67,17.67,0,0,1,68.63,84.37h.1A17.67,17.67,0,0,1,51.06,66.7Zm82.67-31.33h32.9A17.67,17.67,0,0,0,184.3,17.7h0A17.67,17.67,0,0,0,166.63,0h-32.9A17.67,17.67,0,0,0,116.06,17.7h0A17.67,17.67,0,0,0,133.73,35.37Zm-113,98h63.9A17.67,17.67,0,0,0,102.3,115.7h0A17.67,17.67,0,0,0,84.63,98H20.73A17.67,17.67,0,0,0,3.06,115.7h0A17.67,17.67,0,0,0,20.73,133.37Zm83.92-49h6.25L125.5,49h-8.35l-8.9,23.2h-.1L99.4,49H90.5Zm32.45,0h7.8V49h-7.8Zm22.2,0h24.95V77.2H167.1V70h15.35V62.8H167.1V56.2h16.25V49h-24ZM10.1,35.4h7.8V6.9H28V0H0V6.9H10.1ZM39,35.4h7.8V20.1H61.9V35.4h7.8V0H61.9V13.2H46.75V0H39Zm41.25,0h25V28.2H88V21h15.35V13.8H88V7.2h16.25V0h-24Zm-79,49H9V57.25h.1l9,27.15H24l9.3-27.15h.1V84.4h7.8V49H29.45l-8.2,23.1h-.1L13,49H1.2Zm112.09,49H126a24.59,24.59,0,0,0,7.56-1.15,19.52,19.52,0,0,0,6.35-3.37,16.37,16.37,0,0,0,4.37-5.5A16.91,16.91,0,0,0,146,115.8a18.5,18.5,0,0,0-1.68-8.25,15.1,15.1,0,0,0-4.52-5.53A18.55,18.55,0,0,0,133.07,99,33.54,33.54,0,0,0,125,98H113.29Zm7.81-28.2h4.6a17.43,17.43,0,0,1,4.67.62,11.68,11.68,0,0,1,3.88,1.88,9,9,0,0,1,2.62,3.18,9.87,9.87,0,0,1,1,4.52,11.92,11.92,0,0,1-1,5.08,8.69,8.69,0,0,1-2.67,3.34,10.87,10.87,0,0,1-4,1.83,21.57,21.57,0,0,1-5,.55H121.1Zm36.14,28.2h14.5a23.11,23.11,0,0,0,4.73-.5,13.38,13.38,0,0,0,4.27-1.65,9.42,9.42,0,0,0,3.1-3,8.52,8.52,0,0,0,1.2-4.68,9.16,9.16,0,0,0-.55-3.2,7.79,7.79,0,0,0-1.57-2.62,8.38,8.38,0,0,0-2.45-1.85,10,10,0,0,0-3.18-1v-.1a9.28,9.28,0,0,0,4.43-2.82,7.42,7.42,0,0,0,1.67-5,8.34,8.34,0,0,0-1.15-4.65,7.88,7.88,0,0,0-3-2.73,12.9,12.9,0,0,0-4.17-1.3,34.42,34.42,0,0,0-4.63-.32h-13.2Zm7.8-28.8h5.3a10.79,10.79,0,0,1,1.85.17,5.77,5.77,0,0,1,1.7.58,3.33,3.33,0,0,1,1.23,1.13,3.22,3.22,0,0,1,.47,1.82,3.63,3.63,0,0,1-.42,1.8,3.34,3.34,0,0,1-1.13,1.2,4.78,4.78,0,0,1-1.57.65,8.16,8.16,0,0,1-1.78.2H165Zm0,14.15h5.9a15.12,15.12,0,0,1,2.05.15,7.83,7.83,0,0,1,2,.55,4,4,0,0,1,1.58,1.17,3.13,3.13,0,0,1,.62,2,3.71,3.71,0,0,1-.47,1.95,4,4,0,0,1-1.23,1.3,4.78,4.78,0,0,1-1.67.7,8.91,8.91,0,0,1-1.83.2h-7Z"
        />
      </G>
    </G>
  </Svg>
);

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { onSignOut } = useAuth();
  const { colors } = useTheme();
  const { isMuted, toggleSound, playSound } = useSound();
  const [userName, setUserName] = useState('Usuario');
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  
  // Modal state
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  
  // Change password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  
  // Custom Alert state
  const [alertConfig, setAlertConfig] = useState<{
    visible: boolean;
    title: string;
    message?: string;
    buttons?: Array<{
      text: string;
      onPress?: () => void;
      style?: 'default' | 'cancel' | 'destructive';
    }>;
  }>({
    visible: false,
    title: '',
    message: '',
    buttons: [],
  });

  logger.userAction('Screen loaded: Profile');

  const showAlert = (
    title: string,
    message?: string,
    buttons?: Array<{
      text: string;
      onPress?: () => void;
      style?: 'default' | 'cancel' | 'destructive';
    }>
  ) => {
    setAlertConfig({
      visible: true,
      title,
      message,
      buttons: buttons || [{ text: 'OK', style: 'default' }],
    });
  };

  const hideAlert = () => {
    setAlertConfig({ ...alertConfig, visible: false });
  };

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      logger.auth('Loading user profile data');
      
      const user = await getCurrentUser();
      
      // Get preferred_username from user attributes
      const attributes = await fetchUserAttributes();
      const displayName = attributes.preferred_username || user.username || 'Usuario';
      setUserName(displayName);
      
      logger.auth('User profile loaded', {
        userId: user.userId,
        username: displayName
      });
      
    } catch (error) {
      logger.authError('Failed to load user data', error);
      console.error('Error loading user data:', error);
      setUserName('Usuario');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = () => {
    logger.userAction('Change password button pressed');
    setShowChangePasswordModal(true);
  };

  const handleSubmitPasswordChange = async () => {
    // Validaciones
    if (!currentPassword || !newPassword || !confirmPassword) {
      showAlert('Error', 'Por favor completa todos los campos');
      return;
    }

    if (newPassword !== confirmPassword) {
      showAlert('Error', 'Las contraseñas nuevas no coinciden');
      return;
    }

    if (newPassword.length < 8) {
      showAlert('Error', 'La nueva contraseña debe tener al menos 8 caracteres');
      return;
    }

    // Validar requisitos de contraseña
    const hasUpperCase = /[A-Z]/.test(newPassword);
    const hasLowerCase = /[a-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);

    if (!hasUpperCase || !hasLowerCase || !hasNumber) {
      showAlert(
        'Error',
        'La contraseña debe contener:\n• Mayúsculas\n• Minúsculas\n• Números'
      );
      return;
    }

    setIsChangingPassword(true);

    try {
      logger.auth('Password change attempt started');
      
      await updatePassword({
        oldPassword: currentPassword,
        newPassword: newPassword,
      });

      logger.auth('Password changed successfully');
      
      // Limpiar formulario
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowChangePasswordModal(false);

      showAlert(
        'Contraseña Actualizada',
        'Tu contraseña se ha cambiado correctamente'
      );
    } catch (error: any) {
      logger.authError('Password change failed', error);
      console.error('Error changing password:', error);
      
      let errorMessage = 'No se pudo cambiar la contraseña';
      
      if (error.name === 'NotAuthorizedException') {
        errorMessage = 'La contraseña actual es incorrecta';
      } else if (error.name === 'InvalidPasswordException') {
        errorMessage = 'La nueva contraseña no cumple con los requisitos';
      } else if (error.name === 'LimitExceededException') {
        errorMessage = 'Demasiados intentos. Por favor, intenta más tarde';
      }
      
      showAlert('Error', errorMessage);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSignOut = async () => {
    logger.userAction('Sign out button pressed');
    
    showAlert(
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
              showAlert('Error', 'No se pudo cerrar sesión');
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
    
    showAlert(
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
              showAlert(
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
              showAlert(
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
      showAlert('Error', 'No se pudo abrir el enlace');
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
            <View style={[styles.profilePlaceholder, { backgroundColor: '#9333ea' }]}>
              <Icon name="person" size={50} color="#ffffff" />
            </View>
          </View>
          
          <Typography variant="h2" style={styles.userName}>
            {userName}
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
          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={() => {
              logger.navigation('Navigate to MyRooms from Profile');
              navigation.navigate('MyRooms' as never);
            }}
          >
            <Icon name="film" size={22} color={colors.text} />
            <Typography variant="body" style={[styles.menuItemText, { color: colors.text }]}>
              Salas
            </Typography>
            <Icon name="arrow-forward" size={20} color="#cccccc" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
            onPress={() => {
              logger.navigation('Navigate to MyMatches from Profile');
              navigation.navigate('MyMatches' as never);
            }}
          >
            <ChinIcon size={22} color={colors.text} />
            <Typography variant="body" style={[styles.menuItemText, { color: colors.text }]}>
              Chines
            </Typography>
            <Icon name="arrow-forward" size={20} color="#cccccc" />
          </TouchableOpacity>
        </View>

        {/* SECCIÓN 3: PREFERENCIAS */}
        <View style={styles.section}>
          <View style={[styles.menuItem, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
            <Icon name={isMuted ? 'volume-mute' : 'volume-high'} size={22} color={colors.text} />
            <Typography variant="body" style={[styles.menuItemText, { color: colors.text }]}>
              Sonido
            </Typography>
            <Switch
              value={!isMuted}
              onValueChange={toggleSound}
              trackColor={{ false: '#767577', true: colors.primary }}
              thumbColor={!isMuted ? '#ffffff' : '#f4f3f4'}
            />
          </View>

          {/* Botones de prueba de sonido */}
          {!isMuted && (
            <View style={styles.soundTestContainer}>
              <Typography variant="caption" style={[styles.soundTestTitle, { color: colors.textSecondary }]}>
                Probar sonidos:
              </Typography>
              <View style={styles.soundTestButtons}>
                <TouchableOpacity
                  style={[styles.soundTestButton, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    logger.info('SOUND', 'Testing votoSi sound');
                    playSound('votoSi');
                  }}
                >
                  <Typography variant="caption" style={styles.soundTestButtonText}>
                    Voto Sí
                  </Typography>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.soundTestButton, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    logger.info('SOUND', 'Testing votoNo sound');
                    playSound('votoNo');
                  }}
                >
                  <Typography variant="caption" style={styles.soundTestButtonText}>
                    Voto No
                  </Typography>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.soundTestButton, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    logger.info('SOUND', 'Testing chin sound');
                    playSound('chin');
                  }}
                >
                  <Typography variant="caption" style={styles.soundTestButtonText}>
                    Chin
                  </Typography>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.soundTestButton, { backgroundColor: colors.primary }]}
                  onPress={() => {
                    logger.info('SOUND', 'Testing inicioApp sound');
                    playSound('inicioApp');
                  }}
                >
                  <Typography variant="caption" style={styles.soundTestButtonText}>
                    Inicio
                  </Typography>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* SECCIÓN 4: SOPORTE */}
        <View style={styles.section}>
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
            onPress={() => handleOpenURL('https://google.com', 'Valorar')}
          >
            <Icon name="star" size={22} color={colors.text} />
            <Typography variant="body" style={[styles.menuItemText, { color: colors.text }]}>
              Valorar
            </Typography>
            <Icon name="arrow-forward" size={20} color="#cccccc" />
          </TouchableOpacity>
        </View>

        {/* SECCIÓN 5: ZONA DE PELIGRO */}
        <View style={styles.section}>
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

        {/* SECCIÓN 6: INFORMACIÓN */}
        <View style={styles.section}>
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

        {/* SECCIÓN 7: REDES SOCIALES */}
        <View style={styles.socialSection}>
          <TouchableOpacity 
            style={styles.socialIcon}
            onPress={() => handleOpenURL('https://www.instagram.com/trinity.app/', 'Instagram')}
          >
            <Icon name="logo-instagram" size={32} color="#cccccc" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.socialIcon}
            onPress={() => handleOpenURL('mailto:trinity.app.spain@gmail.com', 'Email')}
          >
            <Icon name="mail-outline" size={32} color="#cccccc" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.socialIcon}
            onPress={() => handleOpenURL('https://trinity-app.es', 'Website')}
          >
            <Icon name="globe-outline" size={32} color="#cccccc" />
          </TouchableOpacity>
        </View>

        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Modal "Cambiar Contraseña" */}
      <Modal
        visible={showChangePasswordModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowChangePasswordModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.surface }]}>
            <ScrollView 
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <Typography variant="h2" style={styles.modalTitle}>
                Cambiar Contraseña
              </Typography>

              {/* Contraseña Actual */}
              <View style={styles.inputContainer}>
                <Typography variant="body" style={[styles.inputLabel, { color: colors.text }]}>
                  Contraseña Actual
                </Typography>
                <TextInput
                  style={[styles.input, { 
                    backgroundColor: colors.background, 
                    color: colors.text,
                    borderColor: colors.border 
                  }]}
                  placeholder="Ingresa tu contraseña actual"
                  placeholderTextColor="#888888"
                  secureTextEntry
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Nueva Contraseña */}
              <View style={styles.inputContainer}>
                <Typography variant="body" style={[styles.inputLabel, { color: colors.text }]}>
                  Nueva Contraseña
                </Typography>
                <TextInput
                  style={[styles.input, { 
                    backgroundColor: colors.background, 
                    color: colors.text,
                    borderColor: colors.border 
                  }]}
                  placeholder="Ingresa tu nueva contraseña"
                  placeholderTextColor="#888888"
                  secureTextEntry
                  value={newPassword}
                  onChangeText={setNewPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Confirmar Nueva Contraseña */}
              <View style={styles.inputContainer}>
                <Typography variant="body" style={[styles.inputLabel, { color: colors.text }]}>
                  Confirmar Nueva Contraseña
                </Typography>
                <TextInput
                  style={[styles.input, { 
                    backgroundColor: colors.background, 
                    color: colors.text,
                    borderColor: colors.border 
                  }]}
                  placeholder="Confirma tu nueva contraseña"
                  placeholderTextColor="#888888"
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Requisitos de contraseña */}
              <View style={styles.passwordRequirements}>
                <Typography variant="caption" style={[styles.requirementsTitle, { color: colors.textSecondary }]}>
                  La contraseña debe contener:
                </Typography>
                <Typography variant="caption" style={[styles.requirementItem, { color: colors.textSecondary }]}>
                  • Mínimo 8 caracteres
                </Typography>
                <Typography variant="caption" style={[styles.requirementItem, { color: colors.textSecondary }]}>
                  • Mayúsculas y minúsculas
                </Typography>
                <Typography variant="caption" style={[styles.requirementItem, { color: colors.textSecondary }]}>
                  • Números
                </Typography>
              </View>

              {/* Botones */}
              <View style={styles.modalButtons}>
                <Button
                  title="Cancelar"
                  variant="secondary"
                  size="large"
                  onPress={() => {
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                    setShowChangePasswordModal(false);
                  }}
                  style={styles.modalButton}
                  disabled={isChangingPassword}
                />
                <Button
                  title={isChangingPassword ? "Cambiando..." : "Cambiar"}
                  variant="primary"
                  size="large"
                  onPress={handleSubmitPasswordChange}
                  style={styles.modalButton}
                  disabled={isChangingPassword}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

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
              {/* Logo de Trinity */}
              <View style={styles.modalLogoContainer}>
                <Image 
                  source={require('../../assets/logoTrinity.png')}
                  style={styles.trinityLogo}
                  resizeMode="contain"
                />
                <Typography variant="h1" style={styles.modalAppName}>Trinity</Typography>
              </View>

              {/* Versión */}
              <Typography variant="caption" style={styles.modalVersion}>
                Versión 1.0.0
              </Typography>

              {/* Separador */}
              <View style={[styles.modalDivider, { backgroundColor: colors.border }]} />

              {/* Logo TMDB y texto legal */}
              <View style={styles.tmdbSection}>
                <TMDBLogo width={140} height={50} />
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

      {/* Custom Alert */}
      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        onDismiss={hideAlert}
      />

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
  
  // REDES SOCIALES
  socialSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 40,
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  socialIcon: {
    padding: 10,
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
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 25,
    lineHeight: 20,
  },
  
  // Change Password Modal
  inputContainer: {
    width: '100%',
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    width: '100%',
    height: 50,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    borderWidth: 1,
  },
  passwordRequirements: {
    width: '100%',
    backgroundColor: 'rgba(147, 51, 234, 0.1)',
    borderRadius: 12,
    padding: 15,
    marginBottom: 25,
  },
  requirementsTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  requirementItem: {
    fontSize: 12,
    lineHeight: 18,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
  },
  
  // About Modal
  modalLogoContainer: {
    alignItems: 'center',
    marginBottom: 10,
  },
  trinityLogo: {
    width: 100,
    height: 100,
    marginBottom: 8,
  },
  modalAppName: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  modalVersion: {
    fontSize: 16,
    marginBottom: 12,
    marginTop: 5,
  },
  modalDivider: {
    width: '100%',
    height: 1,
    marginVertical: 20,
  },
  tmdbSection: {
    alignItems: 'center',
    marginBottom: 12,
    paddingVertical: 10,
  },
  tmdbLegalText: {
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 16,
    paddingHorizontal: 10,
    marginTop: 15,
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
  
  // Sound test buttons
  soundTestContainer: {
    padding: 15,
    paddingTop: 10,
  },
  soundTestTitle: {
    fontSize: 12,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  soundTestButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  soundTestButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  soundTestButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  
  bottomSpacer: {
    height: 40,
  },
});