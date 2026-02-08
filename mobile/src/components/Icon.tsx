import React from 'react';
import { Ionicons } from '@expo/vector-icons';

export type IconName = 
  | 'home'
  | 'heart'
  | 'add'
  | 'star'
  | 'person'
  | 'film'
  | 'enter'
  | 'refresh'
  | 'arrow-back'
  | 'arrow-forward'
  | 'checkmark'
  | 'close'
  | 'help-circle'
  | 'star-outline'
  | 'information-circle'
  | 'exit'
  | 'warning'
  | 'volume-mute'
  | 'volume-high'
  | 'lock-closed'
  | 'search'
  | 'play'
  | 'thumbs-up'
  | 'thumbs-down'
  | 'sparkles'
  | 'people'
  | 'calendar'
  | 'time'
  | 'logo-instagram'
  | 'mail-outline'
  | 'globe-outline'
  | 'copy';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
}

const iconMap: Record<IconName, keyof typeof Ionicons.glyphMap> = {
  'home': 'home-outline',
  'heart': 'heart-outline',
  'add': 'add-circle-outline',
  'star': 'star-outline',
  'person': 'person-outline',
  'film': 'film-outline',
  'enter': 'enter-outline',
  'refresh': 'refresh-outline',
  'arrow-back': 'arrow-back',
  'arrow-forward': 'arrow-forward',
  'checkmark': 'checkmark-circle-outline',
  'close': 'close-circle-outline',
  'help-circle': 'help-circle-outline',
  'star-outline': 'star-outline',
  'information-circle': 'information-circle-outline',
  'exit': 'exit-outline',
  'warning': 'warning-outline',
  'volume-mute': 'volume-mute-outline',
  'volume-high': 'volume-high-outline',
  'lock-closed': 'lock-closed-outline',
  'search': 'search-outline',
  'play': 'play-outline',
  'thumbs-up': 'thumbs-up-outline',
  'thumbs-down': 'thumbs-down-outline',
  'sparkles': 'sparkles-outline',
  'people': 'people-outline',
  'calendar': 'calendar-outline',
  'time': 'time-outline',
  'logo-instagram': 'logo-instagram',
  'mail-outline': 'mail-outline',
  'globe-outline': 'globe-outline',
  'copy': 'copy-outline',
};

export const Icon: React.FC<IconProps> = ({ name, size = 24, color = '#ffffff' }) => {
  const ioniconsName = iconMap[name];
  return <Ionicons name={ioniconsName} size={size} color={color} />;
};
