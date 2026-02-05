# Trinity - Movie Matching App

Trinity es una aplicación móvil que ayuda a grupos de amigos a encontrar películas o series para ver juntos mediante un sistema de votación colaborativa.

## 🎯 Descripción

Trinity resuelve el problema común de "¿qué vemos hoy?" permitiendo que múltiples usuarios voten simultáneamente sobre candidatos de películas/series hasta encontrar un match perfecto donde todos están de acuerdo.

### Características Principales

- **Salas de Votación**: Crea salas con código único para que tus amigos se unan
- **Votación Colaborativa**: Todos votan simultáneamente sobre los mismos candidatos
- **Match Automático**: Cuando todos votan positivo por la misma película, se genera un match
- **Notificaciones en Tiempo Real**: Recibe notificaciones instantáneas cuando hay un match
- **Historial de Matches**: Consulta todas las películas que han coincidido con tus amigos
- **Integración TMDB**: Candidatos de películas obtenidos de The Movie Database

## 🏗️ Arquitectura

### Stack Tecnológico

**Frontend (Mobile)**
- React Native 0.81.5
- Expo SDK 54
- TypeScript 5.9.2
- React Navigation 7.x
- AWS Amplify 6.16.0

**Backend (Infrastructure)**
- AWS CDK (Infrastructure as Code)
- AWS AppSync (GraphQL API)
- AWS Lambda (Serverless Functions)
- Amazon DynamoDB (Database)
- Amazon Cognito (Authentication)
- TMDB API (Movie Data)

### Arquitectura Serverless

```
┌─────────────┐
│   Mobile    │
│     App     │
└──────┬──────┘
       │
       ├─── AWS Cognito (Auth)
       │
       ├─── AWS AppSync (GraphQL)
       │         │
       │         ├─── Room Handler (Lambda)
       │         ├─── Vote Handler (Lambda)
       │         ├─── Match Handler (Lambda)
       │         └─── TMDB Handler (Lambda)
       │
       └─── DynamoDB Tables
                 ├─── trinity-rooms
                 ├─── trinity-votes
                 └─── trinity-matches
```

## � Estructura del Proyecto

```
trinity/
├── infrastructure/          # AWS CDK Infrastructure
│   ├── lib/
│   │   └── trinity-stack.ts # Stack principal de CDK
│   ├── src/handlers/        # Lambda functions
│   │   ├── room/           # Gestión de salas
│   │   ├── vote/           # Procesamiento de votos
│   │   ├── match/          # Gestión de matches
│   │   └── tmdb/           # Integración con TMDB
│   ├── lambda-zips/        # ZIPs de Lambda para deployment
│   ├── schema.graphql      # Esquema GraphQL
│   ├── package.json
│   ├── tsconfig.json
│   └── README.md
│
├── mobile/                 # React Native App
│   ├── src/
│   │   ├── screens/        # Pantallas de la app
│   │   ├── services/       # Servicios (API, Auth, etc.)
│   │   ├── hooks/          # Custom React hooks
│   │   ├── context/        # React Context providers
│   │   ├── navigation/     # Configuración de navegación
│   │   ├── config/         # Configuración AWS
│   │   ├── data/           # Datos estáticos
│   │   └── types/          # Tipos TypeScript
│   ├── android/            # Configuración Android
│   ├── assets/             # Assets estáticos
│   ├── App.tsx             # Componente principal
│   ├── app.json           # Configuración Expo
│   ├── package.json
│   └── README.md
│
├── docs/                   # Documentación
│   ├── technical/          # Documentación técnica
│   ├── DEPLOYMENT_GUIDE.md
│   ├── PRODUCTION_BUILD_GUIDE.md
│   └── TRINITY_MASTER_SPEC.md
│
├── .kiro/                  # Configuración Kiro
│   ├── steering/           # Guías de desarrollo
│   └── specs/              # Especificaciones
│
├── .env.example           # Template de variables de entorno
├── .gitignore
├── LICENSE
└── README.md              # Este archivo
```

## 🚀 Inicio Rápido

### Prerrequisitos

- Node.js 18+ y npm
- AWS CLI configurado
- AWS CDK CLI (`npm install -g aws-cdk`)
- Cuenta de TMDB API
- Para mobile: Expo CLI, Android Studio o Xcode

### 1. Clonar el Repositorio

```bash
git clone https://github.com/tu-usuario/trinity_app.git
cd trinity_app
```

### 2. Configurar Infrastructure

```bash
cd infrastructure
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales AWS y TMDB API key

# Desplegar a AWS
cdk bootstrap  # Solo la primera vez
cdk deploy
```

### 3. Configurar Mobile App

```bash
cd mobile
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con los endpoints de AWS generados en el paso anterior

# Iniciar en desarrollo
npx expo start --clear
```

## � Uso de la Aplicación

### Flujo Básico

1. **Registro/Login**: Crea una cuenta o inicia sesión
2. **Crear Sala**: 
   - Selecciona tipo de media (Película o Serie)
   - Elige hasta 2 géneros
   - Comparte el código de sala con tus amigos
3. **Unirse a Sala**: Ingresa el código de 6 caracteres
4. **Votar**: 
   - Desliza las películas candidatas
   - Vota positivo (👍) o negativo (👎)
5. **Match**: Cuando todos votan positivo por la misma película, ¡match!
6. **Celebración**: Pantalla de celebración con el póster de la película
7. **Mis Matches**: Consulta tu historial de matches

### Pantallas Principales

