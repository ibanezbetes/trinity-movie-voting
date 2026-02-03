import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Alert } from 'react-native';
import { client, verifyAuthStatus } from '../services/amplify';
import { GET_MATCHES } from '../services/graphql';
import { matchSubscriptionService, roomSubscriptionService } from '../services/subscriptions';
import { useMatchPolling, useGlobalMatchPolling } from '../hooks/useMatchPolling';
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
  subscribeToRoom: (roomId: string) => void;
  unsubscribeFromRoom: (roomId: string) => void;
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

  // Global match polling for background detection
  const { startGlobalPolling, stopGlobalPolling } = useGlobalMatchPolling((match) => {
    logger.match('New match detected via global polling', {
      matchId: match.id,
      title: match.title,
    });

    const wasInRoom = match.roomId === currentRoomId;
    showMatchNotification(match, wasInRoom);
    
    // Remove room from active rooms since it has a match
    removeActiveRoom(match.roomId);

    if (onMatchFound) {
      onMatchFound(match, wasInRoom);
    }
  });

  // Set up match subscriptions and polling when user is authenticated
  useEffect(() => {
    const setupNotifications = async () => {
      try {
        const authStatus = await verifyAuthStatus();
        if (authStatus.isAuthenticated && authStatus.user?.userId) {
          const userId = authStatus.user.userId;
          setCurrentUserId(userId);

          // CRITICAL FIX: Use BOTH legacy and room-based subscriptions for maximum coverage
          
          // 1. Legacy subscription for backward compatibility
          matchSubscriptionService.subscribe(userId, (match) => {
            logger.match('Match received via legacy subscription', {
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

          // 2. CRITICAL: Also subscribe to room-based notifications for current room
          if (currentRoomId) {
            logger.match('Setting up room-based subscription for current room', { roomId: currentRoomId, userId });
            
            roomSubscriptionService.subscribeToRoom(currentRoomId, userId, (roomMatchEvent) => {
              logger.match('Room match received via room subscription in context', {
                roomId: roomMatchEvent.roomId,
                matchId: roomMatchEvent.matchId,
                movieTitle: roomMatchEvent.movieTitle,
                matchedUsers: roomMatchEvent.matchedUsers,
                currentUserId: userId,
              });

              // Convert room match event to legacy match format for compatibility
              const match: Match = {
                id: roomMatchEvent.matchId,
                roomId: roomMatchEvent.roomId,
                movieId: parseInt(roomMatchEvent.movieId),
                title: roomMatchEvent.movieTitle,
                posterPath: roomMatchEvent.posterPath,
                timestamp: roomMatchEvent.timestamp,
              };

              const wasInRoom = roomMatchEvent.roomId === currentRoomId;
              showMatchNotification(match, wasInRoom);
              
              // Remove room from active rooms since it has a match
              removeActiveRoom(roomMatchEvent.roomId);

              if (onMatchFound) {
                onMatchFound(match, wasInRoom);
              }
            });
          }

          // Start global polling as backup
          startGlobalPolling();

          logger.match('Match notifications set up for user with BOTH legacy and room-based subscriptions', { userId, currentRoomId });
        }
      } catch (error) {
        logger.matchError('Failed to set up match notifications', error);
      }
    };

    setupNotifications();

    // Cleanup subscriptions and polling on unmount
    return () => {
      matchSubscriptionService.unsubscribe();
      roomSubscriptionService.unsubscribeFromAllRooms();
      stopGlobalPolling();
    };
  }, [currentRoomId, onMatchFound]);

  const addActiveRoom = (roomId: string) => {
    setActiveRooms(prev => new Set([...prev, roomId]));
    setCurrentRoomId(roomId);
    logger.match('Added active room', { roomId, totalActiveRooms: activeRooms.size + 1 });
    
    // DO NOT automatically subscribe here - let VotingRoomScreen handle room subscriptions
    // This prevents conflicts between multiple subscription setups
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
    logger.match('Removed active room', { roomId, totalActiveRooms: activeRooms.size - 1 });
    
    // DO NOT automatically unsubscribe here - let VotingRoomScreen handle cleanup
    // This prevents conflicts with manual subscription management
  };

  const clearActiveRooms = () => {
    setActiveRooms(new Set());
    setCurrentRoomId(null);
    logger.match('Cleared all active rooms');
  };

  const checkForMatchesBeforeAction = async (action: () => void, actionName: string = 'user action') => {
    if (isCheckingMatches) {
      // Si ya estamos verificando, ejecutar la acción directamente
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

      logger.match('🔍 Checking for matches in ALL user rooms before action', { 
        actionName,
        userId: authStatus.user?.userId
      });

      // NUEVA LÓGICA MEJORADA: Verificación activa de matches
      // Esta query obtiene todos los matches del usuario directamente del backend
      try {
        const response = await client.graphql({
          query: `
            query GetMatches {
              getMyMatches {
                id
                roomId
                movieId
                title
                posterPath
                timestamp
                matchedUsers
              }
            }
          `,
          authMode: 'userPool',
        });

        const userMatches = response.data.getMyMatches || [];
        
        if (userMatches.length > 0) {
          // Verificar si hay matches en salas activas (más recientes que hace 30 segundos)
          const now = new Date().getTime();
          const thirtySecondsAgo = now - (30 * 1000);
          
          const recentMatches = userMatches.filter(match => {
            const matchTime = new Date(match.timestamp).getTime();
            return matchTime > thirtySecondsAgo;
          });
          
          if (recentMatches.length > 0) {
            // Hay matches recientes - mostrar el más nuevo
            const latestMatch = recentMatches[0];
            
            logger.match('🎉 Recent match found before user action - showing notification', { 
              actionName,
              matchCount: recentMatches.length,
              latestMatch: {
                id: latestMatch.id,
                title: latestMatch.title,
                roomId: latestMatch.roomId,
                timestamp: latestMatch.timestamp
              }
            });

            // Mostrar notificación del match más reciente
            const wasInCurrentRoom = latestMatch.roomId === currentRoomId;
            showMatchNotification(latestMatch, wasInCurrentRoom, action);
            
            // Remover la sala de las activas ya que tiene match
            if (wasInCurrentRoom) {
              removeActiveRoom(latestMatch.roomId);
            }

            // Llamar callback si se proporciona
            if (onMatchFound) {
              onMatchFound(latestMatch, wasInCurrentRoom);
            }
            
            return; // No ejecutar la acción original
          }
        }

        // Si no hay matches recientes, verificar matches específicos de salas activas
        if (activeRooms.size > 0) {
          const checkPromises = Array.from(activeRooms).map(async (roomId) => {
            try {
              // Usar getMyMatches y filtrar por roomId
              const roomMatches = userMatches.filter(match => match.roomId === roomId);
              
              if (roomMatches.length > 0) {
                const match = roomMatches[0];
                logger.match('Match detected in specific room before user action', {
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
            // Se encontraron matches en salas específicas
            const firstMatch = matches[0];
            if (firstMatch) {
              logger.match('Match found in specific room before user action', { 
                actionName,
                matchId: firstMatch.match.id,
                roomId: firstMatch.roomId,
                title: firstMatch.match.title
              });

              showMatchNotification(firstMatch.match, firstMatch.wasInRoom, action);
              removeActiveRoom(firstMatch.roomId);

              if (onMatchFound) {
                onMatchFound(firstMatch.match, firstMatch.wasInRoom);
              }
              
              return; // No ejecutar la acción original
            }
          }
        }

        // No se encontraron matches, ejecutar la acción original
        logger.match('✅ No matches found before user action - proceeding', { actionName });
        action();

      } catch (error) {
        logger.matchError('Error checking for user matches before action', error, { actionName });
        // En caso de error, ejecutar la acción de todos modos
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

  const subscribeToRoom = (roomId: string) => {
    if (!currentUserId) {
      logger.matchError('Cannot subscribe to room - no current user ID', null, { roomId });
      return;
    }

    logger.match('Subscribing to room from context', { roomId, userId: currentUserId });
    
    roomSubscriptionService.subscribeToRoom(roomId, currentUserId, (roomMatchEvent) => {
      logger.match('Room match received in context', {
        roomId: roomMatchEvent.roomId,
        matchId: roomMatchEvent.matchId,
        movieTitle: roomMatchEvent.movieTitle,
        matchedUsers: roomMatchEvent.matchedUsers,
        currentUserId,
      });

      // Convert room match event to legacy match format for compatibility
      const match: Match = {
        id: roomMatchEvent.matchId,
        roomId: roomMatchEvent.roomId,
        movieId: parseInt(roomMatchEvent.movieId),
        title: roomMatchEvent.movieTitle,
        posterPath: roomMatchEvent.posterPath,
        timestamp: roomMatchEvent.timestamp,
      };

      const wasInRoom = roomMatchEvent.roomId === currentRoomId;
      showMatchNotification(match, wasInRoom);
      
      // Remove room from active rooms since it has a match
      removeActiveRoom(roomMatchEvent.roomId);

      if (onMatchFound) {
        onMatchFound(match, wasInRoom);
      }
    });
  };

  const unsubscribeFromRoom = (roomId: string) => {
    logger.match('Unsubscribing from room from context', { roomId });
    roomSubscriptionService.unsubscribeFromRoom(roomId);
  };

  const contextValue: MatchNotificationContextType = {
    checkForMatchesBeforeAction,
    isCheckingMatches,
    activeRooms,
    addActiveRoom,
    removeActiveRoom,
    clearActiveRooms,
    subscribeToRoom,
    unsubscribeFromRoom,
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