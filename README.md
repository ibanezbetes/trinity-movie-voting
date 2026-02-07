# 🎬 Trinity - Movie Matching App

Trinity es una aplicación móvil que ayuda a grupos de amigos a encontrar la película o serie perfecta para ver juntos. Usando un sistema de votación tipo "Tinder", todos los participantes votan sobre opciones hasta encontrar un match perfecto.

**Versión Actual**: 2.2.2  
**Última Actualización**: 2026-02-07

## 🎯 Características Principales

- **Salas de Votación**: Crea salas privadas con código único de 6 caracteres
- **Límite de Participantes**: Configura salas de 2 a 6 participantes (el host cuenta como 1)
- **Votación Intuitiva**: Sistema de swipe (like/dislike) para películas y series
- **Match Automático**: Detecta cuando todos los participantes coinciden en una opción
- **Recomendaciones Inteligentes**: Integración con TMDB para sugerencias personalizadas
- **Notificaciones en Tiempo Real**: AppSync subscriptions para notificar matches instantáneamente
- **Configuración Flexible**: Hasta 2 géneros por sala
- **Control de Capacidad**: Validación automática de límite de participantes

## 🏗️ Arquitectura

### Stack Tecnológico

**Frontend**:
- React Native + Expo
- TypeScript
- AWS Amplify (Auth + API)
- React Navigation

**Backend**:
- AWS CDK (Infrastructure as Code)
- AWS AppSync (GraphQL API)
- AWS Lambda (Serverless Functions)
- Amazon DynamoDB (NoSQL Database)
- Amazon Cognito (Authentication)
- TMDB API (Movie Database)

### Diagrama de Arquitectura

```
┌─────────────────┐
│  Mobile App     │
│  (React Native) │
└────────┬────────┘
         │
         ├─────────────────┐
         │                 │
    ┌────▼─────┐     ┌────▼──────┐
    │ Cognito  │     │  AppSync  │
    │  (Auth)  │     │ (GraphQL) │
    └──────────┘     └─────┬─────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐      ┌─────▼─────┐    ┌─────▼─────┐
    │  Room   │      │   Vote    │    │   Match   │
    │ Handler │      │  Handler  │    │  Handler  │
    └────┬────┘      └─────┬─────┘    └───────────┘
         │                 │
         │           ┌─────▼─────┐
         │           │ DynamoDB  │
         │           │  Tables   │
         │           └───────────┘
         │
    ┌────▼────┐
    │  TMDB   │
    │ Handler │
    └─────────┘
```

## 📁 Estructura del Proyecto

```
trinity/
├── infrastructure/          # AWS CDK Infrastructure
│   ├── lib/
│   │   └── trinity-stack.ts # Stack principal de CDK
│   ├── src/handlers/        # Lambda Functions
│   │   ├── room/           # Gestión de salas
│   │   ├── vote/           # Procesamiento de votos
│   │   ├── match/          # Detección de matches
│   │   └── tmdb/           # Integración con TMDB
│   ├── scripts/            # Scripts de utilidad
│   ├── lambda-zips/        # Lambda deployments
│   └── schema.graphql      # Esquema GraphQL
│
├── mobile/                 # React Native App
│   ├── src/
│   │   ├── screens/        # Pantallas de la app
│   │   ├── services/       # Servicios (API, Auth)
│   │   ├── hooks/          # Custom React Hooks
│   │   ├── context/        # React Context
│   │   ├── navigation/     # Configuración de navegación
│   │   └── types/          # TypeScript types
│   ├── android/            # Configuración Android
│   └── assets/             # Recursos estáticos
│
├── docs/                   # Documentación
│   ├── technical/          # Docs técnicas detalladas
│   ├── DEPLOYMENT_GUIDE.md
│   └── TRINITY_MASTER_SPEC.md
│
└── .kiro/                  # Configuración de Kiro AI
    └── steering/           # Guías de desarrollo
```

## 🚀 Inicio Rápido

### Prerrequisitos

- Node.js 18+
- AWS CLI configurado
- AWS CDK CLI (`npm install -g aws-cdk`)
- Expo CLI (`npm install -g expo-cli`)
- Cuenta de TMDB API

### 1. Clonar el Repositorio

```bash
git clone https://github.com/tu-usuario/trinity.git
cd trinity
```

### 2. Configurar Infrastructure

```bash
cd infrastructure

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env y añadir tu TMDB_API_KEY

# Bootstrap CDK (solo primera vez)
cdk bootstrap

# Desplegar a AWS
cdk deploy
```

### 3. Configurar Mobile App

```bash
cd mobile

# Instalar dependencias
npm install

# Configurar variables de entorno
# El archivo .env se genera automáticamente después del deployment
# O puedes crearlo manualmente:
cp .env.example .env
# Editar .env con los valores de AWS

# Iniciar en desarrollo
npx expo start --clear
```

## 📊 Modelo de Datos

### Tablas DynamoDB

#### `trinity-rooms`
```typescript
{
  id: string              // UUID (PK)
  code: string            // Código de 6 caracteres (GSI)
  hostId: string          // ID del creador
  mediaType: 'MOVIE' | 'TV'
  genreIds: number[]      // Máximo 2 géneros
  maxParticipants: number // 2-6 participantes
  candidates: Movie[]     // 50 películas sugeridas
  createdAt: string       // ISO timestamp
  ttl: number             // Expira en 24h
}
```

#### `trinity-votes`
```typescript
{
  roomId: string          // Partition Key
  userMovieId: string     // Sort Key: "userId#movieId"
  userId: string
  movieId: number         // TMDB ID
  vote: boolean           // true = like, false = dislike
  timestamp: string
}
```

