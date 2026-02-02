// GraphQL Queries and Mutations for Trinity App

export const CREATE_ROOM = `
  mutation CreateRoom($input: CreateRoomInput!) {
    createRoom(input: $input) {
      id
      code
      hostId
      mediaType
      genreIds
      createdAt
    }
  }
`;

export const JOIN_ROOM = `
  mutation JoinRoom($code: String!) {
    joinRoom(code: $code) {
      id
      code
      hostId
      mediaType
      genreIds
      candidates {
        id
        title
        overview
        posterPath
        releaseDate
        mediaType
      }
      createdAt
    }
  }
`;

export const GET_ROOM = `
  query GetRoom($id: String!) {
    getRoom(id: $id) {
      id
      code
      hostId
      mediaType
      genreIds
      candidates {
        id
        title
        overview
        posterPath
        releaseDate
        mediaType
      }
      createdAt
    }
  }
`;

export const VOTE = `
  mutation Vote($input: VoteInput!) {
    vote(input: $input) {
      success
      match {
        id
        roomId
        movieId
        title
        posterPath
        timestamp
      }
    }
  }
`;

export const GET_MATCHES = `
  query GetMatches {
    getMyMatches {
      id
      roomId
      movieId
      title
      posterPath
      timestamp
    }
  }
`;