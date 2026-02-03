# Trinity Mobile App

Aplicación móvil React Native para Trinity Movie Matching, construida con Expo.

## 📱 Descripción

Aplicación móvil que permite a los usuarios crear y unirse a salas de votación de películas, votar de forma anónima y recibir notificaciones cuando se encuentran matches.

## 🏗️ Arquitectura

### Stack Tecnológico
- **React Native**: Framework de desarrollo móvil
- **Expo**: Plataforma de desarrollo y deployment
- **TypeScript**: Tipado estático
- **AWS Amplify**: SDK para servicios AWS
- **GraphQL**: Cliente para API
- **React Navigation**: Navegación entre pantallas

### Estructura del Proyecto

```
mobile/
├── src/
│   ├── components/          # Componentes reutilizables
│   ├── config/             # Configuración AWS
│   │   └── aws-config.ts   # Configuración Amplify
│   ├── context/            # React Context
│   │   ├── AuthContext.tsx # Contexto de autenticación
│   │   └── MatchNotificationContext.tsx # Contexto de notificaciones
│   ├── data/               # Datos estáticos
│   │   └── staticRecommendations.ts
│   ├── hooks/              # Custom hooks
│   │   ├── useMatchPolling.ts
│   │   └── useProactiveMatchCheck.ts
│   ├── navigation/         # Configuración de navegación
│   │   └── AppNavigator.tsx
│   ├── screens/            # Pantallas de la aplicación
│   │   ├── AuthScreen.tsx
│   │   ├── CreateRoomScreen.tsx
│   │   ├── DashboardScreen.tsx
│   │   ├── JoinRoomScreen.tsx
│   │   ├── MyMatchesScreen.tsx
│   │   ├── MyRoomsScreen.tsx
│   │   ├── ProfileScreen.tsx
│   │   ├── RecommendationsScreen.tsx
│   │   └── VotingRoomScreen.tsx
│   ├── services/           # Servicios y utilidades
│   │   ├── amplify.ts      # Configuración Amplify
│   │   ├── auth.ts         # Servicios de autenticación
│   │   ├── graphql.ts      # Queries y mutations GraphQL
│   │   ├── logger.ts       # Sistema de logging
│   │   └── subscriptions.ts # GraphQL subscriptions
│   └── types/              # Definiciones de tipos
│       └── index.ts
├── android/                # Configuración Android
├── assets/                 # Recursos estáticos
├── App.tsx                 # Componente principal
├── app.json               # Configuración Expo
├── eas.json               # Configuración EAS Build
├── metro.config.js        # Configuración Metro bundler
├── package.json           # Dependencias
└── tsconfig.json          # Configuración TypeScript
```

## 🔧 Configuración

### Variables de Entorno

Crear archivo `.env` en la raíz del proyecto mobile:

```bash
# AWS Configuration
EXPO_PUBLIC_AWS_REGION=eu-west-1
EXPO_PUBLIC_USER_POOL_ID=eu-west-1_XXXXXXXXX
EXPO_PUBLIC_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_GRAPHQL_ENDPOINT=https://xxxxxxxxxx.appsync-api.eu-west-1.amazonaws.com/graphql

# App Configuration
EXPO_PUBLIC_APP_NAME=Trinity
EXPO_PUBLIC_APP_VERSION=1.0.0
```

### Instalación

```bash
# Instalar dependencias
npm install

# Instalar Expo CLI (si no está instalado)
npm install -g @expo/cli

# Iniciar desarrollo
npx expo start
```

## 📱 Pantallas

### AuthScreen
**Propósito**: Autenticación de usuarios con Amazon Cognito

**Funcionalidades**:
- Login con email/password
- Registro de nuevos usuarios
- Recuperación de contraseña
- Validación de email

**Componentes**:
- Formularios de login/registro
- Validación en tiempo real
- Manejo de errores

### DashboardScreen
**Propósito**: Pantalla principal con opciones de navegación

**Funcionalidades**:
- Crear nueva sala
- Unirse a sala existente
- Ver mis salas
- Ver mis matches
- Acceder a recomendaciones
- Perfil de usuario

### CreateRoomScreen
**Propósito**: Crear nueva sala de votación

**Funcionalidades**:
- Seleccionar tipo de media (Película/Serie)
- Elegir hasta 2 géneros
- Generar código de sala único
- Obtener candidatos de TMDB

**Flujo**:
1. Usuario selecciona tipo de media
2. Elige géneros de lista
3. Sistema crea sala y genera código
4. Navega a pantalla de votación

### JoinRoomScreen
**Propósito**: Unirse a sala existente mediante código

