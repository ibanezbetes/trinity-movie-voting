# 🎬 Trinity - Movie Chining App

**Version**: 1.0.6  
**Status**: ✅ Production Ready  
**Last Updated**: 2026-02-09

Trinity is a real-time movie chining application that helps groups of friends decide what to watch together. Stop endless scrolling and reach consensus in seconds with our innovative voting system.

## 🌟 Features

### Core Functionality
- **Smart Room Creation**: Create voting rooms with customizable genres and media types
- **Real-Time Voting**: Swipe-style voting interface with instant synchronization
- **Chin Detection**: Automatic detection when all participants agree on a movie
- **Google Sign-In**: Seamless authentication with Google OAuth
- **Live Notifications**: Real-time chin notifications via GraphQL subscriptions
- **Room Management**: Track your active rooms and past chines
- **Sound Effects**: Immersive audio feedback for votes and chines

### Technical Highlights
- **Serverless Architecture**: Built on AWS with auto-scaling capabilities
- **GraphQL API**: Efficient data fetching with AWS AppSync
- **Real-Time Sync**: WebSocket-based subscriptions for instant updates
- **Smart Discovery**: Intelligent movie recommendation algorithm with genre prioritization
- **Secure Authentication**: AWS Cognito with social provider integration
- **Cross-Platform**: React Native app for iOS and Android

## 🏗️ Architecture

Trinity uses a modern serverless architecture:

```
┌─────────────────┐
│  React Native   │
│   Mobile App    │
└────────┬────────┘
         │
         ├─── AWS Cognito (Auth)
         │
         ├─── AWS AppSync (GraphQL API)
         │
         └─── AWS Lambda Functions
                  │
                  ├─── Room Handler
                  ├─── Vote Handler
                  ├─── Chin Handler
                  ├─── TMDB Handler
                  └─── Username Handler
                  │
                  └─── Amazon DynamoDB
                           │
                           ├─── trinity-rooms
                           ├─── trinity-votes
                           └─── trinity-chines
```

## 📁 Project Structure

```
trinity/
├── mobile/                 # React Native mobile application
│   ├── src/
│   │   ├── screens/       # UI screens
│   │   ├── components/    # Reusable components
│   │   ├── services/      # API and business logic
│   │   ├── context/       # React context providers
│   │   ├── hooks/         # Custom React hooks
│   │   ├── navigation/    # Navigation configuration
│   │   └── config/        # App configuration
│   ├── android/           # Android native code
│   ├── assets/            # Images, sounds, fonts
│   └── package.json
│
├── infrastructure/        # AWS CDK infrastructure
│   ├── lib/              # CDK stack definitions
│   ├── src/handlers/     # Lambda function source code
│   │   ├── room/         # Room management
│   │   ├── vote/         # Vote processing
│   │   ├── chin/        # Chin detection
│   │   ├── tmdb/         # TMDB API integration
│   │   └── username/     # Username management
│   ├── lambda-zips/      # Compiled Lambda packages
│   ├── scripts/          # Utility scripts
│   └── schema.graphql    # GraphQL schema
│
├── web/                  # Marketing website
│   ├── index.html        # Landing page
│   ├── privacy.html      # Privacy policy
│   ├── terms.html        # Terms of service
│   ├── faqs.html         # FAQs
│   ├── styles.css        # Global styles
│   └── .htaccess         # Apache configuration
│
└── docs/                 # Documentation
    ├── technical/        # Technical documentation
    ├── DEPLOYMENT_GUIDE.md
    └── PRODUCTION_BUILD_GUIDE.md
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- AWS CLI configured with credentials
- AWS CDK CLI (`npm install -g aws-cdk`)
- Expo CLI (`npm install -g expo-cli`)
- Android Studio (for Android development)
- TMDB API Key ([Get one here](https://www.themoviedb.org/settings/api))

### Infrastructure Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/trinity.git
   cd trinity
   ```

2. **Deploy AWS infrastructure**
   ```bash
   cd infrastructure
   npm install
   
   # Create .env file
   cp .env.example .env
   # Add your TMDB_API_KEY to .env
   
   # Bootstrap CDK (first time only)
   cdk bootstrap
   
   # Deploy stack
   cdk deploy
   ```

3. **Note the outputs**
   After deployment, save these values:
   - GraphQL Endpoint
   - User Pool ID
   - User Pool Client ID
   - Region

