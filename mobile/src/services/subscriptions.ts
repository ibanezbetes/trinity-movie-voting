import { client } from './amplify';
import { logger } from './logger';

// GraphQL subscription for match notifications
export const MATCH_SUBSCRIPTION = `
  subscription OnMatchCreated($userId: String!) {
    onMatchCreated(userId: $userId) {
      id
      roomId
      movieId
      title
      posterPath
      timestamp
    }
  }
`;

interface Match {
  id: string;
  roomId: string;
  movieId: number;
  title: string;
  posterPath?: string;
  timestamp: string;
}

interface MatchSubscriptionService {
  subscribe: (userId: string, onMatch: (match: Match) => void) => () => void;
  unsubscribe: () => void;
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
      logger.match('Subscribing to match notifications', { userId });

      this.subscription = client.graphql({
        query: MATCH_SUBSCRIPTION,
        variables: { userId },
        authMode: 'userPool',
      }).subscribe({
        next: ({ data }) => {
          if (data?.onMatchCreated) {
            const match = data.onMatchCreated;
            logger.match('Match notification received via subscription', {
              matchId: match.id,
              title: match.title,
              roomId: match.roomId,
            });
            
            onMatch(match);
          }
        },
        error: (error) => {
          logger.matchError('Match subscription error', error);
          console.error('Match subscription error:', error);
        },
      });

      this.isSubscribed = true;
      logger.match('Successfully subscribed to match notifications');

      // Return unsubscribe function
      return () => this.unsubscribe();

    } catch (error) {
      logger.matchError('Failed to subscribe to match notifications', error);
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
        logger.match('Unsubscribed from match notifications');
      } catch (error) {
        logger.matchError('Error unsubscribing from match notifications', error);
        console.error('Error unsubscribing:', error);
      }
    }
  }
}

// Export singleton instance
export const matchSubscriptionService = new MatchSubscriptionManager();

// Helper hook for React components
export function useMatchSubscription(userId: string | null, onMatch: (match: Match) => void) {
  React.useEffect(() => {
    if (!userId) return;

    const unsubscribe = matchSubscriptionService.subscribe(userId, onMatch);
    
    return () => {
      unsubscribe();
    };
  }, [userId, onMatch]);
}

// Import React for the hook
import React from 'react';