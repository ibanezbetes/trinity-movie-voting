import { client } from './amplify';
import { logger } from './logger';

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

interface RoomSubscriptionService {
  subscribeToRoom: (roomId: string, userId: string, onMatch: (match: RoomMatchEvent) => void) => () => void;
  unsubscribeFromRoom: (roomId: string) => void;
  unsubscribeFromAllRooms: () => void;
}

interface MatchSubscriptionService {
  subscribe: (userId: string, onMatch: (match: Match) => void) => () => void;
  unsubscribe: () => void;
}

class RoomSubscriptionManager implements RoomSubscriptionService {
  private subscriptions: Map<string, any> = new Map();

  subscribeToRoom(roomId: string, userId: string, onMatch: (match: RoomMatchEvent) => void): () => void {
    if (this.subscriptions.has(roomId)) {
      logger.match('Already subscribed to room notifications', { roomId });
      return () => this.unsubscribeFromRoom(roomId);
    }

    try {
      logger.match('🔔 Subscribing to room-based match notifications', { roomId, userId });

      const subscription = client.graphql({
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
            });
            
            // Process all room match events since they're already filtered by roomId
            // Additional filtering can be done here if needed
            if (roomMatchEvent.matchedUsers && roomMatchEvent.matchedUsers.includes(userId)) {
              logger.match('✅ Room match notification is for current user - processing', {
                roomId: roomMatchEvent.roomId,
                matchId: roomMatchEvent.matchId,
                movieTitle: roomMatchEvent.movieTitle,
                currentUserId: userId,
                matchedUsers: roomMatchEvent.matchedUsers,
              });
              
              onMatch(roomMatchEvent);
            } else {
              logger.match('ℹ️ Room match notification not for current user - ignoring', {
                roomId: roomMatchEvent.roomId,
                matchId: roomMatchEvent.matchId,
                movieTitle: roomMatchEvent.movieTitle,
                currentUserId: userId,
                matchedUsers: roomMatchEvent.matchedUsers,
              });
            }
          }
        },
        error: (error) => {
          logger.matchError('❌ Room match subscription error', error);
          console.error('Room match subscription error:', error);
        },
      });

      this.subscriptions.set(roomId, subscription);
      logger.match('✅ Successfully subscribed to room match notifications', { roomId });

      // Return unsubscribe function
      return () => this.unsubscribeFromRoom(roomId);

    } catch (error) {
      logger.matchError('❌ Failed to subscribe to room match notifications', error);
      console.error('Failed to subscribe to room match notifications:', error);
      return () => {};
    }
  }

  unsubscribeFromRoom(roomId: string): void {
    const subscription = this.subscriptions.get(roomId);
    if (subscription) {
      try {
        subscription.unsubscribe();
        this.subscriptions.delete(roomId);
        logger.match('Unsubscribed from room match notifications', { roomId });
      } catch (error) {
        logger.matchError('Error unsubscribing from room match notifications', error);
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
        logger.matchError('Error unsubscribing from room', error);
        console.error('Error unsubscribing from room:', error);
      }
    }
    this.subscriptions.clear();
    logger.match('Unsubscribed from all room match notifications');
  }
}

class MatchSubscriptionManager implements MatchSubscriptionService {
  private subscription: any = null;
  private isSubscribed = false;

  subscribe(userId: string, onMatch: (match: Match) => void): () => void {
    if (this.isSubscribed) {
      logger.match('Already subscribed to match notifications');
      return () => this.unsubscribe();
    }

    try {
      logger.match('🔔 Subscribing to AppSync match notifications (legacy)', { userId });

      this.subscription = client.graphql({
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
            });
            
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
          logger.matchError('❌ AppSync match subscription error (legacy)', error);
          console.error('Match subscription error:', error);
        },
      });

      this.isSubscribed = true;
      logger.match('✅ Successfully subscribed to AppSync match notifications (legacy)');

      // Return unsubscribe function
      return () => this.unsubscribe();

    } catch (error) {
      logger.matchError('❌ Failed to subscribe to match notifications (legacy)', error);
      console.error('Failed to subscribe to match notifications:', error);
      return () => {};
    }
  }

  unsubscribe(): void {
    if (this.subscription) {
      try {
        this.subscription.unsubscribe();
        this.subscription = null;
        this.isSubscribed = false;
        logger.match('Unsubscribed from match notifications (legacy)');
      } catch (error) {
        logger.matchError('Error unsubscribing from match notifications (legacy)', error);
        console.error('Error unsubscribing:', error);
      }
    }
  }
}

// Export singleton instances
export const roomSubscriptionService = new RoomSubscriptionManager();
export const matchSubscriptionService = new MatchSubscriptionManager();

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