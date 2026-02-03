import { client, realtimeClient } from './amplify';
import { logger } from './logger';

// GraphQL subscription for user-specific match notifications
export const USER_MATCH_SUBSCRIPTION = `
  subscription UserMatch($userId: ID!) {
    userMatch(userId: $userId) {
      userId
      roomId
      matchId
      movieId
      movieTitle
      posterPath
      matchedUsers
      timestamp
      matchDetails {
        voteCount
        requiredVotes
        matchType
      }
    }
  }
`;

// GraphQL subscription for room-based match notifications
export const ROOM_MATCH_SUBSCRIPTION = `
  subscription RoomMatch($roomId: ID!) {
    roomMatch(roomId: $roomId) {
      roomId
      matchId
      movieId
      movieTitle
      posterPath
      matchedUsers
      timestamp
      matchDetails {
        voteCount
        requiredVotes
        matchType
      }
    }
  }
`;

// Legacy subscription for backward compatibility
export const MATCH_SUBSCRIPTION = `
  subscription OnMatchCreated {
    onMatchCreated {
      id
      roomId
      movieId
      title
      posterPath
      timestamp
      matchedUsers
    }
  }
`;

interface UserMatchEvent {
  userId: string;
  roomId: string;
  matchId: string;
  movieId: string;
  movieTitle: string;
  posterPath?: string;
  matchedUsers: string[];
  timestamp: string;
  matchDetails: {
    voteCount: number;
    requiredVotes: number;
    matchType: string;
  };
}

interface RoomMatchEvent {
  roomId: string;
  matchId: string;
  movieId: string;
  movieTitle: string;
  posterPath?: string;
  matchedUsers: string[];
  timestamp: string;
  matchDetails: {
    voteCount: number;
    requiredVotes: number;
    matchType: string;
  };
}

interface Match {
  id: string;
  roomId: string;
  movieId: number;
  title: string;
  posterPath?: string;
  timestamp: string;
  matchedUsers: string[];
}

interface UserSubscriptionService {
  subscribeToUser: (userId: string, onMatch: (match: UserMatchEvent) => void) => () => void;
  unsubscribeFromUser: (userId: string) => void;
  unsubscribeFromAllUsers: () => void;
}

interface RoomSubscriptionService {
  subscribeToRoom: (roomId: string, userId: string, onMatch: (match: RoomMatchEvent) => void) => () => void;
  unsubscribeFromRoom: (roomId: string) => void;
  unsubscribeFromAllRooms: () => void;
}

interface MatchSubscriptionService {
  subscribe: (userId: string, onMatch: (match: Match) => void) => () => void;
  unsubscribe: () => void;
}

class UserSubscriptionManager implements UserSubscriptionService {
  private subscriptions: Map<string, any> = new Map();
  private connectionRetries: Map<string, number> = new Map();
  private maxRetries = 3;
  private retryDelay = 2000; // 2 seconds

  subscribeToUser(userId: string, onMatch: (match: UserMatchEvent) => void): () => void {
    if (this.subscriptions.has(userId)) {
      logger.match('Already subscribed to user notifications', { userId });
      return () => this.unsubscribeFromUser(userId);
    }

    return this.establishUserSubscription(userId, onMatch, 0);
  }

  private establishUserSubscription(
    userId: string, 
    onMatch: (match: UserMatchEvent) => void, 
    retryCount: number
  ): () => void {
    try {
      logger.match('🔔 Establishing user-specific match subscription', { 
        userId, 
        retryCount,
        usingRealtimeClient: true 
      });

      // CRITICAL: Use realtimeClient for better WebSocket handling
      const subscription = realtimeClient.graphql({
        query: USER_MATCH_SUBSCRIPTION,
        variables: { userId },
        authMode: 'userPool',
      }).subscribe({
        next: ({ data }) => {
          if (data?.userMatch) {
            const userMatchEvent = data.userMatch;
            
            logger.match('📡 User match notification received from AppSync', {
              userId: userMatchEvent.userId,
              roomId: userMatchEvent.roomId,
              matchId: userMatchEvent.matchId,
              movieTitle: userMatchEvent.movieTitle,
              matchedUsers: userMatchEvent.matchedUsers,
              subscriptionType: 'user-specific-websocket'
            });
            
            // Reset retry count on successful message
            this.connectionRetries.set(userId, 0);
            
            // Process user match events - these are already filtered by userId
            logger.match('✅ User match notification is for current user - processing', {
              userId: userMatchEvent.userId,
              roomId: userMatchEvent.roomId,
              matchId: userMatchEvent.matchId,
              movieTitle: userMatchEvent.movieTitle,
              matchedUsers: userMatchEvent.matchedUsers,
            });
            
            onMatch(userMatchEvent);
          }
        },
        error: (error) => {
          logger.matchError('❌ User match subscription error', error, { userId, retryCount });
          console.error('User match subscription error:', error);
          
          // Handle reconnection logic
          this.handleSubscriptionError(userId, onMatch, retryCount, error);
        },
      });

      this.subscriptions.set(userId, subscription);
      this.connectionRetries.set(userId, retryCount);
      
      logger.match('✅ Successfully established user match subscription', { 
        userId, 
        retryCount,
        totalActiveSubscriptions: this.subscriptions.size 
      });

      // Return unsubscribe function
      return () => this.unsubscribeFromUser(userId);

    } catch (error) {
      logger.matchError('❌ Failed to establish user match subscription', error, { userId, retryCount });
      console.error('Failed to establish user match subscription:', error);
      
      // Handle initial connection error
      this.handleSubscriptionError(userId, onMatch, retryCount, error);
      
      return () => {};
    }
  }

