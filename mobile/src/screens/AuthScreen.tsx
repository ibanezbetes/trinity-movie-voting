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

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Por favor completa todos los campos');
      return;
    }

    setIsLoading(true);
    logger.auth('Login attempt started', { email });

    try {
      // Try with explicit options to avoid SRP issues
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
        onAuthSuccess();
      } else {
        logger.auth('Login requires additional steps', { nextStep: result.nextStep });
        Alert.alert('Info', 'Se requieren pasos adicionales para completar el login');
      }
    } catch (error) {
      logger.authError('Login failed', error);
      console.error('Login error:', error);
      
      // Log more detailed error information
      if (error && typeof error === 'object') {
        logger.authError('Detailed login error', {
          name: error.name,
          message: error.message,
          code: error.code,
          statusCode: error.statusCode,
          retryable: error.retryable,
          stack: error.stack
        });
      }
      
      Alert.alert('Error', 'Email o contraseña incorrectos');
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

    if (password.length < 8) {
      Alert.alert('Error', 'La contraseña debe tener al menos 8 caracteres');
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
          autoSignIn: true, // Auto sign in after registration
        },
      });

      logger.auth('Registration successful', { 
        email,
        userId: result.userId,
        isSignUpComplete: result.isSignUpComplete,
        nextStep: result.nextStep?.signUpStep
      });

      if (result.isSignUpComplete) {
        logger.auth('Registration complete, user auto-signed in');
        onAuthSuccess();
      } else if (result.nextStep?.signUpStep === 'CONFIRM_SIGN_UP') {
        logger.auth('Registration requires confirmation, attempting auto-confirmation');
        
        // Try to auto-confirm with a dummy code (this will work when Lambda trigger is deployed)
        try {
          await confirmSignUp({
            username: email,
            confirmationCode: '123456', // Dummy code - Lambda will auto-confirm
          });
          
          logger.auth('Auto-confirmation successful, attempting sign in');
          
          // Now try to sign in
          const signInResult = await signIn({
            username: email,
            password: password,
          });
          
          if (signInResult.isSignedIn) {
            logger.auth('Sign in successful after confirmation');
            onAuthSuccess();
          } else {
            logger.auth('Sign in requires additional steps after confirmation');
            onAuthSuccess(); // Proceed anyway
          }
          
        } catch (confirmError) {
          logger.authError('Auto-confirmation failed', confirmError);
          
          Alert.alert(
            'Registro Exitoso', 
            'Tu cuenta ha sido creada. Por favor inicia sesión con tus credenciales.',
            [{ text: 'OK', onPress: () => setAuthMode('login') }]
          );
        }
      } else {
        logger.auth('Registration completed with unknown next step', { nextStep: result.nextStep });
        onAuthSuccess();
      }
    } catch (error) {
      logger.authError('Registration failed', error);
      console.error('Registration error:', error);
      
      const errorMessage = (error as any).message || 'Error al crear la cuenta';
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
});