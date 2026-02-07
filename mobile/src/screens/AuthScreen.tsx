import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signUp, signIn, confirmSignUp, getCurrentUser } from 'aws-amplify/auth';
import { logger } from '../services/logger';

interface AuthScreenProps {
  onAuthSuccess: () => void;
}

type AuthMode = 'welcome' | 'login' | 'register';

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

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
      Alert.alert('Error', 'Por favor completa todos los campos');
      return;
    }

    setIsLoading(true);
    logger.auth('Login attempt started', { email });

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

      // Attempt sign in
      const result = await signIn({
        username: email,
        password: password,
        options: {
          authFlowType: 'USER_PASSWORD_AUTH' // Use password auth instead of SRP
        }
      });

      logger.auth('Login successful', { 
        email,
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
          Alert.alert('Error', 'Problema con la sesión. Por favor intenta de nuevo.');
        }
      } else {
        logger.auth('Login requires additional steps', { nextStep: result.nextStep });
        Alert.alert('Info', 'Se requieren pasos adicionales para completar el login');
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
      
      Alert.alert('Error', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!email || !password || !confirmPassword) {
      Alert.alert('Error', 'Por favor completa todos los campos');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Las contraseñas no coinciden');
      return;
    }

    // Validación detallada de contraseña
    if (password.length < 8) {
      Alert.alert('Error', 'La contraseña debe tener al menos 8 caracteres');
      return;
    }

    if (!/[A-Z]/.test(password)) {
      Alert.alert('Error', 'La contraseña debe contener al menos una letra mayúscula');
      return;
    }

    if (!/[a-z]/.test(password)) {
      Alert.alert('Error', 'La contraseña debe contener al menos una letra minúscula');
      return;
    }

    if (!/[0-9]/.test(password)) {
      Alert.alert('Error', 'La contraseña debe contener al menos un número');
      return;
    }

    setIsLoading(true);
    logger.auth('Registration attempt started', { email });

    try {
      const result = await signUp({
        username: email,
        password: password,
        options: {
          userAttributes: {
            email: email,
          },
          autoSignIn: false, // Don't auto sign in - redirect to login instead
        },
      });

      logger.auth('Registration successful', { 
        email,
        userId: result.userId,
        isSignUpComplete: result.isSignUpComplete,
        nextStep: result.nextStep?.signUpStep
      });

      // Always redirect to login after successful registration
      // This ensures proper token management
      Alert.alert(
        'Registro Exitoso', 
        'Tu cuenta ha sido creada correctamente. Por favor inicia sesión con tus credenciales.',
        [{ 
          text: 'Iniciar Sesión', 
          onPress: () => {
            // Clear password fields for security
            setPassword('');
            setConfirmPassword('');
            // Redirect to login
            setAuthMode('login');
            logger.auth('User redirected to login after successful registration');
          }
        }]
      );

    } catch (error) {
      logger.authError('Registration failed', error);
      console.error('Registration error:', error);
      
      let errorMessage = 'Error al crear la cuenta';
      
      // Handle specific error cases
      if (error && typeof error === 'object') {
        const err = error as any;
        if (err.name === 'UsernameExistsException' || err.code === 'UsernameExistsException') {
          errorMessage = 'Ya existe una cuenta con este email';
        } else if (err.name === 'InvalidPasswordException' || err.code === 'InvalidPasswordException') {
          errorMessage = 'La contraseña no cumple con los requisitos de seguridad';
        } else if (err.message) {
          errorMessage = err.message;
        }
      }
      
      Alert.alert('Error', errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    logger.auth('Google login attempted');
    // TODO: Implement Google OAuth
    Alert.alert('Próximamente', 'Login con Google estará disponible pronto');
  };

  const renderWelcomeScreen = () => (
    <View style={styles.welcomeContainer}>
      <View style={styles.logoContainer}>
        <Text style={styles.logoText}>TRINITY</Text>
        <Text style={styles.logoSubtext}>Movie Voting</Text>
      </View>

      <View style={styles.welcomeButtonsContainer}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={() => {
            logger.userAction('Auth mode changed to login');
            setAuthMode('login');
          }}
        >
          <Text style={styles.primaryButtonText}>INICIAR SESIÓN</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={() => {
            logger.userAction('Auth mode changed to register');
            setAuthMode('register');
          }}
        >
          <Text style={styles.secondaryButtonText}>REGISTRARSE</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.googleButton]}
          onPress={handleGoogleLogin}
        >
          <Text style={styles.googleButtonText}>🔍 CONTINUAR CON GOOGLE</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.welcomeFooter}>
        Swipe • Vote • Match
      </Text>
    </View>
  );

  const renderLoginScreen = () => (
    <KeyboardAvoidingView 
      style={styles.formContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
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
          <Text style={styles.formTitle}>Iniciar Sesión</Text>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Email</Text>
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
          <Text style={styles.inputLabel}>Contraseña</Text>
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

        <TouchableOpacity
          style={[styles.button, styles.primaryButton, isLoading && styles.disabledButton]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>INICIAR SESIÓN</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => {
            logger.userAction('Switch to register from login');
            setAuthMode('register');
          }}
        >
          <Text style={styles.linkText}>¿No tienes cuenta? Regístrate</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderRegisterScreen = () => (
    <KeyboardAvoidingView 
      style={styles.formContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
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
          <Text style={styles.formTitle}>Registrarse</Text>
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Email</Text>
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
          <Text style={styles.inputLabel}>Contraseña</Text>
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
              <Text style={[
                styles.requirementText,
                passwordRequirements.minLength && styles.requirementMet
              ]}>
                {passwordRequirements.minLength ? '✓' : '•'} Mínimo 8 caracteres
              </Text>
              <Text style={[
                styles.requirementText,
                passwordRequirements.hasUppercase && styles.requirementMet
              ]}>
                {passwordRequirements.hasUppercase ? '✓' : '•'} Al menos 1 mayúscula
              </Text>
              <Text style={[
                styles.requirementText,
                passwordRequirements.hasLowercase && styles.requirementMet
              ]}>
                {passwordRequirements.hasLowercase ? '✓' : '•'} Al menos 1 minúscula
              </Text>
              <Text style={[
                styles.requirementText,
                passwordRequirements.hasNumber && styles.requirementMet
              ]}>
                {passwordRequirements.hasNumber ? '✓' : '•'} Al menos 1 número
              </Text>
            </View>
          )}
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Confirmar Contraseña</Text>
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

        <TouchableOpacity
          style={[styles.button, styles.primaryButton, isLoading && styles.disabledButton]}
          onPress={handleRegister}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>CREAR CUENTA</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => {
            logger.userAction('Switch to login from register');
            setAuthMode('login');
          }}
        >
          <Text style={styles.linkText}>¿Ya tienes cuenta? Inicia sesión</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  return (
    <SafeAreaView style={styles.container}>
      {authMode === 'welcome' && renderWelcomeScreen()}
      {authMode === 'login' && renderLoginScreen()}
      {authMode === 'register' && renderRegisterScreen()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  welcomeContainer: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 60,
  },
  logoText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 6,
  },
  logoSubtext: {
    fontSize: 18,
    color: '#888888',
    marginTop: 10,
    letterSpacing: 2,
  },
  welcomeButtonsContainer: {
    width: '100%',
    gap: 20,
  },
  button: {
    paddingVertical: 18,
    paddingHorizontal: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#4CAF50',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#4CAF50',
  },
  googleButton: {
    backgroundColor: '#ffffff',
  },
  disabledButton: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#4CAF50',
    letterSpacing: 1,
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1a1a1a',
    letterSpacing: 1,
  },
  welcomeFooter: {
    fontSize: 14,
    color: '#666666',
    letterSpacing: 2,
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
    backgroundColor: '#333333',
    marginRight: 20,
  },
  backButtonText: {
    fontSize: 20,
    color: '#ffffff',
    fontWeight: 'bold',
  },
  formTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1,
  },
  inputContainer: {
    marginBottom: 25,
  },
  inputLabel: {
    fontSize: 16,
    color: '#ffffff',
    marginBottom: 8,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#333333',
  },
  linkButton: {
    alignItems: 'center',
    marginTop: 20,
  },
  linkText: {
    fontSize: 14,
    color: '#4CAF50',
    textDecorationLine: 'underline',
  },
  passwordRequirements: {
    marginTop: 8,
    paddingLeft: 4,
  },
  requirementText: {
    fontSize: 12,
    color: '#888888',
    marginBottom: 4,
    lineHeight: 18,
  },
  requirementMet: {
    color: '#4CAF50',
  },
});