  private handleSubscriptionError(
    userId: string, 
    onMatch: (match: UserMatchEvent) => void, 
    retryCount: number, 
    error: any
  ): void {
    const currentRetries = this.connectionRetries.get(userId) || retryCount;
    
    if (currentRetries < this.maxRetries) {
      const nextRetryCount = currentRetries + 1;
      const delay = this.retryDelay * nextRetryCount; // Exponential backoff
      
      logger.match(`🔄 Retrying user subscription in ${delay}ms`, { 
        userId, 
        retryCount: nextRetryCount, 
        maxRetries: this.maxRetries,
        error: error?.message 
      });
      
      setTimeout(() => {
        // Clean up failed subscription
        this.unsubscribeFromUser(userId);
        // Retry with new connection
        this.establishUserSubscription(userId, onMatch, nextRetryCount);
      }, delay);
    } else {
      logger.matchError('❌ Max retries exceeded for user subscription', error, { 
        userId, 
        maxRetries: this.maxRetries 
      });
      
      // Clean up failed subscription
      this.unsubscribeFromUser(userId);
    }
  }

  unsubscribeFromUser(userId: string): void {
    const subscription = this.subscriptions.get(userId);
    if (subscription) {
      try {
        subscription.unsubscribe();
        this.subscriptions.delete(userId);
        this.connectionRetries.delete(userId);
        logger.match('Unsubscribed from user match notifications', { 
          userId,
          remainingSubscriptions: this.subscriptions.size 
        });
      } catch (error) {
        logger.matchError('Error unsubscribing from user match notifications', error, { userId });
        console.error('Error unsubscribing from user:', error);
      }
    }
  }

  unsubscribeFromAllUsers(): void {
    for (const [userId, subscription] of this.subscriptions) {
      try {
        subscription.unsubscribe();
        logger.match('Unsubscribed from user', { userId });
      } catch (error) {
        logger.matchError('Error unsubscribing from user', error, { userId });
        console.error('Error unsubscribing from user:', error);
      }
    }
    this.subscriptions.clear();
    this.connectionRetries.clear();
    logger.match('Unsubscribed from all user match notifications');
  }
}

class RoomSubscriptionManager implements RoomSubscriptionService {
  private subscriptions: Map<string, any> = new Map();
  private connectionRetries: Map<string, number> = new Map();
  private maxRetries = 3;
  private retryDelay = 2000; // 2 seconds

  subscribeToRoom(roomId: string, userId: string, onMatch: (match: RoomMatchEvent) => void): () => void {
    if (this.subscriptions.has(roomId)) {
      logger.match('Already subscribed to room notifications', { roomId });
      return () => this.unsubscribeFromRoom(roomId);
    }

    return this.establishRoomSubscription(roomId, userId, onMatch, 0);
  }

