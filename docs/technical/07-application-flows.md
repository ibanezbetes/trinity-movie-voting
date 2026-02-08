# Trinity - Flujos de Aplicación Detallados

## 🔄 Flujos Principales de Trinity

Trinity maneja varios flujos críticos que involucran múltiples servicios AWS trabajando en conjunto. Cada flujo está diseñado para ser robusto, escalable y proporcionar una experiencia de usuario fluida.

## 🏠 Flujo 1: Creación de Sala

### Descripción
Un usuario crea una nueva sala de votación especificando el tipo de contenido (película/serie) y hasta 2 géneros. El sistema genera un código único y obtiene candidatos de películas de TMDB.

### Actores
- **Usuario**: Creador de la sala
- **Mobile App**: Interfaz React Native
- **AppSync**: API GraphQL
- **Room Handler**: Lambda de gestión de salas
- **TMDB Handler**: Lambda de integración con TMDB
- **DynamoDB**: Almacenamiento de datos

### Diagrama de Secuencia
```mermaid
sequenceDiagram
    participant U as Usuario
    participant M as Mobile App
    participant AS as AppSync
    participant RH as Room Handler
    participant TH as TMDB Handler
    participant DB as DynamoDB
    participant TMDB as TMDB API

    U->>M: Selecciona géneros y tipo
    M->>AS: createRoom mutation
    AS->>RH: Invoke Room Handler
    
    Note over RH: Validar input
    RH->>RH: Generar código único
    
    Note over RH: Obtener candidatos
    RH->>TH: Invoke TMDB Handler
    TH->>TMDB: GET /discover/movie
    TMDB-->>TH: Lista de películas
    TH->>TH: Filtrar y formatear
    TH-->>RH: Candidatos formateados
    
    Note over RH: Crear sala
    RH->>DB: PutItem (trinity-rooms)
    RH->>DB: PutItem (trinity-votes) - Participación host
    
    RH-->>AS: Sala creada
    AS-->>M: Room data + código
    M-->>U: Mostrar código de sala
```

### Pasos Detallados

#### 1. Validación de Input
```typescript
// Room Handler valida entrada
if (!mediaType || !['MOVIE', 'TV'].includes(mediaType)) {
  throw new Error('Invalid mediaType');
}

if (genreIds.length > 2) {
  throw new Error('Maximum 2 genres allowed');
}
```

#### 2. Generación de Código Único
```typescript
// Algoritmo de generación con verificación de unicidad
async generateUniqueCode(): Promise<string> {
  let attempts = 0;
  while (attempts < 10) {
    const code = generateRandomCode(); // 6 caracteres A-Z, 0-9
    
    // Verificar unicidad usando GSI
    const existing = await queryByCode(code);
    if (!existing) {
      return code;
    }
    attempts++;
  }
  throw new Error('Failed to generate unique code');
}
```

#### 3. Obtención de Candidatos TMDB
```typescript
// TMDB Handler construye query optimizada
const params = {
  with_genres: genreIds.join(','),
  sort_by: 'popularity.desc',
  'vote_average.gte': '6.0',
  'vote_count.gte': '100',
  page: 1
};
```

#### 4. Almacenamiento en DynamoDB
```typescript
// Crear registro de sala
const room = {
  id: randomUUID(),
  code: uniqueCode,
  hostId: userId,
  mediaType,
  genreIds,
  candidates,
  createdAt: new Date().toISOString(),
  ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24h
};

// Registrar participación automática del host
const participation = {
  roomId: room.id,
  userMovieId: `${userId}#JOINED`,
  userId,
  movieId: -1,
  vote: false,
  isParticipation: true,
  timestamp: new Date().toISOString()
};
```

### Manejo de Errores
- **TMDB API Down**: Retorna sala con candidatos vacíos
- **Código Duplicado**: Reintentos automáticos hasta 10 veces
- **DynamoDB Error**: Rollback y error al usuario

## 🚪 Flujo 2: Unirse a Sala

### Descripción
Un usuario se une a una sala existente usando un código de 6 caracteres. El sistema valida el código, verifica que la sala no haya expirado y registra la participación.

### Diagrama de Secuencia
```mermaid
sequenceDiagram
    participant U as Usuario
    participant M as Mobile App
    participant AS as AppSync
    participant RH as Room Handler
    participant DB as DynamoDB

    U->>M: Ingresa código de sala
    M->>AS: joinRoom mutation
    AS->>RH: Invoke Room Handler
    
    Note over RH: Buscar sala por código
    RH->>DB: Query GSI code-index
    
    alt Sala encontrada y válida
        DB-->>RH: Room data
        RH->>RH: Validar TTL
        
        Note over RH: Registrar participación
        RH->>DB: PutItem (trinity-votes)
        
        RH-->>AS: Sala válida
        AS-->>M: Room data
        M-->>U: Navegar a sala de votación
    else Sala no encontrada o expirada
        DB-->>RH: Empty result
        RH-->>AS: Error
        AS-->>M: Error message
        M-->>U: "Código inválido"
    end
