import { Handler } from 'aws-lambda';
import axios from 'axios';

// Types
interface TMDBDiscoveryParams {
  page: number;
  with_genres?: string;
  language: string;
  region?: string;
  sort_by: string;
  include_adult: boolean;
  with_original_language: string; // Western languages only
}

interface TMDBMovieResponse {
  id: number;
  title?: string;
  name?: string; // TV shows use 'name' instead of 'title'
  overview: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string; // TV shows use 'first_air_date'
  genre_ids: number[];
  original_language: string;
  media_type?: 'movie' | 'tv';
}

interface MovieCandidate {
  id: number;
  title: string;
  overview: string;
  posterPath: string | null;
  releaseDate: string;
  mediaType: 'MOVIE' | 'TV';
}

interface TMDBEvent {
  mediaType: 'MOVIE' | 'TV';
  genreIds?: number[];
  page?: number;
}

interface TMDBResponse {
  statusCode: number;
  body: {
    candidates: MovieCandidate[];
    totalResults: number;
    page: number;
  };
}

// Latin Script Validator
class LatinScriptValidator {
  // Regex to match Latin characters, numbers, punctuation, and common accents
  // Excludes CJK (Chinese/Japanese/Korean) and Cyrillic characters
  private readonly latinScriptRegex = /^[\u0000-\u007F\u00A0-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF\s\p{P}\p{N}]*$/u;
  
  validateContent(title: string, overview: string): boolean {
    return this.isLatinScript(title) && this.isLatinScript(overview);
  }
  
  isLatinScript(text: string): boolean {
    if (!text || text.trim() === '') return false;
    return this.latinScriptRegex.test(text);
  }
}

// TMDB Client
class TMDBClient {
  private readonly baseUrl: string;
  private readonly readToken: string;
  private readonly validator: LatinScriptValidator;

  constructor() {
    this.baseUrl = process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
    this.readToken = process.env.TMDB_READ_TOKEN || '';
    this.validator = new LatinScriptValidator();
    
    if (!this.readToken) {
      throw new Error('TMDB_READ_TOKEN environment variable is required');
    }
  }

  async discoverContent(mediaType: 'MOVIE' | 'TV', genreIds?: number[], page = 1): Promise<MovieCandidate[]> {
    try {
      const endpoint = mediaType === 'MOVIE' ? '/discover/movie' : '/discover/tv';
      
      const params: TMDBDiscoveryParams = {
        page,
        language: 'es-ES', // Default language
        sort_by: 'popularity.desc',
        include_adult: false,
        with_original_language: 'en|es|fr|it|de|pt', // Western languages only - NO ja,ko
      };

      // Add genre filter if provided
      if (genreIds && genreIds.length > 0) {
        params.with_genres = genreIds.join(',');
      }

      console.log(`Querying TMDB ${endpoint} with params:`, JSON.stringify(params));

      const response = await axios.get(`${this.baseUrl}${endpoint}`, {
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${this.readToken}`
        },
        params
      });

      const results: TMDBMovieResponse[] = response.data.results || [];
      console.log(`TMDB returned ${results.length} raw results`);

      // Apply Latin Script Validator and media type enforcement
      const filteredCandidates = this.filterAndTransformResults(results, mediaType);
      
      console.log(`After filtering: ${filteredCandidates.length} candidates`);
      return filteredCandidates;

    } catch (error) {
      console.error('TMDB API Error:', error);
      if (axios.isAxiosError(error)) {
        console.error('Response data:', error.response?.data);
        console.error('Response status:', error.response?.status);
      }
      throw new Error(`TMDB API request failed: ${error}`);
    }
  }

  private filterAndTransformResults(results: TMDBMovieResponse[], expectedMediaType: 'MOVIE' | 'TV'): MovieCandidate[] {
    const candidates: MovieCandidate[] = [];

    for (const item of results) {
      try {
        // Extract title (movies use 'title', TV shows use 'name')
        const title = item.title || item.name || '';
        const overview = item.overview || '';
        
        // Apply Latin Script Validator
        if (!this.validator.validateContent(title, overview)) {
          console.log(`Filtered out non-Latin content: "${title}"`);
          continue;
        }

        // Media type enforcement - crucial check from master spec
        const actualMediaType = expectedMediaType; // We query the correct endpoint, so type matches
        
        // Extract release date
        const releaseDate = item.release_date || item.first_air_date || '';
        
        // Transform to our format
        const candidate: MovieCandidate = {
          id: item.id,
          title,
          overview,
          posterPath: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
          releaseDate,
          mediaType: actualMediaType,
        };

        candidates.push(candidate);

      } catch (error) {
        console.error(`Error processing TMDB item ${item.id}:`, error);
        // Continue processing other items
      }
    }

    return candidates;
  }
}

// Lambda Handler
export const handler: Handler<TMDBEvent, TMDBResponse> = async (event) => {
  console.log('TMDB Lambda received event:', JSON.stringify(event));

  try {
    const { mediaType, genreIds, page = 1 } = event;

    // Validate input
    if (!mediaType || !['MOVIE', 'TV'].includes(mediaType)) {
      throw new Error('Invalid mediaType. Must be MOVIE or TV');
    }

    // Validate genre limit (max 2 as per master spec)
    if (genreIds && genreIds.length > 2) {
      throw new Error('Maximum 2 genres allowed');
    }

    const tmdbClient = new TMDBClient();
    const candidates = await tmdbClient.discoverContent(mediaType, genreIds, page);

    // Quality over quantity - return what we have, don't try to fill gaps
    console.log(`Returning ${candidates.length} filtered candidates`);

    return {
      statusCode: 200,
      body: {
        candidates,
        totalResults: candidates.length,
        page,
      },
    };

  } catch (error) {
    console.error('TMDB Lambda error:', error);
    
    return {
      statusCode: 500,
      body: {
        candidates: [],
        totalResults: 0,
        page: 1,
      },
    };
  }
};