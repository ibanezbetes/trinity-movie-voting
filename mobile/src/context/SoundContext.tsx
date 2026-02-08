import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../services/logger';

interface SoundContextType {
  isMuted: boolean;
  toggleSound: () => void;
  playSound: (soundName: 'votoSi' | 'votoNo' | 'chin' | 'inicioApp') => void;
}

const SoundContext = createContext<SoundContextType | undefined>(undefined);

const SOUND_STORAGE_KEY = '@trinity_sound_muted';

interface SoundProviderProps {
  children: ReactNode;
}

export const SoundProvider: React.FC<SoundProviderProps> = ({ children }) => {
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    loadSoundPreference();
  }, []);

  const loadSoundPreference = async () => {
    try {
      const savedPreference = await AsyncStorage.getItem(SOUND_STORAGE_KEY);
      if (savedPreference !== null) {
        const muted = savedPreference === 'true';
        setIsMuted(muted);
        logger.info('SOUND', 'Sound preference loaded', { isMuted: muted });
      }
    } catch (error) {
      logger.error('Failed to load sound preference', error);
    }
  };

  const toggleSound = async () => {
    try {
      const newMutedState = !isMuted;
      setIsMuted(newMutedState);
      await AsyncStorage.setItem(SOUND_STORAGE_KEY, newMutedState.toString());
      logger.userAction('Sound toggled', { isMuted: newMutedState });
    } catch (error) {
      logger.error('Failed to save sound preference', error);
    }
  };

  const playSound = (soundName: 'votoSi' | 'votoNo' | 'chin' | 'inicioApp') => {
    if (!isMuted) {
      // Log sound play (actual implementation will be in APK build)
      logger.info('SOUND', `Playing sound: ${soundName}`);
      console.log(`🔊 Playing sound: ${soundName}`);
    } else {
      logger.info('SOUND', `Sound muted, not playing: ${soundName}`);
    }
  };

  return (
    <SoundContext.Provider value={{ isMuted, toggleSound, playSound }}>
      {children}
    </SoundContext.Provider>
  );
};

export const useSound = (): SoundContextType => {
  const context = useContext(SoundContext);
  if (!context) {
    throw new Error('useSound must be used within a SoundProvider');
  }
  return context;
};