  private establishRoomSubscription(
    roomId: string, 
    userId: string, 
    onMatch: (match: RoomMatchEvent) => void, 
    retryCount: number
  ): () => void {
    try {
      logger.match('🔔 Establishing room-based match subscription', { 
        roomId, 
        userId, 
        retryCount,
        usingRealtimeClient: true 
      });

      // CRITICAL: Use realtimeClient for better WebSocket handling
      const subscription = realtimeClient.graphql({
        query: ROOM_MATCH_SUBSCRIPTION,
        variables: { roomId },
        authMode: 'userPool',
      }).subscribe({
        next: ({ data }) => {
          if (data?.roomMatch) {
            const roomMatchEvent = data.roomMatch;
            
            logger.match('📡 Room match notification received from AppSync', {
              roomId: roomMatchEvent.roomId,
              matchId: roomMatchEvent.matchId,
              movieTitle: roomMatchEvent.movieTitle,
              matchedUsers: roomMatchEvent.matchedUsers,
              currentUserId: userId,
              subscriptionType: 'realtime-websocket'
            });
            
            // Reset retry count on successful message
            this.connectionRetries.set(roomId, 0);
            
            // CRITICAL FIX: Process ALL room match events for this room
            // Don't filter by matchedUsers here - let the UI handle the filtering
            // This ensures ALL users in the room get notified immediately
            logger.match('✅ Room match notification received - processing for all users in room', {
              roomId: roomMatchEvent.roomId,
              matchId: roomMatchEvent.matchId,
              movieTitle: roomMatchEvent.movieTitle,
              currentUserId: userId,
              matchedUsers: roomMatchEvent.matchedUsers,
            });
            
            onMatch(roomMatchEvent);
          }
        },
        error: (error) => {
          logger.matchError('❌ Room match subscription error', error, { roomId, retryCount });
          console.error('Room match subscription error:', error);
          
          // Handle reconnection logic
          this.handleSubscriptionError(roomId, userId, onMatch, retryCount, error);
        },
      });

      this.subscriptions.set(roomId, subscription);
      this.connectionRetries.set(roomId, retryCount);
      
      logger.match('✅ Successfully established room match subscription', { 
        roomId, 
        retryCount,
        totalActiveSubscriptions: this.subscriptions.size 
      });

      // Return unsubscribe function
      return () => this.unsubscribeFromRoom(roomId);

    } catch (error) {
      logger.matchError('❌ Failed to establish room match subscription', error, { roomId, retryCount });
      console.error('Failed to establish room match subscription:', error);
      
      // Handle initial connection error
      this.handleSubscriptionError(roomId, userId, onMatch, retryCount, error);
      
      return () => {};
    }
  }

  private handleSubscriptionError(
    roomId: string, 
    userId: string, 
    onMatch: (match: RoomMatchEvent) => void, 
    retryCount: number, 
    error: any
  ): void {
    const currentRetries = this.connectionRetries.get(roomId) || retryCount;
    
    if (currentRetries < this.maxRetries) {
      const nextRetryCount = currentRetries + 1;
      const delay = this.retryDelay * nextRetryCount; // Exponential backoff
      
      logger.match(`🔄 Retrying room subscription in ${delay}ms`, { 
        roomId, 
        retryCount: nextRetryCount, 
        maxRetries: this.maxRetries,
        error: error?.message 
      });
      
      setTimeout(() => {
        // Clean up failed subscription
        this.unsubscribeFromRoom(roomId);
        // Retry with new connection
        this.establishRoomSubscription(roomId, userId, onMatch, nextRetryCount);
      }, delay);
    } else {
      logger.matchError('❌ Max retries exceeded for room subscription', error, { 
        roomId, 
        maxRetries: this.maxRetries 
      });
      
      // Clean up failed subscription
      this.unsubscribeFromRoom(roomId);
    }
  }

  unsubscribeFromRoom(roomId: string): void {
    const subscription = this.subscriptions.get(roomId);
    if (subscription) {
      try {
        subscription.unsubscribe();
        this.subscriptions.delete(roomId);
        this.connectionRetries.delete(roomId);
        logger.match('Unsubscribed from room match notifications', { 
          roomId,
          remainingSubscriptions: this.subscriptions.size 
        });
      } catch (error) {
        logger.matchError('Error unsubscribing from room match notifications', error, { roomId });
        console.error('Error unsubscribing from room:', error);
      }
    }
  }

  unsubscribeFromAllRooms(): void {
    for (const [roomId, subscription] of this.subscriptions) {
      try {
        subscription.unsubscribe();
        logger.match('Unsubscribed from room', { roomId });
      } catch (error) {
        logger.matchError('Error unsubscribing from room', error, { roomId });
        console.error('Error unsubscribing from room:', error);
      }
    }
    this.subscriptions.clear();
    this.connectionRetries.clear();
    logger.match('Unsubscribed from all room match notifications');
  }
}

class MatchSubscriptionManager implements MatchSubscriptionService {
  private subscription: any = null;
  private isSubscribed = false;
  private retryCount = 0;
  private maxRetries = 3;
  private retryDelay = 2000;

  subscribe(userId: string, onMatch: (match: Match) => void): () => void {
    if (this.isSubscribed) {
      logger.match('Already subscribed to match notifications');
      return () => this.unsubscribe();
    }

    return this.establishLegacySubscription(userId, onMatch, 0);
  }

