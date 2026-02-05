# Trinity Mobile App

Aplicación móvil de Trinity construida con React Native y Expo para iOS y Android.

## 📱 Descripción

Trinity Mobile es la interfaz de usuario para el sistema de votación colaborativa de películas. Permite a los usuarios crear salas, unirse a ellas, votar por películas y recibir notificaciones en tiempo real cuando hay un match.

## 🏗️ Arquitectura

### Stack Tecnológico

- **React Native**: 0.81.5
- **Expo SDK**: 54
- **TypeScript**: 5.9.2
- **React Navigation**: 7.x
- **AWS Amplify**: 6.16.0
- **AsyncStorage**: 2.2.0

### Arquitectura de la App

```
┌─────────────────────────────────────────────────────────┐
│                    App.tsx                              │
│                 (Entry Point)                           │
└────────┬────────────────────────────────────────────────┘
         │
         ├─── AuthContext (Authentication State)
         │
         ├─── MatchNotificationContext (Match Notifications)
         │
         └─── AppNavigator (Navigation)
                   │
                   ├─── Dashboard
                   ├─── CreateRoom
                   ├─── JoinRoom
                   ├─── VotingRoom
                   ├─── MatchCelebration
                   ├─── MyRooms
                   ├─── MyMatches
                   └─── Profile
```

## 📁 Estructura

```
mobile/
├── src/
│   ├── screens/                # Pantallas de la app
│   │   ├── AuthScreen.tsx
│   │   ├── DashboardScreen.tsx
│   │   ├── CreateRoomScreen.tsx
│   │   ├── JoinRoomScreen.tsx
│   │   ├── VotingRoomScreen.tsx
│   │   ├── MatchCelebrationScreen.tsx
│   │   ├── MyRoomsScreen.tsx
│   │   ├── MyMatchesScreen.tsx
│   │   ├── RecommendationsScreen.tsx
│   │   └── ProfileScreen.tsx
│   │
│   ├── services/               # Servicios
│   │   ├── amplify.ts         # Configuración AWS Amplify
│   │   ├── auth.ts            # Servicio de autenticación
│   │   ├── graphql.ts         # Queries y mutations GraphQL
│   │   ├── logger.ts          # Servicio de logging
│   │   └── subscriptions.ts   # GraphQL subscriptions
│   │
│   ├── hooks/                  # Custom hooks
│   │   ├── useMatchPolling.ts
│   │   └── useProactiveMatchCheck.ts
│   │
│   ├── context/                # React Context
│   │   ├── AuthContext.tsx
│   │   └── MatchNotificationContext.tsx
│   │
│   ├── navigation/             # Navegación
│   │   └── AppNavigator.tsx
│   │
│   ├── config/                 # Configuración
│   │   └── aws-config.ts
│   │
│   ├── data/                   # Datos estáticos
│   │   └── staticRecommendations.ts
│   │
│   └── types/                  # Tipos TypeScript
│       └── index.ts
│
├── android/                    # Configuración Android
│   ├── app/
│   │   ├── build.gradle
│   │   └── src/main/
│   ├── gradle/
│   ├── build.gradle
│   └── settings.gradle
│
├── assets/                     # Assets estáticos
│   ├── icon.png
│   ├── splash-icon.png
│   └── adaptive-icon.png
│
├── App.tsx                     # Componente principal
├── index.ts                    # Entry point
├── app.json                    # Configuración Expo
├── eas.json                    # Configuración EAS Build
├── metro.config.js             # Configuración Metro bundler
├── tsconfig.json               # Configuración TypeScript
├── package.json                # Dependencias
├── .env.example                # Template de variables de entorno
└── README.md                   # Este archivo
```

## 🚀 Instalación

### Prerrequisitos

- Node.js 18+
- npm o yarn
- Expo CLI: `npm install -g expo-cli`
- Para Android: Android Studio y SDK
- Para iOS: Xcode (solo en macOS)

### Configuración Inicial

1. **Instalar dependencias**:
   ```bash
   npm install
   ```

2. **Configurar variables de entorno**:
   ```bash
   cp .env.example .env
   ```
   
   Editar `.env` con los valores de tu infraestructura AWS:
   ```bash
   EXPO_PUBLIC_AWS_REGION=eu-west-1
   EXPO_PUBLIC_USER_POOL_ID=tu_user_pool_id
   EXPO_PUBLIC_USER_POOL_CLIENT_ID=tu_client_id
   EXPO_PUBLIC_GRAPHQL_ENDPOINT=tu_graphql_endpoint
   EXPO_PUBLIC_APP_NAME=Trinity
   EXPO_PUBLIC_APP_VERSION=1.0.0
   ```

3. **Iniciar en desarrollo**:
   ```bash
   npx expo start
   ```

## 📱 Desarrollo

### Comandos Disponibles

