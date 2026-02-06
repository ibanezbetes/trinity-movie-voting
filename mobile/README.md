# Trinity Mobile App

Aplicación móvil de Trinity construida con React Native y Expo.

## 📋 Tabla de Contenidos

- [Descripción](#descripción)
- [Arquitectura](#arquitectura)
- [Estructura del Proyecto](#estructura-del-proyecto)
- [Configuración](#configuración)
- [Desarrollo](#desarrollo)
- [Build y Deployment](#build-y-deployment)
- [Pantallas](#pantallas)
- [Servicios](#servicios)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## 🎯 Descripción

Aplicación móvil multiplataforma (iOS y Android) que permite a grupos de amigos encontrar películas o series para ver juntos mediante votación colaborativa.

### Características

- ✅ Autenticación con AWS Cognito
- ✅ Creación y gestión de salas de votación
- ✅ Votación en tiempo real
- ✅ Notificaciones de matches
- ✅ Historial de matches
- ✅ Integración con TMDB
- ✅ Navegación contextual inteligente
- ✅ Pantalla de celebración de matches

## 🏗️ Arquitectura

### Stack Tecnológico

```
React Native 0.81.5
├── Expo SDK 54
├── TypeScript 5.9.2
├── React Navigation 7.x
├── AWS Amplify 6.16.0
└── GraphQL (AWS AppSync)
```

### Flujo de Datos

```
┌─────────────────┐
│   Components    │
│   (Screens)     │
└────────┬────────┘
         │
         ├─── Context Providers
         │    ├─── AuthContext
         │    └─── MatchNotificationContext
         │
         ├─── Custom Hooks
         │    ├─── useMatchPolling
         │    └─── useProactiveMatchCheck
         │
         ├─── Services
         │    ├─── auth.ts (Cognito)
         │    ├─── graphql.ts (AppSync)
         │    ├─── subscriptions.ts
         │    └─── logger.ts
         │
         └─── AWS Backend
              ├─── AppSync (GraphQL)
              ├─── Lambda Functions
              └─── DynamoDB
```

## 📁 Estructura del Proyecto

```
mobile/
├── src/
│   ├── screens/                    # Pantallas de la app
│   │   ├── AuthScreen.tsx         # Login/Registro
│   │   ├── DashboardScreen.tsx    # Pantalla principal
│   │   ├── CreateRoomScreen.tsx   # Crear sala
│   │   ├── JoinRoomScreen.tsx     # Unirse a sala
│   │   ├── VotingRoomScreen.tsx   # Votación
│   │   ├── MatchCelebrationScreen.tsx  # Celebración de match
│   │   ├── MyRoomsScreen.tsx      # Mis salas
│   │   ├── MyMatchesScreen.tsx    # Mis matches
│   │   ├── RecommendationsScreen.tsx   # Recomendaciones
│   │   └── ProfileScreen.tsx      # Perfil de usuario
│   │
│   ├── services/                   # Servicios
│   │   ├── amplify.ts             # Configuración Amplify
│   │   ├── auth.ts                # Autenticación
│   │   ├── graphql.ts             # Cliente GraphQL
│   │   ├── subscriptions.ts       # Subscriptions en tiempo real
│   │   └── logger.ts              # Logging estructurado
│   │
│   ├── hooks/                      # Custom Hooks
│   │   ├── useMatchPolling.ts     # Polling de matches
│   │   └── useProactiveMatchCheck.ts  # Verificación proactiva
│   │
│   ├── context/                    # Context Providers
│   │   ├── AuthContext.tsx        # Estado de autenticación
│   │   └── MatchNotificationContext.tsx  # Notificaciones
│   │
│   ├── navigation/                 # Navegación
│   │   └── AppNavigator.tsx       # Stack Navigator
│   │
│   ├── config/                     # Configuración
│   │   └── aws-config.ts          # Config AWS
│   │
│   ├── data/                       # Datos estáticos
│   │   └── staticRecommendations.ts
│   │
│   └── types/                      # Tipos TypeScript
│       └── index.ts               # Tipos compartidos
│
├── android/                        # Configuración Android
│   ├── app/
│   │   ├── build.gradle           # Build config
│   │   └── src/main/
│   │       ├── AndroidManifest.xml
│   │       └── java/              # Código nativo
│   └── gradle/                    # Gradle wrapper
│
├── assets/                         # Assets estáticos
│   ├── icon.png                   # Icono de la app
│   ├── splash-icon.png            # Splash screen
│   ├── adaptive-icon.png          # Android adaptive icon
│   └── favicon.png                # Favicon web
│
├── App.tsx                         # Componente raíz
├── index.ts                        # Entry point
├── app.json                        # Configuración Expo
├── eas.json                        # Configuración EAS Build
├── metro.config.js                # Metro bundler config
├── package.json                    # Dependencies
├── tsconfig.json                   # TypeScript config
└── README.md                       # Este archivo
```

## ⚙️ Configuración

### Variables de Entorno

Crear archivo `.env` en `mobile/`:

```bash
# AWS Configuration
EXPO_PUBLIC_AWS_REGION=eu-west-1
EXPO_PUBLIC_USER_POOL_ID=eu-west-1_xxxxx
EXPO_PUBLIC_USER_POOL_CLIENT_ID=xxxxxxxxxxxxx
EXPO_PUBLIC_GRAPHQL_ENDPOINT=https://xxxxx.appsync-api.eu-west-1.amazonaws.com/graphql

# App Configuration
EXPO_PUBLIC_APP_NAME=Trinity
EXPO_PUBLIC_APP_VERSION=1.0.0
```

**Importante**: Obtener estos valores del output de `cdk deploy` en infrastructure.

### Instalación

```bash
cd mobile
npm install
```

## 💻 Desarrollo

### Iniciar en Desarrollo

```bash
# Iniciar Metro bundler
npx expo start

# Iniciar con cache limpio
npx expo start --clear

# Iniciar en modo tunnel (para testing remoto)
npx expo start --tunnel
```

### Ejecutar en Dispositivo

**Android**:
```bash
# Emulador
npx expo run:android

# Dispositivo físico
# 1. Habilitar USB debugging
# 2. Conectar dispositivo
# 3. npx expo run:android
```

**iOS** (solo en macOS):
```bash
npx expo run:ios
```

### Hot Reload

Expo soporta hot reload automático. Los cambios se reflejan instantáneamente en el dispositivo.

## 📱 Pantallas

### 1. AuthScreen (`src/screens/AuthScreen.tsx`)

**Propósito**: Login y registro de usuarios

**Funcionalidades**:
- Login con email y password
- Registro de nuevos usuarios
- Validación de formularios
- Manejo de errores de autenticación

**Navegación**:
- Success → Dashboard

### 2. DashboardScreen (`src/screens/DashboardScreen.tsx`)

**Propósito**: Pantalla principal con acceso a todas las funciones

**Funcionalidades**:
- Crear nueva sala
- Unirse a sala existente
- Ver mis salas
- Ver mis matches
- Ver recomendaciones
- Acceder a perfil

**Navegación**:
- Crear Sala → CreateRoom
- Unirse → JoinRoom
- Mis Salas → MyRooms
- Mis Matches → MyMatches
- Recomendaciones → Recommendations
- Perfil → Profile

### 3. CreateRoomScreen (`src/screens/CreateRoomScreen.tsx`)

**Propósito**: Crear nueva sala de votación

**Funcionalidades**:
- Seleccionar tipo de media (Película/Serie)
- Seleccionar hasta 2 géneros
- Crear sala con código único
- Navegación automática a sala de votación

**Flujo**:
```typescript
1. Usuario selecciona mediaType
2. Usuario selecciona géneros (máx 2)
3. Llamada a mutation createRoom
4. Backend genera código y candidatos
5. Navegación a VotingRoom con roomId y code
```

**Navegación**:
- Success → VotingRoom

### 4. JoinRoomScreen (`src/screens/JoinRoomScreen.tsx`)

**Propósito**: Unirse a sala existente con código

**Funcionalidades**:
- Input de código de 6 caracteres
- Validación de código
- Unirse a sala activa
- Manejo de errores (sala no existe, expirada, etc.)

**Flujo**:
```typescript
1. Usuario ingresa código
2. Llamada a mutation joinRoom
3. Backend valida código y registra participación
4. Navegación a VotingRoom
```

**Navegación**:
- Success → VotingRoom

### 5. VotingRoomScreen (`src/screens/VotingRoomScreen.tsx`)

**Propósito**: Votación de candidatos de películas

**Funcionalidades**:
- Mostrar candidatos de películas
- Votar positivo/negativo
- Contador de votos
- Detección automática de matches
- Subscripción a notificaciones de match
- Navegación automática a celebración

**Flujo de Votación**:
```typescript
1. Mostrar candidato actual
2. Usuario vota (👍 o 👎)
3. Llamada a mutation vote
4. Backend verifica si hay match
5. Si hay match:
   - Subscription recibe notificación
   - Navegación a MatchCelebration
6. Si no hay match:
   - Mostrar siguiente candidato
```

**Hooks Utilizados**:
- `useMatchPolling`: Polling de respaldo cada 5s
- `useProactiveMatchCheck`: Verificación después de cada voto

**Navegación**:
- Match detectado → MatchCelebration

### 6. MatchCelebrationScreen (`src/screens/MatchCelebrationScreen.tsx`)

**Propósito**: Celebración visual cuando hay match

**Funcionalidades**:
- Mostrar póster grande de la película
- Información de la película
- Lista de usuarios que coincidieron
- Botones de navegación contextual
- Auto-dismiss de notificación

**Navegación Contextual**:
```typescript
if (fromVotingRoom) {
  // Usuario estaba votando
  - "Seguir Votando" → VotingRoom
  - "Ver Mis Matches" → MyMatches
} else {
  // Usuario vino de notificación
  - "Ir al Dashboard" → Dashboard
  - "Ver Mis Matches" → MyMatches
}
```

**Navegación**:
- Seguir Votando → VotingRoom
- Ver Mis Matches → MyMatches
- Ir al Dashboard → Dashboard

### 7. MyRoomsScreen (`src/screens/MyRoomsScreen.tsx`)

**Propósito**: Historial de salas del usuario

**Funcionalidades**:
- Listar salas donde el usuario es host
- Listar salas donde el usuario participó
- Filtrar salas activas (sin matches)
- Reentrar a salas activas
- Información de cada sala (código, géneros, fecha)

**Flujo**:
```typescript
1. Llamada a query getMyRooms
2. Backend filtra:
   - Salas no expiradas (TTL)
   - Salas sin matches
   - Usuario es host o participante
3. Mostrar lista ordenada por fecha
4. Usuario puede reentrar a sala activa
```

**Navegación**:
- Reentrar → VotingRoom

### 8. MyMatchesScreen (`src/screens/MyMatchesScreen.tsx`)

**Propósito**: Historial de matches del usuario

**Funcionalidades**:
- Listar todos los matches
- Mostrar póster y título
- Mostrar usuarios que coincidieron
- Fecha del match
- Información de la sala

**Flujo**:
```typescript
1. Llamada a query getMyMatches
2. Backend busca:
   - Todas las salas donde usuario participó
   - Matches de esas salas
   - Filtrar donde usuario está en matchedUsers
3. Mostrar lista ordenada por fecha
```

### 9. RecommendationsScreen (`src/screens/RecommendationsScreen.tsx`)

**Propósito**: Recomendaciones de películas populares

**Funcionalidades**:
- Mostrar películas populares
- Información de cada película
- Enlaces externos (opcional)

### 10. ProfileScreen (`src/screens/ProfileScreen.tsx`)

**Propósito**: Perfil y configuración del usuario

**Funcionalidades**:
- Información del usuario
- Cerrar sesión
- Configuración (futuro)

## 🔧 Servicios

### 1. Auth Service (`src/services/auth.ts`)

**Funciones**:
```typescript
signUp(email: string, password: string): Promise<void>
signIn(email: string, password: string): Promise<void>
signOut(): Promise<void>
getCurrentUser(): Promise<User | null>
```

**Uso**:
```typescript
import { signIn } from '../services/auth';

const handleLogin = async () => {
  try {
    await signIn(email, password);
    navigation.navigate('Dashboard');
  } catch (error) {
    console.error('Login failed:', error);
  }
};
```

### 2. GraphQL Service (`src/services/graphql.ts`)

**Funciones**:
```typescript
createRoom(input: CreateRoomInput): Promise<Room>
joinRoom(code: string): Promise<Room>
vote(input: VoteInput): Promise<VoteResult>
getMyRooms(): Promise<Room[]>
getMyMatches(): Promise<Match[]>
```

**Uso**:
```typescript
import { createRoom } from '../services/graphql';

const handleCreateRoom = async () => {
  const room = await createRoom({
    mediaType: 'MOVIE',
    genreIds: [28, 12]
  });
  navigation.navigate('VotingRoom', { 
    roomId: room.id, 
    roomCode: room.code 
  });
};
```

### 3. Subscriptions Service (`src/services/subscriptions.ts`)

**Funciones**:
```typescript
subscribeToUserMatches(
  userId: string, 
  onMatch: (match: Match) => void
): Subscription
```

**Uso**:
```typescript
import { subscribeToUserMatches } from '../services/subscriptions';

useEffect(() => {
  const subscription = subscribeToUserMatches(
    userId,
    (match) => {
      console.log('New match!', match);
      navigation.navigate('MatchCelebration', { match });
    }
  );

  return () => subscription.unsubscribe();
}, [userId]);
```

### 4. Logger Service (`src/services/logger.ts`)

**Funciones**:
```typescript
logger.userAction(action: string, data?: any)
logger.apiRequest(operation: string, data?: any)
logger.apiResponse(operation: string, data?: any)
logger.error(message: string, error: any, context?: any)
```

**Uso**:
```typescript
import { logger } from '../services/logger';

logger.userAction('Room created', { 
  roomId: room.id, 
  mediaType: room.mediaType 
});

logger.apiRequest('createRoom', { input });
logger.apiResponse('createRoom', { success: true, roomId });

logger.error('Failed to create room', error, { userId, input });
```

## 🎣 Custom Hooks

### useMatchPolling

**Propósito**: Polling de respaldo para detectar matches

**Uso**:
```typescript
import { useMatchPolling } from '../hooks/useMatchPolling';

const VotingRoomScreen = () => {
  useMatchPolling(roomId, userId, (match) => {
    navigation.navigate('MatchCelebration', { match });
  });
};
```

**Comportamiento**:
- Polling cada 5 segundos
- Solo cuando hay subscripción activa
- Detiene polling cuando encuentra match

### useProactiveMatchCheck

**Propósito**: Verificación inmediata después de votar

**Uso**:
```typescript
import { useProactiveMatchCheck } from '../hooks/useProactiveMatchCheck';

const VotingRoomScreen = () => {
  const checkForMatch = useProactiveMatchCheck(roomId, userId);

  const handleVote = async (vote: boolean) => {
    await voteOnMovie({ roomId, movieId, vote });
    await checkForMatch(); // Verificar inmediatamente
  };
};
```

## 🧪 Testing

### Unit Tests

```bash
npm test
```

### E2E Tests (futuro)

```bash
npm run test:e2e
```

## 📦 Build y Deployment

### Development Build

```bash
# Android
npx expo run:android

# iOS
npx expo run:ios
```

### Production Build con EAS

```bash
# Instalar EAS CLI
npm install -g eas-cli

# Login
eas login

# Configurar proyecto
eas build:configure

# Build Android
eas build --platform android --profile production

# Build iOS
eas build --platform ios --profile production
```

### Build Local (Android APK)

```bash
cd android
./gradlew assembleRelease

# APK en: android/app/build/outputs/apk/release/app-release.apk
```

### Configuración de Build (eas.json)

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

## 🐛 Troubleshooting

### Error: "Network request failed"

**Causa**: No se puede conectar al backend

**Solución**:
1. Verificar que `.env` tiene las variables correctas
2. Verificar que el backend está desplegado
3. Verificar conectividad de red

```bash
# Test de conectividad
curl https://tu-graphql-endpoint.appsync-api.eu-west-1.amazonaws.com/graphql
```

### Error: "User is not authenticated"

**Causa**: Token de autenticación expirado o inválido

**Solución**:
1. Cerrar sesión y volver a iniciar
2. Verificar configuración de Cognito en `.env`

### Metro Bundler no inicia

**Solución**:
```bash
# Limpiar cache
npx expo start --clear

# O manualmente
rm -rf node_modules
npm install
npx expo start
```

### Android Build falla

**Solución**:
```bash
# Limpiar build
cd android
./gradlew clean

# Rebuild
./gradlew assembleRelease
```

### Subscriptions no funcionan

**Solución**:
1. Verificar que AppSync tiene subscriptions habilitadas
2. Verificar permisos de IAM
3. Verificar logs en CloudWatch

```typescript
// Debug subscriptions
const subscription = subscribeToUserMatches(userId, (match) => {
  console.log('Subscription received:', match);
});

// Verificar que subscription está activa
console.log('Subscription active:', subscription);
```

## 📚 Referencias

- [React Native Documentation](https://reactnative.dev/)
- [Expo Documentation](https://docs.expo.dev/)
- [React Navigation](https://reactnavigation.org/)
- [AWS Amplify Documentation](https://docs.amplify.aws/)
- [TypeScript Documentation](https://www.typescriptlang.org/)

## 🔗 Enlaces Útiles

- [Main README](../README.md)
- [Infrastructure README](../infrastructure/README.md)
- [Deployment Guide](../docs/DEPLOYMENT_GUIDE.md)
- [Technical Documentation](../docs/technical/README.md)

---

**Última actualización**: 2026-02-06  
**Versión**: 2.2.1  
**Estado**: ✅ Production Ready
