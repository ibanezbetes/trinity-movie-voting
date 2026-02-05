# Trinity Infrastructure

Infraestructura serverless de Trinity usando AWS CDK (Cloud Development Kit) con TypeScript.

## 🏗️ Arquitectura

### Componentes AWS

```
┌─────────────────────────────────────────────────────────┐
│                    AWS AppSync                          │
│                  (GraphQL API)                          │
└────────┬────────────────────────────────────────────────┘
         │
         ├─── Lambda: Room Handler
         │    └─── Gestión de salas de votación
         │
         ├─── Lambda: Vote Handler
         │    └─── Procesamiento de votos y detección de matches
         │
         ├─── Lambda: Match Handler
         │    └─── Consulta y gestión de matches
         │
         └─── Lambda: TMDB Handler
              └─── Integración con The Movie Database API
                   │
                   ├─── DynamoDB: trinity-rooms
                   ├─── DynamoDB: trinity-votes
                   └─── DynamoDB: trinity-matches
```

### Servicios AWS Utilizados

- **AWS AppSync**: API GraphQL con subscriptions en tiempo real
- **AWS Lambda**: Funciones serverless para lógica de negocio
- **Amazon DynamoDB**: Base de datos NoSQL para almacenamiento
- **Amazon Cognito**: Autenticación y gestión de usuarios
- **AWS IAM**: Gestión de permisos y roles

## 📁 Estructura

```
infrastructure/
├── lib/
│   └── trinity-stack.ts        # Stack principal de CDK
├── src/handlers/               # Lambda functions
│   ├── room/
│   │   ├── index.ts           # Handler de salas
│   │   └── package.json       # Dependencias
│   ├── vote/
│   │   ├── index.ts           # Handler de votos
│   │   └── package.json       # Dependencias
│   ├── match/
│   │   ├── index.ts           # Handler de matches
│   │   └── package.json       # Dependencias
│   └── tmdb/
│       ├── index.ts           # Handler de TMDB
│       └── package.json       # Dependencias
├── lambda-zips/                # ZIPs compilados para deployment
│   ├── room-handler.zip
│   ├── vote-handler.zip
│   ├── match-handler.zip
│   └── tmdb-handler.zip
├── scripts/                    # Scripts de utilidad
│   ├── generate-mobile-config.js
│   ├── sync-from-aws.js
│   └── update-mobile-config.js
├── bin/
│   └── trinity.ts             # Entry point de CDK
├── schema.graphql             # Esquema GraphQL
├── cdk.json                   # Configuración de CDK
├── tsconfig.json              # Configuración TypeScript
├── package.json               # Dependencias
├── .env.example               # Template de variables de entorno
└── README.md                  # Este archivo
```

## 🚀 Instalación

### Prerrequisitos

- Node.js 18+
- AWS CLI configurado con credenciales
- AWS CDK CLI instalado globalmente:
  ```bash
  npm install -g aws-cdk
  ```
