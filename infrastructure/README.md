# Trinity Infrastructure

Infraestructura AWS serverless para Trinity Movie Matching App usando AWS CDK.

## 🏗️ Arquitectura

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Cognito       │    │   AppSync        │    │   Lambda        │
│   User Pool     │◄──►│   GraphQL API    │◄──►│   Functions     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │   DynamoDB       │    │   TMDB API      │
                       │   Tables         │    │   Integration   │
                       └──────────────────┘    └─────────────────┘
```

## 🚀 Deployment

### Prerrequisitos

```bash
# Instalar AWS CDK
npm install -g aws-cdk

# Configurar AWS CLI
aws configure

# Verificar configuración
aws sts get-caller-identity
```

### Variables de Entorno

Crear `.env` en el directorio `infrastructure/`:

```bash
# TMDB API Configuration
TMDB_API_KEY=tu_tmdb_api_key
TMDB_READ_TOKEN=tu_tmdb_read_token
TMDB_BASE_URL=https://api.themoviedb.org/3

# AWS Configuration (opcional)
AWS_REGION=us-east-1
CDK_DEFAULT_ACCOUNT=123456789012
```

### Comandos de Deployment

```bash
# Instalar dependencias
npm install

# Bootstrap CDK (solo primera vez)
cdk bootstrap

# Ver diferencias antes de deploy
npm run diff

# Desplegar infraestructura
npm run deploy

