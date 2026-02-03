const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

// Vote Service
class VoteService {
  constructor() {
    this.votesTable = process.env.VOTES_TABLE || '';
    this.matchesTable = process.env.MATCHES_TABLE || '';
    this.roomsTable = process.env.ROOMS_TABLE || '';

    if (!this.votesTable || !this.matchesTable || !this.roomsTable) {
      throw new Error('Required table environment variables are missing');
    }
  }

  async processVote(userId, roomId, movieId, vote) {
    console.log(`Processing vote: User ${userId}, Room ${roomId}, Movie ${movieId}, Vote ${vote}`);

    // Validate room exists and get room details
    const room = await this.getRoom(roomId);
    if (!room) {
      throw new Error('Room not found or has expired');
    }

    // Validate movie is in room candidates
    const movieCandidate = room.candidates.find(c => c.id === movieId);
    if (!movieCandidate) {
      throw new Error('Movie not found in room candidates');
    }

    // Record the vote
    await this.recordVote(userId, roomId, movieId, vote);

    // Check for match if vote is positive
    let match = null;
    if (vote) {
      match = await this.checkForMatch(roomId, movieId, movieCandidate);
    }

    // CRITICAL: Return the exact structure AppSync expects
    const result = {
      success: true,
      match: match || null
    };

    console.log('Vote processing completed:', JSON.stringify(result));
    return result;
  }

  async getRoom(roomId) {
    try {
      const result = await docClient.send(new GetCommand({
        TableName: this.roomsTable,
        Key: { id: roomId },
      }));

      if (!result.Item) {
        return null;
      }

      const room = result.Item;

      // Check if room has expired
      const now = Math.floor(Date.now() / 1000);
      if (room.ttl && room.ttl < now) {
        return null;
      }

      return room;
    } catch (error) {
      console.error('Error getting room:', error);
      return null;
    }
  }

  async recordVote(userId, roomId, movieId, vote) {
    const userMovieId = `${userId}#${movieId}`;
    const timestamp = new Date().toISOString();

    const voteRecord = {
      roomId,
      userMovieId,
      userId,
      movieId,
      vote,
      timestamp,
    };

    await docClient.send(new PutCommand({
      TableName: this.votesTable,
      Item: voteRecord,
    }));

    console.log(`Vote recorded: User ${userId} voted ${vote ? 'YES' : 'NO'} for movie ${movieId} in room ${roomId}`);
  }

  async checkForMatch(roomId, movieId, movieCandidate) {
    try {
      console.log(`Checking for match: Room ${roomId}, Movie ${movieId}`);

      // Get all votes for this movie in this room (excluding participation records)
      const votesResult = await docClient.send(new QueryCommand({
        TableName: this.votesTable,
        KeyConditionExpression: 'roomId = :roomId',
        FilterExpression: 'movieId = :movieId AND vote = :vote AND movieId <> :participationMarker',
        ExpressionAttributeValues: {
          ':roomId': roomId,
          ':movieId': movieId,
          ':vote': true, // Only positive votes
          ':participationMarker': -1, // Exclude participation records
        },
      }));

      const positiveVotes = votesResult.Items || [];
      console.log(`Found ${positiveVotes.length} positive votes for movie ${movieId} in room ${roomId}`);

      // Get all unique users who have voted in this room (excluding participation records)
      const allVotesResult = await docClient.send(new QueryCommand({
        TableName: this.votesTable,
        KeyConditionExpression: 'roomId = :roomId',
        FilterExpression: 'movieId <> :participationMarker', // Exclude participation records
        ExpressionAttributeValues: {
          ':roomId': roomId,
          ':participationMarker': -1,
        },
      }));

      const allVotes = allVotesResult.Items || [];
      const uniqueUsers = new Set(allVotes.map(vote => vote.userId));
      const totalUsers = uniqueUsers.size;

      console.log(`Total unique users who have voted in room: ${totalUsers}`);

      // Check if all users voted positively for this movie
      const positiveUserIds = new Set(positiveVotes.map(vote => vote.userId));
      
      if (positiveUserIds.size === totalUsers && totalUsers > 1) {
        // We have a match! All users voted positively
        console.log(`🎉 MATCH DETECTED! All ${totalUsers} users voted positively for movie ${movieId}`);
        
        // Check if match already exists
        const existingMatch = await this.getExistingMatch(roomId, movieId);
        if (existingMatch) {
          console.log('Match already exists, returning existing match');
          return existingMatch;
        }

        // Create new match
        const match = await this.createMatch(roomId, movieId, movieCandidate, Array.from(positiveUserIds));
        return match;
      }

      console.log(`No match yet. Positive votes: ${positiveUserIds.size}, Total users: ${totalUsers}`);
      return null;

    } catch (error) {
      console.error('Error checking for match:', error);
      return null;
    }
  }

  async getExistingMatch(roomId, movieId) {
    try {
      const result = await docClient.send(new GetCommand({
        TableName: this.matchesTable,
        Key: {
          roomId,
          movieId,
        },
      }));

      return result.Item || null;
    } catch (error) {
      console.error('Error checking existing match:', error);
      return null;
    }
  }

  async createMatch(roomId, movieId, movieCandidate, matchedUsers) {
    const timestamp = new Date().toISOString();
    const matchId = `${roomId}#${movieId}`;

    const match = {
      id: matchId,
      roomId,
      movieId,
      title: movieCandidate.title,
      posterPath: movieCandidate.posterPath || null,
      mediaType: movieCandidate.mediaType,
      matchedUsers,
      timestamp,
    };

    // Store the main match record
    await docClient.send(new PutCommand({
      TableName: this.matchesTable,
      Item: match,
      ConditionExpression: 'attribute_not_exists(roomId) AND attribute_not_exists(movieId)', // Prevent duplicates
    }));

    console.log(`🎉 Match created: ${match.title} in room ${roomId}`);

    // Trigger AppSync subscription
    await this.triggerAppSyncSubscription(match);

    return match;
  }

  async triggerAppSyncSubscription(match) {
    console.log(`🔔 Match created: ${match.title} - Notifications will be handled by polling`);
    // Simplified version - rely on polling for notifications
    // The client-side polling will detect this match
  }


}

// Lambda Handler for AppSync
exports.handler = async (event) => {
  console.log('Vote Lambda received AppSync event:', JSON.stringify(event));

  try {
    // Extract user ID from AppSync context
    const userId = event.identity?.claims?.sub || event.identity?.username;
    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Determine operation from AppSync field name
    const fieldName = event.info?.fieldName;
    console.log('Field name:', fieldName);

    if (fieldName === 'vote') {
      // Get arguments from AppSync
      const input = event.arguments?.input;
      if (!input) {
        throw new Error('Input is required');
      }

      const { roomId, movieId, vote } = input;

      // Validate input
      if (!roomId) {
        throw new Error('Room ID is required');
      }

      if (typeof movieId !== 'number') {
        throw new Error('Movie ID must be a number');
      }

      if (typeof vote !== 'boolean') {
        throw new Error('Vote must be a boolean');
      }

      const voteService = new VoteService();
      const result = await voteService.processVote(userId, roomId, movieId, vote);

      console.log('Returning vote result:', JSON.stringify(result));
      return result;
    } else {
      throw new Error(`Unknown field: ${fieldName}`);
    }

  } catch (error) {
    console.error('Vote Lambda error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    // CRITICAL: Always return a valid VoteResult structure even on error
    return {
      success: false,
      match: null
    };
  }
};