**Funcionalidades**:
- Ingresar código de 6 caracteres
- Validar código en tiempo real
- Unirse a sala activa
- Manejo de errores (sala no encontrada, expirada)

### MyRoomsScreen
**Propósito**: Ver salas donde el usuario participa

**Funcionalidades**:
- Listar salas activas (sin matches)
- Mostrar información de sala (código, tipo, géneros)
- Indicar si es host o participante
- Navegar a sala para votar
- Pull-to-refresh

**Filtros**:
- Solo salas donde el usuario participa
- Solo salas sin matches
- Solo salas no expiradas

### VotingRoomScreen
**Propósito**: Votar por películas en la sala

**Funcionalidades**:
- Mostrar candidatos de películas
- Votar positivo/negativo
- Ver progreso de votación
- Recibir notificaciones de matches
- Información de película (título, año, sinopsis)

**Estados**:
- Cargando candidatos
- Votando
- Esperando otros usuarios
- Match encontrado

### MyMatchesScreen
**Propósito**: Ver historial de matches

**Funcionalidades**:
- Listar todos los matches del usuario
- Mostrar detalles de película
- Información de sala y participantes
- Ordenar por fecha

### RecommendationsScreen
**Propósito**: Recomendaciones basadas en matches

**Funcionalidades**:
- Recomendaciones personalizadas
- Basadas en géneros de matches anteriores
- Integración con TMDB para sugerencias

### ProfileScreen
**Propósito**: Gestión de perfil de usuario

**Funcionalidades**:
- Ver información de usuario
- Estadísticas (salas creadas, matches)
- Cerrar sesión
- Configuraciones

## 🔄 Servicios

### AuthService
**Archivo**: `src/services/auth.ts`

**Funcionalidades**:
- Wrapper para AWS Amplify Auth
- Gestión de sesiones
- Manejo de tokens JWT
- Refresh automático de tokens

```typescript
export const authService = {
  signIn: (email: string, password: string) => Promise<AuthResult>,
  signUp: (email: string, password: string) => Promise<AuthResult>,
  signOut: () => Promise<void>,
  getCurrentUser: () => Promise<User | null>,
  confirmSignUp: (email: string, code: string) => Promise<AuthResult>
};
```

### GraphQL Service
**Archivo**: `src/services/graphql.ts`

**Funcionalidades**:
- Queries y mutations predefinidas
- Cliente GraphQL configurado
- Manejo de errores
- Tipado TypeScript

**Operaciones Principales**:
```typescript
// Mutations
CREATE_ROOM_MUTATION
JOIN_ROOM_MUTATION  
VOTE_MUTATION

// Queries
GET_MY_ROOMS
GET_MY_MATCHES
GET_ROOM

// Subscriptions
USER_MATCH_SUBSCRIPTION
ROOM_MATCH_SUBSCRIPTION
```

### Logger Service
**Archivo**: `src/services/logger.ts`

**Funcionalidades**:
- Logging estructurado
- Diferentes niveles (info, error, debug)
- Contexto de usuario
- Integración con servicios de monitoreo

```typescript
export const logger = {
  userAction: (action: string, data?: any) => void,
  apiRequest: (operation: string, data?: any) => void,
  apiResponse: (operation: string, data?: any) => void,
  error: (message: string, error: any, context?: any) => void
};
```

### Subscription Service
**Archivo**: `src/services/subscriptions.ts`

**Funcionalidades**:
- Gestión de GraphQL subscriptions
- Reconexión automática
- Manejo de errores de conexión
- Cleanup automático

## 🔔 Sistema de Notificaciones

### Match Notifications
**Contexto**: `MatchNotificationContext.tsx`

**Funcionalidades**:
- Escuchar matches en tiempo real
- Mostrar notificaciones in-app
- Polling de respaldo
- Gestión de estado de notificaciones

### Hooks de Notificaciones

#### useMatchPolling
**Propósito**: Polling de respaldo para matches

```typescript
const { isPolling, startPolling, stopPolling } = useMatchPolling(
  userId,
  onMatchFound
);
```

#### useProactiveMatchCheck
**Propósito**: Verificación proactiva de matches

```typescript
const { checkForMatches, isChecking } = useProactiveMatchCheck(
  userId,
  onMatchFound
);
```

## 🎨 Navegación

### Stack Navigator
**Archivo**: `src/navigation/AppNavigator.tsx`

