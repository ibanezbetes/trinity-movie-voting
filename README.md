# Trinity Movie Voting Application

Una aplicación serverless de votación de películas que permite a los usuarios crear salas, votar películas con gestos de deslizamiento y encontrar coincidencias con otros usuarios. Construida con arquitectura serverless de AWS y React Native.

## 🏗️ Arquitectura General

- **Backend**: AWS CDK v2, AppSync GraphQL, DynamoDB, Lambda Functions, Cognito
- **Mobile**: React Native (Expo SDK 50+) con TypeScript
- **Autenticación**: AWS Cognito con auto-confirmación
- **API Externa**: TMDB (The Movie Database) con filtrado de scripts latinos
- **Región**: eu-west-1 (Irlanda)

## 📁 Estructura del Proyecto

```
trinity_app/
├── infrastructure/                 # Infraestructura AWS CDK
│   ├── bin/                       # Punto de entrada CDK App
│   │   └── trinity-app.ts         # Aplicación CDK principal
│   ├── lib/                       # Definiciones de Stack CDK
│   │   ├── lib/                   # Código compilado
│   │   │   ├── trinity-stack.d.ts # Definiciones TypeScript
│   │   │   └── trinity-stack.js   # JavaScript compilado
│   │   └── trinity-stack.ts       # Stack de infraestructura principal
│   ├── src/                       # Código fuente de handlers Lambda
│   │   └── handlers/              # Funciones Lambda organizadas por dominio
│   │       ├── tmdb/              # Integración con API TMDB
│   │       │   ├── index.ts       # Handler TMDB con filtro de scripts latinos
│   │       │   ├── index.js       # JavaScript compilado
│   │       │   ├── package.json   # Dependencias (axios)
│   │       │   └── README.md      # Documentación del handler
│   │       ├── room/              # Gestión de salas
│   │       │   ├── index.ts       # Lógica de creación/unión de salas
│   │       │   ├── index.js       # JavaScript compilado
│   │       │   ├── package.json   # Dependencias
│   │       │   └── README.md      # Documentación del handler
│   │       ├── vote/              # Lógica de votación
│   │       │   ├── index.ts       # Procesamiento de votos y detección de matches
│   │       │   ├── index.js       # JavaScript compilado
│   │       │   ├── package.json   # Dependencias
│   │       │   └── README.md      # Documentación del handler
│   │       └── match/             # Gestión de coincidencias
│   │           ├── index.ts       # Creación de matches e historial
│   │           ├── index.js       # JavaScript compilado
│   │           ├── package.json   # Dependencias
│   │           └── README.md      # Documentación del handler
│   ├── scripts/                   # Scripts de utilidad
│   │   └── generate-mobile-config.js  # Auto-generar configuración móvil
│   ├── schema.graphql             # Esquema GraphQL de AppSync
│   ├── cdk.json                   # Configuración CDK
│   ├── package.json               # Dependencias CDK
│   ├── tsconfig.json              # Configuración TypeScript
│   ├── .env                       # Variables de entorno
│   ├── .env.example               # Ejemplo de variables de entorno
│   └── README.md                  # Documentación de infraestructura
├── mobile/                        # Aplicación React Native Expo
│   ├── src/                       # Código fuente de la app móvil
│   │   ├── components/            # Componentes UI reutilizables
│   │   ├── config/                # Archivos de configuración
│   │   │   └── aws-config.ts      # Configuración AWS auto-generada
│   │   ├── context/               # Contextos de React
│   │   │   └── AuthContext.tsx    # Contexto de autenticación
│   │   ├── data/                  # Datos estáticos
│   │   │   └── staticRecommendations.ts  # Categorías de películas curadas
│   │   ├── navigation/            # Configuración de navegación
│   │   │   └── AppNavigator.tsx   # Estructura de navegación principal
│   │   ├── screens/               # Pantallas de la aplicación
│   │   │   ├── AuthScreen.tsx     # Login/Registro con auto-confirmación
│   │   │   ├── DashboardScreen.tsx # Dashboard principal con 4 botones
│   │   │   ├── CreateRoomScreen.tsx # Creación de salas con selección de género
│   │   │   ├── JoinRoomScreen.tsx  # Unión a salas con código de entrada
│   │   │   ├── VotingRoomScreen.tsx # Interfaz de votación por deslizamiento
│   │   │   ├── MyMatchesScreen.tsx # Historial de coincidencias del usuario
│   │   │   ├── ProfileScreen.tsx   # Perfil de usuario y configuración
│   │   │   └── RecommendationsScreen.tsx # Recomendaciones estáticas
│   │   ├── services/              # Servicios API y utilidades
│   │   │   ├── amplify.ts         # Configuración AWS Amplify
│   │   │   ├── graphql.ts         # Consultas y mutaciones GraphQL
│   │   │   ├── auth.ts            # Helpers de autenticación
│   │   │   └── logger.ts          # Sistema de logging integral
│   │   └── types/                 # Definiciones de tipos TypeScript
│   │       └── index.ts           # Tipos e interfaces compartidas
│   ├── assets/                    # Assets estáticos (iconos, imágenes)
│   ├── App.tsx                    # Componente principal de la app
│   ├── app.json                   # Configuración Expo
│   ├── package.json               # Dependencias móviles
│   └── tsconfig.json              # Configuración TypeScript
├── DEPLOYMENT_GUIDE.md            # Instrucciones detalladas de despliegue
├── TRINITY_MASTER_SPEC.md         # Especificación maestra del proyecto
└── README.md                      # Este archivo
```