- **Dashboard**: Pantalla principal con acceso a todas las funciones
- **Crear Sala**: Configuración de nueva sala de votación
- **Unirse a Sala**: Ingreso con código de sala
- **Sala de Votación**: Votación de candidatos
- **Celebración de Match**: Pantalla visual cuando hay match
- **Mis Salas**: Historial de salas creadas/participadas
- **Mis Matches**: Historial de películas con match
- **Perfil**: Configuración de usuario

## 🔧 Desarrollo

### Comandos Útiles

**Infrastructure**
```bash
cd infrastructure

# Desarrollo
npm run build          # Compilar TypeScript
npm run watch          # Compilar en modo watch
cdk synth             # Sintetizar CloudFormation
cdk diff              # Ver cambios antes de deploy
cdk deploy            # Desplegar a AWS

# Testing
npm test              # Ejecutar tests
```

**Mobile**
```bash
cd mobile

# Desarrollo
npx expo start        # Iniciar Metro bundler
npx expo start --clear # Limpiar cache y iniciar

# Android
npx expo run:android  # Ejecutar en Android
cd android && ./gradlew assembleRelease  # Build APK

# iOS
npx expo run:ios      # Ejecutar en iOS

# Testing
npm test              # Ejecutar tests
```

### Variables de Entorno

**Infrastructure (.env)**
```bash
TMDB_API_KEY=tu_api_key_de_tmdb
AWS_REGION=eu-west-1
AWS_ACCOUNT_ID=tu_account_id
```

**Mobile (.env)**
```bash
EXPO_PUBLIC_AWS_REGION=eu-west-1
EXPO_PUBLIC_USER_POOL_ID=tu_user_pool_id
EXPO_PUBLIC_USER_POOL_CLIENT_ID=tu_client_id
EXPO_PUBLIC_GRAPHQL_ENDPOINT=tu_graphql_endpoint
EXPO_PUBLIC_APP_NAME=Trinity
EXPO_PUBLIC_APP_VERSION=1.0.0
```

## � Modelo de Datos

### Tablas DynamoDB

**trinity-rooms**
- Almacena información de salas de votación
- TTL de 24 horas
- Incluye candidatos de películas

**trinity-votes**
- Registra votos de usuarios
- Partition Key: roomId
- Sort Key: userMovieId (userId#movieId)

**trinity-matches**
- Almacena matches generados
- Incluye lista de usuarios que coincidieron
- Información de la película

Ver [docs/technical/06-dynamodb-tables.md](docs/technical/06-dynamodb-tables.md) para más detalles.

## 🔐 Seguridad

- **Autenticación**: AWS Cognito con User Pools
- **Autorización**: GraphQL con directivas @aws_auth
- **API Keys**: Variables de entorno, nunca en código
- **HTTPS**: Todas las comunicaciones encriptadas
- **TTL**: Salas expiran automáticamente después de 24h

## 🧪 Testing

```bash
# Infrastructure
cd infrastructure
npm test

# Mobile
cd mobile
npm test
```

## 📚 Documentación

- [Estado del Proyecto](PROJECT_STATUS.md) - Estado actual, limpieza y organización
- [Guía de Deployment](docs/DEPLOYMENT_GUIDE.md)
- [Guía de Build de Producción](docs/PRODUCTION_BUILD_GUIDE.md)
- [Especificación Maestra](docs/TRINITY_MASTER_SPEC.md)
- [Documentación Técnica](docs/technical/README.md)
- [Arquitectura de la App](docs/technical/01-app-architecture.md)
- [Funciones Lambda](docs/technical/04-lambda-functions.md)
- [Esquema GraphQL](docs/technical/05-graphql-schema.md)
- [Flujos de Aplicación](docs/technical/07-application-flows.md)

## 🤝 Contribución

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

### Guías de Estilo

- **TypeScript**: Strict mode habilitado
- **Naming**: camelCase para variables, PascalCase para tipos
- **Commits**: Mensajes descriptivos en inglés
- **Documentación**: Comentarios en código cuando sea necesario

Ver [.kiro/steering/trinity-project-guide.md](.kiro/steering/trinity-project-guide.md) para guías detalladas.

## 📝 Changelog

### v1.0.0 (2026-02-05)
- ✅ Pantalla de celebración de match con póster grande
- ✅ Navegación contextual inteligente
- ✅ Corrección de notificaciones duplicadas
- ✅ Corrección de errores de tipo GraphQL
- ✅ Sistema de auto-dismiss de notificaciones
- ✅ Integración completa con TMDB API
- ✅ Sistema de votación colaborativa
- ✅ Notificaciones en tiempo real

## 🐛 Problemas Conocidos

Ninguno actualmente. Reporta issues en GitHub.

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver [LICENSE](LICENSE) para más detalles.

## 👥 Autores

- **Tu Nombre** - *Trabajo Inicial* - [tu-usuario](https://github.com/tu-usuario)

## 🙏 Agradecimientos

- [The Movie Database (TMDB)](https://www.themoviedb.org/) por la API de películas
- [AWS](https://aws.amazon.com/) por la infraestructura serverless
- [Expo](https://expo.dev/) por el framework de React Native
- Comunidad de React Native y AWS CDK

## 📞 Contacto

- Email: tu-email@ejemplo.com
- GitHub: [@tu-usuario](https://github.com/tu-usuario)
- LinkedIn: [Tu Nombre](https://linkedin.com/in/tu-perfil)

---

**Hecho con ❤️ usando React Native, AWS y TypeScript**