**Estructura**:
```typescript
type RootStackParamList = {
  Auth: undefined;
  Dashboard: undefined;
  CreateRoom: undefined;
  JoinRoom: undefined;
  VotingRoom: { roomId: string; roomCode: string };
  MyRooms: undefined;
  MyMatches: undefined;
  Recommendations: undefined;
  Profile: undefined;
};
```

**Flujo de Navegación**:
1. **Auth** → Dashboard (después de login)
2. **Dashboard** → CreateRoom/JoinRoom/MyRooms/MyMatches
3. **CreateRoom** → VotingRoom (después de crear)
4. **JoinRoom** → VotingRoom (después de unirse)
5. **MyRooms** → VotingRoom (seleccionar sala)

## 🔐 Autenticación

### AWS Amplify Configuration
**Archivo**: `src/config/aws-config.ts`

```typescript
const awsConfig = {
  Auth: {
    region: process.env.EXPO_PUBLIC_AWS_REGION,
    userPoolId: process.env.EXPO_PUBLIC_USER_POOL_ID,
    userPoolWebClientId: process.env.EXPO_PUBLIC_USER_POOL_CLIENT_ID,
  },
  API: {
    GraphQL: {
      endpoint: process.env.EXPO_PUBLIC_GRAPHQL_ENDPOINT,
      region: process.env.EXPO_PUBLIC_AWS_REGION,
      defaultAuthMode: 'userPool',
    },
  },
};
```

### Auth Context
**Archivo**: `src/context/AuthContext.tsx`

**Estado Global**:
- Usuario actual
- Estado de autenticación
- Funciones de login/logout
- Loading states

## 📊 Estado y Datos

### Tipos TypeScript
**Archivo**: `src/types/index.ts`

**Tipos Principales**:
```typescript
interface User {
  userId: string;
  email: string;
  name?: string;
}

interface Room {
  id: string;
  code: string;
  hostId: string;
  mediaType: 'MOVIE' | 'TV';
  genreIds: number[];
  candidates: MovieCandidate[];
  createdAt: string;
}

interface Match {
  id: string;
  roomId: string;
  movieId: number;
  title: string;
  posterPath?: string;
  timestamp: string;
  matchedUsers: string[];
}

interface Vote {
  roomId: string;
  userId: string;
  movieId: number;
  vote: boolean;
}
```

## 🚀 Build y Deployment

### Development Build
```bash
# Ejecutar en simulador
npx expo start

# Ejecutar en dispositivo físico
npx expo start --tunnel
```

### Production Build

#### Android APK
```bash
# Build local
npx expo build:android

# EAS Build (recomendado)
npx eas build --platform android
```

#### Android AAB (Play Store)
```bash
npx eas build --platform android --profile production
```

### Configuración EAS
**Archivo**: `eas.json`

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
        "buildType": "aab"
      }
    }
  }
}
```

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### E2E Tests
```bash
npm run test:e2e
```

### Manual Testing
1. **Flujo de Autenticación**
   - Registro de usuario
   - Login/logout
   - Recuperación de contraseña

2. **Flujo de Salas**
   - Crear sala
   - Unirse a sala
   - Ver mis salas

3. **Flujo de Votación**
   - Votar por películas
   - Recibir notificaciones
   - Ver matches

## 🔧 Desarrollo

### Hot Reload
Expo proporciona hot reload automático durante el desarrollo.

### Debugging
```bash
# Abrir debugger
npx expo start --dev-client

# Logs en tiempo real
npx expo logs
```

### Linting
```bash
npm run lint
```

### TypeScript Check
```bash
npm run type-check
```

## 📱 Configuración Android

### Permisos
**Archivo**: `android/app/src/main/AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

### Configuración de Build
**Archivo**: `android/app/build.gradle`

- Configuración de signing
- Versioning automático
- Optimizaciones de build

## 🚨 Troubleshooting

### Errores Comunes

#### "Network request failed"
- Verificar configuración de AWS
- Comprobar conectividad de red
- Validar endpoints

#### "Authentication failed"
- Verificar User Pool configuration
- Comprobar tokens expirados
- Validar permisos

#### "GraphQL errors"
- Verificar schema compatibility
- Comprobar autenticación
- Validar variables de queries

### Debug Tools
- **Flipper**: Para debugging avanzado
- **React Native Debugger**: Para inspección de estado
- **AWS CloudWatch**: Para logs de backend

## 📚 Referencias

- [Expo Documentation](https://docs.expo.dev/)
- [React Native Documentation](https://reactnative.dev/)
- [AWS Amplify Documentation](https://docs.amplify.aws/)
- [React Navigation Documentation](https://reactnavigation.org/)
- [TypeScript Documentation](https://www.typescriptlang.org/)