## 🚀 Inicio Rápido

### Prerrequisitos

- Node.js 18+ y npm
- AWS CLI configurado con credenciales
- AWS CDK CLI: `npm install -g aws-cdk`
- Expo CLI: `npm install -g @expo/cli`
- Cuenta TMDB API (gratuita en https://www.themoviedb.org/settings/api)

### 1. Despliegue del Backend

```bash
# Navegar a infraestructura
cd infrastructure

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales TMDB

# Desplegar en AWS
npm run deploy
```

### 2. Configuración de la App Móvil

```bash
# Navegar a la app móvil
cd mobile

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm start
```

## 🔧 Configuración del Entorno

Crear `infrastructure/.env` con:

```env
AWS_REGION=eu-west-1
TMDB_API_KEY=tu_clave_api_tmdb_aqui
TMDB_READ_TOKEN=tu_token_bearer_tmdb_aqui
TMDB_BASE_URL=https://api.themoviedb.org/3
```

## 🏛️ Recursos AWS Creados

### Tablas DynamoDB
- **TrinityRooms**: Datos de salas con GSI para búsqueda por código
- **TrinityVotes**: Votos de usuarios con claves compuestas
- **TrinityMatches**: Registros de coincidencias con indexación por timestamp
- **TrinityUsers**: Datos de perfil de usuario

### Funciones Lambda
- **trinity-tmdb-handler**: Integración con API TMDB con filtrado de scripts latinos
- **trinity-room-handler**: Lógica de creación y unión de salas
- **trinity-vote-handler**: Procesamiento de votos y detección de coincidencias
- **trinity-match-handler**: Creación de coincidencias y gestión de historial

### Otros Recursos
- **API GraphQL AppSync**: API principal con autenticación Cognito
- **Pool de Usuarios Cognito**: Autenticación de usuarios con auto-confirmación
- **Roles IAM**: Acceso de menor privilegio para funciones Lambda

## 📱 Características de la App Móvil

### Autenticación
- Pantalla de bienvenida con opciones de login/registro
- Auto-confirmación (no requiere verificación por email)
- Gestión de perfil con cambio de contraseña
- Manejo seguro de tokens JWT

### Funcionalidades Principales
- **Dashboard**: Layout de 4 botones (Crear Sala, Unirse a Sala, Mis Coincidencias, Recomendaciones)
- **Creación de Salas**: Selección de tipo de media (Película/TV) + filtrado por género (máx 2)
- **Unión a Salas**: Entrada de código de 6 caracteres con validación
- **Votación por Deslizamiento**: Tarjetas de películas a pantalla completa con reconocimiento de gestos
- **Detección de Coincidencias**: Notificaciones en tiempo real cuando los usuarios coinciden
- **Recomendaciones Estáticas**: 7 categorías curadas con latencia cero

### Características Técnicas
- Sistema de logging integral para debugging
- Arquitectura offline-first con fallbacks elegantes
- TypeScript en toda la aplicación para seguridad de tipos
- React Navigation para transiciones suaves

## 🛠️ Comandos de Desarrollo

### Infraestructura
```bash
cd infrastructure
npm run deploy          # Desplegar stack CDK
npm run destroy         # Destruir stack CDK  
npm run diff           # Mostrar diferencias de despliegue
npm run synth          # Sintetizar CloudFormation
npm run generate-config # Generar configuración móvil
```

### Móvil
```bash
cd mobile
npm start              # Iniciar servidor de desarrollo Expo
npm run android        # Ejecutar en dispositivo/emulador Android
npm run ios           # Ejecutar en dispositivo/simulador iOS
npm run web           # Ejecutar en navegador web
```

## 🔍 Detalles Clave de Implementación

### Filtrado de Scripts Latinos
- Filtra contenido con scripts no latinos (ej. japonés, árabe)
- Acepta: "Naruto" ✅, Rechaza: "ナルト" ❌
- Implementado en el handler TMDB con validación regex

### Autenticación con Auto-Confirmación
- Los usuarios se registran y son confirmados inmediatamente
- No requiere verificación por email
- Trigger Lambda PreSignUp maneja la auto-confirmación

### Generación de Códigos de Sala
- Códigos alfanuméricos de 6 caracteres (A-Z, 0-9)
- Detección de colisiones con lógica de reintento
- TTL de 24 horas para limpieza automática

### Algoritmo de Detección de Coincidencias
- Rastrea votos por combinación sala/película
- Detecta votos positivos unánimes
- Crea registros de coincidencias con asociaciones de usuarios

## 🐛 Solución de Problemas

### Problemas Comunes

1. **CDK Bootstrap Requerido**
   ```bash
   cdk bootstrap aws://TU_ACCOUNT_ID/eu-west-1
   ```

2. **Credenciales AWS No Encontradas**
   ```bash
   aws configure
   # O revisar ~/.aws/credentials
   ```

3. **Errores de API TMDB**
   - Verificar que TMDB_READ_TOKEN sea un token Bearer válido
   - Revisar límites de API (40 requests por 10 segundos)

4. **Configuración Móvil Faltante**
   ```bash
   cd infrastructure
   npm run generate-config
   ```

5. **Errores UUID en Lambda**
   - Asegurar que los handlers usen `crypto.randomUUID()` no el paquete `uuid`
   - Recompilar TypeScript: `npx tsc index.ts --target es2020 --module commonjs`

### Debugging

- Revisar logs de CloudWatch para errores de Lambda
- Usar el logger de la app móvil para debugging del lado cliente
- Verificar que el esquema GraphQL de AppSync coincida con las consultas del cliente

## 📊 Estado Actual

✅ **Funcionalidades Completadas:**
- Infraestructura AWS completa desplegada
- Autenticación de usuarios con auto-confirmación  
- Creación y unión de salas
- Integración TMDB con datos reales de películas
- App móvil con todas las pantallas principales
- Sistema de logging integral

🚧 **En Progreso:**
- Implementación de interfaz de votación
- Pruebas de detección de coincidencias
- Contenido de recomendaciones estáticas

## 📄 Licencia

ISC