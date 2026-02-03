const { SignatureV4 } = require('@aws-sdk/signature-v4');
const { Sha256 } = require('@aws-crypto/sha256-js');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { HttpRequest } = require('@aws-sdk/protocol-http');

async function testAppSyncCall() {
  console.log('🧪 Testing direct AppSync call from Node.js...');
  
  const endpoint = 'https://nvokqs473bbfdizeq4n5oosjpy.appsync-api.eu-west-1.amazonaws.com/graphql';
  
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
    const url = new URL(endpoint);
    const request = new HttpRequest({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        host: url.hostname,
      },
      hostname: url.hostname,
      path: '/graphql',
      body: JSON.stringify({ query: mutation, variables }),
    });

    console.log('🔐 Signing request with IAM credentials...');
    
    // Sign the request with IAM credentials
    const signer = new SignatureV4({
      credentials: defaultProvider(),
      region: 'eu-west-1',
      service: 'appsync',
      sha256: Sha256,
    });

    const signedRequest = await signer.sign(request);

    console.log('📡 Sending signed request to AppSync...');
    console.log('Request headers:', signedRequest.headers);

    // Send the request using fetch
    const response = await fetch(endpoint, {
      method: signedRequest.method,
      headers: signedRequest.headers,
      body: signedRequest.body,
    });

    const result = await response.json();
    
    console.log('📊 Response status:', response.status);
    console.log('📊 Response headers:', Object.fromEntries(response.headers.entries()));
    console.log('📊 Response body:', JSON.stringify(result, null, 2));
    
    if (result.errors) {
      console.error('❌ GraphQL errors:', result.errors);
    } else {
      console.log('✅ Success! AppSync accepted the mutation');
    }

  } catch (error) {
    console.error('❌ Error calling AppSync:', error);
  }
}

// Run the test
testAppSyncCall().catch(console.error);