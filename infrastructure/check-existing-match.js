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

async function checkExistingMatch() {
  console.log('🔍 Checking for existing matches in the room...');
  
  const roomId = '89ff9ad2-ceb3-4e74-9e12-07b77be1cc00';
  
  // Check room match
  const checkRoomQuery = `
    query CheckRoomMatch($roomId: String!) {
      checkRoomMatch(roomId: $roomId) {
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

  const roomResult = await callAppSync(checkRoomQuery, { roomId });
  
  if (roomResult?.checkRoomMatch) {
    console.log('✅ MATCH FOUND in room:', roomResult.checkRoomMatch);
    console.log('🎬 Movie:', roomResult.checkRoomMatch.title);
    console.log('👥 Matched Users:', roomResult.checkRoomMatch.matchedUsers);
    console.log('⏰ Created:', roomResult.checkRoomMatch.timestamp);
  } else {
    console.log('❌ No match found in room');
  }

  // Check user matches
  console.log('\n🔍 Checking user matches...');
  
  const userMatchesQuery = `
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
  `;

  const userResult = await callAppSync(userMatchesQuery);
  
  if (userResult?.getMyMatches && userResult.getMyMatches.length > 0) {
    console.log(`✅ Found ${userResult.getMyMatches.length} user matches:`);
    userResult.getMyMatches.forEach((match, index) => {
      console.log(`${index + 1}. ${match.title} (Room: ${match.roomId})`);
      console.log(`   Users: ${match.matchedUsers.join(', ')}`);
      console.log(`   Time: ${match.timestamp}`);
    });
  } else {
    console.log('❌ No user matches found');
  }
}

// Run the check
checkExistingMatch().catch(console.error);