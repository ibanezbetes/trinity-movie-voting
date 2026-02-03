# Trinity - Movie Matching App

Trinity es una aplicación móvil que permite a los usuarios crear salas virtuales para votar películas y encontrar coincidencias en tiempo real. Cuando todos los usuarios en una sala votan positivamente por la misma película, se crea un "match" y todos reciben notificaciones instantáneas.

## 🏗️ Arquitectura del Sistema

### Componentes Principales

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Mobile App    │    │   AWS AppSync    │    │   AWS Lambda    │
│   (React Native)│◄──►│   (GraphQL API)  │◄──►│   (Handlers)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Cognito       │    │   DynamoDB       │    │   TMDB API      │
│   (Auth)        │    │   (Database)     │    │   (Movies)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Tecnologías Utilizadas

- **Frontend**: React Native + Expo
- **Backend**: AWS CDK + TypeScript
- **API**: AWS AppSync (GraphQL)
- **Base de Datos**: Amazon DynamoDB
- **Autenticación**: Amazon Cognito
- **Funciones**: AWS Lambda
- **API Externa**: The Movie Database (TMDB)

## 📱 Funcionalidades

### Core Features
- ✅ **Autenticación de usuarios** con Cognito
- ✅ **Creación de salas** con códigos únicos
- ✅ **Unirse a salas** mediante código
- ✅ **Votación de películas** con sistema swipe
- ✅ **Detección de matches** en tiempo real
- ✅ **Notificaciones push** via GraphQL subscriptions
- ✅ **Historial de matches** personal

### Flujo de Usuario

1. **Registro/Login** → Usuario se autentica con Cognito
2. **Crear/Unirse a Sala** → Usuario crea sala o se une con código
3. **Votar Películas** → Sistema presenta películas filtradas por género
4. **Match Detection** → Cuando todos votan "sí" por la misma película
5. **Notificación** → Todos los usuarios reciben notificación instantánea
6. **Ver Matches** → Usuario puede revisar su historial de matches

## 🚀 Configuración del Proyecto

### Prerrequisitos

- Node.js 18+
- AWS CLI configurado
- AWS CDK v2
- Android Studio (para builds APK)
- Cuenta TMDB API

### Variables de Entorno

Crear `.env` en el directorio raíz:

```bash
# TMDB API Configuration
TMDB_API_KEY=tu_tmdb_api_key
TMDB_READ_TOKEN=tu_tmdb_read_token
TMDB_BASE_URL=https://api.themoviedb.org/3

# AWS Configuration (opcional, usa AWS CLI por defecto)
AWS_REGION=us-east-1
AWS_PROFILE=default
```

### Instalación

1. **Clonar repositorio**
```bash
git clone <repository-url>
cd trinity
```

2. **Instalar dependencias del backend**
```bash
cd infrastructure
npm install
```

3. **Instalar dependencias del frontend**
```bash
cd ../mobile
npm install
```

4. **Desplegar infraestructura AWS**
```bash
cd ../infrastructure
npm run deploy
```

5. **Configurar mobile app**
```bash
cd ../mobile
# El script de deployment genera automáticamente la configuración
npm start
```

## 🏗️ Infraestructura AWS

### Recursos Desplegados

#### DynamoDB Tables
- **TrinityRooms**: Almacena información de salas
- **TrinityVotes**: Registra votos de usuarios
- **TrinityMatches**: Guarda matches encontrados
- **TrinityUsers**: Información de usuarios

#### Lambda Functions
- **trinity-tmdb-handler**: Integración con TMDB API
- **trinity-room-handler**: Gestión de salas
- **trinity-vote-handler**: Procesamiento de votos y detección de matches
- **trinity-match-handler**: Gestión del historial de matches

#### AppSync API
- **GraphQL Endpoint**: API principal para operaciones CRUD
- **Real-time Subscriptions**: Notificaciones en tiempo real
- **Dual Authentication**: Cognito User Pool + IAM

#### Cognito User Pool
- **Autenticación**: Email + password
- **Auto-confirmación**: Sin verificación de email requerida
- **Token Management**: JWT tokens con refresh

### Esquema GraphQL

```graphql
type Room {
  id: ID!
  code: String!
  hostId: ID!
  mediaType: MediaType!
  genreIds: [Int!]!
  candidates: [MovieCandidate!]!
  createdAt: AWSDateTime!
}

type Match {
  id: ID!
  roomId: ID!
  movieId: Int!
  title: String!
  posterPath: String
  timestamp: AWSDateTime!
  matchedUsers: [ID!]!
}

type Mutation {
  createRoom(input: CreateRoomInput!): Room!
  joinRoom(code: String!): Room!
  vote(input: VoteInput!): VoteResult!
}

type Subscription {
  userMatch(userId: ID!): UserMatchEvent
  roomMatch(roomId: ID!): RoomMatchEvent
}
```

## 📱 Aplicación Móvil

### Estructura del Proyecto

