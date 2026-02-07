# Trinity Infrastructure

Infraestructura serverless de Trinity construida con AWS CDK y TypeScript.

## 📋 Tabla de Contenidos

- [Descripción](#descripción)
- [Arquitectura](#arquitectura)
- [Servicios AWS](#servicios-aws)
- [Lambda Functions](#lambda-functions)
- [Configuración](#configuración)
- [Deployment](#deployment)
- [Desarrollo](#desarrollo)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## 🎯 Descripción

Este directorio contiene toda la infraestructura como código (IaC) de Trinity, incluyendo:

- Stack de AWS CDK con todos los recursos
- Funciones Lambda para lógica de negocio
- Esquema GraphQL de AppSync
- Scripts de utilidad para deployment
- Configuración de DynamoDB

## 🏗️ Arquitectura

### Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────┐
│                    AWS AppSync                          │
│                  (GraphQL API)                          │
└────────┬────────────────────────────────────────────────┘
         │
         ├─── Cognito User Pool (Autenticación)
         │
         ├─── Lambda Functions:
         │    │
         │    ├─── Room Handler
         │    │    ├─── createRoom
         │    │    ├─── joinRoom
         │    │    ├─── getRoom
         │    │    ├─── getMyRooms
         │    │    └─── getRoomByCode
         │    │
         │    ├─── Vote Handler
         │    │    ├─── vote
         │    │    └─── getVotes
         │    │
         │    ├─── Match Handler
         │    │    ├─── getMyMatches
         │    │    ├─── getRoomMatches
         │    │    └─── publishUserMatch
         │    │
         │    └─── TMDB Handler
         │         └─── discoverContent
         │              ├─── Smart Random Discovery
         │              ├─── Genre Prioritization (AND/OR)
         │              └─── Quality Filters
         │
         └─── DynamoDB Tables:
              ├─── trinity-rooms (TTL: 24h)
              ├─── trinity-votes
              └─── trinity-matches
```

## ☁️ Servicios AWS

### AWS AppSync
- **Propósito**: API GraphQL principal
- **Autenticación**: Cognito User Pools
- **Subscriptions**: Notificaciones en tiempo real
- **Resolvers**: Lambda functions

### Amazon Cognito
- **User Pool**: Gestión de usuarios
- **Autenticación**: Email + Password
- **Grupos**: Users (default)

### AWS Lambda
- **Runtime**: Node.js 18.x
- **Memoria**: 256 MB (configurable)
- **Timeout**: 30 segundos
- **Concurrencia**: Auto-scaling

### Amazon DynamoDB
- **Modo**: On-Demand (pay-per-request)
- **Backup**: Point-in-time recovery
- **TTL**: Habilitado en trinity-rooms (24h)

## 🔧 Lambda Functions

### 1. Room Handler (`src/handlers/room/`)

**Propósito**: Gestión completa del ciclo de vida de salas de votación.

**Operaciones GraphQL**:
- `createRoom`: Crea nueva sala de votación
- `joinRoom`: Usuario se une a sala existente
- `getRoom`: Obtiene detalles de una sala específica
- `getMyRooms`: Lista salas del usuario (host o participante)

**Flujo de createRoom**:
```typescript
1. Validar input:
   - mediaType: 'MOVIE' o 'TV'
   - genreIds: array de IDs (máximo 2)
   - maxParticipants: número entre 2 y 6

2. Generar código único:
   - 6 caracteres alfanuméricos (A-Z, 0-9)
   - Verificar unicidad contra GSI code-index
   - Máximo 10 intentos de generación

3. Obtener candidatos de TMDB:
   - Invocar TMDB Lambda con Smart Random Discovery
   - Recibir 50 candidatos filtrados y aleatorizados

4. Crear registro en trinity-rooms:
   - UUID único como ID
   - TTL de 24 horas (auto-eliminación)
   - Almacenar todos los candidatos

5. Registrar participación automática:
   - Crear registro especial en trinity-votes
   - userMovieId: "userId#JOINED"
   - movieId: -1 (marcador de participación)
   - isParticipation: true

6. Retornar sala creada con código
```

**Flujo de joinRoom**:
```typescript
1. Validar código de sala (6 caracteres)

2. Buscar sala por código:
   - Query en GSI code-index
   - Fallback a Scan si GSI no disponible

3. Validar sala:
   - Verificar que existe
   - Verificar que no ha expirado (TTL)

4. Registrar participación:
   - Crear registro en trinity-votes
   - Mismo formato que createRoom

5. Retornar sala con candidatos
```

**Flujo de getMyRooms**:
```typescript
1. Obtener salas donde usuario es host:
   - Scan con FilterExpression hostId = userId
   - (Futuro: Query en GSI hostId-index)

2. Obtener salas donde usuario participó:
   - Scan en trinity-votes con userId
   - Extraer roomIds únicos
   - Fetch detalles de cada sala

3. Filtrar salas:
   - Eliminar salas expiradas (TTL < now)
   - Eliminar salas con matches (Query en trinity-matches)

4. Ordenar por fecha de creación (descendente)

5. Retornar array de salas activas
```

**Modelo de Datos (Room)**:
```typescript
interface Room {
  id: string;              // UUID único
  code: string;            // 6 chars (A-Z0-9)
  hostId: string;          // User ID del creador
  mediaType: 'MOVIE' | 'TV';
  genreIds: number[];      // Máximo 2 géneros
  maxParticipants: number; // 2-6 participantes
  candidates: MovieCandidate[];  // 50 películas
  createdAt: string;       // ISO timestamp
  ttl: number;             // Unix timestamp (24h)
}

interface MovieCandidate {
  id: number;              // TMDB ID
  title: string;
  overview: string;
  posterPath: string | null;
  releaseDate: string;
  mediaType: 'MOVIE' | 'TV';
}
```

**Variables de Entorno**:
- `ROOMS_TABLE`: Nombre de tabla trinity-rooms
- `VOTES_TABLE`: Nombre de tabla trinity-votes (para participación)
- `MATCHES_TABLE`: Nombre de tabla trinity-matches (para filtrado)
- `TMDB_LAMBDA_ARN`: ARN de TMDB Lambda
- `AWS_REGION`: Región de AWS

**Características Especiales**:
- **Código Único**: Generación con verificación de unicidad
- **Participación Automática**: Host se registra automáticamente al crear
- **Filtrado Inteligente**: getMyRooms excluye salas con matches
- **Fallback a Scan**: Si GSI no está disponible, usa Scan
- **Error Handling**: Retorna array vacío en lugar de null para evitar errores GraphQL

### 2. Vote Handler (`src/handlers/vote/`)

**Propósito**: Procesamiento de votos y detección automática de matches.

**Operaciones GraphQL**:
- `vote`: Registra voto de usuario y verifica matches

**Flujo Completo de vote**:
```typescript
1. Validar sala:
   - Obtener sala de trinity-rooms
   - Verificar que no ha expirado (TTL)
   - Verificar que existe

2. Validar acceso del usuario:
   - Usuario es host de la sala, O
   - Usuario ha participado previamente (registro en votes), O
   - MVP: Permitir acceso a cualquier usuario autenticado

3. Validar película:
   - Verificar que movieId está en room.candidates
   - Obtener detalles de la película

4. Registrar voto:
   - Crear registro en trinity-votes
   - userMovieId: "userId#movieId"
   - Timestamp ISO

5. Verificar match (solo si vote = true):
   a. Obtener todos los votos de la sala
   b. Identificar usuarios activos:
      - Excluir votos de participación (movieId: -1)
      - Contar usuarios únicos con votos reales
   c. Para la película votada:
      - Contar votos positivos
      - Si positiveVotes === activeUsers → MATCH!
   d. Si hay match:
      - Crear registro en trinity-matches
      - Invocar Match Lambda para notificaciones
      - Publicar via AppSync subscription

6. Retornar resultado:
   - success: true
   - match: Match object (si hay match)
```

**Algoritmo de Detección de Match**:
```typescript
// Obtener usuarios activos (con votos reales)
const activeUsers = new Set(
  allVotes
    .filter(v => v.movieId !== -1 && !v.isParticipation)
    .map(v => v.userId)
);

// Contar votos positivos para la película
const positiveVotes = allVotes.filter(v => 
  v.movieId === targetMovieId && 
  v.vote === true
);

// Match si todos los usuarios activos votaron positivo
if (positiveVotes.length === activeUsers.size && activeUsers.size > 0) {
  // ¡MATCH DETECTADO!
  createMatch(roomId, movieId, matchedUsers);
}
```

**Modelo de Datos (Vote)**:
```typescript
interface Vote {
  roomId: string;          // Partition Key
  userMovieId: string;     // Sort Key: "userId#movieId"
  userId: string;
  movieId: number;         // TMDB ID (-1 para participación)
  vote: boolean;           // true = like, false = dislike
  timestamp: string;       // ISO timestamp
  isParticipation?: boolean; // true para registros de join
}
```

**Variables de Entorno**:
- `VOTES_TABLE`: Nombre de tabla trinity-votes
- `MATCHES_TABLE`: Nombre de tabla trinity-matches
- `ROOMS_TABLE`: Nombre de tabla trinity-rooms
- `MATCH_LAMBDA_ARN`: ARN de Match Lambda (para notificaciones)
- `GRAPHQL_ENDPOINT`: Endpoint de AppSync (para subscriptions)
- `AWS_REGION`: Región de AWS

**Características Especiales**:
- **Detección Automática**: Match se detecta inmediatamente después de votar
- **Usuarios Activos**: Solo cuenta usuarios con votos reales (excluye participación)
- **Notificaciones**: Publica via AppSync subscription para tiempo real
- **Validación de Acceso**: Verifica que usuario tiene permiso para votar
- **Dependencies**: Requiere `@aws-crypto/sha256-js` y `@aws-sdk/signature-v4` para subscriptions

**⚠️ Importante**: Este Lambda DEBE incluir `node_modules/` en el ZIP de deployment (2.95 MB) debido a las dependencias de firma de AppSync.

### 3. Match Handler (`src/handlers/match/`)

**Propósito**: Gestión de matches y notificaciones a usuarios.

**Operaciones GraphQL**:
- `getMyMatches`: Lista todos los matches del usuario
- `checkRoomMatch`: Verifica si una sala tiene match
- `matchCreated`: Procesa match recién creado (interno)
- `notifyMatch`: Envía notificaciones de match (interno)

**Flujo de getMyMatches**:
```typescript
1. Scan en trinity-matches:
   - FilterExpression: contains(matchedUsers, userId)
   - Limit: 50 matches más recientes

2. Para cada match encontrado:
   - Incluir detalles completos de la película
   - Incluir lista de usuarios que coincidieron
   - Incluir timestamp del match

3. Ordenar por timestamp descendente

4. Retornar array de matches
   - IMPORTANTE: Siempre retornar array (nunca null)
   - Array vacío si no hay matches
```

**Flujo de checkRoomMatch**:
```typescript
1. Query en trinity-matches:
   - KeyConditionExpression: roomId = :roomId
   - Limit: 1 (solo necesitamos saber si existe)

2. Si encuentra match:
   - Retornar primer match encontrado
   - Incluir todos los detalles

3. Si no encuentra:
   - Retornar null
```

**Flujo de matchCreated** (interno):
```typescript
1. Recibir match del Vote Handler

2. Actualizar actividad de usuarios:
   - Actualizar lastActiveAt en trinity-users (si existe)
   - Para cada usuario en matchedUsers

3. Enviar notificaciones:
   - AppSync subscription (tiempo real)
   - Push notifications (futuro)
   - Email notifications (futuro)

4. Log para analytics:
   - Registrar match creado
   - Métricas de usuarios
   - Tipo de contenido
```

**Modelo de Datos (Match)**:
```typescript
interface Match {
  id: string;              // UUID único (matchId)
  roomId: string;          // Partition Key
  movieId: number;         // Sort Key (TMDB ID)
  title: string;           // Título de la película/serie
  posterPath?: string;     // URL del póster
  mediaType: 'MOVIE' | 'TV';
  matchedUsers: string[];  // Array de userIds
  timestamp: string;       // ISO timestamp
}
```

**Variables de Entorno**:
- `MATCHES_TABLE`: Nombre de tabla trinity-matches
- `USERS_TABLE`: Nombre de tabla trinity-users (opcional)
- `AWS_REGION`: Región de AWS

**Características Especiales**:
- **Scan con FilterExpression**: Usa `contains()` para buscar userId en array
- **Retorno Seguro**: Siempre retorna array (nunca null) para evitar errores GraphQL
- **Notificaciones Múltiples**: Notifica a todos los usuarios del match
- **Activity Tracking**: Actualiza última actividad de usuarios
- **Límite de Resultados**: Máximo 50 matches por query

### 4. TMDB Handler (`src/handlers/tmdb/`)

**Propósito**: Integración con The Movie Database API usando algoritmo Smart Random Discovery.

**Operaciones**:
- `discoverContent`: Obtiene 50 candidatos de películas/series con priorización de géneros

**Algoritmo Smart Random Discovery** (Versión Mejorada):

```typescript
PHASE 1: Verificación de Disponibilidad
  1. Hacer llamada inicial con lógica AND (intersección)
     - Ejemplo: Drama + Animación → with_genres: "18,16"
  2. Verificar total_results disponibles
  3. Umbral de decisión: 50 resultados mínimos

PHASE 2: Decisión Estratégica
  IF total_results >= 50:
    ✅ Usar SOLO lógica AND (intersección estricta)
    - Solo películas que cumplen TODOS los géneros
    - Fetch de 3 páginas aleatorias
    - Ejemplo: Solo películas que son Drama Y Animación
    - Log: "Using STRICT (AND) logic"
  
  ELSE:
    ⚠️ Usar lógica OR (unión amplia) con priorización
    - Películas que cumplen CUALQUIER género
    - Priorizar las que cumplen TODOS los géneros primero
    - Fetch de 3 páginas aleatorias
    - Ejemplo: Drama Y Animación primero, luego Drama O Animación
    - Log: "Using FALLBACK (OR) logic"

PHASE 3: Fetches Adicionales
  WHILE candidatos < 50 AND intentos < 3:
    - Fetch de páginas aleatorias adicionales
    - Evitar duplicados con Map<id, candidate>
    - Aplicar filtros de calidad

PHASE 4: Shuffle Final
  - Fisher-Yates shuffle para máxima aleatoriedad
  - Retornar exactamente 50 candidatos
```

**Filtros de Calidad Aplicados**:
```typescript
✅ Poster obligatorio (poster_path !== null)
✅ Overview no vacío (overview.length > 0)
✅ Mínimo 50 votos (vote_count >= 50)
✅ Idiomas occidentales (en, es, fr, it, de, pt)
✅ Script latino (validación de caracteres)
   - Regex: /^[\u0000-\u007F\u00A0-\u00FF\u0100-\u017F...]*$/u
   - Excluye CJK (chino/japonés/coreano) y cirílico
❌ Contenido adulto (include_adult: false)
```

**Lógica de Géneros TMDB API**:
```typescript
// AND (intersección) - Debe tener TODOS los géneros
with_genres: "18,16"  // Drama Y Animación (coma = AND)

// OR (unión) - Debe tener CUALQUIER género
with_genres: "18|16"  // Drama O Animación (pipe = OR)
```

**Ejemplos de Comportamiento Real**:

**Caso 1: Acción + Aventura** (géneros populares)
```
PHASE 1: Strict AND found 1,247 results
✅ Using STRICT (AND) logic
PHASE 2: Fetching with AND only
Result: 50 películas que son Acción Y Aventura
Strategy: STRICT (AND), Total: 1,247
```

**Caso 2: Drama + Animación** (géneros menos comunes juntos)
```
PHASE 1: Strict AND found 23 results
⚠️ Using FALLBACK (OR) logic
PHASE 2: Fetching with OR, prioritizing multi-genre
Result: 23 películas Drama+Animación + 27 Drama o Animación
Strategy: FALLBACK (OR), Total: 23
```

**Caso 3: Western + Documental** (géneros muy raros juntos)
```
PHASE 1: Strict AND found 2 results
⚠️ Using FALLBACK (OR) logic
PHASE 2: Fetching with OR
Result: 2 Western+Documental + 48 Western o Documental
Strategy: FALLBACK (OR), Total: 2
```

**Caso 4: Un solo género** (Acción)
```
Single genre selected - using standard logic
PHASE 2: Fetching with standard logic
Result: 50 películas de Acción
Strategy: SINGLE GENRE, Total: varies
```

**Modelo de Datos (MovieCandidate)**:
```typescript
interface MovieCandidate {
  id: number;              // TMDB ID
  title: string;           // Título (movies) o name (TV)
  overview: string;        // Descripción
  posterPath: string | null; // URL del póster
  releaseDate: string;     // Fecha de estreno
  mediaType: 'MOVIE' | 'TV';
  genreIds?: number[];     // IDs de géneros (para priorización)
}
```

**Parámetros de Búsqueda TMDB**:
```typescript
interface TMDBDiscoveryParams {
  page: number;                    // Página aleatoria
  with_genres?: string;            // "18,16" (AND) o "18|16" (OR)
  language: 'en-US';               // Idioma de metadatos
  region?: 'US';                   // Región (opcional)
  sort_by: 'popularity.desc';      // Ordenar por popularidad
  include_adult: false;            // Sin contenido adulto
  with_original_language: 'en|es|fr|it|de|pt'; // Idiomas occidentales
  'vote_count.gte': 50;            // Mínimo 50 votos
}
```

**Variables de Entorno**:
- `TMDB_API_KEY`: API Key de TMDB (v3 auth)
- `TMDB_READ_TOKEN`: Read Access Token (v4 auth) - alternativa a API_KEY
- `TMDB_BASE_URL`: Base URL de API (default: https://api.themoviedb.org/3)
- `AWS_REGION`: Región de AWS

**Características Especiales**:
- **Priorización Inteligente**: AND primero, OR como fallback
- **Páginas Aleatorias**: Fetch de páginas random para variedad
- **Deduplicación**: Map para evitar duplicados
- **Validación de Script**: Solo contenido en alfabeto latino
- **Logging Detallado**: Logs de cada fase para debugging
- **Fallback Robusto**: Maneja casos con pocos resultados
- **Target Count**: Siempre intenta retornar 50 candidatos

**Obtener TMDB API Key**:
1. Crear cuenta en [TMDB](https://www.themoviedb.org/)
2. Ir a Settings > API
3. Solicitar API Key (gratis)
4. Copiar "API Read Access Token" o "API Key (v3 auth)"
5. Configurar en `infrastructure/.env`

**Troubleshooting**:
- Si retorna pocos candidatos: Verificar filtros de calidad
- Si retorna contenido no latino: Verificar validación de script
- Si falla autenticación: Verificar TMDB_API_KEY en .env
- Si timeout: Reducir número de páginas a fetch

### 5. Cognito Pre Sign-up Trigger (`src/handlers/cognito-triggers/`)

**Propósito**: Auto-confirmación de usuarios al registrarse (sin verificación de email).

**Trigger**: `preSignUp` - Se ejecuta antes de completar el registro

**Flujo de Auto-confirmación**:
```typescript
1. Usuario se registra en la app:
   - Email
   - Password

2. Cognito invoca Lambda Pre Sign-up Trigger

3. Lambda auto-confirma usuario:
   - event.response.autoConfirmUser = true
   - event.response.autoVerifyEmail = true

4. Usuario puede iniciar sesión inmediatamente:
   - No se requiere código de verificación
   - No se envía email de confirmación
```

**Código del Handler**:
```typescript
export const handler: PreSignUpTriggerHandler = async (event) => {
  console.log('Pre Sign-up Trigger invoked', {
    userPoolId: event.userPoolId,
    userName: event.userName,
    email: event.request.userAttributes.email,
  });

  // Auto-confirm the user
  event.response.autoConfirmUser = true;

  // Auto-verify the email
  if (event.request.userAttributes.email) {
    event.response.autoVerifyEmail = true;
  }

  console.log('User auto-confirmed', {
    userName: event.userName,
    autoConfirmUser: event.response.autoConfirmUser,
    autoVerifyEmail: event.response.autoVerifyEmail,
  });

  return event;
};
```

**Configuración en CDK**:
```typescript
// Lambda Trigger
const preSignUpTrigger = new lambda.Function(this, 'PreSignUpTrigger', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'pre-signup.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../src/handlers/cognito-triggers')),
  timeout: cdk.Duration.seconds(10),
  description: 'Auto-confirms users on sign-up',
});

// User Pool con trigger
const userPool = new cognito.UserPool(this, 'TrinityUserPool', {
  userPoolName: 'trinity-users',
  selfSignUpEnabled: true,
  signInAliases: { email: true },
  autoVerify: { email: false }, // Disabled - using Lambda trigger
  lambdaTriggers: {
    preSignUp: preSignUpTrigger, // Lambda trigger
  },
});
```

**Variables de Entorno**: Ninguna requerida

**Características Especiales**:
- **Sin Email Verification**: No se envían emails de confirmación
- **Registro Instantáneo**: Usuario puede usar la app inmediatamente
- **Mejor UX**: Sin fricción en el proceso de registro
- **Logs Detallados**: CloudWatch logs para debugging

**Verificación**:
```bash
# Ver logs del trigger
aws logs tail /aws/lambda/TrinityStack-PreSignUpTrigger --follow

# Verificar usuario en Cognito
aws cognito-idp admin-get-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username test@example.com
```

**Output Esperado en Logs**:
```json
{
  "message": "Pre Sign-up Trigger invoked",
  "userPoolId": "eu-west-1_xxxxx",
  "userName": "user-uuid",
  "email": "test@example.com"
}
{
  "message": "User auto-confirmed",
  "userName": "user-uuid",
  "autoConfirmUser": true,
  "autoVerifyEmail": true
}
```

**Deployment**:
```bash
# Compilar TypeScript
npm run build

# Crear ZIP
.\create-zips.ps1

# Desplegar con CDK
cdk deploy

# O subir manualmente a Lambda Console
# Upload: lambda-zips/cognito-trigger.zip
```

**Documentación Completa**: Ver [COGNITO_AUTO_CONFIRM_SETUP.md](./COGNITO_AUTO_CONFIRM_SETUP.md)

## ⚙️ Configuración

### Variables de Entorno

Crear archivo `.env` en `infrastructure/`:

```bash
# TMDB API
TMDB_API_KEY=tu_api_key_de_tmdb
TMDB_READ_TOKEN=tu_read_token_de_tmdb  # Opcional, usa API_KEY si no está

# AWS
AWS_REGION=eu-west-1
AWS_ACCOUNT_ID=tu_account_id

# Opcional
TMDB_BASE_URL=https://api.themoviedb.org/3
```

### Obtener TMDB API Key

1. Crear cuenta en [TMDB](https://www.themoviedb.org/)
2. Ir a Settings > API
3. Solicitar API Key (gratis)
4. Copiar "API Read Access Token" o "API Key (v3 auth)"

## 🚀 Deployment

### Primera Vez (Bootstrap)

```bash
cd infrastructure
npm install

# Bootstrap CDK (solo primera vez por cuenta/región)
cdk bootstrap aws://ACCOUNT-ID/REGION
```

### Deployment Normal

```bash
# Verificar cambios
cdk diff

# Desplegar
cdk deploy

# Desplegar sin confirmación
cdk deploy --require-approval never
```

### Deployment de Lambda Functions

Las funciones Lambda se despliegan automáticamente con `cdk deploy`, pero si necesitas actualizar solo una función:

```bash
# 1. Compilar TypeScript
cd src/handlers/tmdb
npx tsc index.ts --target ES2020 --module commonjs --esModuleInterop

# 2. Crear ZIPs
cd ../../..  # Volver a infrastructure/
.\create-zips.ps1

# 3. Subir manualmente a AWS Lambda Console
# O hacer cdk deploy completo
```

### Outputs del Deployment

Después del deployment, CDK mostrará:

```
Outputs:
TrinityStack.GraphQLEndpoint = https://xxxxx.appsync-api.eu-west-1.amazonaws.com/graphql
TrinityStack.UserPoolId = eu-west-1_xxxxx
TrinityStack.UserPoolClientId = xxxxx
TrinityStack.Region = eu-west-1
```

**Importante**: Copiar estos valores al `.env` de mobile.

## 💻 Desarrollo

### Estructura de Archivos

```
infrastructure/
├── bin/
│   └── infrastructure.ts    # Entry point de CDK
├── lib/
│   └── trinity-stack.ts     # Definición del stack
├── src/handlers/
│   ├── room/
│   │   ├── index.ts         # TypeScript source
│   │   ├── index.js         # Compilado
│   │   └── package.json     # Dependencies
│   ├── vote/
│   ├── match/
│   └── tmdb/
├── lambda-zips/             # ZIPs para deployment
│   ├── room-handler.zip
│   ├── vote-handler.zip
│   ├── match-handler.zip
│   └── tmdb-handler.zip
├── scripts/
│   ├── generate-mobile-config.js
│   ├── sync-from-aws.js
│   └── update-mobile-config.js
├── schema.graphql           # Esquema GraphQL
├── create-zips.ps1          # Script de build
├── cdk.json                 # Configuración CDK
├── package.json
├── tsconfig.json
└── README.md
```

### Comandos de Desarrollo

```bash
# Compilar TypeScript
npm run build

# Compilar en modo watch
npm run watch

# Sintetizar CloudFormation
cdk synth

# Ver diferencias
cdk diff

# Listar stacks
cdk list

# Destruir stack (¡CUIDADO!)
cdk destroy
```

### Crear Nueva Lambda Function

1. Crear directorio en `src/handlers/nueva-funcion/`
2. Crear `index.ts` con el handler
3. Crear `package.json` con dependencies
4. Agregar al stack en `lib/trinity-stack.ts`
5. Actualizar `create-zips.ps1` si es necesario
6. Compilar y desplegar

### Testing Local

```bash
# Instalar dependencies
npm install

# Ejecutar tests
npm test

# Test con coverage
npm run test:coverage
```

## 🧪 Testing

### Unit Tests

```typescript
// Ejemplo: test de Room Handler
import { handler } from '../src/handlers/room';

describe('Room Handler', () => {
  it('should create room with valid input', async () => {
    const event = {
      info: { fieldName: 'createRoom' },
      arguments: {
        input: {
          mediaType: 'MOVIE',
          genreIds: [28, 12]
        }
      },
      identity: { claims: { sub: 'user123' } }
    };

    const result = await handler(event);
    
    expect(result).toBeDefined();
    expect(result.code).toHaveLength(6);
    expect(result.candidates).toHaveLength(50);
  });
});
```

### Integration Tests

```bash
# Ejecutar contra AWS real (requiere credenciales)
npm run test:integration
```

## 🐛 Troubleshooting

### Error: "TMDB_API_KEY not found"

**Solución**: Verificar que `.env` existe y tiene `TMDB_API_KEY` configurado.

```bash
# Verificar
cat .env | grep TMDB_API_KEY

# Si no existe
cp .env.example .env
# Editar .env con tu API key
```

### Error: "CDK bootstrap required"

**Solución**: Ejecutar bootstrap de CDK.

```bash
cdk bootstrap aws://ACCOUNT-ID/REGION
```

### Error: Lambda timeout

**Solución**: Aumentar timeout en `trinity-stack.ts`:

```typescript
const roomHandler = new lambda.Function(this, 'RoomHandler', {
  timeout: Duration.seconds(60), // Aumentar de 30 a 60
  // ...
});
```

### Error: DynamoDB throttling

**Solución**: DynamoDB está en modo On-Demand, debería auto-escalar. Verificar métricas en CloudWatch.

### Lambda no se actualiza después de deploy

**Solución**: 
1. Verificar que el ZIP se creó correctamente
2. Forzar actualización del código:

```bash
# Recrear ZIPs
.\create-zips.ps1

# Deploy forzado
cdk deploy --force
```

### Ver logs de Lambda

```bash
# AWS CLI
aws logs tail /aws/lambda/TrinityStack-RoomHandler --follow

# O en AWS Console
# CloudWatch > Log Groups > /aws/lambda/TrinityStack-RoomHandler
```

## 📊 Monitoreo

### CloudWatch Metrics

Métricas importantes a monitorear:

- **Lambda Invocations**: Número de ejecuciones
- **Lambda Errors**: Errores en funciones
- **Lambda Duration**: Tiempo de ejecución
- **DynamoDB ConsumedReadCapacity**: Lecturas
- **DynamoDB ConsumedWriteCapacity**: Escrituras
- **AppSync 4XXError**: Errores de cliente
- **AppSync 5XXError**: Errores de servidor

### CloudWatch Logs

Cada Lambda tiene su log group:
- `/aws/lambda/TrinityStack-RoomHandler`
- `/aws/lambda/TrinityStack-VoteHandler`
- `/aws/lambda/TrinityStack-MatchHandler`
- `/aws/lambda/TrinityStack-TmdbHandler`

### Structured Logging

Todas las funciones usan logging estructurado:

```typescript
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  level: 'INFO',
  operation: 'createRoom',
  userId: 'user123',
  roomId: 'room456',
  success: true
}));
```

## 📚 Referencias

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS AppSync Documentation](https://docs.aws.amazon.com/appsync/)
- [AWS Lambda Documentation](https://docs.aws.amazon.com/lambda/)
- [DynamoDB Documentation](https://docs.aws.amazon.com/dynamodb/)
- [TMDB API Documentation](https://developers.themoviedb.org/3)

## 🔗 Enlaces Útiles

- [GraphQL Schema](schema.graphql)
- [Deployment Guide](../docs/DEPLOYMENT_GUIDE.md)
- [Technical Documentation](../docs/technical/README.md)
- [Lambda Functions Details](../docs/technical/04-lambda-functions.md)

---

**Última actualización**: 2026-02-07  
**Versión**: 2.2.2  
**Estado**: ✅ Production Ready
