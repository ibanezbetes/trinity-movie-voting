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

**Operaciones**:
- `createRoom`: Crea nueva sala de votación
- `joinRoom`: Usuario se une a sala existente
- `getRoom`: Obtiene detalles de sala
- `getMyRooms`: Lista salas del usuario (host o participante)
- `getRoomByCode`: Busca sala por código de 6 caracteres

**Flujo de createRoom**:
```typescript
1. Validar input (mediaType, genreIds)
2. Generar código único de 6 caracteres
3. Llamar a TMDB Handler para obtener candidatos
4. Crear registro en trinity-rooms con TTL de 24h
5. Registrar participación automática del host
6. Retornar sala creada
```

**Modelo de Datos (Room)**:
```typescript
interface Room {
  id: string;              // UUID
  code: string;            // 6 chars (A-Z0-9)
  hostId: string;          // User ID del creador
  mediaType: 'MOVIE' | 'TV';
  genreIds: number[];      // Máximo 2 géneros
  candidates: MovieCandidate[];
  createdAt: string;       // ISO timestamp
  ttl: number;             // Unix timestamp (24h)
}
```

### 2. Vote Handler (`src/handlers/vote/`)

**Operaciones**:
- `vote`: Registra voto de usuario
- `getVotes`: Obtiene votos de una sala

**Flujo de vote**:
```typescript
1. Validar input (roomId, movieId, vote)
2. Verificar que sala existe y está activa
3. Registrar voto en trinity-votes
4. Obtener todos los votos de la sala
5. Verificar si hay match:
   - Obtener usuarios activos (con votos)
   - Para cada película, verificar si todos votaron positivo
   - Si hay match, crear registro en trinity-matches
   - Publicar notificación via GraphQL subscription
6. Retornar resultado del voto
```

**Modelo de Datos (Vote)**:
```typescript
interface Vote {
  roomId: string;          // Partition Key
  userMovieId: string;     // Sort Key: userId#movieId
  userId: string;
  movieId: number;         // TMDB ID (-1 para participación)
  vote: boolean;
  timestamp: string;
  isParticipation?: boolean;
}
```

**Detección de Match**:
- Se considera match cuando TODOS los usuarios activos votan positivo
- Usuario activo = tiene al menos un voto en la sala
- Se excluyen votos de participación (movieId: -1)

### 3. Match Handler (`src/handlers/match/`)

**Operaciones**:
- `getMyMatches`: Lista matches del usuario
- `getRoomMatches`: Lista matches de una sala
- `publishUserMatch`: Publica notificación de match (interno)

**Flujo de getMyMatches**:
```typescript
1. Obtener todas las salas donde el usuario participó
2. Para cada sala, buscar matches en trinity-matches
3. Filtrar matches donde el usuario está en matchedUsers
4. Ordenar por timestamp descendente
5. Retornar lista de matches
```

**Modelo de Datos (Match)**:
```typescript
interface Match {
  roomId: string;          // Partition Key
  movieId: number;         // Sort Key
  matchId: string;         // UUID único
  title: string;
  posterPath?: string;
  matchedUsers: string[];  // IDs de usuarios
  timestamp: string;
}
```

### 4. TMDB Handler (`src/handlers/tmdb/`)

**Operaciones**:
- `discoverContent`: Obtiene candidatos de películas/series

**Algoritmo Smart Random Discovery**:
```typescript
PHASE 1: Verificación de Disponibilidad
  - Hacer llamada inicial con lógica AND (intersección)
  - Verificar total_results disponibles
  - Umbral: 50 resultados mínimos

PHASE 2: Decisión Estratégica
  IF total_results >= 50:
    - Usar SOLO lógica AND (intersección estricta)
    - Fetch de 3 páginas aleatorias
  ELSE:
    - Usar lógica OR (unión amplia)
    - Priorizar películas que cumplen TODOS los géneros
    - Fetch de 3 páginas aleatorias

PHASE 3: Fetches Adicionales
  - Si no se alcanza TARGET_COUNT (50)
  - Máximo 3 intentos adicionales
  - Evitar duplicados con Map

PHASE 4: Shuffle Final
  - Fisher-Yates shuffle
  - Retornar 50 candidatos
```

**Filtros de Calidad**:
```typescript
- Poster obligatorio (poster_path)
- Overview no vacío
- Mínimo 50 votos (vote_count >= 50)
- Idiomas occidentales (en, es, fr, it, de, pt)
- Script latino (validación de caracteres)
```

**Lógica de Géneros TMDB**:
- **AND**: `with_genres: "18,16"` (coma = intersección)
- **OR**: `with_genres: "18|16"` (pipe = unión)

**Ejemplo de Comportamiento**:

*Caso 1: Drama + Animación (pocos resultados)*
```
PHASE 1: Strict AND found 23 results
⚠️ Using FALLBACK (OR) logic
PHASE 2: Fetching with OR, prioritizing multi-genre
✅ Strategy: FALLBACK (OR), Total: 23
```

*Caso 2: Acción + Aventura (muchos resultados)*
```
PHASE 1: Strict AND found 1,247 results
✅ Using STRICT (AND) logic
PHASE 2: Fetching with AND only
✅ Strategy: STRICT (AND), Total: 1,247
```

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

**Última actualización**: 2026-02-05  
**Versión**: 2.1.0
