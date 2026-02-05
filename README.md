# Trinity Movie Matching App

Una aplicación móvil para crear salas de votación de películas y encontrar coincidencias entre usuarios.

## 🎯 Descripción

Trinity es una aplicación que permite a los usuarios crear salas virtuales donde pueden votar por películas de forma anónima. Cuando todos los usuarios en una sala votan positivamente por la misma película, se genera un "match" y todos reciben una notificación.

### ✨ Características Principales
- **Votación Anónima**: Los usuarios votan sin ver las decisiones de otros
- **Matches en Tiempo Real**: Detección instantánea cuando todos coinciden
- **Optimistic UI**: Interfaz fluida con respuesta inmediata
- **Notificaciones Push**: Alertas instantáneas de matches
- **Integración TMDB**: Base de datos completa de películas y series

## 🏗️ Arquitectura

### Stack Tecnológico
- **Frontend**: React Native + Expo
- **Backend**: AWS CDK + TypeScript  
- **API**: AWS AppSync (GraphQL)
- **Base de Datos**: Amazon DynamoDB
- **Autenticación**: Amazon Cognito
- **Funciones**: AWS Lambda
- **API Externa**: The Movie Database (TMDB)

### Componentes Principales

```
trinity/
├── infrastructure/          # AWS CDK Infrastructure
│   ├── lib/
│   │   └── trinity-stack.ts # Stack principal de AWS
│   ├── src/handlers/        # Lambda functions
│   │   ├── tmdb/           # Integración con TMDB
│   │   ├── room/           # Gestión de salas
│   │   ├── vote/           # Procesamiento de votos
│   │   └── match/          # Gestión de matches
│   └── schema.graphql      # Esquema GraphQL
├── mobile/                 # React Native App
│   ├── src/
│   │   ├── screens/        # Pantallas de la UI
│   │   ├── services/       # Servicios de API
│   │   ├── hooks/          # Custom hooks
│   │   ├── context/        # React context
│   │   └── types/          # Tipos TypeScript
│   └── android/            # Configuración Android
└── docs/                   # Documentación
```

## 🚀 Funcionalidades

### 🏠 Gestión de Salas
- **Crear Sala**: Los usuarios pueden crear salas especificando tipo de media (película/serie) y géneros (máximo 2)
- **Unirse a Sala**: Otros usuarios pueden unirse usando un código único de 6 caracteres
- **Mis Salas**: Ver salas donde el usuario participa (creadas o unidas) que no tienen matches
- **Expiración Automática**: Las salas expiran automáticamente después de 24 horas

### 🗳️ Sistema de Votación
- **Votación Anónima**: Los usuarios votan por películas sin ver los votos de otros
- **Candidatos TMDB**: Las películas se obtienen de The Movie Database API con filtros de calidad
- **Optimistic UI**: Respuesta instantánea en la interfaz durante la votación
- **Detección de Matches**: Cuando todos votan positivamente por la misma película

### 🔔 Notificaciones en Tiempo Real
- **GraphQL Subscriptions**: Notificaciones instantáneas de matches via AWS AppSync
- **Polling Fallback**: Sistema de respaldo para garantizar la entrega de notificaciones
- **Notificaciones Push**: Integración con Expo Notifications para alertas móviles
- **Estados Sincronizados**: Actualización automática del estado de la sala

## 📱 Pantallas Principales

1. **AuthScreen**: Autenticación con Amazon Cognito (auto-confirmación habilitada)
2. **DashboardScreen**: Pantalla principal con opciones de navegación
3. **CreateRoomScreen**: Crear nueva sala (selección de tipo de media y géneros)
4. **JoinRoomScreen**: Unirse a sala existente (código de 6 caracteres)
5. **MyRoomsScreen**: Ver salas del usuario (creadas y unidas, sin matches)
6. **VotingRoomScreen**: Votar por películas con Optimistic UI
7. **MyMatchesScreen**: Ver matches encontrados con detalles de películas
8. **RecommendationsScreen**: Recomendaciones basadas en matches previos
9. **ProfileScreen**: Gestión de perfil de usuario

## 🔧 Configuración del Desarrollo

### Prerrequisitos
- Node.js 18+
- AWS CLI configurado
- AWS CDK CLI
- Expo CLI
- Android Studio (para desarrollo Android)

### Variables de Entorno

#### Infrastructure (.env)
```bash
TMDB_API_KEY=tu_api_key_de_tmdb
AWS_REGION=eu-west-1
```

#### Mobile (.env)
```bash
EXPO_PUBLIC_AWS_REGION=eu-west-1
EXPO_PUBLIC_USER_POOL_ID=tu_user_pool_id
EXPO_PUBLIC_USER_POOL_CLIENT_ID=tu_client_id
EXPO_PUBLIC_GRAPHQL_ENDPOINT=tu_graphql_endpoint
```

### Instalación

1. **Clonar el repositorio**
```bash
git clone <repository-url>
cd trinity_app
```

2. **Configurar Infrastructure**
```bash
cd infrastructure
npm install
cp .env.example .env
# Editar .env con tus valores
```

3. **Desplegar Infrastructure**
```bash
cdk bootstrap
cdk deploy
```