```bash
# Iniciar Metro bundler
npx expo start

# Limpiar cache e iniciar
npx expo start --clear

# Ejecutar en Android
npx expo run:android

# Ejecutar en iOS (solo macOS)
npx expo run:ios

# Ejecutar en web
npx expo start --web
```

### Desarrollo con Expo Go

1. Instala Expo Go en tu dispositivo móvil
2. Ejecuta `npx expo start`
3. Escanea el QR code con Expo Go

### Desarrollo con Emulador

**Android**:
```bash
# Asegúrate de tener Android Studio instalado
npx expo run:android
```

**iOS** (solo macOS):
```bash
# Asegúrate de tener Xcode instalado
npx expo run:ios
```

## 🏗️ Build de Producción

### Build APK (Android)

#### Método 1: Gradle (Tradicional)

```bash
# Prebuild
npx expo prebuild --clean

# Build APK
cd android
./gradlew assembleRelease

# APK generada en:
# android/app/build/outputs/apk/release/app-release.apk
```

#### Método 2: EAS Build

```bash
# Configurar EAS
eas build:configure

# Build para Android
eas build --platform android --profile production

# Build para iOS
eas build --platform ios --profile production
```

### Configuración de Build

**app.json**:
```json
{
  "expo": {
    "name": "Trinity",
    "slug": "trinity",
    "version": "1.0.0",
    "android": {
      "package": "com.trinityapp.mobile",
      "versionCode": 1
    },
    "ios": {
      "bundleIdentifier": "com.trinityapp.mobile",
      "buildNumber": "1.0.0"
    }
  }
}
```

## 📱 Pantallas

### AuthScreen

**Ruta**: `/`  
**Descripción**: Pantalla de autenticación (login/registro)

**Funcionalidades**:
- Login con email/password
- Registro de nuevos usuarios
- Validación de formularios
- Integración con AWS Cognito

### DashboardScreen

**Ruta**: `/dashboard`  
**Descripción**: Pantalla principal de la app

**Funcionalidades**:
- Crear nueva sala
- Unirse a sala existente
- Ver mis salas
- Ver mis matches
- Acceso a perfil

### CreateRoomScreen

**Ruta**: `/create-room`  
**Descripción**: Creación de nueva sala de votación

**Funcionalidades**:
- Selección de tipo de media (Película/Serie)
- Selección de géneros (máximo 2)
- Generación automática de código de sala
- Obtención de candidatos de TMDB

**Flujo**:
1. Usuario selecciona tipo de media
2. Usuario selecciona hasta 2 géneros
3. Sistema genera código único
4. Sistema obtiene candidatos de TMDB
5. Sala creada → Redirige a VotingRoom

### JoinRoomScreen

**Ruta**: `/join-room`  
**Descripción**: Unirse a sala existente con código

**Funcionalidades**:
- Input de código de sala (6 caracteres)
- Validación de código
- Verificación de sala activa
- Registro de participación

**Flujo**:
1. Usuario ingresa código de 6 caracteres
2. Sistema valida código
3. Sistema verifica que sala existe y está activa
4. Usuario se une → Redirige a VotingRoom

### VotingRoomScreen

**Ruta**: `/voting-room/:roomId`  
**Descripción**: Sala de votación de películas

**Funcionalidades**:
- Visualización de candidatos
- Votación positiva/negativa
- Contador de votos
- Detección automática de matches
- Subscriptions en tiempo real

**Flujo**:
1. Usuario ve candidato actual
2. Usuario vota positivo (👍) o negativo (👎)
3. Sistema registra voto
4. Sistema verifica si hay match
5. Si hay match → Notificación + MatchCelebration

### MatchCelebrationScreen

**Ruta**: `/match-celebration`  
**Descripción**: Pantalla de celebración cuando hay match

**Funcionalidades**:
- Póster grande de la película
- Título y detalles del match
- Número de usuarios que coincidieron
- Navegación contextual

**Navegación**:
- Si `wasInRoom: true`: "Ver Mis Matches" + "Ir al Inicio"
- Si `wasInRoom: false`: "Ver Mis Matches" + "Continuar"

### MyRoomsScreen

**Ruta**: `/my-rooms`  
**Descripción**: Historial de salas del usuario

**Funcionalidades**:
- Lista de salas creadas
- Lista de salas donde participó
- Filtrado de salas activas
- Acceso rápido a salas

### MyMatchesScreen

**Ruta**: `/my-matches`  
**Descripción**: Historial de matches del usuario

**Funcionalidades**:
- Lista de todas las películas con match
- Póster y título de cada película
- Fecha del match
- Usuarios que coincidieron

### ProfileScreen

**Ruta**: `/profile`  
**Descripción**: Perfil y configuración del usuario

**Funcionalidades**:
- Información del usuario
- Cerrar sesión
- Configuración de la app

## 🔧 Servicios

