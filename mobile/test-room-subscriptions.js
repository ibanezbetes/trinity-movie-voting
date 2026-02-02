/**
 * Test script to verify room-based subscription system
 * Run this in the mobile app console to test room subscriptions
 */

// Test room subscription functionality
const testRoomSubscription = async () => {
  console.log('🧪 Testing Room-Based Subscription System');
  
  try {
    // Import the room subscription service
    const { roomSubscriptionService } = require('./src/services/subscriptions');
    
    const testRoomId = 'test-room-123';
    const testUserId = 'test-user-456';
    
    console.log('📡 Setting up room subscription...');
    
    // Subscribe to room notifications
    const unsubscribe = roomSubscriptionService.subscribeToRoom(
      testRoomId, 
      testUserId, 
      (roomMatchEvent) => {
        console.log('🎉 Room match notification received!', {
          roomId: roomMatchEvent.roomId,
          matchId: roomMatchEvent.matchId,
          movieTitle: roomMatchEvent.movieTitle,
          matchedUsers: roomMatchEvent.matchedUsers,
          timestamp: roomMatchEvent.timestamp,
        });
      }
    );
    
    console.log('✅ Room subscription established');
    console.log('ℹ️  Subscription will listen for matches in room:', testRoomId);
    console.log('ℹ️  To test: Create a match in this room from another device');
    
    // Test unsubscribe after 30 seconds
    setTimeout(() => {
      console.log('🔌 Unsubscribing from room...');
      unsubscribe();
      console.log('✅ Unsubscribed successfully');
    }, 30000);
    
  } catch (error) {
    console.error('❌ Room subscription test failed:', error);
  }
};

// Export for use in React Native debugger
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { testRoomSubscription };
}

// Auto-run if in browser console
if (typeof window !== 'undefined') {
  console.log('🚀 Run testRoomSubscription() to test room subscriptions');
}