import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { logger } from '../services/logger';
import { AuthProvider } from '../context/AuthContext';

// Screens
import DashboardScreen from '../screens/DashboardScreen';
import CreateRoomScreen from '../screens/CreateRoomScreen';
import JoinRoomScreen from '../screens/JoinRoomScreen';
import VotingRoomScreen from '../screens/VotingRoomScreen';
import MyMatchesScreen from '../screens/MyMatchesScreen';
import RecommendationsScreen from '../screens/RecommendationsScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Stack = createStackNavigator<RootStackParamList>();

interface AppNavigatorProps {
  onSignOut: () => void;
}

export default function AppNavigator({ onSignOut }: AppNavigatorProps) {
  logger.info('NAVIGATION', 'AppNavigator initialized');

  return (
    <AuthProvider onSignOut={onSignOut}>
      <NavigationContainer
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
            cardStyle: { backgroundColor: '#1a1a1a' },
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
        </Stack.Navigator>
      </NavigationContainer>
    </AuthProvider>
  );
}