```

### Validaciones Implementadas

#### 1. Formato de Código
```typescript
const codeRegex = /^[A-Z0-9]{6}$/;
if (!codeRegex.test(code)) {
  throw new Error('Invalid code format');
}
```

#### 2. Existencia de Sala
```typescript
// Query usando GSI para eficiencia
const result = await docClient.send(new QueryCommand({
  TableName: 'trinity-rooms',
  IndexName: 'code-index',
  KeyConditionExpression: 'code = :code',
  ExpressionAttributeValues: { ':code': code.toUpperCase() }
}));

if (!result.Items || result.Items.length === 0) {
  throw new Error('Room not found');
}
```

#### 3. Validación de TTL
```typescript
const now = Math.floor(Date.now() / 1000);
if (room.ttl && room.ttl < now) {
  throw new Error('Room has expired');
}
```

### Fallback para GSI
```typescript
// Si GSI no está disponible, usar scan como fallback
try {
  return await queryByGSI(code);
} catch (error) {
  console.log('GSI not available, using scan fallback');
  return await scanByCode(code);
}
```

## 🗳️ Flujo 3: Proceso de Votación

### Descripción
Los usuarios votan por películas candidatas. El sistema registra cada voto y verifica automáticamente si se ha producido un chin (todos votan positivamente por la misma película).

### Diagrama de Secuencia
```mermaid
sequenceDiagram
    participant U1 as Usuario 1
    participant U2 as Usuario 2
    participant M as Mobile App
    participant AS as AppSync
    participant VH as Vote Handler
    participant DB as DynamoDB

    Note over U1,U2: Ambos en la misma sala

    U1->>M: Vota positivo por película X
    M->>AS: vote mutation
    AS->>VH: Process vote
    
    VH->>DB: PutItem (trinity-votes)
    VH->>VH: Check for chin
    VH->>DB: Query votos positivos película X
    VH->>DB: Query total usuarios sala
    
    Note over VH: 1 de 2 usuarios votó positivo
    VH-->>AS: Vote recorded, no chin
    AS-->>M: Success
    
    U2->>M: Vota positivo por película X
    M->>AS: vote mutation
    AS->>VH: Process vote
    
    VH->>DB: PutItem (trinity-votes)
    VH->>VH: Check for chin
    VH->>DB: Query votos positivos película X
    VH->>DB: Query total usuarios sala
    
    Note over VH: 2 de 2 usuarios votaron positivo - MATCH!
    VH->>DB: PutItem (trinity-chines)
    VH->>AS: publishUserChin (Usuario 1)
    VH->>AS: publishUserChin (Usuario 2)
    
    AS-->>U1: Chin notification
    AS-->>U2: Chin notification
```

### Algoritmo de Detección de Chin

#### 1. Registrar Voto
```typescript
const voteRecord = {
  roomId,
  userMovieId: `${userId}#${movieId}`,
  userId,
  movieId,
  vote,
  timestamp: new Date().toISOString()
};

await docClient.send(new PutCommand({
  TableName: 'trinity-votes',
  Item: voteRecord
}));
```

#### 2. Verificar Chin (Solo para Votos Positivos)
```typescript
if (!vote) {
  return { success: true }; // No verificar chines para votos negativos
}

// Obtener votos positivos para esta película
const positiveVotes = await getPositiveVotes(roomId, movieId);

// Obtener total de usuarios únicos en la sala
const totalUsers = await getTotalUsers(roomId);

// Verificar unanimidad
if (positiveVotes.length === totalUsers.length && totalUsers.length > 1) {
  return await createChin(roomId, movieId, positiveVotes);
}
```

#### 3. Crear Chin
```typescript
async createChin(roomId: string, movieId: number, users: string[]): Promise<Chin> {
  const chin = {
    roomId,
    movieId,
    chinId: randomUUID(),
    title: await getMovieTitle(movieId),
    posterPath: await getMoviePoster(movieId),
    chinedUsers: users,
    timestamp: new Date().toISOString()
  };
  
  // Almacenar chin
  await docClient.send(new PutCommand({
    TableName: 'trinity-chines',
    Item: chin
  }));
  
  return chin;
}
```

### Prevención de Condiciones de Carrera
```typescript
// Usar transacciones para operaciones críticas
const transactItems = [
  {
    Put: {
      TableName: 'trinity-votes',
      Item: voteRecord,
      ConditionExpression: 'attribute_not_exists(userMovieId) OR userMovieId = :userMovieId',
      ExpressionAttributeValues: { ':userMovieId': voteRecord.userMovieId }
    }
  }
];