# Destruir infraestructura (¡CUIDADO!)
npm run destroy
```

## 📊 Recursos AWS Desplegados

### DynamoDB Tables

#### TrinityRooms
```typescript
{
  tableName: 'TrinityRooms',
  partitionKey: 'id',           // Room ID único
  billingMode: 'PAY_PER_REQUEST',
  ttl: 'ttl',                   // Auto-eliminación de salas expiradas
  
  // Global Secondary Indexes
  indexes: [
    {
      name: 'code-index',        // Búsqueda por código de sala
      partitionKey: 'code'
    },
    {
      name: 'hostId-createdAt-index', // Salas por host
      partitionKey: 'hostId',
      sortKey: 'createdAt'
    }
  ]
}
```

#### TrinityVotes
```typescript
{
  tableName: 'TrinityVotes',
  partitionKey: 'roomId',       // ID de la sala
  sortKey: 'userMovieId',       // "userId#movieId"
  billingMode: 'PAY_PER_REQUEST',
  
  // Global Secondary Index
  indexes: [
    {
      name: 'userId-timestamp-index', // Votos por usuario
      partitionKey: 'userId',
      sortKey: 'timestamp'
    }
  ]
}
```

#### TrinityMatches
```typescript
{
  tableName: 'TrinityMatches',
  partitionKey: 'roomId',       // ID de la sala
  sortKey: 'movieId',           // ID de la película
  billingMode: 'PAY_PER_REQUEST',
  
  // Indexes
  indexes: [
    {
      name: 'timestamp-index',   // Local Secondary Index
      sortKey: 'timestamp'
    },
    {
      name: 'userId-timestamp-index', // Global Secondary Index
      partitionKey: 'userId',    // Para queries por usuario
      sortKey: 'timestamp'
    }
  ]
}
```

#### TrinityUsers
```typescript
{
  tableName: 'TrinityUsers',
  partitionKey: 'id',           // User ID de Cognito
  billingMode: 'PAY_PER_REQUEST'
}
```

### Lambda Functions

#### trinity-tmdb-handler
- **Función**: Integración con TMDB API
- **Trigger**: AppSync GraphQL resolvers
- **Operaciones**:
  - Búsqueda de películas por género
  - Filtrado por script latino
  - Cache de resultados
  - Rate limiting

```typescript
// Operaciones soportadas
interface TMDBOperations {
  discoverMovies: (genreIds: number[], mediaType: 'movie' | 'tv') => Promise<Movie[]>;
  getMovieDetails: (movieId: number) => Promise<MovieDetails>;
  searchMovies: (query: string) => Promise<Movie[]>;
}
```

#### trinity-room-handler
- **Función**: Gestión de salas de votación
- **Trigger**: AppSync GraphQL resolvers
- **Operaciones**:
  - Crear sala con código único
  - Unirse a sala por código
  - Validar membresía
  - Gestionar TTL de salas

```typescript
// Operaciones soportadas
interface RoomOperations {
  createRoom: (input: CreateRoomInput) => Promise<Room>;
  joinRoom: (code: string) => Promise<Room>;
  getRoom: (roomId: string) => Promise<Room>;
  getMyRooms: (userId: string) => Promise<Room[]>;
  addRoomMember: (roomId: string, userId: string) => Promise<boolean>;
  removeRoomMember: (roomId: string, userId: string) => Promise<boolean>;
}
```

#### trinity-vote-handler
- **Función**: Procesamiento de votos y detección de matches
- **Trigger**: AppSync GraphQL resolvers
- **Operaciones**:
  - Registrar votos de usuarios
  - Detectar matches automáticamente
  - Enviar notificaciones en tiempo real
  - Crear registros de match

```typescript
// Operaciones soportadas
interface VoteOperations {
  processVote: (userId: string, roomId: string, movieId: number, vote: boolean) => Promise<VoteResult>;
  checkForMatch: (roomId: string, movieId: number) => Promise<Match | null>;
  triggerNotifications: (match: Match) => Promise<void>;
}
```

#### trinity-match-handler
- **Función**: Gestión del historial de matches
- **Trigger**: AppSync GraphQL resolvers
- **Operaciones**:
  - Obtener matches por usuario
  - Crear matches manuales
  - Verificar matches existentes
  - Estadísticas de matches

```typescript
// Operaciones soportadas
interface MatchOperations {
  getUserMatches: (userId: string) => Promise<Match[]>;
  createMatch: (input: CreateMatchInput) => Promise<Match>;
  checkRoomMatch: (roomId: string) => Promise<Match | null>;
  checkUserMatches: (userId: string) => Promise<Match[]>;
}
```

### AppSync GraphQL API

#### Configuración de Autenticación
```typescript
{
  defaultAuthorization: {
    authorizationType: 'USER_POOL',
    userPoolConfig: {
      userPool: cognitoUserPool
    }
  },
  additionalAuthorizationModes: [
    {
      authorizationType: 'IAM'  // Para Lambda functions
    }
  ]
}
```

#### Resolvers Principales

**Mutations**:
- `createRoom` → trinity-room-handler
- `joinRoom` → trinity-room-handler  
- `vote` → trinity-vote-handler
- `publishRoomMatch` → NONE (subscription trigger)
- `publishUserMatch` → NONE (subscription trigger)

**Queries**:
- `getRoom` → trinity-room-handler
- `getMyRooms` → trinity-room-handler
- `getMyMatches` → trinity-match-handler
- `checkUserMatches` → trinity-match-handler
- `checkRoomMatch` → trinity-match-handler

**Subscriptions**:
- `userMatch(userId: ID!)` → Notificaciones individuales
- `roomMatch(roomId: ID!)` → Notificaciones de sala
- `onMatchCreated` → Legacy subscription

### Cognito User Pool

#### Configuración
```typescript
{
  userPoolName: 'trinity-user-pool',
  selfSignUpEnabled: true,
  signInAliases: { email: true },
  autoVerify: {},  // Sin verificación de email
  passwordPolicy: {
    minLength: 8,
    requireLowercase: false,
    requireUppercase: false,
    requireDigits: false,
    requireSymbols: false
  },
  lambdaTriggers: {
    preSignUp: autoConfirmTrigger  // Auto-confirma usuarios
  }
}
```

#### User Pool Client
```typescript
{
  userPoolClientName: 'trinity-mobile-client',
  generateSecret: false,  // Requerido para mobile
  authFlows: {
    userSrp: true,
    userPassword: true,
    adminUserPassword: true
  },
  tokenValidity: {
    accessToken: Duration.hours(1),
    idToken: Duration.hours(1),
    refreshToken: Duration.days(30)
  }
}
```

## 🔧 Estructura del Proyecto

```
infrastructure/
├── lib/
│   └── trinity-stack.ts         # Stack principal de CDK
├── src/
│   └── handlers/               # Código de Lambda functions
│       ├── tmdb/
│       │   ├── index.ts        # TMDB handler
│       │   └── package.json
│       ├── room/
│       │   ├── index.ts        # Room handler  
│       │   └── package.json
│       ├── vote/
│       │   ├── index.ts        # Vote handler
│       │   └── package.json
│       └── match/
│           ├── index.ts        # Match handler
│           └── package.json
├── bin/
│   └── trinity.ts              # CDK App entry point
├── cdk.json                    # CDK configuration
├── package.json                # Dependencies
├── tsconfig.json               # TypeScript config
├── schema.graphql              # GraphQL schema
└── .env                        # Environment variables
```

## 📝 GraphQL Schema

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
  ttl: Int
}

type Match {
  id: ID!
  roomId: ID!
  movieId: Int!
  title: String!
  posterPath: String
  mediaType: MediaType!
  matchedUsers: [ID!]!
  timestamp: AWSDateTime!
}

type VoteResult {
  success: Boolean!
  match: Match
  error: String
}

enum MediaType {
  MOVIE
  TV
}
```

