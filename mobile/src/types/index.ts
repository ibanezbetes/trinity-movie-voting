// Trinity App Types

export interface Room {
  id: string;
  code: string;
  hostId: string;
  mediaType: 'MOVIE' | 'TV' | 'BOTH';
  genreIds: number[];
  candidates: MovieCandidate[];
  createdAt: string;
  maxParticipants: number;
  yearRange?: { min: number; max: number };
  platformIds?: number[]; // IDs de plataformas de streaming
}

export interface MovieCandidate {
  id: number;
  title: string;
  overview: string;
  posterPath: string | null;
  releaseDate: string;
  mediaType: 'MOVIE' | 'TV' | 'BOTH';
  trailerKey?: string; // YouTube trailer key (optional)
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
  mediaType: 'MOVIE' | 'TV' | 'BOTH';
  genreIds: number[];
  maxParticipants: number;
  yearRange?: { min: number; max: number };
  platformIds?: number[]; // IDs de plataformas de streaming
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
  JoinRoom: { initialRoomCode?: string } | undefined;
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
  isSpecial?: boolean; // Para género especial "Cualquier género"
}

// ID especial para género (negativo para no confundir con IDs de TMDB)
export const SPECIAL_GENRE_IDS = {
  ANY: -2,       // Cualquier género
};

export const MOVIE_GENRES: Genre[] = [
  { id: SPECIAL_GENRE_IDS.ANY, name: 'Cualquier género', isSpecial: true },
  { id: 28, name: 'Acción' },
  { id: 12, name: 'Aventura' },
  { id: 16, name: 'Animación' },
  { id: 35, name: 'Comedia' },
  { id: 80, name: 'Crimen' },
  { id: 99, name: 'Documental' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Familiar' },
  { id: 14, name: 'Fantasía' },
  { id: 36, name: 'Historia' },
  { id: 27, name: 'Terror' },
  { id: 10402, name: 'Música' },
  { id: 9648, name: 'Misterio' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Ciencia Ficción' },
  { id: 10770, name: 'Película de TV' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'Guerra' },
  { id: 37, name: 'Western' }
];

export const TV_GENRES: Genre[] = [
  { id: SPECIAL_GENRE_IDS.ANY, name: 'Cualquier género', isSpecial: true },
  { id: 10759, name: 'Acción y Aventura' },
  { id: 16, name: 'Animación' },
  { id: 35, name: 'Comedia' },
  { id: 80, name: 'Crimen' },
  { id: 99, name: 'Documental' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Familiar' },
  { id: 10762, name: 'Infantil' },
  { id: 9648, name: 'Misterio' },
  { id: 10763, name: 'Noticias' },
  { id: 10764, name: 'Reality' },
  { id: 10765, name: 'Ciencia Ficción y Fantasía' },
  { id: 10766, name: 'Telenovela' },
  { id: 10767, name: 'Talk Show' },
  { id: 10768, name: 'Guerra y Política' },
  { id: 37, name: 'Western' }
];

// Combined genres for BOTH (movies and TV shows)
// Using genres that exist in both TMDB movie and TV APIs
export const COMBINED_GENRES: Genre[] = [
  { id: SPECIAL_GENRE_IDS.ANY, name: 'Cualquier género', isSpecial: true },
  { id: 28, name: 'Acción' },
  { id: 12, name: 'Aventura' },
  { id: 16, name: 'Animación' },
  { id: 35, name: 'Comedia' },
  { id: 80, name: 'Crimen' },
  { id: 99, name: 'Documental' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Familiar' },
  { id: 14, name: 'Fantasía' },
  { id: 27, name: 'Terror' },
  { id: 9648, name: 'Misterio' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Ciencia Ficción' },
  { id: 53, name: 'Thriller' },
  { id: 37, name: 'Western' }
];

// Streaming Platforms (TMDB Watch Provider IDs for Spain)
export interface StreamingPlatform {
  id: number;
  name: string;
  logo: any; // require() image
}

export const STREAMING_PLATFORMS: StreamingPlatform[] = [
  { id: 8, name: 'Netflix', logo: require('../../assets/platforms/netflix.png') },
  { id: 119, name: 'Prime Video', logo: require('../../assets/platforms/primevideo.png') },
  { id: 337, name: 'Disney+', logo: require('../../assets/platforms/disney.png') },
  { id: 1899, name: 'Max', logo: require('../../assets/platforms/hbomax.png') },
  { id: 149, name: 'Movistar+', logo: require('../../assets/platforms/movistar.png') },
  { id: 350, name: 'Apple TV+', logo: require('../../assets/platforms/appletv.png') },
  { id: 63, name: 'Filmin', logo: require('../../assets/platforms/filmin.png') },
];