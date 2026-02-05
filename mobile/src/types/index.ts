// Trinity App Types

export interface Room {
  id: string;
  code: string;
  hostId: string;
  mediaType: 'MOVIE' | 'TV';
  genreIds: number[];
  candidates: MovieCandidate[];
  createdAt: string;
}

export interface MovieCandidate {
  id: number;
  title: string;
  overview: string;
  posterPath: string | null;
  releaseDate: string;
  mediaType: 'MOVIE' | 'TV';
}

export interface Match {
  id: string;
  roomId: string;
  movieId: number;
  title: string;
  posterPath?: string;
  timestamp: string;
  matchedUsers?: string[];
}

export interface CreateRoomInput {
  mediaType: 'MOVIE' | 'TV';
  genreIds: number[];
}

export interface VoteInput {
  roomId: string;
  movieId: number;
  vote: boolean;
}

export interface VoteResult {
  success: boolean;
  match?: Match;
}

// Navigation Types
export type RootStackParamList = {
  Dashboard: undefined;
  CreateRoom: undefined;
  JoinRoom: undefined;
  VotingRoom: { roomId: string; roomCode: string };
  MyRooms: undefined;
  MyMatches: undefined;
  Recommendations: undefined;
  Profile: undefined;
  MatchCelebration: { match: Match; wasInRoom: boolean };
};

// Genre Types (TMDB Genre IDs)
export interface Genre {
  id: number;
  name: string;
}

export const MOVIE_GENRES: Genre[] = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 14, name: 'Fantasy' },
  { id: 36, name: 'History' },
  { id: 27, name: 'Horror' },
  { id: 10402, name: 'Music' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Science Fiction' },
  { id: 10770, name: 'TV Movie' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'War' },
  { id: 37, name: 'Western' }
];

export const TV_GENRES: Genre[] = [
  { id: 10759, name: 'Action & Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 99, name: 'Documentary' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 10762, name: 'Kids' },
  { id: 9648, name: 'Mystery' },
  { id: 10763, name: 'News' },
  { id: 10764, name: 'Reality' },
  { id: 10765, name: 'Sci-Fi & Fantasy' },
  { id: 10766, name: 'Soap' },
  { id: 10767, name: 'Talk' },
  { id: 10768, name: 'War & Politics' },
  { id: 37, name: 'Western' }
];