  private establishLegacySubscription(
    userId: string, 
    onMatch: (match: Match) => void, 
    retryCount: number
  ): () => void {
    try {
      logger.match('🔔 Establishing AppSync match subscription (legacy)', { 
        userId, 
        retryCount,
        usingRealtimeClient: true 
      });

      // CRITICAL: Use realtimeClient for better WebSocket handling
      this.subscription = realtimeClient.graphql({
        query: MATCH_SUBSCRIPTION,
        authMode: 'userPool',
      }).subscribe({
        next: ({ data }) => {
          if (data?.onMatchCreated) {
            const match = data.onMatchCreated;
            
            logger.match('📡 Match notification received from AppSync (legacy)', {
              matchId: match.id,
              title: match.title,
              roomId: match.roomId,
              matchedUsers: match.matchedUsers,
              currentUserId: userId,
              subscriptionType: 'realtime-websocket'
            });
            
            // Reset retry count on successful message
            this.retryCount = 0;
            
            // CRITICAL: Filter matches on the client side
            // Only process matches where the current user is involved
            if (match.matchedUsers && match.matchedUsers.includes(userId)) {
              logger.match('✅ Match notification is for current user - processing (legacy)', {
                matchId: match.id,
                title: match.title,
                roomId: match.roomId,
                currentUserId: userId,
                matchedUsers: match.matchedUsers,
              });
              
              onMatch(match);
            } else {
              logger.match('ℹ️ Match notification not for current user - ignoring (legacy)', {
                matchId: match.id,
                title: match.title,
                currentUserId: userId,
                matchedUsers: match.matchedUsers,
              });
            }
          }
        },
        error: (error) => {
          logger.matchError('❌ AppSync match subscription error (legacy)', error, { retryCount });
          console.error('Match subscription error:', error);
          
          // Handle reconnection logic
          this.handleLegacySubscriptionError(userId, onMatch, retryCount, error);
        },
      });

      this.isSubscribed = true;
      this.retryCount = retryCount;
      
      logger.match('✅ Successfully established AppSync match subscription (legacy)', { retryCount });

      // Return unsubscribe function
      return () => this.unsubscribe();

    } catch (error) {
      logger.matchError('❌ Failed to establish match subscription (legacy)', error, { retryCount });
      console.error('Failed to establish match subscription:', error);
      
      // Handle initial connection error
      this.handleLegacySubscriptionError(userId, onMatch, retryCount, error);
      
      return () => {};
    }
  }

  private handleLegacySubscriptionError(
    userId: string, 
    onMatch: (match: Match) => void, 
    retryCount: number, 
    error: any
  ): void {
    if (retryCount < this.maxRetries) {
      const nextRetryCount = retryCount + 1;
      const delay = this.retryDelay * nextRetryCount; // Exponential backoff
      
      logger.match(`🔄 Retrying legacy subscription in ${delay}ms`, { 
        retryCount: nextRetryCount, 
        maxRetries: this.maxRetries,
        error: error?.message 
      });
      
      setTimeout(() => {
        // Clean up failed subscription
        this.unsubscribe();
        // Retry with new connection
        this.establishLegacySubscription(userId, onMatch, nextRetryCount);
      }, delay);
    } else {
      logger.matchError('❌ Max retries exceeded for legacy subscription', error, { 
        maxRetries: this.maxRetries 
      });
      
      // Clean up failed subscription
      this.unsubscribe();
    }
  }

  unsubscribe(): void {
    if (this.subscription) {
      try {
        this.subscription.unsubscribe();
        this.subscription = null;
        this.isSubscribed = false;
        this.retryCount = 0;
        logger.match('Unsubscribed from match notifications (legacy)');
      } catch (error) {
        logger.matchError('Error unsubscribing from match notifications (legacy)', error);
        console.error('Error unsubscribing:', error);
      }
    }
  }
}

// Export singleton instances
export const userSubscriptionService = new UserSubscriptionManager();
export const roomSubscriptionService = new RoomSubscriptionManager();
export const matchSubscriptionService = new MatchSubscriptionManager();

// Helper hook for user-specific subscriptions
export function useUserMatchSubscription(
  userId: string | null, 
  onMatch: (match: UserMatchEvent) => void
) {
  React.useEffect(() => {
    if (!userId) return;

    const unsubscribe = userSubscriptionService.subscribeToUser(userId, onMatch);
    
    return () => {
      unsubscribe();
    };
  }, [userId, onMatch]);
}

// Helper hook for room-based subscriptions
export function useRoomMatchSubscription(
  roomId: string | null, 
  userId: string | null, 
  onMatch: (match: RoomMatchEvent) => void
) {
  React.useEffect(() => {
    if (!roomId || !userId) return;

    const unsubscribe = roomSubscriptionService.subscribeToRoom(roomId, userId, onMatch);
    
    return () => {
      unsubscribe();
    };
  }, [roomId, userId, onMatch]);
}

// Helper hook for legacy match subscriptions
export function useMatchSubscription(userId: string | null, onMatch: (match: Match) => void) {
  React.useEffect(() => {
    if (!userId) return;

    const unsubscribe = matchSubscriptionService.subscribe(userId, onMatch);
    
    return () => {
      unsubscribe();
    };
  }, [userId, onMatch]);
}

// Import React for the hooks
import React from 'react';