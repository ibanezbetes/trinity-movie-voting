const { Amplify } = require('aws-amplify');
const { generateClient } = require('aws-amplify/api');
const { signIn, getCurrentUser, fetchAuthSession } = require('aws-amplify/auth');

// Configure Amplify with the same settings as the mobile app
const amplifyConfig = {
  aws_project_region: 'eu-west-1',
  aws_appsync_graphqlEndpoint: 'https://nvokqs473bbfdizeq4n5oosjpy.appsync-api.eu-west-1.amazonaws.com/graphql',
  aws_appsync_region: 'eu-west-1',
  aws_appsync_authenticationType: 'AMAZON_COGNITO_USER_POOLS',
  aws_appsync_realtimeEndpoint: 'wss://nvokqs473bbfdizeq4n5oosjpy.appsync-realtime-api.eu-west-1.amazonaws.com/graphql',
  aws_cognito_region: 'eu-west-1',
  aws_user_pools_id: 'eu-west-1_RPkdnO7Ju',
  aws_user_pools_web_client_id: '61nf41i2bff1c4oc4qo9g36m1k',
};

Amplify.configure(amplifyConfig);

const client = generateClient({
  authMode: 'userPool',
});

async function verifyAuthenticationStatus() {
  console.log('\n🔐 Verifying current authentication status...');
  
  try {
    const user = await getCurrentUser();
    console.log('✅ User is authenticated:');
    console.log(`   User ID: ${user.userId}`);
    console.log(`   Username: ${user.username}`);
    
    const session = await fetchAuthSession();
    console.log('✅ Session is valid:');
    console.log(`   Access Token: ${session.tokens?.accessToken ? 'Present' : 'Missing'}`);
    console.log(`   ID Token: ${session.tokens?.idToken ? 'Present' : 'Missing'}`);
    
    return true;
  } catch (error) {
    console.log('❌ User not authenticated:', error.message);
    return false;
  }
}

async function checkMatchesWithUserAuth() {
  console.log('🔐 Starting user-authenticated match verification...');
  
  // Check if credentials are provided via environment variables
  const username = process.env.COGNITO_USERNAME;
  const password = process.env.COGNITO_PASSWORD;
  
  if (!username || !password) {
    console.log('\n⚠️  CREDENTIALS REQUIRED:');
    console.log('Set environment variables:');
    console.log('  COGNITO_USERNAME=your-username');
    console.log('  COGNITO_PASSWORD=your-password');
    console.log('\nExample:');
    console.log('  set COGNITO_USERNAME=your-email@example.com');
    console.log('  set COGNITO_PASSWORD=your-password');
    console.log('  node check-matches-with-user-auth.js');
    console.log('\n💡 Alternative: Use the mobile app to check matches');
    console.log('💡 The mobile app is already authenticated and should show matches');
    return;
  }
  
  try {
    console.log(`🔐 Authenticating user: ${username}`);
    
    const signInResult = await signIn({
      username: username,
      password: password,
    });
    
    if (signInResult.isSignedIn) {
      console.log('✅ Successfully authenticated with Cognito User Pool');
      
      // Verify authentication status
      await verifyAuthenticationStatus();
      
      // Now we can make authenticated queries using the same auth as mobile app
      console.log('\n📱 Using same authentication method as mobile app...');
      await checkUserMatches();
      await checkRoomMatch();
      
    } else {
      console.log('❌ Authentication incomplete - may require additional steps');
      console.log('SignIn result:', signInResult);
    }
  } catch (error) {
    console.error('❌ Authentication error:', error.message || error);
    
    if (error.name === 'NotAuthorizedException') {
      console.log('\n💡 Check your username and password');
    } else if (error.name === 'UserNotConfirmedException') {
      console.log('\n💡 User account needs to be confirmed');
    } else if (error.name === 'PasswordResetRequiredException') {
      console.log('\n💡 Password reset required');
    }
  }
}

