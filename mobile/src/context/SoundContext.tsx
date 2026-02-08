import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { Asset } from 'expo-asset';
import { logger } from '../services/logger';

interface SoundContextType {
  isMuted: boolean;
  toggleSound: () => void;
  playSound: (soundName: 'votoSi' | 'votoNo' | 'chin' | 'inicioApp') => Promise<void>;
}

const SoundContext = createContext<SoundContextType | undefined>(undefined);

const SOUND_STORAGE_KEY = '@trinity_sound_muted';

interface SoundProviderProps {
  children: ReactNode;
}

// Sound files mapping
const soundFiles = {
  votoSi: require('../../assets/votoSi.wav'),
  votoNo: require('../../assets/votoNo.wav'),
  chin: require('../../assets/chin.wav'),
  inicioApp: require('../../assets/inicioApp.wav'),
};

export const SoundProvider: React.FC<SoundProviderProps> = ({ children }) => {
  const [isMuted, setIsMuted] = useState(false);
  const [assetsLoaded, setAssetsLoaded] = useState(false);

  useEffect(() => {
    loadSoundPreference();
    configureAudio();
    preloadAssets();
  }, []);

  const preloadAssets = async () => {
    try {
      logger.info('SOUND', 'Preloading sound assets...');
      
      // Preload all sound files
      const assetPromises = Object.entries(soundFiles).map(async ([name, file]) => {
        try {
          const asset = Asset.fromModule(file);
          await asset.downloadAsync();
          logger.info('SOUND', `Asset preloaded: ${name}`, { 
            localUri: asset.localUri,
            uri: asset.uri 
          });
          return { name, success: true };
        } catch (error) {
          logger.error(`Failed to preload asset: ${name}`, error);
          return { name, success: false };
        }
      });

      const results = await Promise.all(assetPromises);
      const successCount = results.filter(r => r.success).length;
      
      logger.info('SOUND', 'Asset preloading completed', { 
        total: results.length,
        successful: successCount 
      });
      
      setAssetsLoaded(true);
    } catch (error) {
      logger.error('Failed to preload assets', error);
      setAssetsLoaded(true); // Continue anyway
    }
  };

  const configureAudio = async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
      logger.info('SOUND', 'Audio mode configured');
    } catch (error) {
      logger.error('Failed to configure audio mode', error);
    }
  };

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

  const playSound = async (soundName: 'votoSi' | 'votoNo' | 'chin' | 'inicioApp') => {
    if (isMuted) {
      logger.info('SOUND', `Sound muted: ${soundName}`);
      return;
    }

    if (!assetsLoaded) {
      logger.warn('Assets not loaded yet', { soundName });
      return;
    }

    try {
      logger.info('SOUND', `Attempting to play: ${soundName}`);

      const soundFile = soundFiles[soundName];
      
      // Get the asset
      const asset = Asset.fromModule(soundFile);
      
      // Make sure it's downloaded
      if (!asset.downloaded) {
        logger.info('SOUND', `Downloading asset: ${soundName}`);
        await asset.downloadAsync();
      }

      logger.info('SOUND', `Creating sound from asset: ${soundName}`, {
        localUri: asset.localUri,
        uri: asset.uri
      });

      // Create sound from the downloaded asset
      const { sound } = await Audio.Sound.createAsync(
        { uri: asset.localUri || asset.uri },
        { shouldPlay: true }
      );
      
      logger.info('SOUND', `Sound playing: ${soundName}`);

      // Unload after playing
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
          logger.info('SOUND', `Sound finished and unloaded: ${soundName}`);
        }
      });

    } catch (error) {
      logger.error('Failed to play sound', error, { soundName });
      console.error('Sound error:', error);
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
