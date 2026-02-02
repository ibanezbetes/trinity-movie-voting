import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Alert } from 'react-native';
import { client, verifyAuthStatus } from '../services/amplify';
import { CHECK_ROOM_MATCH } from '../services/graphql';
import { matchSubscriptionService } from '../services/subscriptions';
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
  checkForMatchesBeforeAction: (action: () => void, actionName?: string) => Promise<void>;
  isCheckingMatches: boolean;
  activeRooms: Set<string>;
  addActiveRoom: (roomId: string) => void;
  removeActiveRoom: (roomId: string) => void;
  clearActiveRooms: () => void;
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
  const [activeRooms, setActiveRooms] = useState<Set<string>>(new Set());
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Set up match subscriptions when user is authenticated
  useEffect(() => {
    const setupSubscriptions = async () => {
      try {
        const authStatus = await verifyAuthStatus();
        if (authStatus.isAuthenticated && authStatus.user?.userId) {
          const userId = authStatus.user.userId;
          setCurrentUserId(userId);

          // Subscribe to match notifications
          matchSubscriptionService.subscribe(userId, (match) => {
            logger.match('Match received via subscription', {
              matchId: match.id,
              title: match.title,
              roomId: match.roomId,
            });

            // Check if this match is from a room the user is currently in
            const wasInRoom = match.roomId === currentRoomId;
            
            // Show notification
            showMatchNotification(match, wasInRoom);
            
            // Remove room from active rooms since it has a match
            removeActiveRoom(match.roomId);

            // Call callback if provided
            if (onMatchFound) {
              onMatchFound(match, wasInRoom);
            }
          });

          logger.match('Match subscriptions set up for user', { userId });
        }
      } catch (error) {
        logger.matchError('Failed to set up match subscriptions', error);
      }
    };

    setupSubscriptions();

    // Cleanup subscriptions on unmount
    return () => {
      matchSubscriptionService.unsubscribe();
    };
  }, [currentRoomId, onMatchFound]);

  const addActiveRoom = (roomId: string) => {
    setActiveRooms(prev => new Set([...prev, roomId]));
    setCurrentRoomId(roomId);
  };

  const removeActiveRoom = (roomId: string) => {
    setActiveRooms(prev => {
      const newSet = new Set(prev);
      newSet.delete(roomId);
      return newSet;
    });
    if (currentRoomId === roomId) {
      setCurrentRoomId(null);
    }
  };

  const clearActiveRooms = () => {
    setActiveRooms(new Set());
    setCurrentRoomId(null);
  };

  const checkForMatchesBeforeAction = async (action: () => void, actionName: string = 'user action') => {
    if (isCheckingMatches) {
      // Si ya estamos verificando, ejecutar la acción directamente
      action();
      return;
    }

    if (activeRooms.size === 0) {
      // No hay salas activas, ejecutar la acción directamente
      action();
      return;
    }

    setIsCheckingMatches(true);
    
    try {
      const authStatus = await verifyAuthStatus();
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for match check before action', null);
        action(); // Ejecutar la acción aunque no esté autenticado
        return;
      }

      logger.match('Checking for matches before user action', { 
        actionName,
        activeRooms: Array.from(activeRooms),
        roomCount: activeRooms.size 
      });

      // Verificar matches en todas las salas activas
      const checkPromises = Array.from(activeRooms).map(async (roomId) => {
        try {
          const response = await client.graphql({
            query: CHECK_ROOM_MATCH,
            variables: { roomId },
            authMode: 'userPool',
          });

          const match = response.data.checkRoomMatch;
          
          if (match) {
            logger.match('Match detected before user action', {
              actionName,
              matchId: match.id,
              roomId: match.roomId,
              movieTitle: match.title,
              wasInCurrentRoom: roomId === currentRoomId
            });

            return { roomId, match, wasInRoom: roomId === currentRoomId };
          }

          return null;
        } catch (error) {
          logger.matchError('Error checking room for match before action', error, { roomId, actionName });
          return null;
        }
      });

      const results = await Promise.allSettled(checkPromises);
      const matches = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.status === 'fulfilled' ? r.value : null)
        .filter(Boolean);

      if (matches.length > 0) {
        // Se encontraron matches, mostrar notificaciones y no ejecutar la acción original
        logger.match('Matches found before user action - blocking action', { 
          actionName,
          matchCount: matches.length,
          matches: matches.map(m => ({ roomId: m?.roomId, title: m?.match?.title }))
        });

        // Mostrar notificación del primer match encontrado
        const firstMatch = matches[0];
        if (firstMatch) {
          showMatchNotification(firstMatch.match, firstMatch.wasInRoom, action);
          
          // Remover la sala de las activas ya que tiene match
          removeActiveRoom(firstMatch.roomId);

          // Llamar callback si se proporciona
          if (onMatchFound) {
            onMatchFound(firstMatch.match, firstMatch.wasInRoom);
          }
        }
      } else {
        // No se encontraron matches, ejecutar la acción original
        logger.match('No matches found before user action - proceeding', { actionName });
        action();
      }

    } catch (error) {
      logger.matchError('Error in match check before action', error, { actionName });
      // En caso de error, ejecutar la acción de todos modos
      action();
    } finally {
      setIsCheckingMatches(false);
    }
  };

  const showMatchNotification = (match: Match, wasInRoom: boolean, originalAction?: () => void) => {
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
              // Navigate to matches but stay in current location
            }
          },
          { 
            text: 'Continuar', 
            onPress: () => {
              // Execute the original action if provided
              if (originalAction) {
                originalAction();
              }
            } 
          }
        ];

    Alert.alert(title, message, buttons);
  };

  const contextValue: MatchNotificationContextType = {
    checkForMatchesBeforeAction,
    isCheckingMatches,
    activeRooms,
    addActiveRoom,
    removeActiveRoom,
    clearActiveRooms,
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