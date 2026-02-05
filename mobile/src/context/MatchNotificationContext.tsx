import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  dismissedNotifications: Set<string>;
  dismissNotification: (matchId: string) => void;
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
  const [dismissedNotifications, setDismissedNotifications] = useState<Set<string>>(new Set());

  // Storage keys for persistence
  const DISMISSED_NOTIFICATIONS_KEY = 'trinity_dismissed_notifications';

  // Load dismissed notifications from storage on mount
  useEffect(() => {
    const loadDismissedNotifications = async () => {
      try {
        const stored = await AsyncStorage.getItem(DISMISSED_NOTIFICATIONS_KEY);
        if (stored) {
          const dismissedArray = JSON.parse(stored);
          setDismissedNotifications(new Set(dismissedArray));
          logger.match('Loaded dismissed notifications from storage', { 
            count: dismissedArray.length 
          });
        }
      } catch (error) {
        logger.matchError('Failed to load dismissed notifications', error);
      }
    };

    loadDismissedNotifications();
  }, []);

  // Save dismissed notifications to storage whenever it changes
  const saveDismissedNotifications = async (dismissed: Set<string>) => {
    try {
      const dismissedArray = Array.from(dismissed);
      await AsyncStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify(dismissedArray));
      logger.match('Saved dismissed notifications to storage', { 
        count: dismissedArray.length 
      });
    } catch (error) {
      logger.matchError('Failed to save dismissed notifications', error);
    }
  };

  // Function to dismiss a notification
  const dismissNotification = (matchId: string) => {
    setDismissedNotifications(prev => {
      const newSet = new Set(prev);
      newSet.add(matchId);
      saveDismissedNotifications(newSet);
      logger.match('Notification dismissed', { matchId });
      return newSet;
    });
  };

  // Function to check if a match should be shown (not dismissed)
  const shouldShowMatch = (match: Match): boolean => {
    const isDismissed = dismissedNotifications.has(match.id);
    
    if (isDismissed) {
      logger.match('Match notification skipped - already dismissed', { 
        matchId: match.id,
        title: match.title 
      });
      return false;
    }

    // Also check if match is too old (more than 5 minutes)
    const matchTime = new Date(match.timestamp).getTime();
    const now = new Date().getTime();
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    
    if (matchTime < fiveMinutesAgo) {
      logger.match('Match notification skipped - too old', { 
        matchId: match.id,
        title: match.title,
        ageInMinutes: (now - matchTime) / (60 * 1000)
      });
      return false;
    }

    return true;
  };

  // Global match polling for background detection
  const { startGlobalPolling, stopGlobalPolling } = useGlobalMatchPolling((match) => {
    logger.match('New match detected via global polling', {
      matchId: match.id,
      title: match.title,
    });

    // Check if we should show this match
    if (!shouldShowMatch(match)) {
      return;
    }

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

            // Check if we should show this match
            if (!shouldShowMatch(match)) {
              return;
            }

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

              // Check if we should show this match
              if (!shouldShowMatch(match)) {
                return;
              }

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
    // CRITICAL: Block ALL actions while checking for matches
    if (isCheckingMatches) {
      logger.match('⏳ Already checking matches - blocking action', { actionName });
      return; // BLOCK the action completely
    }

    setIsCheckingMatches(true);
    
    try {
      const authStatus = await verifyAuthStatus();
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for match check before action', null);
        setIsCheckingMatches(false);
        action(); // Only execute if not authenticated
        return;
      }

      logger.match('🔍 AGGRESSIVE MATCH CHECK before action', { 
        actionName,
        userId: authStatus.user?.userId,
        activeRoomsCount: activeRooms.size,
        currentRoomId
      });

      // CRITICAL: SYNCHRONOUS match checking - block until complete
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
        logger.match('📊 Match check results', { 
          actionName,
          totalMatches: userMatches.length,
          activeRoomsCount: activeRooms.size
        });
        
        // PRIORITY 1: Check current room first (most critical)
        if (currentRoomId) {
          const currentRoomMatch = userMatches.find(match => 
            match.roomId === currentRoomId && shouldShowMatch(match)
          );
          if (currentRoomMatch) {
            logger.match('🚨 MATCH FOUND IN CURRENT ROOM - BLOCKING ACTION', { 
              actionName,
              matchId: currentRoomMatch.id,
              roomId: currentRoomId,
              title: currentRoomMatch.title
            });

            setIsCheckingMatches(false);
            showMatchNotification(currentRoomMatch, true);
            removeActiveRoom(currentRoomId);

            if (onMatchFound) {
              onMatchFound(currentRoomMatch, true);
            }
            
            return; // BLOCK the action - match found in current room
          }
        }

        // PRIORITY 2: Check all active rooms
        if (activeRooms.size > 0) {
          for (const roomId of activeRooms) {
            const roomMatch = userMatches.find(match => 
              match.roomId === roomId && shouldShowMatch(match)
            );
            if (roomMatch) {
              logger.match('🚨 MATCH FOUND IN ACTIVE ROOM - BLOCKING ACTION', { 
                actionName,
                matchId: roomMatch.id,
                roomId,
                title: roomMatch.title,
                wasInCurrentRoom: roomId === currentRoomId
              });

              setIsCheckingMatches(false);
              const wasInCurrentRoom = roomId === currentRoomId;
              showMatchNotification(roomMatch, wasInCurrentRoom);
              removeActiveRoom(roomId);

              if (onMatchFound) {
                onMatchFound(roomMatch, wasInCurrentRoom);
              }
              
              return; // BLOCK the action - match found in active room
            }
          }
        }

        // PRIORITY 3: Check for ANY recent matches that haven't been dismissed (last 60 seconds)
        if (userMatches.length > 0) {
          const now = new Date().getTime();
          const sixtySecondsAgo = now - (60 * 1000);
          
          const recentMatches = userMatches.filter(match => {
            const matchTime = new Date(match.timestamp).getTime();
            return matchTime > sixtySecondsAgo && shouldShowMatch(match);
          });
          
          if (recentMatches.length > 0) {
            const latestMatch = recentMatches[0];
            
            logger.match('🚨 RECENT MATCH FOUND - BLOCKING ACTION', { 
              actionName,
              matchId: latestMatch.id,
              title: latestMatch.title,
              roomId: latestMatch.roomId,
              timestamp: latestMatch.timestamp,
              ageInSeconds: (now - new Date(latestMatch.timestamp).getTime()) / 1000
            });

            setIsCheckingMatches(false);
            const wasInCurrentRoom = latestMatch.roomId === currentRoomId;
            showMatchNotification(latestMatch, wasInCurrentRoom);
            
            if (wasInCurrentRoom) {
              removeActiveRoom(latestMatch.roomId);
            }

            if (onMatchFound) {
              onMatchFound(latestMatch, wasInCurrentRoom);
            }
            
            return; // BLOCK the action - recent match found
          }
        }

        // No matches found - allow action to proceed
        logger.match('✅ No matches found - allowing action', { 
          actionName,
          totalMatchesChecked: userMatches.length,
          activeRoomsChecked: activeRooms.size
        });
        
        setIsCheckingMatches(false);
        action(); // ONLY execute if no matches found

      } catch (error) {
        logger.matchError('❌ Error in aggressive match check', error, { actionName });
        setIsCheckingMatches(false);
        
        // CRITICAL: On error, still try to check for matches using fallback method
        // Don't execute action if there might be matches
        logger.match('🔄 Using fallback match check due to error', { actionName });
        
        // Simple fallback: if we have active rooms, assume there might be matches
        if (activeRooms.size > 0) {
          logger.match('⚠️ Blocking action due to active rooms and check error', { 
            actionName,
            activeRoomsCount: activeRooms.size 
          });
          return; // BLOCK action on error if there are active rooms
        }
        
        // Only execute if no active rooms
        action();
      }

    } catch (error) {
      logger.matchError('❌ Critical error in match check', error, { actionName });
      setIsCheckingMatches(false);
      
      // CRITICAL: On critical error, be conservative and block action if there are active rooms
      if (activeRooms.size > 0) {
        logger.match('⚠️ Blocking action due to critical error and active rooms', { 
          actionName,
          activeRoomsCount: activeRooms.size 
        });
        return; // BLOCK action on critical error if there are active rooms
      }
      
      // Only execute if no active rooms
      action();
    }
  };

  const showMatchNotification = (match: Match, wasInRoom: boolean, originalAction?: () => void) => {
    // Don't show Alert - let the navigation handler show the MatchCelebration screen
    logger.match('Match notification handled', {
      matchTitle: match.title,
      wasInRoom,
      currentRoute: 'context'
    });

    // The onMatchFound callback will handle navigation to MatchCelebration screen
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

      // Check if we should show this match
      if (!shouldShowMatch(match)) {
        return;
      }

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
    dismissedNotifications,
    dismissNotification,
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