```
mobile/
├── src/
│   ├── components/          # Componentes reutilizables
│   ├── screens/            # Pantallas principales
│   │   ├── AuthScreen.tsx
│   │   ├── DashboardScreen.tsx
│   │   ├── CreateRoomScreen.tsx
│   │   ├── JoinRoomScreen.tsx
│   │   ├── VotingRoomScreen.tsx
│   │   ├── MyMatchesScreen.tsx
│   │   └── MyRoomsScreen.tsx
│   ├── services/           # Servicios y APIs
│   │   ├── amplify.ts      # Configuración AWS
│   │   ├── auth.ts         # Autenticación
│   │   ├── graphql.ts      # Queries y mutations
│   │   ├── subscriptions.ts # Real-time subscriptions
│   │   └── logger.ts       # Sistema de logging
│   ├── hooks/              # Custom hooks
│   │   ├── useMatchPolling.ts
│   │   └── useProactiveMatchCheck.ts
│   ├── context/            # React Context
│   │   ├── AuthContext.tsx
│   │   └── MatchNotificationContext.tsx
│   ├── navigation/         # Navegación
│   │   └── AppNavigator.tsx
│   ├── types/              # TypeScript types
│   │   └── index.ts
│   └── config/             # Configuración
│       └── aws-config.ts
├── android/                # Configuración Android
├── assets/                 # Recursos estáticos
├── App.tsx                 # Componente principal
├── app.json               # Configuración Expo
├── package.json           # Dependencias
└── build-apk.bat          # Script de build APK
```

### Sistema de Notificaciones

#### Dual Subscription System
La app implementa un sistema dual de suscripciones para garantizar la entrega de notificaciones:

1. **User-Specific Subscriptions** (`userMatch`)
   - Canal dedicado por usuario
   - Garantiza que cada usuario reciba notificaciones individuales
   - Filtrado automático por userId

2. **Room-Based Subscriptions** (`roomMatch`)
   - Canal por sala para compatibilidad
   - Broadcast a todos los usuarios en la sala
   - Filtrado manual en el cliente

#### Polling Fallback
- Sistema de polling como respaldo
- Se activa si las subscriptions WebSocket fallan
- Verificación periódica de matches cada 2 segundos

### Build y Deployment

#### Desarrollo (Expo)
```bash
cd mobile
npm start
# Escanear QR code con Expo Go app
```

#### Producción (APK)
```bash
cd mobile
./build-apk.bat
# APK generado en: android/app/build/outputs/apk/release/
```

## 🔧 Desarrollo

### Comandos Útiles

#### Backend
```bash
# Desplegar infraestructura
cd infrastructure
npm run deploy

# Destruir infraestructura
npm run destroy

# Verificar diferencias
npm run diff

# Sintetizar CloudFormation
npm run synth
```

#### Frontend
```bash
# Desarrollo con Expo
cd mobile
npm start

# Build APK
./build-apk.bat

# Limpiar cache
npm run clean
```

### Debugging

#### Backend (Lambda Logs)
```bash
# Ver logs en tiempo real
aws logs tail /aws/lambda/trinity-vote-handler --follow

# Buscar errores específicos
aws logs filter-log-events \
  --log-group-name /aws/lambda/trinity-vote-handler \
  --filter-pattern "ERROR"
```

#### Frontend (React Native)
- Usar React Native Debugger
- Console logs disponibles en Metro bundler
- Sistema de logging personalizado en `src/services/logger.ts`

### Testing

#### Escenario de Prueba Principal
1. **Usuario A** abre app → Crea sala → Obtiene código
2. **Usuario B** abre app → Se une con código
3. **Usuario A** vota "sí" en película X → No hay match aún
4. **Usuario B** vota "sí" en película X → ¡MATCH!
5. **Verificar**: Ambos usuarios reciben notificación instantánea

## 📊 Monitoreo y Métricas

### CloudWatch Dashboards
- **Lambda Performance**: Duración, errores, invocaciones
- **DynamoDB Metrics**: Read/Write capacity, throttling
- **AppSync Metrics**: Request count, latency, errors

### Alertas Configuradas
- Lambda errors > 5% en 5 minutos
- DynamoDB throttling events
- AppSync 4xx/5xx errors

## 🔒 Seguridad

### Autenticación y Autorización
- **Cognito User Pool**: Gestión de usuarios
- **JWT Tokens**: Autenticación stateless
- **IAM Roles**: Permisos granulares para Lambda
- **AppSync Authorization**: User Pool + IAM dual mode

### Validación de Datos
- **Input Validation**: En Lambda handlers
- **Schema Validation**: GraphQL type safety
- **Rate Limiting**: AppSync built-in protection

## 🚀 Deployment

### Ambientes

#### Development
- **Stack Name**: `TrinityStack-dev`
- **Auto-deploy**: En push a `develop` branch
- **Configuración**: Logs detallados, sin TTL en tablas

#### Production
- **Stack Name**: `TrinityStack-prod`
- **Manual deploy**: Requiere aprobación
- **Configuración**: Logs mínimos, TTL configurado, backup habilitado

### CI/CD Pipeline
```yaml
# .github/workflows/deploy.yml
name: Deploy Trinity
on:
  push:
    branches: [main, develop]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      - name: Install dependencies
        run: cd infrastructure && npm install
      - name: Deploy to AWS
        run: cd infrastructure && npm run deploy
```

## 📚 Documentación Adicional

- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md)
- [Production Build Guide](docs/PRODUCTION_BUILD_GUIDE.md)
- [Trinity Master Spec](docs/TRINITY_MASTER_SPEC.md)

## 🤝 Contribución

1. Fork el repositorio
2. Crear feature branch (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push al branch (`git push origin feature/nueva-funcionalidad`)
5. Crear Pull Request

## 📄 Licencia

Este proyecto está bajo la licencia MIT. Ver [LICENSE](LICENSE) para más detalles.

## 🆘 Soporte

Para reportar bugs o solicitar features:
- Crear issue en GitHub
- Incluir logs relevantes
- Describir pasos para reproducir el problema

---

**Trinity** - Encuentra tu próxima película favorita con amigos 🎬