const { SignatureV4 } = require('@aws-sdk/signature-v4');
const { Sha256 } = require('@aws-crypto/sha256-js');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { HttpRequest } = require('@aws-sdk/protocol-http');

const endpoint = 'https://nvokqs473bbfdizeq4n5oosjpy.appsync-api.eu-west-1.amazonaws.com/graphql';

async function callAppSync(query, variables = {}) {
  try {
    const url = new URL(endpoint);
    const request = new HttpRequest({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        host: url.hostname,
      },
      hostname: url.hostname,
      path: '/graphql',
      body: JSON.stringify({ query, variables }),
    });

    const signer = new SignatureV4({
      credentials: defaultProvider(),
      region: 'eu-west-1',
      service: 'appsync',
      sha256: Sha256,
    });

    const signedRequest = await signer.sign(request);

    const response = await fetch(endpoint, {
      method: signedRequest.method,
      headers: signedRequest.headers,
      body: signedRequest.body,
    });

    const result = await response.json();
    
    if (result.errors) {
      console.error('❌ GraphQL errors:', result.errors);
      return null;
    }
    
    return result.data;
  } catch (error) {
    console.error('❌ Error calling AppSync:', error);
    return null;
  }
}

async function testSpecificRoom() {
  console.log('🧪 Testing notifications for the actual room...');
  
  // La sala actual del usuario
  const actualRoomId = '89ff9ad2-ceb3-4e74-9e12-07b77be1cc00';
  
  console.log(`📡 Sending test notification to room: ${actualRoomId}`);
  
  const publishMutation = `
    mutation PublishRoomMatch($roomId: ID!, $matchData: RoomMatchInput!) {
      publishRoomMatch(roomId: $roomId, matchData: $matchData) {
        roomId
        matchId
        movieId
        movieTitle
        matchedUsers
        timestamp
      }
    }
  `;

  const testMatchId = `manual-test-${Date.now()}`;
  
  const publishVariables = {
    roomId: actualRoomId,
    matchData: {
      matchId: testMatchId,
      movieId: '446337',
      movieTitle: 'Xoxontla - TEST NOTIFICATION',
      posterPath: '/test-poster.jpg',
      matchedUsers: ['e2352494-00a1-701b-affc-1b5dad653c83', '32054474-8031-709d-4370-b59b6c4f9113'],
      matchDetails: {
        voteCount: 2,
        requiredVotes: 2,
        matchType: 'unanimous'
      }
    }
  };

  const publishResult = await callAppSync(publishMutation, publishVariables);
  
  if (publishResult?.publishRoomMatch) {
    console.log('✅ Test notification sent successfully:', publishResult.publishRoomMatch);
    console.log('📱 Check your mobile app - you should receive a notification now!');
    console.log('🔔 If you don\'t receive it, the WebSocket subscription is not working');
  } else {
    console.log('❌ Failed to send test notification');
  }
}

// Run the test
testSpecificRoom().catch(console.error);