### Subscriptions en Tiempo Real

```graphql
type Subscription {
  # Notificación individual por usuario
  userMatch(userId: ID!): UserMatchEvent
    @aws_subscribe(mutations: ["publishUserMatch"])
  
  # Notificación por sala
  roomMatch(roomId: ID!): RoomMatchEvent  
    @aws_subscribe(mutations: ["publishRoomMatch"])
  
  # Legacy subscription
  onMatchCreated: Match
    @aws_subscribe(mutations: ["createMatch"])
}

type UserMatchEvent {
  userId: ID!
  roomId: ID!
  matchId: ID!
  movieId: ID!
  movieTitle: String!
  posterPath: String
  matchedUsers: [ID!]!
  timestamp: AWSDateTime!
  matchDetails: MatchDetails
}
```

## 🔐 Seguridad y Permisos

### IAM Roles y Políticas

#### Lambda Execution Roles
```typescript
// Permisos para todas las Lambda functions
const lambdaPermissions = [
  'dynamodb:GetItem',
  'dynamodb:PutItem', 
  'dynamodb:UpdateItem',
  'dynamodb:DeleteItem',
  'dynamodb:Query',
  'dynamodb:Scan',
  'logs:CreateLogGroup',
  'logs:CreateLogStream',
  'logs:PutLogEvents'
];

// Permisos adicionales para vote-handler
const voteHandlerPermissions = [
  'appsync:GraphQL',           // Para triggers de subscriptions
  'lambda:InvokeFunction'      // Para invocar match-handler
];
```

#### AppSync Service Role
```typescript
const appSyncPermissions = [
  'dynamodb:GetItem',
  'dynamodb:PutItem',
  'dynamodb:UpdateItem', 
  'dynamodb:DeleteItem',
  'dynamodb:Query',
  'dynamodb:Scan'
];
```

### Validación de Datos

#### Input Validation
```typescript
// Validación en Lambda handlers
interface CreateRoomInput {
  mediaType: 'MOVIE' | 'TV';
  genreIds: number[];  // Máximo 5 géneros
}

interface VoteInput {
  roomId: string;      // UUID válido
  movieId: number;     // ID positivo
  vote: boolean;       // true/false
}
```

#### Rate Limiting
- AppSync: 1000 requests/second por API key
- Lambda: Concurrency limits configurados
- DynamoDB: Auto-scaling habilitado

## 📊 Monitoreo y Logging

### CloudWatch Logs

#### Log Groups Creados
```
/aws/lambda/trinity-tmdb-handler
/aws/lambda/trinity-room-handler  
/aws/lambda/trinity-vote-handler
/aws/lambda/trinity-match-handler
/aws/appsync/apis/{api-id}
```

#### Structured Logging
```typescript
// Ejemplo de logs estructurados
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  level: 'INFO',
  operation: 'processVote',
  userId: 'user123',
  roomId: 'room456', 
  movieId: 789,
  vote: true,
  duration: 150
}));
```

### Métricas Personalizadas

```typescript
// Métricas de negocio
const metrics = {
  'Trinity/Rooms/Created': roomsCreated,
  'Trinity/Matches/Found': matchesFound,
  'Trinity/Votes/Processed': votesProcessed,
  'Trinity/Users/Active': activeUsers
};
```

### Alertas CloudWatch

```typescript
// Alertas configuradas automáticamente
const alerts = [
  {
    name: 'Lambda Errors',
    metric: 'AWS/Lambda/Errors',
    threshold: 5,
    period: 300  // 5 minutos
  },
  {
    name: 'DynamoDB Throttles', 
    metric: 'AWS/DynamoDB/ThrottledRequests',
    threshold: 1,
    period: 60
  },
  {
    name: 'AppSync 4xx Errors',
    metric: 'AWS/AppSync/4XXError', 
    threshold: 10,
    period: 300
  }
];
```

## 🧪 Testing y Debugging

### Testing Local

```bash
# Ejecutar tests unitarios
npm test

# Test de integración con LocalStack
npm run test:integration

# Validar CloudFormation template
npm run synth
```

### Debugging Lambda Functions

