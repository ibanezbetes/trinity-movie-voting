# Trinity Mobile App

Aplicación móvil React Native para Trinity - Movie Matching App.

## 🚀 Inicio Rápido

### Desarrollo con Expo
```bash
npm install
npm start
# Escanear QR code con Expo Go app
```

### Build APK para Producción
```bash
./build-apk.bat
# APK generado en: android/app/build/outputs/apk/release/app-release.apk
```

## 📱 Estructura del Proyecto

```
src/
├── components/          # Componentes reutilizables
├── screens/            # Pantallas principales
│   ├── AuthScreen.tsx           # Login/Registro
│   ├── DashboardScreen.tsx      # Pantalla principal
│   ├── CreateRoomScreen.tsx     # Crear sala
│   ├── JoinRoomScreen.tsx       # Unirse a sala
│   ├── VotingRoomScreen.tsx     # Votación de películas
│   ├── MyMatchesScreen.tsx      # Historial de matches
│   ├── MyRoomsScreen.tsx        # Mis salas
│   └── ProfileScreen.tsx        # Perfil de usuario
├── services/           # Servicios y APIs
│   ├── amplify.ts      # Configuración AWS Amplify
│   ├── auth.ts         # Servicios de autenticación
│   ├── graphql.ts      # Queries y mutations GraphQL
│   ├── subscriptions.ts # Suscripciones en tiempo real
│   └── logger.ts       # Sistema de logging
├── hooks/              # Custom React Hooks
│   ├── useMatchPolling.ts       # Polling de matches
│   └── useProactiveMatchCheck.ts # Verificación proactiva
├── context/            # React Context
│   ├── AuthContext.tsx          # Estado de autenticación
│   └── MatchNotificationContext.tsx # Notificaciones
├── navigation/         # Configuración de navegación
│   └── AppNavigator.tsx
├── types/              # Definiciones TypeScript
│   └── index.ts
├── config/             # Configuración
│   └── aws-config.ts   # Configuración AWS
└── data/               # Datos estáticos
    └── staticRecommendations.ts
```

## 🔧 Configuración

### Variables de Entorno AWS

La configuración AWS se genera automáticamente durante el deployment del backend. El archivo `src/config/aws-config.ts` contiene:

```typescript
export const awsConfig = {
  Auth: {
    region: 'us-east-1',
    userPoolId: 'us-east-1_xxxxxxxxx',
    userPoolWebClientId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
  },
  API: {
    GraphQL: {
      endpoint: 'https://xxxxxxxxxxxxxxxxxxxxxxxxxx.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
      defaultAuthMode: 'userPool',
    },
  },
};
```

### Dependencias Principales

```json
{
  "dependencies": {
    "react-native": "0.74.5",
    "expo": "~51.0.28",
    "@react-navigation/native": "^6.1.18",
    "@react-navigation/stack": "^6.4.1",
    "aws-amplify": "^6.0.7",
    "react-native-gesture-handler": "~2.16.1",
    "expo-linear-gradient": "~13.0.2"
  }
}
```

## 📱 Pantallas Principales

### AuthScreen
- **Función**: Login y registro de usuarios
- **Características**:
  - Autenticación con Cognito
  - Auto-confirmación de usuarios
  - Manejo de errores de autenticación
  - Navegación automática al dashboard

### DashboardScreen
- **Función**: Pantalla principal de la app
- **Características**:
  - Acceso a crear/unirse a salas
  - Ver matches recientes
  - Navegación a historial y perfil
  - Estado de autenticación

### CreateRoomScreen
- **Función**: Crear nueva sala de votación
- **Características**:
  - Selección de tipo de media (Movie/TV)
  - Selección múltiple de géneros
  - Integración con TMDB API
  - Generación de código único

### JoinRoomScreen
- **Función**: Unirse a sala existente
- **Características**:
  - Input de código de sala
  - Validación en tiempo real
  - Navegación automática a votación

### VotingRoomScreen
- **Función**: Votación de películas con sistema swipe
- **Características**:
  - Gestos swipe (izquierda/derecha)
  - Botones de like/dislike
  - Detección de matches en tiempo real
  - Notificaciones push
  - Sistema dual de suscripciones

### MyMatchesScreen
- **Función**: Historial personal de matches
- **Características**:
  - Lista de matches encontrados
  - Detalles de películas
  - Información de usuarios participantes
  - Filtros y búsqueda

## 🔔 Sistema de Notificaciones

### Dual Subscription System

La app implementa un sistema robusto de notificaciones en tiempo real:

#### 1. User-Specific Subscriptions
```typescript
// Suscripción individual por usuario
const USER_MATCH_SUBSCRIPTION = `
  subscription UserMatch($userId: ID!) {
    userMatch(userId: $userId) {
      userId
      roomId
      matchId
      movieTitle
      matchedUsers
    }
  }
`;
```

