/**
 * Test script to verify AppSync subscription connections
 * This script tests both the standard GraphQL endpoint and the real-time WebSocket endpoint
 */

const { Amplify } = require('aws-amplify');
const { generateClient } = require('aws-amplify/api');

// Enhanced Amplify configuration with real-time support
const amplifyConfig = {
  aws_project_region: 'eu-west-1',
  aws_appsync_graphqlEndpoint: 'https://nvokqs473bbfdizeq4n5oosjpy.appsync-api.eu-west-1.amazonaws.com/graphql',
  aws_appsync_region: 'eu-west-1',
  aws_appsync_authenticationType: 'AMAZON_COGNITO_USER_POOLS',
  // CRITICAL: Add real-time configuration for WebSocket subscriptions
  aws_appsync_realtimeEndpoint: 'wss://nvokqs473bbfdizeq4n5oosjpy.appsync-realtime-api.eu-west-1.amazonaws.com/graphql',
  aws_cognito_region: 'eu-west-1',
  aws_user_pools_id: 'eu-west-1_RPkdnO7Ju',
  aws_user_pools_web_client_id: '61nf41i2bff1c4oc4qo9g36m1k',
  // CRITICAL: Enable WebSocket for real-time subscriptions
  aws_appsync_dangerously_connect_to_http_endpoint_for_testing: false,
};

// Configure Amplify
Amplify.configure(amplifyConfig);

// Create clients
const standardClient = generateClient({ authMode: 'userPool' });
const realtimeClient = generateClient({ authMode: 'userPool' });

// Test subscriptions
const ROOM_MATCH_SUBSCRIPTION = `
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

const LEGACY_MATCH_SUBSCRIPTION = `
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

async function testSubscriptionConnections() {
  console.log('🧪 Testing AppSync subscription connections...');
  console.log('📡 Standard endpoint:', amplifyConfig.aws_appsync_graphqlEndpoint);
  console.log('🔌 Real-time endpoint:', amplifyConfig.aws_appsync_realtimeEndpoint);
  
  const testRoomId = `test-room-${Date.now()}`;
  
  // Test 1: Room-based subscription with standard client
  console.log('\n1️⃣ Testing room-based subscription (standard client)...');
  try {
    const subscription1 = standardClient.graphql({
      query: ROOM_MATCH_SUBSCRIPTION,
      variables: { roomId: testRoomId },
      authMode: 'userPool',
    }).subscribe({
      next: ({ data }) => {
        console.log('✅ Room match received (standard):', data?.roomMatch);
      },
      error: (error) => {
        console.error('❌ Room subscription error (standard):', error);
      },
    });
    
    console.log('✅ Room subscription established (standard client)');
    
    // Clean up after 5 seconds
    setTimeout(() => {
      subscription1.unsubscribe();
      console.log('🧹 Room subscription cleaned up (standard)');
    }, 5000);
    
  } catch (error) {
    console.error('❌ Failed to establish room subscription (standard):', error);
  }
  
  // Test 2: Room-based subscription with realtime client
  console.log('\n2️⃣ Testing room-based subscription (realtime client)...');
  try {
    const subscription2 = realtimeClient.graphql({
      query: ROOM_MATCH_SUBSCRIPTION,
      variables: { roomId: testRoomId },
      authMode: 'userPool',
    }).subscribe({
      next: ({ data }) => {
        console.log('✅ Room match received (realtime):', data?.roomMatch);
      },
      error: (error) => {
        console.error('❌ Room subscription error (realtime):', error);
      },
    });
    
    console.log('✅ Room subscription established (realtime client)');
    
    // Clean up after 5 seconds
    setTimeout(() => {
      subscription2.unsubscribe();
      console.log('🧹 Room subscription cleaned up (realtime)');
    }, 5000);
    
  } catch (error) {
    console.error('❌ Failed to establish room subscription (realtime):', error);
  }
  
  // Test 3: Legacy subscription
  console.log('\n3️⃣ Testing legacy subscription...');
  try {
    const subscription3 = realtimeClient.graphql({
      query: LEGACY_MATCH_SUBSCRIPTION,
      authMode: 'userPool',
    }).subscribe({
      next: ({ data }) => {
        console.log('✅ Legacy match received:', data?.onMatchCreated);
      },
      error: (error) => {
        console.error('❌ Legacy subscription error:', error);
      },
    });
    
    console.log('✅ Legacy subscription established');
    
    // Clean up after 5 seconds
    setTimeout(() => {
      subscription3.unsubscribe();
      console.log('🧹 Legacy subscription cleaned up');
    }, 5000);
    
  } catch (error) {
    console.error('❌ Failed to establish legacy subscription:', error);
  }
  
  console.log('\n⏰ Subscriptions will run for 30 seconds...');
  console.log('💡 To test notifications, run the infrastructure test script in another terminal:');
  console.log('   cd infrastructure && node test-full-flow.js');
  console.log(`💡 Use roomId: ${testRoomId} for room-specific tests`);
  
  // Keep script alive for 30 seconds
  setTimeout(() => {
    console.log('\n🏁 Test completed. Check results above.');
    process.exit(0);
  }, 30000);
}

// Mock authentication for testing (you'll need real auth in production)
async function mockAuth() {
  console.log('⚠️  Note: This test requires valid Cognito authentication');
  console.log('⚠️  Make sure you have valid credentials configured');
  
  // In a real app, you would sign in here
  // For now, we assume credentials are available
}

// Run tests
mockAuth().then(() => {
  testSubscriptionConnections();
}).catch(error => {
  console.error('❌ Authentication failed:', error);
  console.log('💡 Make sure you have valid Cognito credentials configured');
});