import { useEffect, useRef, useState, useCallback } from 'react';
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
  matchedUsers: string[];
}

interface UseMatchPollingOptions {
  roomId?: string;
  enabled?: boolean;
  interval?: number;
  onMatchFound?: (match: Match) => void;
}

// CRITICAL: Enhanced polling with better error handling and backoff
export function useMatchPolling({
  roomId,
  enabled = true,
  interval = 3000, // 3 seconds
  onMatchFound,
}: UseMatchPollingOptions) {
  const [isPolling, setIsPolling] = useState(false);
  const [lastMatchCheck, setLastMatchCheck] = useState<number>(0);
  const [errorCount, setErrorCount] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const lastKnownMatches = useRef<Set<string>>(new Set());
  const maxErrors = 5;
  const baseInterval = interval;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const checkForMatch = useCallback(async () => {
    if (!roomId || !mountedRef.current) return;

    try {
      const now = Date.now();
      
      // Throttle checks to avoid spam
      if (now - lastMatchCheck < 1000) return;
      setLastMatchCheck(now);

      logger.match('🔍 Enhanced polling for matches', { roomId, errorCount });

      const authStatus = await verifyAuthStatus();
      if (!authStatus.isAuthenticated) {
        logger.authError('User not authenticated for match polling', null);
        return;
      }

      // CRITICAL: Use getMyMatches for more reliable match detection
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

      const allMatches = response.data.getMyMatches || [];
      const roomMatches = allMatches.filter(match => match.roomId === roomId);
      
      // Check for new matches
      const newMatches = roomMatches.filter(match => !lastKnownMatches.current.has(match.id));
      
      if (newMatches.length > 0 && mountedRef.current) {
        logger.match('🎉 New matches found via enhanced polling', { 
          roomId, 
          newMatchCount: newMatches.length,
          matchIds: newMatches.map(m => m.id)
        });

        // Update known matches
        newMatches.forEach(match => {
          lastKnownMatches.current.add(match.id);
          if (onMatchFound) {
            onMatchFound(match);
          }
        });

        // Stop polling since match was found
        stopPolling();
      }

      // Reset error count on successful check
      setErrorCount(0);

    } catch (error) {
      const newErrorCount = errorCount + 1;
      setErrorCount(newErrorCount);
      
      logger.matchError('❌ Error in enhanced match polling', error, { 
        roomId, 
        errorCount: newErrorCount,
        maxErrors 
      });

      // Stop polling if too many errors
      if (newErrorCount >= maxErrors) {
        logger.matchError('❌ Too many polling errors, stopping', error, { roomId, errorCount: newErrorCount });
        stopPolling();
      }
    }
  }, [roomId, onMatchFound, errorCount, lastMatchCheck]);

  const startPolling = useCallback(() => {
    if (intervalRef.current || !roomId) return;

    setIsPolling(true);
    setErrorCount(0);
    lastKnownMatches.current.clear();
    
    logger.match('▶️ Starting enhanced match polling', { roomId, interval: baseInterval });

    // Check immediately
    checkForMatch();

    // Set up interval with exponential backoff on errors
    const currentInterval = errorCount > 0 ? baseInterval * Math.pow(2, Math.min(errorCount, 3)) : baseInterval;
    
    intervalRef.current = setInterval(() => {
      if (mountedRef.current) {
        checkForMatch();
      }
    }, currentInterval);
  }, [roomId, checkForMatch, baseInterval, errorCount]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
    setErrorCount(0);
    logger.match('⏹️ Stopped enhanced match polling', { roomId });
  }, [roomId]);

  // Start/stop polling based on enabled state
  useEffect(() => {
    if (enabled && roomId) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => stopPolling();
  }, [enabled, roomId, startPolling, stopPolling]);

  // Restart polling with backoff when error count changes
  useEffect(() => {
    if (isPolling && errorCount > 0 && errorCount < maxErrors) {
      stopPolling();
      
      // Restart with exponential backoff
      const backoffDelay = baseInterval * Math.pow(2, Math.min(errorCount, 3));
      logger.match('🔄 Restarting polling with backoff', { 
        roomId, 
        errorCount, 
        backoffDelay 
      });
      
      setTimeout(() => {
        if (roomId && enabled && mountedRef.current) {
          startPolling();
        }
      }, backoffDelay);
    }
  }, [errorCount, isPolling, roomId, enabled, startPolling, stopPolling, baseInterval]);

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
    errorCount,
    checkNow,
    checkUserMatches,
    startPolling,
    stopPolling,
  };
}