#### 2. Room-Based Subscriptions
```typescript
// Suscripción por sala
const ROOM_MATCH_SUBSCRIPTION = `
  subscription RoomMatch($roomId: ID!) {
    roomMatch(roomId: $roomId) {
      roomId
      matchId
      movieTitle
      matchedUsers
    }
  }
`;
```

### Polling Fallback
Sistema de respaldo que verifica matches cada 2 segundos si las suscripciones WebSocket fallan.

## 🎨 Componentes y Hooks

### useProactiveMatchCheck
Hook personalizado para verificación proactiva de matches:

```typescript
const { addActiveRoom, removeActiveRoom, executeWithMatchCheck } = useProactiveMatchCheck();

// Agregar sala activa para monitoreo
addActiveRoom(roomId);

// Ejecutar acción con verificación de match
await executeWithMatchCheck(async () => {
  // Lógica de votación
}, 'Vote Action');
```

### useMatchPolling
Hook para polling de matches como fallback:

```typescript
const { startPolling, stopPolling } = useMatchPolling(userId, onMatchFound);

// Iniciar polling
startPolling();

// Detener polling
stopPolling();
```

## 🔨 Build y Deployment

### Desarrollo Local

1. **Instalar dependencias**
```bash
npm install
```

2. **Iniciar Expo Dev Server**
```bash
npm start
```

3. **Abrir en dispositivo**
   - Escanear QR code con Expo Go
   - O usar emulador Android/iOS

### Build APK Producción

1. **Ejecutar script de build**
```bash
./build-apk.bat
```

2. **Proceso automático**:
   - Limpia builds anteriores
   - Configura entorno de producción
   - Ejecuta Gradle build
   - Genera APK firmado

3. **Ubicación del APK**:
```
android/app/build/outputs/apk/release/app-release.apk
```

### Configuración Android

#### Gradle Configuration
```gradle
// android/app/build.gradle
android {
    compileSdkVersion 34
    buildToolsVersion "34.0.0"
    
    defaultConfig {
        applicationId "com.trinityapp.mobile"
        minSdkVersion 21
        targetSdkVersion 34
        versionCode 1
        versionName "1.0.0"
    }
    
    signingConfigs {
        release {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
}
```

## 🐛 Debugging

### Logs del Sistema
```typescript
import { logger } from '../services/logger';

// Log de acciones de usuario
logger.userAction('Button pressed', { buttonId: 'create-room' });

// Log de API calls
logger.apiRequest('createRoom', { mediaType: 'MOVIE' });

// Log de errores
logger.error('Failed to create room', error, { userId });
```

### React Native Debugger
1. Instalar React Native Debugger
2. Abrir en puerto 8081
3. Habilitar debugging en Expo Dev Tools

### Logs de Subscriptions
```typescript
// Logs automáticos en subscriptions.ts
console.log('📡 Match notification received:', matchEvent);
console.log('✅ Successfully established subscription');
console.log('❌ Subscription error:', error);
```

## 🧪 Testing

### Escenario de Prueba Completo

1. **Setup**:
   - Dos dispositivos con la app instalada
   - Backend desplegado y funcionando
   - Conexión a internet estable

2. **Flujo de Prueba**:
   ```
   Usuario A: Login → Crear Sala → Obtener Código
   Usuario B: Login → Unirse con Código
   Usuario A: Votar "Sí" en Película X
   Usuario B: Votar "Sí" en Película X
   Resultado: Ambos reciben notificación de match
   ```

3. **Verificaciones**:
   - ✅ Notificaciones en tiempo real
   - ✅ Navegación automática
   - ✅ Datos correctos en MyMatches
   - ✅ Logs sin errores

## 📦 Scripts Disponibles

```json
{
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "build": "expo build:android",
    "clean": "expo r -c"
  }
}
```

## 🔧 Troubleshooting

### Problemas Comunes

#### 1. APK Build Falla
```bash
# Limpiar cache de Gradle
cd android
./gradlew clean

# Verificar Java version
java -version  # Debe ser Java 11 o superior
```

#### 2. Subscriptions No Funcionan
```typescript
// Verificar configuración AWS
console.log('AWS Config:', awsConfig);

// Verificar autenticación
const session = await Auth.currentSession();
console.log('Auth Session:', session);
```

#### 3. TMDB API Errors
```bash
# Verificar variables de entorno en backend
echo $TMDB_API_KEY
echo $TMDB_READ_TOKEN
```

### Logs Útiles

```bash
# Ver logs de Metro bundler
npx react-native log-android

# Ver logs de Expo
expo logs

# Debug de red en Chrome DevTools
# Habilitar "Network" tab en React Native Debugger
```

## 🚀 Próximas Mejoras

- [ ] Implementar notificaciones push nativas
- [ ] Agregar modo offline
- [ ] Mejorar UI/UX con animaciones
- [ ] Implementar chat en salas
- [ ] Agregar sistema de ratings
- [ ] Soporte para múltiples idiomas

---

Para más información, consultar la [documentación principal](../README.md).