import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../types';
import { FloatingTabBar } from './FloatingTabBar';
import { IconName } from './Icon';
import { ChinIcon } from './ChinIcon';

type NavigationProp = StackNavigationProp<RootStackParamList>;

interface AppTabBarProps {
  activeTab: 'home' | 'matches' | 'create' | 'recommendations' | 'profile' | 'rooms';
}

export const AppTabBar: React.FC<AppTabBarProps> = ({ activeTab }) => {
  const navigation = useNavigation<NavigationProp>();

  const tabs: Array<{
    icon?: IconName;
    customIcon?: React.ReactNode;
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
      customIcon: <ChinIcon size={22} color={activeTab === 'matches' ? '#ffffff' : '#888888'} />,
      label: 'Chines',
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
      label: 'Descubre',
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