await docClient.send(new TransactWriteCommand({
  TransactItems: transactItems
}));
```

## 🔔 Flujo 4: Sistema de Notificaciones

### Descripción
Cuando se detecta un chin, el sistema envía notificaciones en tiempo real a todos los usuarios participantes usando GraphQL subscriptions y polling como fallback.

### Diagrama de Arquitectura de Notificaciones
```mermaid
graph TB
    subgraph "Chin Detection"
        A[Vote Handler] --> B[Chin Detected]
    end
    
    subgraph "Notification Publishing"
        B --> C[Publish to AppSync]
        C --> D[User Chin Events]
        C --> E[Room Chin Events]
    end
    
    subgraph "Client Reception"
        D --> F[GraphQL Subscriptions]
        D --> G[Polling Fallback]
        F --> H[Real-time Notification]
        G --> I[Delayed Notification]
    end
    
    subgraph "User Experience"
        H --> J[Instant UI Update]
        I --> J
        J --> K[Chin Details Screen]
    end
```

### Implementación de Subscriptions

#### 1. Publicación de Eventos
```typescript
// Vote Handler publica eventos para cada usuario
for (const userId of chinedUsers) {
  await graphqlClient.request(`
    mutation PublishUserChin($userId: ID!, $chinData: RoomChinInput!) {
      publishUserChin(userId: $userId, chinData: $chinData) {
        userId
        chinId
        movieTitle
      }
    }
  `, {
    userId,
    chinData: {
      chinId: chin.chinId,
      movieId: chin.movieId,
      movieTitle: chin.title,
      posterPath: chin.posterPath,
      chinedUsers: chin.chinedUsers,
      timestamp: chin.timestamp
    }
  });
}
```

#### 2. Suscripción del Cliente
```typescript
// Mobile app se suscribe a chines del usuario
const subscription = client.graphql({
  query: `
    subscription UserChin($userId: ID!) {
      userChin(userId: $userId) {
        chinId
        movieTitle
        posterPath
        chinedUsers
        timestamp
      }
    }
  `,
  variables: { userId: currentUser.id },
  authMode: 'userPool'
}).subscribe({
  next: ({ data }) => {
    if (data?.userChin) {
      showChinNotification(data.userChin);
      navigateToChinScreen(data.userChin);
    }
  },
  error: (error) => {
    console.error('Subscription error:', error);
    // Activar polling como fallback
    startPollingFallback();
  }
});
```

#### 3. Polling Fallback
```typescript
// Sistema de polling como respaldo
class ChinPollingService {
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastCheckTimestamp: string = new Date().toISOString();