```bash
# Ver logs en tiempo real
aws logs tail /aws/lambda/trinity-vote-handler --follow

# Buscar errores específicos  
aws logs filter-log-events \
  --log-group-name /aws/lambda/trinity-vote-handler \
  --filter-pattern "ERROR" \
  --start-time $(date -d '1 hour ago' +%s)000

# Invocar función directamente
aws lambda invoke \
  --function-name trinity-vote-handler \
  --payload '{"operation":"vote","userId":"test","input":{"roomId":"room123","movieId":456,"vote":true}}' \
  response.json
```

### Debugging AppSync

```bash
# Ver logs de AppSync
aws logs tail /aws/appsync/apis/{api-id} --follow

# Test GraphQL queries
curl -X POST \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"query GetRoom($id: ID!) { getRoom(id: $id) { id code hostId } }","variables":{"id":"room123"}}' \
  $GRAPHQL_ENDPOINT
```

## 🚀 Deployment Strategies

### Ambientes

#### Development
```bash
# Deploy a ambiente de desarrollo
cdk deploy --profile dev --context environment=dev
```

#### Production  
```bash
# Deploy a producción con aprobación manual
cdk deploy --profile prod --context environment=prod --require-approval broadening
```

### Blue/Green Deployment

```typescript
// Configuración para deployment sin downtime
const lambdaAlias = new lambda.Alias(this, 'LiveAlias', {
  aliasName: 'live',
  version: lambdaFunction.currentVersion,
});

// CodeDeploy para rollout gradual
const deploymentConfig = codedeploy.LambdaDeploymentConfig.LINEAR_10PERCENT_EVERY_1MINUTE;
```

### Rollback Strategy

```bash
# Rollback automático en caso de errores
aws cloudformation cancel-update-stack --stack-name TrinityStack

# Rollback manual a versión anterior
cdk deploy --rollback
```

## 📈 Optimización y Performance

### DynamoDB Optimization

```typescript
// Configuración de auto-scaling
const readScaling = table.autoScaleReadCapacity({
  minCapacity: 5,
  maxCapacity: 100
});

readScaling.scaleOnUtilization({
  targetUtilizationPercent: 70
});
```

### Lambda Optimization

```typescript
// Configuración optimizada
const lambdaConfig = {
  runtime: lambda.Runtime.NODEJS_20_X,
  memorySize: 512,           // Optimizado para costo/performance
  timeout: Duration.seconds(30),
  reservedConcurrentExecutions: 100,
  environment: {
    NODE_OPTIONS: '--enable-source-maps'
  }
};
```

### AppSync Caching

```typescript
// Cache configuration
const cachingConfig = {
  cachingBehavior: appsync.CachingBehavior.PER_RESOLVER_CACHING,
  defaultTtl: Duration.minutes(5),
  maxTtl: Duration.hours(1)
};
```

## 🔧 Troubleshooting

### Problemas Comunes

#### 1. CDK Bootstrap Issues
```bash
# Re-bootstrap CDK
cdk bootstrap --force

# Verificar bootstrap stack
aws cloudformation describe-stacks --stack-name CDKToolkit
```

#### 2. Lambda Timeout Errors
```typescript
// Aumentar timeout en trinity-stack.ts
timeout: Duration.seconds(60)  // Era 30 segundos
```

#### 3. DynamoDB Throttling
```bash
# Verificar métricas
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedReadCapacityUnits \
  --dimensions Name=TableName,Value=TrinityRooms \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T23:59:59Z \
  --period 3600 \
  --statistics Sum
```

#### 4. AppSync Authorization Errors
```typescript
// Verificar configuración de auth en schema.graphql
type Query {
  getRoom(id: ID!): Room @aws_auth(cognito_groups: ["Users"])
}
```

### Logs Útiles

```bash
# Ver todos los logs de la stack
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/trinity"

# Monitorear errores en tiempo real
aws logs filter-log-events \
  --log-group-name /aws/lambda/trinity-vote-handler \
  --filter-pattern "{ $.level = \"ERROR\" }" \
  --start-time $(date -d '10 minutes ago' +%s)000
```

## 📚 Scripts Útiles

```json
{
  "scripts": {
    "build": "tsc",
    "watch": "tsc -w", 
    "test": "jest",
    "cdk": "cdk",
    "deploy": "cdk deploy --require-approval never",
    "destroy": "cdk destroy",
    "diff": "cdk diff",
    "synth": "cdk synth",
    "bootstrap": "cdk bootstrap"
  }
}
```

---

Para más información, consultar la [documentación principal](../README.md).