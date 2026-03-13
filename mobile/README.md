# 📱 Trinity Mobile App

React Native mobile application for Trinity Movie Matching platform.

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Screens](#screens)
- [Services](#services)
- [Components](#components)
- [Context Providers](#context-providers)
- [Custom Hooks](#custom-hooks)
- [Setup](#setup)
- [Development](#development)
- [Building](#building)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## 🎯 Overview

Trinity Mobile is a cross-platform React Native application built with Expo. It provides a seamless movie matching experience with real-time synchronization, intuitive swipe-based voting, and instant match notifications.

### Key Features

- **Authentication**: Email/password and Google Sign-In
- **Real-Time Sync**: GraphQL subscriptions for instant updates
- **Swipe Voting**: Tinder-style interface for movie selection
- **Match Notifications**: Celebration screen with confetti effects
- **Sound Effects**: Audio feedback for user interactions
- **Room Management**: Create, join, and manage voting rooms
- **Match History**: View past matches and room activity

### Tech Stack

- **Framework**: React Native + Expo SDK 52
- **Language**: TypeScript
- **State Management**: React Context API
- **Navigation**: React Navigation 6
- **Authentication**: AWS Amplify Auth
- **API**: AWS AppSync (GraphQL)
- **Real-Time**: GraphQL Subscriptions
- **UI**: Custom components with React Native SVG
- **Audio**: Expo AV

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│           React Native App              │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────┐  ┌──────────┐           │
│  │ Screens  │  │Components│           │
│  └────┬─────┘  └────┬─────┘           │
│       │             │                  │
│  ┌────┴─────────────┴─────┐           │
│  │   Context Providers     │           │
│  │  - Auth                 │           │
│  │  - Theme                │           │
│  │  - Sound                │           │
│  │  - MatchNotification    │           │
│  └────┬────────────────────┘           │
│       │                                │
│  ┌────┴────────────────────┐           │
│  │      Services            │           │
│  │  - Amplify               │           │
│  │  - GraphQL               │           │
│  │  - Subscriptions         │           │
│  │  - Logger                │           │
│  └────┬────────────────────┘           │
│       │                                │
└───────┼────────────────────────────────┘
        │
        ├─── AWS Cognito (Auth)
        ├─── AWS AppSync (GraphQL)
        └─── AWS Lambda (Backend)
```

## 📁 Project Structure

```
mobile/
├── src/
│   ├── screens/              # Screen components
│   │   ├── AuthScreen.tsx           # Login/Register
│   │   ├── DashboardScreen.tsx      # Home screen
│   │   ├── CreateRoomScreen.tsx     # Room creation
│   │   ├── JoinRoomScreen.tsx       # Join with code
│   │   ├── VotingRoomScreen.tsx     # Swipe voting
│   │   ├── MatchCelebrationScreen.tsx  # Match found
│   │   ├── MyRoomsScreen.tsx        # Room list
│   │   ├── MyMatchesScreen.tsx      # Match history
│   │   ├── RecommendationsScreen.tsx # Browse movies
│   │   └── ProfileScreen.tsx        # User settings
│   │
│   ├── components/           # Reusable UI components
│   │   ├── Typography.tsx           # Text components
│   │   ├── Button.tsx               # Button variants
│   │   ├── Card.tsx                 # Card container
│   │   ├── Icon.tsx                 # Ionicons wrapper
│   │   ├── ChinIcon.tsx             # Custom logo
│   │   ├── Avatar.tsx               # User avatar
│   │   ├── Chip.tsx                 # Genre chips
│   │   ├── MovieCarousel.tsx        # Scrolling movies
│   │   ├── CelebrationEffects.tsx   # Confetti
│   │   ├── CustomAlert.tsx          # Alert dialogs
│   │   ├── FloatingTabBar.tsx       # Bottom nav
│   │   └── index.ts                 # Exports
│   │
│   ├── services/             # Business logic & API
│   │   ├── amplify.ts               # AWS Amplify config
│   │   ├── auth.ts                  # Auth helpers
│   │   ├── graphql.ts               # GraphQL operations
│   │   ├── subscriptions.ts         # Real-time subs
│   │   ├── recommendations.ts       # Movie data
│   │   └── logger.ts                # Structured logging
│   │
│   ├── context/              # React Context providers
│   │   ├── AuthContext.tsx          # Auth state
│   │   ├── ThemeContext.tsx         # Theme/colors
│   │   ├── SoundContext.tsx         # Audio control
│   │   └── MatchNotificationContext.tsx  # Match alerts
│   │
│   ├── hooks/                # Custom React hooks
│   │   ├── useMatchPolling.ts       # Polling fallback
│   │   └── useProactiveMatchCheck.ts # Immediate check
│   │
│   ├── navigation/           # Navigation setup
│   │   └── AppNavigator.tsx         # Stack & Tab nav
│   │
│   ├── config/               # Configuration
│   │   └── aws-config.ts            # AWS credentials
│   │
│   ├── data/                 # Static data
│   │   └── staticRecommendations.ts # Fallback movies
│   │
│   └── types/                # TypeScript types
│       └── index.ts                 # Type definitions
│
├── android/                  # Android native code
├── assets/                   # Static assets
│   ├── logoTrinity.png
│   ├── icon.png
│   ├── splash-icon.png
│   ├── botonSi.png
│   ├── botonNo.png
│   ├── iconoChin.png
│   ├── inicioApp.wav
│   ├── votoSi.wav
│   ├── votoNo.wav
│   └── chin.wav
│
├── App.tsx                   # Root component
├── app.json                  # Expo configuration
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript config
└── README.md                 # This file
```

## 📱 Screens

### AuthScreen
**Purpose**: User authentication (login/register)

**Features**:
- Welcome screen with movie carousel
- Email/password authentication
- Google Sign-In integration
- Password validation with requirements
- Username creation

**Navigation**: Entry point → Dashboard on success

**Key Functions**:
- `handleLogin()`: Email/password sign-in
- `handleRegister()`: Create new account
- `handleGoogleLogin()`: OAuth with Google

---

### DashboardScreen
**Purpose**: Main hub for app navigation

**Features**:
- Create new room button
- Join room with code
- View my rooms
- View my matches
- Browse recommendations
- Quick access to profile

**Navigation**: Tab navigator root

**Key Functions**:
- Navigation to all major features
- User greeting with username
- Quick stats display

---

### CreateRoomScreen
**Purpose**: Create a new voting room

**Features**:
- Media type selection (Movie/TV)
- Genre selection (max 2)
- Visual genre chips
- Room code generation
- Automatic host join

**Flow**:
1. Select media type
2. Choose up to 2 genres
3. Tap "Crear Sala"
4. System generates code
5. Navigate to VotingRoom

**Key Functions**:
- `handleCreateRoom()`: GraphQL mutation
- `handleGenreToggle()`: Genre selection logic

---

### JoinRoomScreen
**Purpose**: Join existing room with code

**Features**:
- 6-character code input
- Auto-uppercase formatting
- Code validation
- Error handling

**Flow**:
1. Enter 6-character code
2. Tap "Unirse"
3. System validates room
4. Navigate to VotingRoom

**Key Functions**:
- `handleJoinRoom()`: GraphQL mutation
- Code formatting and validation

---

### VotingRoomScreen
**Purpose**: Swipe-based movie voting

**Features**:
- Tinder-style card interface
- Swipe right (yes) / left (no)
- Button voting alternative
- Real-time vote sync
- Progress indicator
- Match detection
- Sound effects

**Flow**:
1. Load room candidates
2. Display movie cards
3. User votes on each movie
4. System checks for matches
5. Navigate to celebration on match

**Key Functions**:
- `handleVote()`: Submit vote to backend
- `checkForMatches()`: Verify match conditions
- `handleSwipe()`: Gesture handling

**State Management**:
- Current movie index
- Voted movies set
- Match detection status
- Loading states

---

### MatchCelebrationScreen
**Purpose**: Display match result with celebration

**Features**:
- Confetti animation
- Movie poster display
- Match details
- Sound effect
- Navigation options

**Props**:
- `matchId`: Match identifier
- `movieTitle`: Movie name
- `posterPath`: TMDB poster URL
- `roomCode`: Room identifier

**Key Functions**:
- `playSound('chin')`: Celebration audio
- Confetti animation trigger

---

### MyRoomsScreen
**Purpose**: List user's active and past rooms

**Features**:
- Active rooms list
- Room codes display
- Participant count
- Genre badges
- Navigation to voting
- Pull-to-refresh

**Data Source**: GraphQL query `getMyRooms`

**Key Functions**:
- `loadRooms()`: Fetch user rooms
- `handleRoomPress()`: Navigate to room
- `handleRefresh()`: Reload data

---

### MyMatchesScreen
**Purpose**: Display user's match history

**Features**:
- Match list with posters
- Movie titles
- Match timestamps
- Room information
- Empty state handling

**Data Source**: GraphQL query `getMyMatches`

**Key Functions**:
- `loadMatches()`: Fetch match history
- `handleMatchPress()`: View details

---

### RecommendationsScreen
**Purpose**: Browse movie recommendations

**Features**:
- Grid layout
- Movie posters
- Search functionality
- Genre filtering
- Infinite scroll

**Data Source**: Static recommendations + TMDB

**Key Functions**:
- `loadRecommendations()`: Fetch movies
- `handleSearch()`: Filter results

---

### ProfileScreen
**Purpose**: User settings and account management

**Features**:
- User profile display
- Change password
- Sound toggle
- Sound test buttons
- My rooms shortcut
- My matches shortcut
- Help/FAQs
- Rate app
- About Trinity
- Social links
- Sign out
- Delete account

**Key Functions**:
- `handleChangePassword()`: Update password
- `handleSignOut()`: Log out user
- `handleDeleteAccount()`: Remove account
- `toggleSound()`: Audio settings

## 🔧 Services

### amplify.ts
**Purpose**: AWS Amplify configuration

**Exports**:
- `client`: GraphQL client for queries/mutations
- `realtimeClient`: GraphQL client for subscriptions
- `verifyAuthStatus()`: Check authentication
- `refreshAuthSession()`: Refresh tokens

**Configuration**:
```typescript
{
  Auth: {
    Cognito: {
      userPoolId, userPoolClientId, region,
      loginWith: { oauth: {...} }
    }
  },
  API: {
    GraphQL: { endpoint, region, defaultAuthMode }
  }
}
```

---

### auth.ts
**Purpose**: Authentication helper functions

**Functions**:
- `signUp()`: Create new user
- `signIn()`: Authenticate user
- `signOut()`: Log out
- `getCurrentUser()`: Get current user
- `fetchUserAttributes()`: Get user data
- `updatePassword()`: Change password
- `deleteUser()`: Remove account

---

### graphql.ts
**Purpose**: GraphQL operations

**Queries**:
- `GET_MY_ROOMS`: Fetch user rooms
- `GET_MY_MATCHES`: Fetch match history
- `GET_ROOM_BY_CODE`: Find room by code

**Mutations**:
- `CREATE_ROOM`: Create new room
- `JOIN_ROOM`: Join existing room
- `VOTE`: Submit vote
- `PUBLISH_USER_MATCH`: Notify match

**Subscriptions**:
- `USER_MATCH_SUBSCRIPTION`: Listen for matches

---

### subscriptions.ts
**Purpose**: Real-time subscription management

**Functions**:
- `subscribeToUserMatches()`: Listen for user matches
- `unsubscribeFromUserMatches()`: Clean up subscription

**Features**:
- Automatic reconnection
- Error handling
- Token refresh
- Logging

---

### recommendations.ts
**Purpose**: Movie data management

**Functions**:
- `getRecommendations()`: Fetch movie list
- `searchMovies()`: Search by title
- `getMovieDetails()`: Get movie info

**Data Source**: Static fallback + TMDB API

---

### logger.ts
**Purpose**: Structured logging

**Functions**:
- `logger.info()`: General info
- `logger.auth()`: Auth events
- `logger.authError()`: Auth errors
- `logger.userAction()`: User interactions
- `logger.navigation()`: Navigation events
- `logger.ui()`: UI events
- `logger.apiRequest()`: API calls
- `logger.apiResponse()`: API responses
- `logger.error()`: General errors

**Format**:
```typescript
{
  timestamp: ISO string,
  level: 'INFO' | 'ERROR',
  category: string,
  message: string,
  data?: object
}
```

## 🎨 Components

### Typography
**Purpose**: Consistent text styling

**Variants**:
- `h1`: Large headings (32px)
- `h2`: Medium headings (24px)
- `h3`: Small headings (20px)
- `body`: Body text (16px)
- `caption`: Small text (14px)
- `label`: Form labels (12px, uppercase)

**Props**: `variant`, `align`, `style`, `children`

---

### Button
**Purpose**: Interactive buttons

**Variants**:
- `primary`: Purple gradient
- `secondary`: Outlined
- `outline`: Border only

**Sizes**: `small`, `medium`, `large`

**Props**: `title`, `variant`, `size`, `onPress`, `disabled`, `loading`, `style`

---

### Card
**Purpose**: Container component

**Features**:
- Rounded corners
- Shadow/elevation
- Padding
- Background color

**Props**: `children`, `style`, `onPress`

---

### Icon
**Purpose**: Ionicons wrapper

**Props**: `name`, `size`, `color`, `style`

**Usage**: Consistent icon rendering across app

---

### ChinIcon
**Purpose**: Custom Trinity logo

**Props**: `size`, `color`

**Features**: SVG-based scalable logo

---

### MovieCarousel
**Purpose**: Horizontal scrolling movie posters

**Features**:
- Auto-scroll option
- Infinite loop
- Smooth animations
- Touch controls

**Props**: `movies`, `autoScroll`, `scrollInterval`

---

### CelebrationEffects
**Purpose**: Confetti animation

**Features**:
- Particle system
- Customizable colors
- Auto-cleanup

**Props**: `active`, `duration`

---

### CustomAlert
**Purpose**: Custom alert dialogs

**Features**:
- Modal overlay
- Custom buttons
- Flexible styling
- iOS/Android consistent

**Props**: `visible`, `title`, `message`, `buttons`, `onDismiss`

---

### FloatingTabBar
**Purpose**: Bottom navigation bar

**Features**:
- Floating design
- Active state
- Icons + labels
- Smooth transitions

**Props**: `state`, `descriptors`, `navigation`

## 🔄 Context Providers

### AuthContext
**Purpose**: Global authentication state

**State**:
- `isAuthenticated`: boolean
- `user`: User object
- `loading`: boolean

**Functions**:
- `onSignOut()`: Handle logout
- `refreshAuth()`: Refresh session

---

### ThemeContext
**Purpose**: App theming

**State**:
- `colors`: Color palette
- `isDark`: Dark mode flag

**Colors**:
```typescript
{
  primary: '#7c3aed',
  background: '#0a0a0a',
  surface: '#1a1a1a',
  text: '#ffffff',
  textSecondary: '#cccccc',
  border: '#2a2a2a',
  error: '#ef4444',
  success: '#10b981'
}
```

---

### SoundContext
**Purpose**: Audio management

**State**:
- `isMuted`: boolean
- `sounds`: Loaded audio objects

**Functions**:
- `playSound(name)`: Play audio
- `toggleSound()`: Mute/unmute

**Sounds**:
- `inicioApp`: App start
- `votoSi`: Yes vote
- `votoNo`: No vote
- `chin`: Match found

---

### MatchNotificationContext
**Purpose**: Match notification handling

**State**:
- `pendingMatch`: Match object
- `showNotification`: boolean

**Functions**:
- `showMatchNotification()`: Display match
- `dismissNotification()`: Hide match

## 🪝 Custom Hooks

### useMatchPolling
**Purpose**: Polling fallback for match detection

**Usage**:
```typescript
const { startPolling, stopPolling } = useMatchPolling(roomId, userId);
```

**Features**:
- 5-second interval
- Automatic cleanup
- Error handling

---

### useProactiveMatchCheck
**Purpose**: Immediate match verification after vote

**Usage**:
```typescript
const { checkForMatch } = useProactiveMatchCheck();
await checkForMatch(roomId, userId);
```

**Features**:
- Instant check
- No waiting for subscription
- Fallback mechanism

## 🚀 Setup

### Prerequisites
- Node.js 18+
- npm or yarn
- Expo CLI
- Android Studio (for Android)
- Xcode (for iOS, macOS only)

### Installation

1. **Install dependencies**
   ```bash
   cd mobile
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   
   Update `.env`:
   ```env
   EXPO_PUBLIC_AWS_REGION=eu-west-1
   EXPO_PUBLIC_USER_POOL_ID=your-user-pool-id
   EXPO_PUBLIC_USER_POOL_CLIENT_ID=your-client-id
   EXPO_PUBLIC_GRAPHQL_ENDPOINT=your-graphql-endpoint
   ```

3. **Update AWS config**
   Edit `src/config/aws-config.ts` with your values

## 💻 Development

### Start Development Server
```bash
npx expo start
```

Options:
- Press `a` for Android
- Press `i` for iOS
- Press `w` for web
- Press `r` to reload
- Press `m` to toggle menu

### Run on Device

**Android**:
```bash
npx expo run:android
```

**iOS**:
```bash
npx expo run:ios
```

### Development Tips

1. **Hot Reload**: Enabled by default, saves time
2. **Debug Menu**: Shake device or Cmd+D (iOS) / Cmd+M (Android)
3. **React DevTools**: `npx react-devtools`
4. **Network Inspector**: Enable in Debug Menu
5. **Logs**: `npx react-native log-android` or `log-ios`

## 🏗️ Building

### Development Build
```bash
npx eas build --profile development --platform android
```

### Production Build

**Android APK** (for testing):
```bash
npx eas build --profile production-apk --platform android
```

**Android AAB** (for Google Play Store):

**Option 1: Using Scripts (Recommended)**
```bash
# 1. Create production keystore (first time only)
./create-keystore.ps1

# 2. Generate AAB
./generate-aab.ps1
```

**Option 2: Using Gradle Directly**
```bash
cd android
./gradlew clean
./gradlew bundleRelease
# Output: android/app/build/outputs/bundle/release/app-release.aab
```

**Option 3: Using EAS Build**
```bash
npx eas build --profile production --platform android
```

**iOS**:
```bash
npx eas build --profile production --platform ios
```

### Build Profiles

Defined in `eas.json`:
- `development`: Debug build with dev tools
- `preview`: Release build for testing
- `production`: Android App Bundle (.aab) for Play Store
- `production-apk`: APK for direct installation

## 📤 Publishing to Google Play Store

### Quick Start

1. **Create Production Keystore** (first time only):
   ```bash
   ./create-keystore.ps1
   ```
   
   ⚠️ **CRITICAL**: Save the keystore and credentials in multiple secure locations!

2. **Generate AAB**:
   ```bash
   ./generate-aab.ps1
   ```

3. **Upload to Play Console**:
   - Go to [Google Play Console](https://play.google.com/console)
   - Create app or select existing
   - Navigate to Production > Create new release
   - Upload `android/app/build/outputs/bundle/release/app-release.aab`
   - Fill in release notes and submit

### Complete Guide

For detailed step-by-step instructions, see:
📖 **[Google Play Store Publishing Guide](../docs/GOOGLE_PLAY_STORE_GUIDE.md)**

This guide covers:
- ✅ Creating production keystore
- ✅ Configuring signing
- ✅ Generating AAB
- ✅ Play Console setup
- ✅ Store listing assets
- ✅ Internal testing
- ✅ Production release
- ✅ Future updates

### Important Files

- `android/app/trinity-release.keystore` - Production keystore (DO NOT LOSE!)
- `android/keystore.properties` - Keystore credentials (DO NOT COMMIT!)
- `trinity-keystore-credentials.txt` - Backup of credentials
- `create-keystore.ps1` - Script to generate keystore
- `generate-aab.ps1` - Script to build AAB

## 🧪 Testing

### Run Tests
```bash
npm test
```

### Test Coverage
```bash
npm run test:coverage
```

### E2E Tests
```bash
npm run test:e2e
```

## 🐛 Troubleshooting

### Metro Bundler Issues
```bash
# Clear cache
npx expo start -c

# Reset everything
rm -rf node_modules
npm install
npx expo start -c
```

### Android Build Failures
```bash
cd android
./gradlew clean
cd ..
npx expo prebuild --clean
```

### iOS Build Failures
```bash
cd ios
pod deintegrate
pod install
cd ..
npx expo prebuild --clean
```

### Authentication Issues
- Verify AWS credentials in `.env`
- Check Cognito User Pool settings
- Ensure OAuth redirect URIs are configured
- Clear app data and reinstall

### Subscription Not Working
- Check WebSocket connection
- Verify authentication tokens
- Test with polling fallback
- Check AppSync endpoint

### Sound Not Playing
- Verify audio files in `assets/`
- Check device volume
- Test on physical device (not simulator)
- Verify permissions

## 📚 Additional Resources

- [Expo Documentation](https://docs.expo.dev/)
- [React Native Documentation](https://reactnative.dev/)
- [AWS Amplify Documentation](https://docs.amplify.aws/)
- [React Navigation](https://reactnavigation.org/)

## 🤝 Contributing

See main [README.md](../README.md) for contribution guidelines.

---

**Version**: 1.0.11  
**Last Updated**: 2026-03-13