- Cuenta de TMDB API (https://www.themoviedb.org/settings/api)

### Configuración Inicial

1. **Instalar dependencias**:
   ```bash
   npm install
   ```

2. **Configurar variables de entorno**:
   ```bash
   cp .env.example .env
   ```
   
   Editar `.env` con tus valores:
   ```bash
   TMDB_API_KEY=tu_api_key_de_tmdb
   AWS_REGION=eu-west-1
   AWS_ACCOUNT_ID=tu_account_id
   ```

3. **Bootstrap de CDK** (solo primera vez):
   ```bash
   cdk bootstrap aws://ACCOUNT-ID/REGION
   ```

## 📦 Deployment

### Desarrollo

```bash
# Compilar TypeScript
npm run build

# Ver cambios antes de desplegar
cdk diff

# Desplegar a AWS
cdk deploy

# Ver outputs (endpoints, IDs, etc.)
cdk deploy --outputs-file outputs.json
```

### Producción

```bash
# Desplegar con confirmación
cdk deploy --require-approval broadening

# Desplegar con contexto específico
cdk deploy --context environment=prod
```

### Actualizar Lambda Functions

Las funciones Lambda se actualizan automáticamente con `cdk deploy`. Los ZIPs en `lambda-zips/` se generan durante el build.

Para actualizar manualmente una función específica:

```bash
# Compilar handler específico
cd src/handlers/vote
npm install
tsc

# Volver a desplegar
cd ../../..
cdk deploy
```

## 🔧 Lambda Functions

### Room Handler

**Responsabilidades**:
- Crear salas de votación
- Generar códigos únicos de sala
- Obtener candidatos de TMDB
- Consultar salas del usuario
- Validar y gestionar TTL

**Operaciones GraphQL**:
- `createRoom(input: CreateRoomInput!): Room!`
- `getRoomByCode(code: String!): Room`
- `getMyRooms: [Room!]!`

**Archivo**: `src/handlers/room/index.ts`

### Vote Handler

**Responsabilidades**:
- Registrar votos de usuarios
- Detectar matches automáticamente
- Publicar notificaciones de matches
- Validar acceso a salas

**Operaciones GraphQL**:
- `vote(input: VoteInput!): VoteResult!`

**Archivo**: `src/handlers/vote/index.ts`

**Lógica de Match**:
1. Usuario vota positivo por una película
2. Se cuentan votos positivos para esa película
3. Se obtienen usuarios únicos que han votado en la sala
4. Si todos los usuarios votaron positivo → Match!
5. Se crea registro en tabla de matches
6. Se publican notificaciones via AppSync

### Match Handler

**Responsabilidades**:
- Consultar matches del usuario
- Filtrar por usuario en matchedUsers
- Retornar historial de matches

**Operaciones GraphQL**:
- `getMyMatches: [Match!]!`

**Archivo**: `src/handlers/match/index.ts`

### TMDB Handler

**Responsabilidades**:
- Obtener películas/series de TMDB API
- Filtrar por géneros
- Formatear respuestas
- Manejar rate limiting

**Operaciones GraphQL**:
- `getMovieRecommendations(genreIds: [Int!]!): [MovieCandidate!]!`
- `getTVRecommendations(genreIds: [Int!]!): [MovieCandidate!]!`

**Archivo**: `src/handlers/tmdb/index.ts`

## 📊 Tablas DynamoDB

### trinity-rooms

**Partition Key**: `id` (String)

**Atributos**:
```typescript
{
  id: string;              // UUID
  code: string;            // Código de 6 caracteres (GSI)
  hostId: string;          // ID del creador
  mediaType: 'MOVIE' | 'TV';
  genreIds: number[];      // Máximo 2 géneros
  candidates: MovieCandidate[];
  createdAt: string;       // ISO timestamp
  ttl: number;             // Unix timestamp (24h)
}
```

**GSI**: `code-index` para búsqueda por código

**TTL**: 24 horas desde creación

### trinity-votes

**Partition Key**: `roomId` (String)  
**Sort Key**: `userMovieId` (String) - Formato: `userId#movieId`

**Atributos**:
```typescript
{
  roomId: string;
  userMovieId: string;     // userId#movieId
  userId: string;
  movieId: number;         // TMDB ID (-1 para participación)
  vote: boolean;
  timestamp: string;
  isParticipation?: boolean;
}
```

### trinity-matches

**Partition Key**: `roomId` (String)  
**Sort Key**: `movieId` (Number)

**Atributos**:
```typescript
{
  id: string;              // matchId único
  roomId: string;
  movieId: number;
  title: string;
  posterPath?: string;
  mediaType: 'MOVIE' | 'TV';
  matchedUsers: string[];  // Array de userIds
  timestamp: string;
}
```

## 🔐 Seguridad

### Autenticación

- **Cognito User Pool**: Gestión de usuarios
- **Cognito Identity Pool**: Acceso a recursos AWS
- **JWT Tokens**: Autenticación en AppSync

### Autorización

GraphQL con directivas `@aws_auth`:

```graphql
type Query {
  getMyRooms: [Room!]! @aws_auth(cognito_groups: ["Users"])
  getMyMatches: [Match!]! @aws_auth(cognito_groups: ["Users"])
}

type Mutation {
  createRoom(input: CreateRoomInput!): Room! 
    @aws_auth(cognito_groups: ["Users"])
  vote(input: VoteInput!): VoteResult! 
    @aws_auth(cognito_groups: ["Users"])
}
```

### IAM Roles

- **Lambda Execution Role**: Permisos para DynamoDB, CloudWatch Logs
- **AppSync Service Role**: Permisos para invocar Lambdas
- **Cognito Authenticated Role**: Permisos para AppSync

## 📝 GraphQL Schema

Ver [schema.graphql](schema.graphql) para el esquema completo.

### Tipos Principales

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
  matchedUsers: [ID!]!
  timestamp: AWSDateTime!
}

type VoteResult {
  success: Boolean!
  match: Match
}
```

### Subscriptions

```graphql
type Subscription {
  userMatch(userId: ID!): UserMatchEvent
    @aws_subscribe(mutations: ["publishUserMatch"])
    @aws_iam
    @aws_cognito_user_pools
    
  roomMatch(roomId: ID!): RoomMatchEvent
    @aws_subscribe(mutations: ["publishRoomMatch"])
    @aws_iam
    @aws_cognito_user_pools
}
```

## 🧪 Testing

```bash
# Ejecutar tests
npm test

# Tests con coverage
npm run test:coverage

# Tests en modo watch
npm run test:watch
```

## 🔄 Scripts de Utilidad

### generate-mobile-config.js

Genera configuración para la app móvil desde outputs de CDK:

```bash
node scripts/generate-mobile-config.js
```

### sync-from-aws.js

Sincroniza configuración desde AWS:

```bash
node scripts/sync-from-aws.js
```

### update-mobile-config.js

Actualiza archivo .env de mobile con valores de AWS:

```bash
node scripts/update-mobile-config.js
```

## 📈 Monitoreo

### CloudWatch Logs

Cada Lambda function tiene su log group:
- `/aws/lambda/TrinityStack-RoomHandler`
- `/aws/lambda/TrinityStack-VoteHandler`
- `/aws/lambda/TrinityStack-MatchHandler`
- `/aws/lambda/TrinityStack-TMDBHandler`

### Métricas

- Invocaciones de Lambda
- Errores de Lambda
- Duración de ejecución
- Throttles
- Operaciones de DynamoDB
- Latencia de AppSync

## 🐛 Troubleshooting

### Error: "Stack already exists"

```bash
cdk destroy
cdk deploy
```

### Error: "Insufficient permissions"

Verificar que el usuario AWS tiene permisos para:
- CloudFormation
- Lambda
- DynamoDB
- AppSync
- Cognito
- IAM

### Lambda function no se actualiza

```bash
# Forzar actualización
cdk deploy --force

# O eliminar y redesplegar
cdk destroy
cdk deploy
```

### TMDB API rate limit

La API de TMDB tiene límites:
- 40 requests por 10 segundos
- Implementar caching si es necesario

## 📚 Recursos

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS AppSync Documentation](https://docs.aws.amazon.com/appsync/)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)
- [TMDB API Documentation](https://developers.themoviedb.org/3)

## 🤝 Contribución

Ver [../README.md](../README.md) para guías de contribución.

## 📄 Licencia

MIT License - Ver [../LICENSE](../LICENSE)