### amplify.ts

Configuración de AWS Amplify:

```typescript
import { Amplify } from 'aws-amplify';

Amplify.configure({
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
});
```

### auth.ts

Servicio de autenticación:

```typescript
export const signIn = async (email: string, password: string);
export const signUp = async (email: string, password: string);
export const signOut = async ();
export const getCurrentUser = async ();
```

### graphql.ts

Queries y mutations GraphQL:

```typescript
// Queries
export const GET_ROOM_BY_CODE = `query GetRoomByCode($code: String!) { ... }`;
export const GET_MY_ROOMS = `query GetMyRooms { ... }`;
export const GET_MY_MATCHES = `query GetMyMatches { ... }`;

// Mutations
export const CREATE_ROOM = `mutation CreateRoom($input: CreateRoomInput!) { ... }`;
export const VOTE = `mutation Vote($input: VoteInput!) { ... }`;

// Subscriptions
export const USER_MATCH_SUBSCRIPTION = `subscription OnUserMatch($userId: ID!) { ... }`;
export const ROOM_MATCH_SUBSCRIPTION = `subscription OnRoomMatch($roomId: ID!) { ... }`;
```

### subscriptions.ts

Gestión de subscriptions GraphQL:

```typescript
export const matchSubscriptionService = {
  subscribe: (userId: string, callback: (match: Match) => void),
  unsubscribe: (),
};

export const roomSubscriptionService = {
  subscribeToRoom: (roomId: string, userId: string, callback),
  unsubscribeFromRoom: (roomId: string),
  unsubscribeFromAllRooms: (),
};
```

### logger.ts

Servicio de logging estructurado:

```typescript
export const logger = {
  info: (category: string, message: string, data?: any),
  error: (category: string, message: string, error: any, data?: any),
  userAction: (action: string, data?: any),
  apiRequest: (operation: string, data?: any),
  apiResponse: (operation: string, data?: any),
  match: (message: string, data?: any),
  matchError: (message: string, error: any, data?: any),
};
```

## 🎣 Custom Hooks

### useMatchPolling

Hook para polling de matches como fallback:

```typescript
const { startPolling, stopPolling } = useMatchPolling(
  roomId,
  (match) => {
    // Handle match
  }
);
```

### useProactiveMatchCheck

Hook para verificación proactiva de matches:

```typescript
const { checkForMatchesBeforeAction, isCheckingMatches } = useProactiveMatchCheck();

// Verificar antes de una acción
await checkForMatchesBeforeAction(() => {
  // Acción a ejecutar si no hay matches
});
```

## 🌐 Context Providers

### AuthContext

Gestión del estado de autenticación:

```typescript
const { user, isAuthenticated, signIn, signUp, signOut } = useAuth();
```

### MatchNotificationContext

Gestión de notificaciones de matches:

```typescript
const {
  checkForMatchesBeforeAction,
  isCheckingMatches,
  activeRooms,
  addActiveRoom,
  removeActiveRoom,
  dismissNotification,
} = useMatchNotification();
```

## 🎨 Estilos y Temas

### Colores Principales

```typescript
const colors = {
  primary: '#e94560',      // Rojo/Rosa
  background: '#1a1a2e',   // Oscuro
  card: '#2a2a3e',         // Gris oscuro
  text: '#ffffff',         // Blanco
  textSecondary: '#a0a0a0', // Gris
  success: '#4caf50',      // Verde
  error: '#f44336',        // Rojo
};
```

### Componentes Estilizados

- **TouchableOpacity**: Botones con feedback táctil
- **ScrollView**: Listas scrolleables
- **Image**: Imágenes con lazy loading
- **View**: Contenedores con flexbox

## 🧪 Testing

```bash
# Ejecutar tests
npm test

# Tests con coverage
npm run test:coverage

# Tests en modo watch
npm run test:watch
```

## 🐛 Troubleshooting

### Error: "Metro bundler not starting"

```bash
npx expo start --clear
```

### Error: "Unable to resolve module"

```bash
rm -rf node_modules
npm install
npx expo start --clear
```

### Error: "Android build failed"

```bash
cd android
./gradlew clean
cd ..
npx expo prebuild --clean
```

### Subscriptions no funcionan

1. Verificar que el endpoint GraphQL es correcto
2. Verificar que el usuario está autenticado
3. Verificar permisos en AppSync
4. Revisar logs de CloudWatch

## 📚 Recursos

- [React Native Documentation](https://reactnative.dev/)
- [Expo Documentation](https://docs.expo.dev/)
- [React Navigation](https://reactnavigation.org/)
- [AWS Amplify for React Native](https://docs.amplify.aws/react-native/)

## 🤝 Contribución

Ver [../README.md](../README.md) para guías de contribución.

## 📄 Licencia

MIT License - Ver [../LICENSE](../LICENSE)