#### `trinity-matches`
```typescript
{
  roomId: string          // Partition Key
  movieId: number         // Sort Key
  matchId: string         // UUID
  title: string
  posterPath: string
  matchedUsers: string[]  // IDs de usuarios que hicieron match
  timestamp: string
}
```

## 🔄 Flujos Principales

### 1. Crear Sala

```
Usuario → createRoom(mediaType, genreIds, maxParticipants)
  ↓
Room Handler genera código único
  ↓
TMDB Handler obtiene 50 candidatos
  ↓
Sala guardada en DynamoDB (TTL 24h)
  ↓
Usuario registrado como participante
```

### 2. Unirse a Sala

```
Usuario → joinRoom(code)
  ↓
Room Handler valida código
  ↓
Usuario registrado como participante
  ↓
Retorna sala con candidatos
```

### 3. Votar

```
Usuario → vote(roomId, movieId, vote)
  ↓
Vote Handler registra voto
  ↓
Verifica si hay match (todos votaron positivo)
  ↓
Si hay match:
  - Crea registro en trinity-matches
  - Publica notificación via AppSync
  - Usuarios reciben notificación en tiempo real
```

### 4. Algoritmo de Match

```typescript
// Match ocurre cuando:
positiveVotes.length === maxParticipants

// Ejemplo: Sala de 3 personas
// Usuario A vota SÍ → 1/3
// Usuario B vota SÍ → 2/3
// Usuario C vota SÍ → 3/3 ✅ MATCH!
```

## 🔐 Seguridad

- **Autenticación**: Amazon Cognito con User Pools
- **Autorización**: AppSync con reglas de autorización por usuario
- **API Keys**: Variables de entorno (nunca en código)
- **TTL**: Salas expiran automáticamente en 24h
- **Validación**: Input validation en todas las Lambda functions

## 🧪 Testing

### Infrastructure

```bash
cd infrastructure
npm test
```

### Mobile

```bash
cd mobile
npm test
```

### Limpiar Datos de Prueba

```bash
cd infrastructure/scripts
.\cleanup-test-rooms.ps1
```

## 📱 Build de Producción

### Android APK

```bash
cd mobile
npx eas build --platform android --profile production
```

### iOS

```bash
cd mobile
npx eas build --platform ios --profile production
```

## 🛠️ Scripts Útiles

### Infrastructure

```bash
# Compilar TypeScript
npm run build

# Desplegar a AWS
npm run deploy

# Ver diferencias antes de desplegar
cdk diff

# Destruir stack (¡cuidado!)
cdk destroy
```

### Mobile

```bash
# Desarrollo
npx expo start

# Build Android
npx eas build --platform android

# Build iOS
npx eas build --platform ios
```

### Utilidades

```bash
# Limpiar proyecto
.\cleanup.ps1

# Sincronizar desde AWS
node infrastructure/scripts/sync-from-aws.js

# Limpiar salas de prueba
.\infrastructure\scripts\cleanup-test-rooms.ps1
```

## 📚 Documentación Adicional

- [Guía de Deployment](docs/DEPLOYMENT_GUIDE.md)
- [Guía de Build de Producción](docs/PRODUCTION_BUILD_GUIDE.md)
- [Especificación Maestra](docs/TRINITY_MASTER_SPEC.md)
- [Documentación Técnica](docs/technical/README.md)
- [Scripts de Infrastructure](infrastructure/scripts/README.md)

## 🐛 Troubleshooting

### Error: "Room not found"
- Verifica que la sala no haya expirado (24h TTL)
- Comprueba que el código sea correcto (6 caracteres)

### Error: "TMDB_API_KEY not found"
- Configura la variable de entorno en `infrastructure/.env`
- Redespliega el stack: `cdk deploy`

### Notificaciones no llegan
- Verifica que AppSync subscriptions estén activas
- Comprueba los logs de CloudWatch
- Asegúrate de que el usuario esté autenticado

### Build de Android falla
- Limpia el build: `cd mobile/android && ./gradlew clean`
- Verifica que tengas Java 11 instalado
- Revisa `mobile/android/gradle.properties`

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo [LICENSE](LICENSE) para más detalles.

## 👥 Autores

- **Tu Nombre** - *Trabajo Inicial* - [tu-usuario](https://github.com/tu-usuario)

## 🙏 Agradecimientos

- [TMDB](https://www.themoviedb.org/) por su excelente API de películas
- [AWS](https://aws.amazon.com/) por la infraestructura serverless
- [Expo](https://expo.dev/) por simplificar el desarrollo móvil

---

**Version**: 2.2.2  
**Last Updated**: 2026-02-07  
**Status**: ✅ Production Ready  
**Region**: eu-west-1 (Ireland)

## 📝 Changelog

### v2.2.2 (2026-02-06)
- ✅ **Room Capacity Limit**: Implementado límite real de participantes en salas
  - Validación en backend al unirse a sala
  - El host cuenta como 1 participante
  - Mensaje de error "Sala llena" cuando se alcanza el límite
  - Re-entrada permitida para usuarios ya en la sala
- ✅ Mejoras en manejo de errores en JoinRoomScreen
- ✅ Documentación completa en `ROOM_CAPACITY_LIMIT_v2.2.2.md`

### v2.2.1 (2026-02-06)
- ✅ Fix de notificaciones duplicadas de match
- ✅ Eliminados Alerts nativos, solo MatchCelebrationScreen
- ✅ Navegación contextual mejorada
- ✅ Documentación completa actualizada

### v2.2.0 (2026-02-05)
- ✅ Smart Random Discovery en TMDB Handler
- ✅ Algoritmo de priorización de géneros (AND/OR)
- ✅ Filtros de calidad mejorados
- ✅ Proyecto limpio y organizado