### Mobile App Setup

1. **Install dependencies**
   ```bash
   cd mobile
   npm install
   ```

2. **Configure environment**
   ```bash
   # Create .env file
   cp .env.example .env
   ```
   
   Update `.env` with values from infrastructure deployment:
   ```env
   EXPO_PUBLIC_AWS_REGION=eu-west-1
   EXPO_PUBLIC_USER_POOL_ID=your-user-pool-id
   EXPO_PUBLIC_USER_POOL_CLIENT_ID=your-client-id
   EXPO_PUBLIC_GRAPHQL_ENDPOINT=your-graphql-endpoint
   ```

3. **Run the app**
   ```bash
   # Development
   npx expo start
   
   # Android
   npx expo run:android
   
   # iOS
   npx expo run:ios
   ```

## 🔐 Authentication

Trinity supports multiple authentication methods:

### Email/Password
- Standard email and password authentication
- Password requirements: 8+ characters, uppercase, lowercase, numbers
- Automatic username generation

### Google Sign-In
- One-tap Google authentication
- Seamless OAuth flow
- Automatic account creation

### ⚠️ CRITICAL: User Identification for Google Users

For users authenticated with Google OAuth, the system uses **`cognitoIdentityId`** as the unique user identifier, NOT `username`.

**Why this matters:**
- All Google users share the same `username` (the IAM role name)
- Each Google user has a unique `cognitoIdentityId` from Cognito Identity Pool
- Using `username` would treat all Google users as the same person

**Correct implementation:**
```typescript
// ✅ Correct - Use cognitoIdentityId for Google users
const userId = event.identity?.cognitoIdentityId || event.identity?.claims?.sub;

// ❌ Wrong - username is not unique for Google users
const userId = event.identity?.username;
```

This is implemented in:
- `infrastructure/src/handlers/vote/index.ts`
- `infrastructure/src/handlers/match/index.ts`

## 📊 Data Model

### Rooms
```typescript
{
  id: string;           // UUID
  code: string;         // 6-character room code
  hostId: string;       // Creator's user ID
  mediaType: 'MOVIE' | 'TV';
  genreIds: number[];   // Max 2 genres
  candidates: Movie[];  // 50 movie candidates
  createdAt: string;    // ISO timestamp
  ttl: number;          // Expiration (24h)
}
```

### Votes
```typescript
{
  roomId: string;       // Partition key
  userMovieId: string;  // Sort key: userId#movieId
  userId: string;
  movieId: number;      // TMDB ID
  vote: boolean;        // true = yes, false = no
  timestamp: string;
}
```

### Chines
```typescript
{
  roomId: string;       // Partition key
  movieId: number;      // Sort key
  chinId: string;      // UUID
  title: string;
  posterPath?: string;
  chinedUsers: string[];
  timestamp: string;
}
```

## 🎯 Key Flows

### 1. Create Room
1. User selects media type (Movie/TV) and up to 2 genres
2. System generates unique 6-character room code
3. TMDB Handler fetches 50 movie candidates using Smart Discovery algorithm
4. Room is created with 24-hour TTL
5. Host automatically joins the room

### 2. Join Room
1. User enters 6-character room code
2. System validates room exists and is active
3. User is added to room participants
4. Voting screen loads with movie candidates

### 3. Vote
1. User swipes right (yes) or left (no) on movies
2. Vote is recorded in DynamoDB
3. System checks for chines after each vote
4. If all participants vote yes on same movie → Chin!

### 4. Chin Detection
1. Vote Handler checks if all active users voted yes
2. Chin record created in DynamoDB
3. GraphQL subscription publishes chin event
4. All participants receive real-time notification
5. Celebration screen displays with confetti

## 🧠 Smart Discovery Algorithm

Trinity uses an intelligent movie discovery system:

### Phase 1: Availability Check
- Tests TMDB API with AND logic (genre intersection)
- Checks if sufficient results exist (50+ movies)

### Phase 2: Strategy Selection
- **50+ results**: Use strict AND logic (all genres required)
- **<50 results**: Use OR logic with prioritization (any genre, prefer multi-genre)

### Phase 3: Quality Filters
- Poster image required
- Overview text required
- Minimum 50 votes on TMDB
- Western languages only (en, es, fr, it, de, pt)
- Latin script validation
- No adult content

