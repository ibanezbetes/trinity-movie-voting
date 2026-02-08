import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signUp, signIn, confirmSignUp, getCurrentUser } from 'aws-amplify/auth';
import { logger } from '../services/logger';
import { Typography, Button, MovieCarousel, CustomAlert } from '../components';

const { width, height } = Dimensions.get('window');

interface AuthScreenProps {
  onAuthSuccess: () => void;
}

type AuthMode = 'welcome' | 'login' | 'register';

// Mock de las 10 mejores películas de la historia para el carousel
const POPULAR_MOVIES = [
  { id: 1, title: 'The Shawshank Redemption', poster: 'https://image.tmdb.org/t/p/w500/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg' },
  { id: 2, title: 'The Godfather', poster: 'https://image.tmdb.org/t/p/w500/3bhkrj58Vtu7enYsRolD1fZdja1.jpg' },
  { id: 3, title: 'The Dark Knight', poster: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg' },
  { id: 4, title: 'The Godfather Part II', poster: 'https://image.tmdb.org/t/p/w500/hek3koDUyRQk7FIhPXsa6mT2Zc3.jpg' },
  { id: 5, title: '12 Angry Men', poster: 'https://image.tmdb.org/t/p/w500/ow3wq89wM8qd5X7hWKxiRfsFf9C.jpg' },
  { id: 6, title: 'Schindler\'s List', poster: 'https://image.tmdb.org/t/p/w500/sF1U4EUQS8YHUYjNl3pMGNIQyr0.jpg' },
  { id: 7, title: 'The Lord of the Rings: The Return of the King', poster: 'https://image.tmdb.org/t/p/w500/rCzpDGLbOoPwLjy3OAm5NUPOTrC.jpg' },
  { id: 8, title: 'Pulp Fiction', poster: 'https://image.tmdb.org/t/p/w500/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg' },
  { id: 9, title: 'Forrest Gump', poster: 'https://image.tmdb.org/t/p/w500/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg' },
  { id: 10, title: 'Inception', poster: 'https://image.tmdb.org/t/p/w500/9gk7adHYeDvHkCSEqAvQNLV5Uge.jpg' },
];

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('welcome');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
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

  logger.userAction('Screen loaded: Auth', { authMode });

  // Validación de requisitos de contraseña
  const passwordRequirements = {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
  };

  const allRequirementsMet = Object.values(passwordRequirements).every(req => req);

  const handleLogin = async () => {
    if (!email || !password) {
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'Por favor completa todos los campos',
        buttons: [{ text: 'OK' }]
      });
      return;
    }

    setIsLoading(true);
    logger.auth('Login attempt started', { identifier: email });

    try {
      // Clear any existing session first
      try {
        const currentUser = await getCurrentUser();
        if (currentUser) {
          logger.auth('Existing session found, proceeding with login');
        }
      } catch (e) {
        // No existing session, which is fine
        logger.auth('No existing session found');
      }

      // Attempt sign in with email
      const result = await signIn({
        username: email, // Always use email for Cognito
        password: password,
        options: {
          authFlowType: 'USER_PASSWORD_AUTH' // Use password auth instead of SRP
        }
      });

      logger.auth('Login successful', { 
        identifier: email,
        isSignedIn: result.isSignedIn,
        nextStep: result.nextStep?.signInStep 
      });

      if (result.isSignedIn) {
        // Verify we can get the current user and token
        try {
          const user = await getCurrentUser();
          logger.auth('User session verified after login', { userId: user.userId });
          onAuthSuccess();
        } catch (tokenError) {
          logger.authError('Token verification failed after login', tokenError);
          setAlertConfig({
            visible: true,
            title: 'Error',
            message: 'Problema con la sesión. Por favor intenta de nuevo.',
            buttons: [{ text: 'OK' }]
          });
        }
      } else {
        logger.auth('Login requires additional steps', { nextStep: result.nextStep });
        setAlertConfig({
          visible: true,
          title: 'Info',
          message: 'Se requieren pasos adicionales para completar el login',
          buttons: [{ text: 'OK' }]
        });
      }
    } catch (error) {
      logger.authError('Login failed', error);
      console.error('Login error:', error);
      
      let errorMessage = 'Email o contraseña incorrectos';
      
      // Handle specific error cases
      if (error && typeof error === 'object') {
        const err = error as any;
        logger.authError('Detailed login error', {
          name: err.name,
          message: err.message,
          code: err.code,
          statusCode: err.statusCode,
          retryable: err.retryable
        });
        
        if (err.name === 'NotAuthorizedException' || err.code === 'NotAuthorizedException') {
          errorMessage = 'Email o contraseña incorrectos';
        } else if (err.name === 'UserNotConfirmedException' || err.code === 'UserNotConfirmedException') {
          errorMessage = 'Tu cuenta no está confirmada. Por favor contacta soporte.';
        } else if (err.name === 'UserNotFoundException' || err.code === 'UserNotFoundException') {
          errorMessage = 'No existe una cuenta con este email';
        } else if (err.message) {
          errorMessage = err.message;
        }
      }
      
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: errorMessage,
        buttons: [{ text: 'OK' }]
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!email || !username || !password || !confirmPassword) {
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'Por favor completa todos los campos',
        buttons: [{ text: 'OK' }]
      });
      return;
    }

    // Validar formato de username
    if (username.length < 3) {
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'El nombre de usuario debe tener al menos 3 caracteres',
        buttons: [{ text: 'OK' }]
      });
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'El nombre de usuario solo puede contener letras, números y guiones bajos',
        buttons: [{ text: 'OK' }]
      });
      return;
    }

    if (password !== confirmPassword) {
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'Las contraseñas no coinciden',
        buttons: [{ text: 'OK' }]
      });
      return;
    }

    // Validación detallada de contraseña
    if (password.length < 8) {
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'La contraseña debe tener al menos 8 caracteres',
        buttons: [{ text: 'OK' }]
      });
      return;
    }

    if (!/[A-Z]/.test(password)) {
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'La contraseña debe contener al menos una letra mayúscula',
        buttons: [{ text: 'OK' }]
      });
      return;
    }

    if (!/[a-z]/.test(password)) {
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'La contraseña debe contener al menos una letra minúscula',
        buttons: [{ text: 'OK' }]
      });
      return;
    }

    if (!/[0-9]/.test(password)) {
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'La contraseña debe contener al menos un número',
        buttons: [{ text: 'OK' }]
      });
      return;
    }

    setIsLoading(true);
    logger.auth('Registration attempt started', { email, username });

    try {
      // Use email as Cognito username (required by current User Pool config)
      // Store custom username in preferred_username attribute
      const result = await signUp({
        username: email, // Cognito username = email
        password: password,
        options: {
          userAttributes: {
            email: email,
            preferred_username: username, // Custom username stored here
          },
          autoSignIn: false,
        },
      });

      logger.auth('Registration successful', { 
        email,
        username,
        userId: result.userId,
        isSignUpComplete: result.isSignUpComplete,
        nextStep: result.nextStep?.signUpStep
      });

      // Always redirect to login after successful registration
      setAlertConfig({
        visible: true,
        title: 'Registro Exitoso',
        message: 'Por favor inicia sesión con tu email.',
        buttons: [{ text: 'OK', onPress: () => setAuthMode('login') }]
      });

    } catch (error) {
      logger.authError('Registration failed', error);
      console.error('Registration error:', error);
      
      let errorMessage = 'Error al crear la cuenta';
      
      // Handle specific error cases
      if (error && typeof error === 'object') {
        const err = error as any;
        if (err.name === 'UsernameExistsException' || err.code === 'UsernameExistsException') {
          errorMessage = 'Ya existe una cuenta con este nombre de usuario';
        } else if (err.name === 'InvalidPasswordException' || err.code === 'InvalidPasswordException') {
          errorMessage = 'La contraseña no cumple con los requisitos de seguridad';
        } else if (err.message && err.message.includes('email')) {
          errorMessage = 'Ya existe una cuenta con este email';
        } else if (err.message) {
          // Limpiar el prefijo "PreSignUp failed with error" o "PreSinUp failed with error"
          let cleanMessage = err.message;
          if (cleanMessage.includes('PreSignUp failed with error')) {
            cleanMessage = cleanMessage.replace('PreSignUp failed with error', '').trim();
          } else if (cleanMessage.includes('PreSinUp failed with error')) {
            cleanMessage = cleanMessage.replace('PreSinUp failed with error', '').trim();
          }
          errorMessage = cleanMessage;
        }
      }
      
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: errorMessage,
        buttons: [{ text: 'OK' }]
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      logger.auth('Google login initiated');
      
      const { signInWithRedirect } = await import('aws-amplify/auth');
      
      await signInWithRedirect({
        provider: 'Google',
      });
      
      logger.auth('Google login redirect initiated');
    } catch (error) {
      logger.authError('Google login failed', error);
      setAlertConfig({
        visible: true,
        title: 'Error',
        message: 'No se pudo iniciar sesión con Google. Por favor intenta de nuevo.',
        buttons: [{ text: 'OK' }]
      });
      setIsLoading(false);
    }
  };

  const renderWelcomeScreen = () => (
    <View style={styles.welcomeContainer}>
      {/* Carousel de películas de fondo */}
      <MovieCarousel movies={POPULAR_MOVIES} autoScroll={true} scrollInterval={3000} />

      {/* Contenido principal */}
      <View style={styles.contentContainer}>
        {/* Logo Trinity con sombra */}
        <View style={styles.logoContainer}>
          <Image
            source={require('../../assets/logoTrinity.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        {/* Texto de bienvenida */}
        <View style={styles.welcomeTextContainer}>
          <Typography variant="h1" align="center" style={styles.welcomeTitle}>
            Trinity
          </Typography>
          <Typography variant="body" align="center" style={styles.welcomeSubtitle}>
            Stop Scroll Infinity{'\n'}Ponte de acuerdo en un chin
          </Typography>
        </View>

        {/* Botones */}
        <View style={styles.buttonsContainer}>
          {/* Botones principales */}
          <Button
            title="Iniciar Sesión"
            variant="primary"
            size="large"
            onPress={() => {
              logger.userAction('Auth mode changed to login');
              setAuthMode('login');
            }}
            style={styles.mainButton}
          />

          <Button
            title="Crear Cuenta"
            variant="outline"
            size="large"
            onPress={() => {
              logger.userAction('Auth mode changed to register');
              setAuthMode('register');
            }}
            style={styles.mainButton}
          />

          {/* Texto "Continúa con:" */}
          <Typography variant="caption" align="center" style={styles.continueText}>
            Continúa con:
          </Typography>

          {/* Botón circular de Google */}
          <View style={styles.socialButtonsRow}>
            <TouchableOpacity
              style={styles.socialButtonCircle}
              onPress={handleGoogleLogin}
              activeOpacity={0.7}
              disabled={isLoading}
            >
              <Image
                source={{ uri: 'https://www.google.com/images/branding/googleg/1x/googleg_standard_color_128dp.png' }}
                style={styles.socialIconLarge}
                resizeMode="contain"
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );

  const renderLoginScreen = () => (
    <KeyboardAvoidingView 
      style={styles.formContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.formHeader}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              logger.userAction('Back to welcome from login');
              setAuthMode('welcome');
            }}
          >
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <Typography variant="h2">Iniciar Sesión</Typography>
        </View>

        <View style={styles.inputContainer}>
          <Typography variant="label" style={styles.inputLabel}>EMAIL</Typography>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(text) => {
              setEmail(text.toLowerCase().trim());
              logger.ui('Email input changed', { hasValue: !!text });
            }}
            placeholder="tu@email.com"
            placeholderTextColor="#666666"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputContainer}>
          <Typography variant="label" style={styles.inputLabel}>CONTRASEÑA</Typography>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              logger.ui('Password input changed', { hasValue: !!text });
            }}
            placeholder="Tu contraseña"
            placeholderTextColor="#666666"
            secureTextEntry
          />
        </View>

        <Button
          title="Iniciar Sesión"
          variant="primary"
          size="large"
          onPress={handleLogin}
          disabled={isLoading}
          loading={isLoading}
          style={styles.submitButton}
        />

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => {
            logger.userAction('Switch to register from login');
            setAuthMode('register');
          }}
        >
          <Typography variant="caption" style={styles.linkText}>
            ¿No tienes cuenta? Crear cuenta
          </Typography>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderRegisterScreen = () => (
    <KeyboardAvoidingView 
      style={styles.formContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.formHeader}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              logger.userAction('Back to welcome from register');
              setAuthMode('welcome');
            }}
          >
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
          <Typography variant="h2">Crear Cuenta</Typography>
        </View>

        <View style={styles.inputContainer}>
          <Typography variant="label" style={styles.inputLabel}>NOMBRE DE USUARIO</Typography>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={(text) => {
              setUsername(text.toLowerCase().trim());
              logger.ui('Username input changed', { hasValue: !!text });
            }}
            placeholder="usuario123"
            placeholderTextColor="#666666"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {username.length > 0 && username.length < 3 && (
            <Typography variant="caption" style={styles.errorText}>
              Mínimo 3 caracteres
            </Typography>
          )}
          {username.length >= 3 && !/^[a-zA-Z0-9_]+$/.test(username) && (
            <Typography variant="caption" style={styles.errorText}>
              Solo letras, números y guiones bajos
            </Typography>
          )}
        </View>

        <View style={styles.inputContainer}>
          <Typography variant="label" style={styles.inputLabel}>EMAIL</Typography>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(text) => {
              setEmail(text.toLowerCase().trim());
              logger.ui('Email input changed', { hasValue: !!text });
            }}
            placeholder="tu@email.com"
            placeholderTextColor="#666666"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputContainer}>
          <Typography variant="label" style={styles.inputLabel}>CONTRASEÑA</Typography>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              logger.ui('Password input changed', { hasValue: !!text });
            }}
            placeholder="Mínimo 8 caracteres"
            placeholderTextColor="#666666"
            secureTextEntry
          />
          {password.length > 0 && (
            <View style={styles.passwordRequirements}>
              <Typography 
                variant="caption" 
                style={[
                  styles.requirementText,
                  passwordRequirements.minLength && styles.requirementMet
                ]}
              >
                {passwordRequirements.minLength ? '✓' : '•'} Mínimo 8 caracteres
              </Typography>
              <Typography 
                variant="caption" 
                style={[
                  styles.requirementText,
                  passwordRequirements.hasUppercase && styles.requirementMet
                ]}
              >
                {passwordRequirements.hasUppercase ? '✓' : '•'} Al menos 1 mayúscula
              </Typography>
              <Typography 
                variant="caption" 
                style={[
                  styles.requirementText,
                  passwordRequirements.hasLowercase && styles.requirementMet
                ]}
              >
                {passwordRequirements.hasLowercase ? '✓' : '•'} Al menos 1 minúscula
              </Typography>
              <Typography 
                variant="caption" 
                style={[
                  styles.requirementText,
                  passwordRequirements.hasNumber && styles.requirementMet
                ]}
              >
                {passwordRequirements.hasNumber ? '✓' : '•'} Al menos 1 número
              </Typography>
            </View>
          )}
        </View>

        <View style={styles.inputContainer}>
          <Typography variant="label" style={styles.inputLabel}>CONFIRMAR CONTRASEÑA</Typography>
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={(text) => {
              setConfirmPassword(text);
              logger.ui('Confirm password input changed', { hasValue: !!text });
            }}
            placeholder="Repite tu contraseña"
            placeholderTextColor="#666666"
            secureTextEntry
          />
        </View>

        <Button
          title="Crear Cuenta"
          variant="primary"
          size="large"
          onPress={handleRegister}
          disabled={isLoading}
          loading={isLoading}
          style={styles.submitButton}
        />

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => {
            logger.userAction('Switch to login from register');
            setAuthMode('login');
          }}
        >
          <Typography variant="caption" style={styles.linkText}>
            ¿Ya tienes cuenta? Iniciar sesión
          </Typography>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  return (
    <SafeAreaView style={styles.container}>
      {authMode === 'welcome' && renderWelcomeScreen()}
      {authMode === 'login' && renderLoginScreen()}
      {authMode === 'register' && renderRegisterScreen()}
      
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
    backgroundColor: '#0a0a0a',
  },
  welcomeContainer: {
    flex: 1,
    position: 'relative',
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
    zIndex: 1,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 80,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowOpacity: 0.9,
    shadowRadius: 12,
    elevation: 15,
  },
  logoImage: {
    width: 180,
    height: 180,
  },
  welcomeTextContainer: {
    alignItems: 'center',
    marginTop: -40,
  },
  welcomeTitle: {
    marginBottom: 12,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 6,
  },
  welcomeSubtitle: {
    opacity: 0.95,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  buttonsContainer: {
    width: '100%',
    gap: 16,
  },
  mainButton: {
    width: '100%',
  },
  continueText: {
    marginTop: 8,
    marginBottom: 8,
    opacity: 0.7,
  },
  socialButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    marginTop: 8,
  },
  socialButtonCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  socialIconLarge: {
    width: 32,
    height: 32,
  },
  appleIconWhite: {
    fontSize: 32,
    color: '#ffffff',
  },
  formContainer: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 40,
    paddingVertical: 20,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    marginRight: 20,
  },
  backButtonText: {
    fontSize: 20,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  inputContainer: {
    marginBottom: 24,
  },
  inputLabel: {
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  submitButton: {
    marginTop: 8,
  },
  linkButton: {
    alignItems: 'center',
    marginTop: 20,
  },
  linkText: {
    color: '#7c3aed',
  },
  passwordRequirements: {
    marginTop: 12,
    paddingLeft: 4,
    gap: 4,
  },
  requirementText: {
    opacity: 0.6,
  },
  requirementMet: {
    color: '#7c3aed',
    opacity: 1,
  },
  errorText: {
    color: '#ef4444',
    marginTop: 4,
    fontSize: 12,
  },
});