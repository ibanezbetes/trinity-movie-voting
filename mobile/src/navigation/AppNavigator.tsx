import React, { useRef } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { logger } from '../services/logger';
import { AuthProvider } from '../context/AuthContext';
import { MatchNotificationProvider } from '../context/MatchNotificationContext';

// Screens
import DashboardScreen from '../screens/DashboardScreen';
import CreateRoomScreen from '../screens/CreateRoomScreen';
import JoinRoomScreen from '../screens/JoinRoomScreen';
import VotingRoomScreen from '../screens/VotingRoomScreen';
import MyRoomsScreen from '../screens/MyRoomsScreen';
import MyMatchesScreen from '../screens/MyMatchesScreen';
import RecommendationsScreen from '../screens/RecommendationsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import MatchCelebrationScreen from '../screens/MatchCelebrationScreen';

const Stack = createStackNavigator<RootStackParamList>();

interface AppNavigatorProps {
  onSignOut: () => void;
  pendingRoomCode?: string | null;
}

export default function AppNavigator({ onSignOut, pendingRoomCode }: AppNavigatorProps) {
  const navigationRef = useRef<any>(null);
  
  logger.info('NAVIGATION', 'AppNavigator initialized', { hasPendingRoomCode: !!pendingRoomCode });

  // Handle pending room code navigation
  const [isNavigationReady, setIsNavigationReady] = React.useState(false);
  
  React.useEffect(() => {
    if (pendingRoomCode && navigationRef.current && isNavigationReady) {
      logger.navigation('Navigating to JoinRoom with pending room code', { roomCode: pendingRoomCode });
      navigationRef.current.navigate('JoinRoom', { initialRoomCode: pendingRoomCode });
    }
  }, [pendingRoomCode, isNavigationReady]);

  const handleNavigateToHome = () => {
    if (navigationRef.current) {
      navigationRef.current.navigate('Dashboard');
    }
  };

  const handleMatchFound = (match: any, wasInRoom: boolean) => {
    logger.match('Match notification handled', {
      matchTitle: match.title,
      wasInRoom,
      currentRoute: navigationRef.current?.getCurrentRoute()?.name
    });

    // Navigate to MatchCelebration screen
    if (navigationRef.current) {
      navigationRef.current.navigate('MatchCelebration', { match, wasInRoom });
    }
  };

  return (
    <AuthProvider onSignOut={onSignOut}>
      <MatchNotificationProvider 
        onMatchFound={handleMatchFound}
        onNavigateToHome={handleNavigateToHome}
      >
        <NavigationContainer
          ref={navigationRef}
          onReady={() => {
            logger.navigation('Navigation container ready');
            setIsNavigationReady(true);
          }}
          onStateChange={(state) => {
            if (state) {
              const currentRoute = state.routes[state.index];
              logger.navigation('Navigation state changed', {
                routeName: currentRoute.name,
                params: currentRoute.params,
                timestamp: new Date().toISOString()
              });
            }
          }}
        >
          <Stack.Navigator
            initialRouteName="Dashboard"
            screenOptions={{
              headerShown: false,
              cardStyle: { backgroundColor: '#0a0a0a' },
              animationEnabled: true,
              gestureEnabled: true,
            }}
          >
            <Stack.Screen 
              name="Dashboard" 
              component={DashboardScreen}
              options={{
                animationTypeForReplace: 'push',
              }}
            />
            <Stack.Screen 
              name="CreateRoom" 
              component={CreateRoomScreen}
              options={{
                presentation: 'modal',
              }}
            />
            <Stack.Screen 
              name="JoinRoom" 
              component={JoinRoomScreen}
              options={{
                presentation: 'modal',
              }}
            />
            <Stack.Screen 
              name="VotingRoom" 
              component={VotingRoomScreen}
            />
            <Stack.Screen 
              name="MyRooms" 
              component={MyRoomsScreen}
            />
            <Stack.Screen 
              name="MyMatches" 
              component={MyMatchesScreen}
            />
            <Stack.Screen 
              name="Recommendations" 
              component={RecommendationsScreen}
            />
            <Stack.Screen 
              name="Profile" 
              component={ProfileScreen}
            />
            <Stack.Screen 
              name="MatchCelebration" 
              component={MatchCelebrationScreen}
              options={{
                presentation: 'modal',
                gestureEnabled: false,
                headerShown: false,
                headerBackVisible: false,
              }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </MatchNotificationProvider>
    </AuthProvider>
  );
}