4. **Configurar Mobile**
```bash
cd ../mobile
npm install
cp .env.example .env
# Editar .env con los valores del deploy
```

5. **Ejecutar Mobile App**
```bash
npx expo start
```

## 🗄️ Base de Datos

### Tablas DynamoDB

#### trinity-rooms
- **PK**: `id` (UUID de la sala)
- **GSI**: `code-index` (código de 6 caracteres)
- **Atributos**: hostId, mediaType, genreIds, candidates, createdAt, ttl

#### trinity-votes
- **PK**: `roomId`
- **SK**: `userMovieId` (userId#movieId)
- **Atributos**: userId, movieId, vote, timestamp

#### trinity-matches
- **PK**: `roomId`
- **SK**: `movieId`
- **Atributos**: matchId, title, posterPath, matchedUsers, timestamp

## 🔄 Flujo de la Aplicación

### 1. Creación de Sala
1. Usuario selecciona tipo de media (MOVIE/TV) y géneros (máximo 2)
2. Sistema genera código único de 6 caracteres alfanuméricos
3. TMDB Lambda obtiene candidatos de películas filtrados por idioma occidental
4. Sala se almacena en DynamoDB con TTL de 24 horas
5. Se registra automáticamente la participación del host

### 2. Unión a Sala
1. Usuario ingresa código de sala de 6 caracteres
2. Sistema valida código y verifica que la sala esté activa
3. Se registra participación del usuario en la tabla de votos
4. Usuario accede a pantalla de votación con candidatos

### 3. Proceso de Votación
1. Usuario ve candidatos de películas con información de TMDB
2. Vota positivo/negativo por cada película con Optimistic UI
3. Vote Lambda procesa el voto y actualiza DynamoDB
4. Sistema verifica automáticamente si hay match después de cada voto

### 4. Detección de Match
1. Si todos los usuarios activos votan positivo por la misma película
2. Se crea registro en tabla de matches con detalles completos
3. Se publican notificaciones via GraphQL subscriptions
4. Usuarios reciben notificación push del match encontrado
5. La sala se marca como completada (con match)

### 5. Consulta de Mis Salas
1. Sistema busca salas donde el usuario es host
2. Sistema busca salas donde el usuario ha participado (votado)
3. Filtra salas expiradas (TTL) y salas con matches existentes
4. Retorna lista ordenada por fecha de creación descendente

## 🔐 Seguridad

### Autenticación
- **Amazon Cognito**: Gestión de usuarios y autenticación
- **JWT Tokens**: Autenticación en GraphQL API
- **IAM Roles**: Permisos granulares para Lambda functions

### Autorización
- **User Pool Groups**: Control de acceso por grupos
- **GraphQL Directives**: `@aws_auth` para proteger resolvers
- **Lambda Authorizers**: Validación adicional en funciones

## 📊 Monitoreo

### Logging Estructurado
```typescript
logger.userAction('Room created', { 
  roomId: room.id, 
  mediaType: room.mediaType,
  genreCount: room.genreIds.length 
});
```

### Métricas CloudWatch
- Salas creadas por día
- Matches generados
- Errores de API
- Latencia de funciones Lambda

## 🧪 Testing

### Unit Tests
```bash
cd infrastructure
npm test
```

### Integration Tests
```bash
cd mobile
npm test
```

## 🚀 Deployment

### Staging
```bash
cd infrastructure
cdk deploy --context environment=staging
```

### Production
```bash
cd infrastructure
cdk deploy --context environment=prod --require-approval broadening
```

### Mobile Build
```bash
cd mobile
npx expo build:android
```

## 📚 Documentación Adicional

### Documentación Técnica Completa
- **[Documentación Técnica](docs/technical/README.md)** - Índice completo de documentación técnica
- **[Arquitectura de la Aplicación](docs/technical/01-app-architecture.md)** - Concepto, arquitectura serverless y ventajas
- **[Lenguajes de Programación](docs/technical/02-programming-languages.md)** - Stack tecnológico y herramientas
- **[Servicios AWS](docs/technical/03-aws-services.md)** - Servicios utilizados y su propósito
- **[Funciones Lambda](docs/technical/04-lambda-functions.md)** - Microservicios especializados
- **[Esquemas GraphQL](docs/technical/05-graphql-schema.md)** - API completa y tipada
- **[Tablas DynamoDB](docs/technical/06-dynamodb-tables.md)** - Diseño de base de datos NoSQL
- **[Flujos de Aplicación](docs/technical/07-application-flows.md)** - Flujos detallados de funcionalidades
- **[Diagramas de Arquitectura](docs/technical/diagrams/architecture-overview.md)** - Diagramas visuales del sistema

### Guías de Deployment y Producción
- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md)
- [Production Build Guide](docs/PRODUCTION_BUILD_GUIDE.md)
- [Trinity Master Spec](docs/TRINITY_MASTER_SPEC.md)

## 🤝 Contribución

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para detalles.

## 🔗 Enlaces Útiles

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [React Native Documentation](https://reactnative.dev/)
- [Expo Documentation](https://docs.expo.dev/)
- [TMDB API Documentation](https://developers.themoviedb.org/3)
- [AWS AppSync Documentation](https://docs.aws.amazon.com/appsync/)