async function checkUserMatches() {
  console.log('\n🔍 Checking user matches with proper Cognito authentication...');
  
  try {
    const response = await client.graphql({
      query: `
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
      `,
      authMode: 'userPool',
    });

    const matches = response.data.getMyMatches || [];
    
    if (matches.length > 0) {
      console.log(`✅ Found ${matches.length} user matches:`);
      matches.forEach((match, index) => {
        console.log(`\n${index + 1}. "${match.title}"`);
        console.log(`   Match ID: ${match.id}`);
        console.log(`   Room ID: ${match.roomId}`);
        console.log(`   Movie ID: ${match.movieId}`);
        console.log(`   Users: ${match.matchedUsers.join(', ')}`);
        console.log(`   Timestamp: ${match.timestamp}`);
        
        // Check if this is the room we're testing
        if (match.roomId === '89ff9ad2-ceb3-4e74-9e12-07b77be1cc00') {
          console.log(`   🎯 THIS IS THE TEST ROOM (LHVFZZ)!`);
        }
      });
      
      // Check specifically for the test room
      const testRoomMatch = matches.find(m => m.roomId === '89ff9ad2-ceb3-4e74-9e12-07b77be1cc00');
      if (testRoomMatch) {
        console.log(`\n🎉 CONFIRMED: Match exists in test room LHVFZZ`);
        console.log(`   Movie: ${testRoomMatch.title} (ID: ${testRoomMatch.movieId})`);
        console.log(`   This explains why mobile should show the match!`);
      } else {
        console.log(`\n❌ No match found in test room 89ff9ad2-ceb3-4e74-9e12-07b77be1cc00`);
      }
      
    } else {
      console.log('❌ No user matches found');
      console.log('   This could mean:');
      console.log('   - User hasn\'t participated in any matches yet');
      console.log('   - Matches exist but user auth is different');
      console.log('   - Backend match creation failed');
    }
  } catch (error) {
    console.error('❌ Error checking user matches:', error.message || error);
    
    if (error.message?.includes('UnauthorizedException')) {
      console.log('💡 Authentication issue - check if user session is valid');
    } else if (error.message?.includes('AccessDeniedException')) {
      console.log('💡 Permission issue - check IAM policies for user pool access');
    }
  }
}

async function checkRoomMatch() {
  console.log('\n🔍 Checking specific room match with user authentication...');
  
  const roomId = '89ff9ad2-ceb3-4e74-9e12-07b77be1cc00';
  const roomCode = 'LHVFZZ';
  
  console.log(`   Room ID: ${roomId}`);
  console.log(`   Room Code: ${roomCode}`);
  
  try {
    // First, try to get room information
    console.log('\n📋 Checking if room exists...');
    const roomResponse = await client.graphql({
      query: `
        query GetRoom($id: ID!) {
          getRoom(id: $id) {
            id
            code
            mediaType
            genreIds
            maxUsers
            createdAt
            candidates {
              id
              title
            }
          }
        }
      `,
      variables: { id: roomId },
      authMode: 'userPool',
    });

    const room = roomResponse.data.getRoom;
    if (room) {
      console.log(`✅ Room exists:`);
      console.log(`   Code: ${room.code}`);
      console.log(`   Media Type: ${room.mediaType}`);
      console.log(`   Max Users: ${room.maxUsers}`);
      console.log(`   Candidates: ${room.candidates?.length || 0} movies`);
      console.log(`   Created: ${room.createdAt}`);
    } else {
      console.log(`❌ Room not found - may have been deleted after match`);
      console.log(`   This is normal behavior when a match is found`);
    }

    // Now check for matches using the checkRoomMatch query
    console.log('\n🎯 Checking for room match...');
    const matchResponse = await client.graphql({
      query: `
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
      `,
      variables: { roomId },
      authMode: 'userPool',
    });

    const match = matchResponse.data.checkRoomMatch;
    
    if (match) {
      console.log('🎉 ROOM MATCH FOUND:');
      console.log(`   Match ID: ${match.id}`);
      console.log(`   Title: ${match.title}`);
      console.log(`   Movie ID: ${match.movieId}`);
      console.log(`   Users: ${match.matchedUsers.join(', ')}`);
      console.log(`   Timestamp: ${match.timestamp}`);
      console.log(`   Poster: ${match.posterPath || 'N/A'}`);
      
      console.log('\n✅ VERIFICATION SUCCESSFUL:');
      console.log('   - Backend successfully created the match');
      console.log('   - Match is accessible via user authentication');
      console.log('   - Mobile app should be able to retrieve this match');
      
    } else {
      console.log('❌ No match found in room');
      console.log('   Possible reasons:');
      console.log('   - Match hasn\'t been created yet');
      console.log('   - Users haven\'t voted on the same movie');
      console.log('   - Match was created but not accessible to this user');
    }
    
  } catch (error) {
    console.error('❌ Error checking room match:', error.message || error);
    
    if (error.message?.includes('Room not found')) {
      console.log('💡 Room may have been deleted after match creation');
      console.log('💡 This is expected behavior - check getMyMatches instead');
    }
  }
}

// Run the check
checkMatchesWithUserAuth().catch(console.error);