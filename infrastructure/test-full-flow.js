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

async function testFullMatchFlow() {
  console.log('🧪 Testing full match flow...');
  
  // 1. Test publishRoomMatch mutation
  console.log('\n1️⃣ Testing publishRoomMatch mutation...');
  
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

  const testRoomId = `test-room-${Date.now()}`;
  const testMatchId = `test-match-${Date.now()}`;
  
  const publishVariables = {
    roomId: testRoomId,
    matchData: {
      matchId: testMatchId,
      movieId: '12345',
      movieTitle: 'Test Movie for Subscription',
      posterPath: '/test-poster.jpg',
      matchedUsers: ['test-user-1', 'test-user-2'],
      matchDetails: {
        voteCount: 2,
        requiredVotes: 2,
        matchType: 'unanimous'
      }
    }
  };

  const publishResult = await callAppSync(publishMutation, publishVariables);
  
  if (publishResult?.publishRoomMatch) {
    console.log('✅ publishRoomMatch successful:', publishResult.publishRoomMatch);
    
    // 2. Test if we can query the published data (this should trigger subscriptions)
    console.log('\n2️⃣ Testing if subscription was triggered...');
    console.log('📡 If you have a client subscribed to roomMatch for roomId:', testRoomId);
    console.log('📡 It should receive this notification now!');
    
    // 3. Test multiple rapid calls to simulate real voting scenario
    console.log('\n3️⃣ Testing rapid succession calls...');
    
    for (let i = 1; i <= 3; i++) {
      const rapidTestRoomId = `rapid-test-room-${i}`;
      const rapidTestMatchId = `rapid-test-match-${i}-${Date.now()}`;
      
      const rapidVariables = {
        roomId: rapidTestRoomId,
        matchData: {
          matchId: rapidTestMatchId,
          movieId: `${12345 + i}`,
          movieTitle: `Rapid Test Movie ${i}`,
          posterPath: `/test-poster-${i}.jpg`,
          matchedUsers: [`rapid-user-${i}-1`, `rapid-user-${i}-2`],
          matchDetails: {
            voteCount: 2,
            requiredVotes: 2,
            matchType: 'unanimous'
          }
        }
      };
      
      const rapidResult = await callAppSync(publishMutation, rapidVariables);
      
      if (rapidResult?.publishRoomMatch) {
        console.log(`✅ Rapid test ${i} successful for room:`, rapidTestRoomId);
      } else {
        console.log(`❌ Rapid test ${i} failed for room:`, rapidTestRoomId);
      }
      
      // Small delay between calls
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
  } else {
    console.log('❌ publishRoomMatch failed');
  }
  
  console.log('\n🏁 Test completed. Check AppSync logs and client subscriptions for results.');
}

// Run the test
testFullMatchFlow().catch(console.error);