  startPolling(userId: string, onChin: (chin: Chin) => void) {
    this.pollingInterval = setInterval(async () => {
      try {
        const chines = await this.checkForNewChin(userId);
        chines.forEach(onChin);
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 2000); // Poll cada 2 segundos
  }

  private async checkForNewChin(userId: string): Promise<Chin[]> {
    const response = await client.graphql({
      query: CHECK_USER_MATCHES,
      variables: { userId },
      authMode: 'userPool'
    });

    const allChin = response.data.checkUserChin;
    
    // Filtrar solo chines nuevos
    return allChin.filter(chin => 
      chin.timestamp > this.lastCheckTimestamp
    );
  }
}
```

## 📋 Flujo 5: Consulta de Mis Salas

### Descripción
El usuario consulta las salas donde participa que aún no tienen chines. El sistema busca en múltiples fuentes y filtra según criterios específicos.

### Diagrama de Flujo de Datos
```mermaid
graph TB
    A[Usuario solicita Mis Salas] --> B[Room Handler]
    
    B --> C[Buscar salas como host]
    B --> D[Buscar participación en votos]
    
    C --> E[Scan trinity-rooms por hostId]
    D --> F[Scan trinity-votes por userId]
    
    F --> G[Extraer roomIds únicos]
    G --> H[Get room details por ID]
    
    E --> I[Combinar resultados]
    H --> I
    
    I --> J[Filtrar salas expiradas]
    J --> K[Verificar chines por sala]
    K --> L[Filtrar salas con chines]
    L --> M[Ordenar por fecha creación]
    M --> N[Retornar lista final]
```

### Implementación Detallada

#### 1. Obtener Salas como Host
```typescript
async getRoomsAsHost(userId: string): Promise<Room[]> {
  const result = await docClient.send(new ScanCommand({
    TableName: 'trinity-rooms',
    FilterExpression: 'hostId = :userId',
    ExpressionAttributeValues: { ':userId': userId }
  }));
  
  return result.Items as Room[];
}
```

#### 2. Obtener Salas por Participación
```typescript
async getRoomsByParticipation(userId: string): Promise<Room[]> {
  // Obtener registros de participación
  const votesResult = await docClient.send(new ScanCommand({
    TableName: 'trinity-votes',
    FilterExpression: 'userId = :userId',
    ExpressionAttributeValues: { ':userId': userId }
  }));
  
  // Extraer IDs únicos de salas
  const roomIds = new Set(
    votesResult.Items?.map(item => item.roomId) || []
  );
  
  // Obtener detalles de cada sala
  const rooms = await Promise.all(
    Array.from(roomIds).map(async (roomId) => {
      const roomResult = await docClient.send(new GetCommand({
        TableName: 'trinity-rooms',
        Key: { id: roomId }
      }));
      return roomResult.Item as Room;
    })
  );
  
  return rooms.filter(room => room !== null);
}
```

#### 3. Filtrar Salas con Chin
```typescript
async filterRoomsWithoutChin(rooms: Room[]): Promise<Room[]> {
  const roomsWithoutChin = [];
  
  for (const room of rooms) {
    const hasChin = await this.checkRoomHasChin(room.id);
    if (!hasChin) {
      roomsWithoutChin.push(room);
    }
  }
  
  return roomsWithoutChin;
}

private async checkRoomHasChin(roomId: string): Promise<boolean> {
  const result = await docClient.send(new QueryCommand({
    TableName: 'trinity-chines',
    KeyConditionExpression: 'roomId = :roomId',
    ExpressionAttributeValues: { ':roomId': roomId },
    Limit: 1 // Solo necesitamos saber si existe alguno
  }));
  
  return (result.Items?.length || 0) > 0;
}
```

## 🔍 Flujo 6: Consulta de Mis Chin

### Descripción
El usuario consulta su historial de chines encontrados. El sistema busca en la tabla de chines y retorna los resultados ordenados cronológicamente.

### Diagrama Simplificado
```mermaid
sequenceDiagram
    participant U as Usuario
    participant M as Mobile App
    participant AS as AppSync
    participant MH as Chin Handler
    participant DB as DynamoDB

    U->>M: Ver mis chines
    M->>AS: getMyChin query
    AS->>MH: Invoke Chin Handler
    
    MH->>DB: Scan trinity-chines
    Note over MH: Filter by user in chinedUsers
    DB-->>MH: Filtered chines
    
    MH->>MH: Sort by timestamp desc
    MH-->>AS: Chin list
    AS-->>M: Chin data
    M-->>U: Display chines history
```

### Optimización con GSI (Futura)
```typescript
// GSI propuesto para optimizar consultas por usuario
interface UserChinGSI {
  userId: string;        // GSI PK
  timestamp: string;     // GSI SK
  roomId: string;        // Projected attribute
  movieId: number;       // Projected attribute
  chinId: string;       // Projected attribute
}

// Query optimizada
const result = await docClient.send(new QueryCommand({
  TableName: 'trinity-chines',
  IndexName: 'user-chines-index',
  KeyConditionExpression: 'userId = :userId',
  ExpressionAttributeValues: { ':userId': userId },
  ScanIndexForward: false // Orden descendente por timestamp
}));
```

## 📊 Métricas y Monitoreo de Flujos

### Métricas por Flujo
```typescript
// Métricas personalizadas para cada flujo
const metrics = {
  'room.creation.duration': 'Tiempo de creación de sala',
  'room.join.success_rate': 'Tasa de éxito al unirse',
  'vote.processing.latency': 'Latencia de procesamiento de votos',
  'chin.detection.accuracy': 'Precisión de detección de chines',
  'notification.delivery.time': 'Tiempo de entrega de notificaciones'
};

// Logging estructurado
console.log(JSON.stringify({
  metric: 'room.creation.duration',
  value: processingTime,
  userId: userId,
  roomId: roomId,
  timestamp: new Date().toISOString()
}));
```

### Dashboards de Monitoreo
- **Flujo de Creación**: Tiempo promedio, tasa de éxito, errores TMDB
- **Flujo de Votación**: Latencia, chines por hora, errores de concurrencia
- **Sistema de Notificaciones**: Tasa de entrega, latencia, fallbacks activados

---

Estos flujos detallados muestran cómo Trinity orquesta múltiples servicios AWS para proporcionar una experiencia de usuario fluida y confiable, con manejo robusto de errores y optimizaciones de performance en cada paso.