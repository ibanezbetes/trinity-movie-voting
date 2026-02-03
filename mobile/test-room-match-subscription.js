const { Amplify } = require('aws-amplify');
const { generateClient } = require('aws-amplify/api');

// Configure Amplify with your settings
const awsConfig = {
  aws_project_region: 'eu-west-1',
  aws_appsync_graphqlEndpoint: 'https://nvokqs473bbfdizeq4n5oosjpy.appsync-api.eu-west-1.amazonaws.com/graphql',
  aws_appsync_region: 'eu-west-1',
  aws_appsync_authenticationType: 'AMAZON_COGNITO_USER_POOLS',
  aws_cognito_region: 'eu-west-1',
  aws_user_pools_id: 'eu-west-1_Ej8Ej8Ej8',
  aws_user_pools_web_client_id: 'your-client-id',
};

Amplify.configure(awsConfig);
const client = generateClient();

// Test subscription
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

async function testRoomSubscription() {
  console.log('🔔 Testing room-based match subscription...');
  
  const testRoomId = 'test-room-123';
  
  try {
    const subscription = client.graphql({
      query: ROOM_MATCH_SUBSCRIPTION,
      variables: { roomId: testRoomId },
      authMode: 'userPool',
    }).subscribe({
      next: ({ data }) => {
        console.log('📡 Room match notification received:', data);
        if (data?.roomMatch) {
          console.log('✅ Match details:', {
            roomId: data.roomMatch.roomId,
            matchId: data.roomMatch.matchId,
            movieTitle: data.roomMatch.movieTitle,
            matchedUsers: data.roomMatch.matchedUsers,
          });
        }
      },
      error: (error) => {
        console.error('❌ Subscription error:', error);
      },
    });

    console.log('✅ Subscription established, waiting for notifications...');
    
    // Keep the subscription alive for testing
    setTimeout(() => {
      console.log('🔄 Unsubscribing...');
      subscription.unsubscribe();
    }, 30000); // 30 seconds

  } catch (error) {
    console.error('❌ Failed to set up subscription:', error);
  }
}

// Test direct mutation call
async function testPublishRoomMatch() {
  console.log('🚀 Testing publishRoomMatch mutation...');
  
  const mutation = `
    mutation PublishRoomMatch($roomId: ID!, $matchData: RoomMatchInput!) {
      publishRoomMatch(roomId: $roomId, matchData: $matchData) {
        roomId
        matchId
        movieId
        matchedUsers
      }
    }
  `;

  const variables = {
    roomId: 'test-room-123',
    matchData: {
      matchId: 'test-match-456',
      movieId: '12345',
      movieTitle: 'Test Movie',
      posterPath: '/test-poster.jpg',
      matchedUsers: ['user1', 'user2'],
      matchDetails: {
        voteCount: 2,
        requiredVotes: 2,
        matchType: 'unanimous'
      }
    }
  };

  try {
    const response = await client.graphql({
      query: mutation,
      variables,
      authMode: 'userPool',
    });

    console.log('✅ Mutation response:', response);
  } catch (error) {
    console.error('❌ Mutation error:', error);
  }
}

// Run tests
if (require.main === module) {
  console.log('🧪 Starting AppSync subscription tests...');
  testRoomSubscription();
  
  // Test mutation after 5 seconds
  setTimeout(() => {
    testPublishRoomMatch();
  }, 5000);
}