// CRITICAL: Enhanced global match polling for background detection
export function useGlobalMatchPolling(onNewMatch?: (match: Match) => void) {
  const [lastMatchCount, setLastMatchCount] = useState(0);
  const [isGlobalPolling, setIsGlobalPolling] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const globalKnownMatches = useRef<Set<string>>(new Set());
  const globalErrorCount = useRef(0);
  const maxGlobalErrors = 3;
  const globalInterval = 8000; // 8 seconds for global polling

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const checkForGlobalMatches = useCallback(async () => {
    if (!mountedRef.current) return;

    try {
      logger.match('🌍 Enhanced global polling for matches');

      const authStatus = await verifyAuthStatus();
      if (!authStatus.isAuthenticated) return;

      // Use the reliable getMyMatches query
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

      const allMatches = response.data.getMyMatches || [];
      
      // Check for matches from the last 30 seconds (to catch recent matches)
      const now = new Date();
      const thirtySecondsAgo = new Date(now.getTime() - 30000);
      
      const recentMatches = allMatches.filter(match => {
        const matchTime = new Date(match.timestamp);
        return matchTime > thirtySecondsAgo && !globalKnownMatches.current.has(match.id);
      });
      
      if (recentMatches.length > 0) {
        logger.match('🎉 New matches found via enhanced global polling', { 
          newMatchCount: recentMatches.length,
          matchIds: recentMatches.map(m => m.id)
        });

        // Update known matches and notify
        recentMatches.forEach(match => {
          globalKnownMatches.current.add(match.id);
          if (onNewMatch) {
            onNewMatch(match);
          }
        });
      }

      // Also check by count for additional safety
      if (allMatches.length > lastMatchCount) {
        setLastMatchCount(allMatches.length);
      } else if (allMatches.length < lastMatchCount) {
        // Reset count if matches decreased (shouldn't happen normally)
        setLastMatchCount(allMatches.length);
        globalKnownMatches.current.clear();
      }

      // Reset error count on successful check
      globalErrorCount.current = 0;

    } catch (error) {
      globalErrorCount.current++;
      
      logger.matchError('❌ Error in enhanced global match polling', error, { 
        errorCount: globalErrorCount.current,
        maxErrors: maxGlobalErrors 
      });

      // Stop global polling if too many errors
      if (globalErrorCount.current >= maxGlobalErrors) {
        logger.matchError('❌ Too many global polling errors, stopping');
        stopGlobalPolling();
      }
    }
  }, [onNewMatch, lastMatchCount]);

  const startGlobalPolling = useCallback(() => {
    if (intervalRef.current) return;

    setIsGlobalPolling(true);
    globalErrorCount.current = 0;
    globalKnownMatches.current.clear();

    logger.match('▶️ Starting enhanced global match polling', { interval: globalInterval });

    // Check immediately
    checkForGlobalMatches();

    // Set up interval
    intervalRef.current = setInterval(() => {
      if (mountedRef.current) {
        checkForGlobalMatches();
      }
    }, globalInterval);
  }, [checkForGlobalMatches]);

  const stopGlobalPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsGlobalPolling(false);
    globalErrorCount.current = 0;
    logger.match('⏹️ Stopped enhanced global match polling');
  }, []);

  return {
    isGlobalPolling,
    startGlobalPolling,
    stopGlobalPolling,
  };
}