import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { FloatingTabBar } from './FloatingTabBar';
import { IconName } from './Icon';

type NavigationProp = StackNavigationProp<RootStackParamList>;

interface AppTabBarProps {
  activeTab: 'home' | 'matches' | 'create' | 'recommendations' | 'profile' | 'rooms';
}

export const AppTabBar: React.FC<AppTabBarProps> = ({ activeTab }) => {
  const navigation = useNavigation<NavigationProp>();

  const tabs: Array<{
    icon: IconName;
    label: string;
    onPress: () => void;
    active: boolean;
  }> = [
    {
      icon: 'home',
      label: 'Inicio',
      onPress: () => navigation.navigate('Dashboard'),
      active: activeTab === 'home',
    },
    {
      icon: 'heart',
      label: 'Matches',
      onPress: () => navigation.navigate('MyMatches'),
      active: activeTab === 'matches',
    },
    {
      icon: 'add',
      label: 'Crear',
      onPress: () => navigation.navigate('CreateRoom'),
      active: activeTab === 'create',
    },
    {
      icon: 'star',
      label: 'Recomendaciones',
      onPress: () => navigation.navigate('Recommendations'),
      active: activeTab === 'recommendations',
    },
    {
      icon: 'person',
      label: 'Perfil',
      onPress: () => navigation.navigate('Profile'),
      active: activeTab === 'profile',
    },
  ];

  return <FloatingTabBar tabs={tabs} />;
};
