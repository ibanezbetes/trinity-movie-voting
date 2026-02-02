import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { client, verifyAuthStatus } from '../services/amplify';
import { CHECK_ROOM_MATCH } from '../services/graphql';
import { logger } from '../services/logger';

interface Match {
  id: string;
  roomId: string;
  movieId: number;
  title: string;
  posterPath?: string;
  timestamp: string;
}

interface MatchNotificationContextType {
  checkForGlobalMatches: () => Promise<void>;
  isCheckingMatches: boolean;
  lastCheckedRooms: Set<string>;
  addRoomToCheck: (roomId: string) => void;
  removeRoomFromCheck: (roomId: string) => void;
}

const MatchNotificationContext = createContext<MatchNotificationContextType | undefined>(undefined);

interface MatchNotificationProviderProps {
  children: ReactNode;
  onMatchFound?: (match: Match, wasInRoom: boolean) => void;
  onNavigateToHome?: () => void;
}

export function MatchNotificationProvider({ 
  children, 
  onMatchFound,
  onNavigateToHome 
}: MatchNotificationProviderProps) {
  const [isCheckingMatches, setIsCheckingMatches] = useState(false);
  const [lastCheckedRooms, setLastCheckedRooms] = useState<Set<string>>(new Set());
  const [roomsToCheck, setRoomsToCheck] = useState<Set<string>>(new Set());
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);

  const addRoomToCheck = (roomId: string) => {
    setRoomsToCheck(prev => new Set([...prev, roomId]));
  };

  const removeRoomFromCheck = (roomId: string) => {
    setRoomsToCheck(prev => {
      const newSet = new Set(prev);
      newSet.delete(roomId);
      return newSet;
    });
    setCurrentRoomId(null);
  };

  const checkForGlobalMatches = async () => {
    if (isCheckingMatches || roomsToCheck.size === 0) return;

    setIsCheckingMatches(true);
    
    try {
      const authStatus = await verifyAuthStatus();
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for global match check', null);
        return;
      }

      logger.match('Checking for global matches', { 
        roomsToCheck: Array.from(roomsToCheck),
        roomCount: roomsToCheck.size 
      });

      const checkPromises = Array.from(roomsToCheck).map(async (roomId) => {
        try {
          const response = await client.graphql({
            query: CHECK_ROOM_MATCH,
            variables: { roomId },
            authMode: 'userPool',
          });

          const match = response.data.checkRoomMatch;
          
          if (match && !lastCheckedRooms.has(roomId)) {
            logger.match('Global match detected', {
              matchId: match.id,
              roomId: match.roomId,
              movieTitle: match.title,
              wasInCurrentRoom: roomId === currentRoomId
            });

            // Mark this room as having a match
            setLastCheckedRooms(prev => new Set([...prev, roomId]));
            
            // Remove room from checking since it has a match
            removeRoomFromCheck(roomId);

            // Show match notification
            const wasInRoom = roomId === currentRoomId;
            showMatchNotification(match, wasInRoom);

            // Call callback if provided
            if (onMatchFound) {
              onMatchFound(match, wasInRoom);
            }

            return { roomId, match, wasInRoom };
          }

          return { roomId, match: null, wasInRoom: false };
        } catch (error) {
          logger.matchError('Error checking room for match', error, { roomId });
          return { roomId, match: null, wasInRoom: false, error };
        }
      });

      const results = await Promise.allSettled(checkPromises);
      const matches = results
        .filter(r => r.status === 'fulfilled' && r.value.match)
        .map(r => r.status === 'fulfilled' ? r.value : null)
        .filter(Boolean);

      if (matches.length > 0) {
        logger.match('Global matches found', { 
          matchCount: matches.length,
          matches: matches.map(m => ({ roomId: m?.roomId, title: m?.match?.title }))
        });
      }

    } catch (error) {
      logger.matchError('Error in global match check', error, {});
    } finally {
      setIsCheckingMatches(false);
    }
  };

  const showMatchNotification = (match: Match, wasInRoom: boolean) => {
    const title = wasInRoom ? '🎉 ¡MATCH EN TU SALA!' : '🎉 ¡MATCH ENCONTRADO!';
    const message = wasInRoom 
      ? `¡Se encontró una película en común en tu sala!\n\n${match.title}`
      : `¡Se encontró una película en común en una de tus salas!\n\n${match.title}`;

    const buttons = wasInRoom 
      ? [
          { 
            text: 'Ver Mis Matches', 
            onPress: () => {
              // Navigate to matches and then home
              if (onNavigateToHome) {
                onNavigateToHome();
              }
            }
          },
          { 
            text: 'Ir al Inicio', 
            onPress: () => {
              if (onNavigateToHome) {
                onNavigateToHome();
              }
            }
          }
        ]
      : [
          { 
            text: 'Ver Mis Matches', 
            onPress: () => {
              // Just navigate to matches, don't go to home
            }
          },
          { 
            text: 'Continuar', 
            onPress: () => {} 
          }
        ];

    Alert.alert(title, message, buttons);
  };

  // Set up periodic checking
  useEffect(() => {
    if (roomsToCheck.size === 0) return;

    const interval = setInterval(() => {
      checkForGlobalMatches();
    }, 3000); // Check every 3 seconds

    // Initial check
    checkForGlobalMatches();

    return () => clearInterval(interval);
  }, [roomsToCheck.size, isCheckingMatches]);

  const contextValue: MatchNotificationContextType = {
    checkForGlobalMatches,
    isCheckingMatches,
    lastCheckedRooms,
    addRoomToCheck,
    removeRoomFromCheck,
  };

  return (
    <MatchNotificationContext.Provider value={contextValue}>
      {children}
    </MatchNotificationContext.Provider>
  );
}

export function useMatchNotification() {
  const context = useContext(MatchNotificationContext);
  if (context === undefined) {
    throw new Error('useMatchNotification must be used within a MatchNotificationProvider');
  }
  return context;
}