### Phase 4: Randomization
- Fisher-Yates shuffle for maximum variety
- Returns exactly 50 candidates

## 🛠️ Development

### Running Tests
```bash
# Infrastructure tests
cd infrastructure
npm test

# Mobile tests
cd mobile
npm test
```

### Building for Production
```bash
# Build Lambda functions
cd infrastructure
npm run build
./create-zips.ps1

# Build Android APK (for testing)
cd mobile
npx eas build --platform android --profile production-apk

# Build Android AAB (for Google Play Store)
cd mobile
./create-keystore.ps1    # First time only
./generate-aab.ps1       # Generate AAB
```

### Publishing to Google Play Store

**Quick Steps**:
1. Generate production keystore (first time only):
   ```bash
   cd mobile
   ./create-keystore.ps1
   ```

2. Build Android App Bundle:
   ```bash
   ./generate-aab.ps1
   ```

3. Upload to Play Console:
   - Go to [Google Play Console](https://play.google.com/console)
   - Upload `android/app/build/outputs/bundle/release/app-release.aab`
   - Complete store listing and submit

📖 **Complete Guide**: See [Google Play Store Publishing Guide](docs/GOOGLE_PLAY_STORE_GUIDE.md) for detailed step-by-step instructions.

### Useful Scripts
```bash
# Infrastructure
npm run build          # Compile TypeScript
npm run watch          # Watch mode
cdk synth             # Synthesize CloudFormation
cdk diff              # Show changes

# Mobile
npm start             # Start Expo dev server
npm run android       # Run on Android
npm run ios           # Run on iOS
```

## 📚 Documentation

- [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) - Complete deployment instructions
- [Production Build Guide](docs/PRODUCTION_BUILD_GUIDE.md) - Building for production
- [Technical Documentation](docs/technical/README.md) - In-depth technical docs
- [Infrastructure README](infrastructure/README.md) - AWS infrastructure details
- [Mobile README](mobile/README.md) - Mobile app documentation
- [Web README](web/README.md) - Marketing website documentation

## 🌐 Website

Trinity includes a marketing website with:
- **Landing Page**: App overview and download links
- **Privacy Policy**: GDPR-compliant privacy information
- **Terms of Service**: Legal terms and conditions
- **FAQs**: Comprehensive help and support

The website is built with vanilla HTML/CSS for maximum performance and can be deployed to any static hosting service (Netlify, Vercel, GitHub Pages, AWS S3, etc.).

**Live Site**: [trinity-app.es](https://trinity-app.es)

## 🔧 Configuration

### Environment Variables

**Infrastructure (.env)**
```env
TMDB_API_KEY=your_tmdb_api_key
AWS_REGION=eu-west-1
```

**Mobile (.env)**
```env
EXPO_PUBLIC_AWS_REGION=eu-west-1
EXPO_PUBLIC_USER_POOL_ID=your_user_pool_id
EXPO_PUBLIC_USER_POOL_CLIENT_ID=your_client_id
EXPO_PUBLIC_GRAPHQL_ENDPOINT=your_graphql_endpoint
```

## 🐛 Troubleshooting

### Common Issues

**Lambda timeout errors**
- Increase timeout in `trinity-stack.ts`
- Check CloudWatch logs for specific errors

**GraphQL subscription not working**
- Verify WebSocket connection in network tab
- Check authentication tokens are valid
- Ensure AppSync endpoint is correct

**TMDB API errors**
- Verify API key is valid
- Check rate limits (40 requests per 10 seconds)
- Ensure environment variable is set

**Build failures**
- Clear node_modules and reinstall
- Check Node.js version (18+)
- Verify all environment variables are set

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [The Movie Database (TMDB)](https://www.themoviedb.org/) for movie data
- [AWS](https://aws.amazon.com/) for cloud infrastructure
- [Expo](https://expo.dev/) for React Native tooling
- [React Native](https://reactnative.dev/) for mobile framework

## 📞 Contact

- **Email**: trinity.app.spain@gmail.com
- **Instagram**: [@trinity.app](https://www.instagram.com/trinity.app/)
- **Website**: [trinity-app.es](https://trinity-app.es)

---

**Made with ❤️ by the Trinity Team**

*Stop Scroll Infinity - Ponte de acuerdo en un chin* 🎬✨
