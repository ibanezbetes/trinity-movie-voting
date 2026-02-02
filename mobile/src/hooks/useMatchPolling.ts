import { useEffect, useRef, useState } from 'react';
import { client, verifyAuthStatus } from '../services/amplify';
import { GET_MATCHES } from '../services/graphql';
import { logger } from '../services/logger';

interface Match {
  id: string;
  roomId: string;
  movieId: number;
  title: string;
  posterPath?: string;
  timestamp: string;
}

interface UseMatchPollingOptions {
  roomId?: string;
  enabled?: boolean;
  interval?: number;
  onMatchFound?: (match: Match) => void;
}

export function useMatchPolling({
  roomId,
  enabled = true,
  interval = 3000, // 3 seconds
  onMatchFound,
}: UseMatchPollingOptions) {
  const [isPolling, setIsPolling] = useState(false);
  const [lastMatchCheck, setLastMatchCheck] = useState<number>(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Start/stop polling based on enabled state
  useEffect(() => {
    if (enabled && roomId) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => stopPolling();
  }, [enabled, roomId, interval]);

  const startPolling = () => {
    if (intervalRef.current || !roomId) return;

    setIsPolling(true);
    logger.match('Starting match polling', { roomId, interval });

    // Check immediately
    checkForMatch();

    // Then check periodically
    intervalRef.current = setInterval(() => {
      if (mountedRef.current) {
        checkForMatch();
      }
    }, interval);
  };

  const stopPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
    logger.match('Stopped match polling', { roomId });
  };

  const checkForMatch = async () => {
    if (!roomId || !mountedRef.current) return;

    try {
      const now = Date.now();
      
      // Throttle checks to avoid spam
      if (now - lastMatchCheck < 1000) return;
      setLastMatchCheck(now);

      const authStatus = await verifyAuthStatus();
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for match polling', null);
        return;
      }

      // Check for room-specific match
      const response = await client.graphql({
        query: CHECK_ROOM_MATCH,
        variables: { roomId },
        authMode: 'userPool',
      });

      const match = response.data.checkRoomMatch;
      
      if (match && mountedRef.current) {
        logger.match('Match found via polling', {
          matchId: match.id,
          roomId: match.roomId,
          title: match.title,
          pollingInterval: interval,
        });

        // Stop polling since match was found
        stopPolling();

        // Notify callback
        if (onMatchFound) {
          onMatchFound(match);
        }
      }

    } catch (error) {
      logger.matchError('Error in match polling', error, { roomId });
      // Continue polling even if there's an error
    }
  };

  // Manual check function
  const checkNow = () => {
    checkForMatch();
  };

  // Check for any new matches for the user (not room-specific)
  const checkUserMatches = async (): Promise<Match[]> => {
    try {
      const authStatus = await verifyAuthStatus();
      if (!authStatus.isAuthenticated) {
        return [];
      }

      const response = await client.graphql({
        query: GET_MATCHES,
        authMode: 'userPool',
      });

      return response.data.getMyMatches || [];
    } catch (error) {
      logger.matchError('Error checking user matches', error);
      return [];
    }
  };

  return {
    isPolling,
    checkNow,
    checkUserMatches,
    startPolling,
    stopPolling,
  };
}

// Hook for global match notifications (not room-specific)
export function useGlobalMatchPolling(onNewMatch?: (match: Match) => void) {
  const [lastMatchCount, setLastMatchCount] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const startGlobalPolling = () => {
    if (intervalRef.current) return;

    logger.match('🔄 Starting global match polling with getMyMatches query');

    // Check every 5 seconds for new matches using getMyMatches
    intervalRef.current = setInterval(async () => {
      if (!mountedRef.current) return;

      try {
        const authStatus = await verifyAuthStatus();
        if (!authStatus.isAuthenticated) return;

        // Use the reliable getMyMatches query
        const response = await client.graphql({
          query: GET_MATCHES,
          authMode: 'userPool',
        });

        const matches = response.data.getMyMatches || [];
        
        if (matches.length > lastMatchCount) {
          // New match(es) found
          const newMatches = matches.slice(0, matches.length - lastMatchCount);
          setLastMatchCount(matches.length);

          newMatches.forEach((match: Match) => {
            logger.match('🎉 New match detected via global polling', {
              matchId: match.id,
              title: match.title,
              roomId: match.roomId,
              timestamp: match.timestamp,
            });

            if (onNewMatch) {
              onNewMatch(match);
            }
          });
        } else if (matches.length < lastMatchCount) {
          // Reset count if matches decreased (shouldn't happen normally)
          setLastMatchCount(matches.length);
        }
      } catch (error) {
        logger.matchError('❌ Error in global match polling', error);
      }
    }, 5000); // 5 seconds
  };

  const stopGlobalPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    logger.match('⏹️ Stopped global match polling');
  };

  return {
    startGlobalPolling,
    stopGlobalPolling,
  };
}