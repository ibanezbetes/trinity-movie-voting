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
  'vote_count.gte'?: number; // Minimum vote count filter
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
  vote_count?: number;
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

// TMDB Client with Smart Random Discovery
class TMDBClient {
  private readonly baseUrl: string;
  private readonly readToken: string;
  private readonly validator: LatinScriptValidator;
  private readonly TARGET_COUNT = 50; // Target number of candidates

  constructor() {
    this.baseUrl = process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
    // Try both TMDB_READ_TOKEN and TMDB_API_KEY for compatibility
    this.readToken = process.env.TMDB_READ_TOKEN || process.env.TMDB_API_KEY || '';
    this.validator = new LatinScriptValidator();
    
    console.log('TMDBClient initializing...');
    console.log('Base URL:', this.baseUrl);
    console.log('Token configured:', this.readToken ? 'YES' : 'NO');
    console.log('Token length:', this.readToken.length);
    console.log('Token first 20 chars:', this.readToken.substring(0, 20));
    console.log('All env vars:', Object.keys(process.env));
    console.log('TMDB env vars:', Object.keys(process.env).filter(key => key.includes('TMDB')));
    
    if (!this.readToken) {
      console.error('Available environment variables:', Object.keys(process.env).filter(key => key.includes('TMDB')));
      throw new Error('TMDB_READ_TOKEN or TMDB_API_KEY environment variable is required');
    }
  }

  /**
   * Smart Random Discovery Algorithm
   * 1. Priority Search (AND logic): All genres must match
   * 2. Fallback Search (OR logic): Any genre can match
   * 3. Random page selection to avoid repetitive content
   * 4. Shuffle final results for variety
   */
  async discoverContent(mediaType: 'MOVIE' | 'TV', genreIds?: number[]): Promise<MovieCandidate[]> {
    try {
      let candidates: MovieCandidate[] = [];
      
      console.log(`Starting Smart Random Discovery for ${mediaType} with genres: ${genreIds?.join(',') || 'none'}`);

      // STEP A: Priority Search (AND Logic for Genres)
      if (genreIds && genreIds.length > 0) {
        console.log('STEP A: Priority search with ALL genres (AND logic)');
        const randomPageA = Math.floor(Math.random() * 20) + 1;
        const strictResults = await this.fetchFromTmdb(mediaType, {
          genreIds,
          logicType: 'AND',
          page: randomPageA
        });
        
        const filteredStrict = this.applyBaseFilters(strictResults, mediaType);
        candidates.push(...filteredStrict);
        console.log(`Priority search found ${filteredStrict.length} candidates (page ${randomPageA})`);
      }

      // STEP B: Fallback Search (OR Logic) if needed
      if (candidates.length < this.TARGET_COUNT && genreIds && genreIds.length > 0) {
        console.log(`STEP B: Fallback search with ANY genre (OR logic) - need ${this.TARGET_COUNT - candidates.length} more`);
        const randomPageB = Math.floor(Math.random() * 20) + 1;
        const looseResults = await this.fetchFromTmdb(mediaType, {
          genreIds,
          logicType: 'OR',
          page: randomPageB
        });
        
        const filteredLoose = this.applyBaseFilters(looseResults, mediaType);
        
        // Add unique items until we reach target
        for (const item of filteredLoose) {
          if (candidates.length >= this.TARGET_COUNT) break;
          if (!candidates.find(c => c.id === item.id)) {
            candidates.push(item);
          }
        }
        console.log(`After fallback search: ${candidates.length} total candidates`);
      }

      // STEP C: General Discovery if still not enough content
      if (candidates.length < this.TARGET_COUNT) {
        console.log(`STEP C: General discovery - need ${this.TARGET_COUNT - candidates.length} more`);
        const randomPageC = Math.floor(Math.random() * 20) + 1;
        const generalResults = await this.fetchFromTmdb(mediaType, {
          page: randomPageC
        });
        
        const filteredGeneral = this.applyBaseFilters(generalResults, mediaType);
        
        // Add unique items until we reach target
        for (const item of filteredGeneral) {
          if (candidates.length >= this.TARGET_COUNT) break;
          if (!candidates.find(c => c.id === item.id)) {
            candidates.push(item);
          }
        }
        console.log(`After general discovery: ${candidates.length} total candidates`);
      }

      // STEP D: Shuffle final results for variety
      const shuffledCandidates = this.shuffleArray(candidates).slice(0, this.TARGET_COUNT);
      console.log(`Final result: ${shuffledCandidates.length} shuffled candidates`);
      
      return shuffledCandidates;

    } catch (error) {
      console.error('Smart Random Discovery Error:', error);
      throw new Error(`Smart Random Discovery failed: ${error}`);
    }
  }

  /**
   * Fetch content from TMDB with specified parameters
   */
  private async fetchFromTmdb(
    mediaType: 'MOVIE' | 'TV', 
    options: {
      genreIds?: number[];
      logicType?: 'AND' | 'OR';
      page?: number;
    } = {}
  ): Promise<TMDBMovieResponse[]> {
    const { genreIds, logicType, page = 1 } = options;
    const endpoint = mediaType === 'MOVIE' ? '/discover/movie' : '/discover/tv';
    
    const params: TMDBDiscoveryParams = {
      page,
      language: 'es-ES', // Default language
      sort_by: 'popularity.desc',
      include_adult: false,
      with_original_language: 'en|es|fr|it|de|pt', // Western languages only
      'vote_count.gte': 100, // Minimum 100 votes to avoid garbage content
    };

    // Add genre filter based on logic type
    if (genreIds && genreIds.length > 0) {
      if (logicType === 'OR') {
        params.with_genres = genreIds.join('|'); // OR logic: any genre matches
      } else {
        params.with_genres = genreIds.join(','); // AND logic: all genres must match
      }
    }

    console.log(`Fetching from TMDB ${endpoint} with params:`, JSON.stringify(params));

    const response = await axios.get(`${this.baseUrl}${endpoint}`, {
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${this.readToken}`
      },
      params
    });

    const results: TMDBMovieResponse[] = response.data.results || [];
    console.log(`TMDB returned ${results.length} raw results for page ${page}`);
    
    return results;
  }

  /**
   * Apply base quality filters to TMDB results
   */
  private applyBaseFilters(results: TMDBMovieResponse[], mediaType: 'MOVIE' | 'TV'): MovieCandidate[] {
    const candidates: MovieCandidate[] = [];

    for (const item of results) {
      try {
        // Extract title (movies use 'title', TV shows use 'name')
        const title = item.title || item.name || '';
        const overview = item.overview || '';
        
        // Base quality filters
        if (!item.poster_path) {
          console.log(`Filtered out item without poster: "${title}"`);
          continue;
        }
        
        if (!overview || overview.trim() === '') {
          console.log(`Filtered out item without overview: "${title}"`);
          continue;
        }

        // Vote count filter (additional safety check)
        if (item.vote_count && item.vote_count < 100) {
          console.log(`Filtered out low-vote item: "${title}" (${item.vote_count} votes)`);
          continue;
        }

        // Language filter - ensure Western languages only
        const allowedLanguages = ['en', 'es', 'fr', 'it', 'de', 'pt'];
        if (!allowedLanguages.includes(item.original_language)) {
          console.log(`Filtered out non-Western language: "${title}" (${item.original_language})`);
          continue;
        }
        
        // Apply Latin Script Validator
        if (!this.validator.validateContent(title, overview)) {
          console.log(`Filtered out non-Latin content: "${title}"`);
          continue;
        }

        // Extract release date
        const releaseDate = item.release_date || item.first_air_date || '';
        
        // Transform to our format
        const candidate: MovieCandidate = {
          id: item.id,
          title,
          overview,
          posterPath: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
          releaseDate,
          mediaType: mediaType === 'MOVIE' ? 'MOVIE' : 'TV',
        };

        candidates.push(candidate);

      } catch (error) {
        console.error(`Error processing TMDB item ${item.id}:`, error);
        // Continue processing other items
      }
    }

    return candidates;
  }

  /**
   * Shuffle array using Fisher-Yates algorithm
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Legacy method for backward compatibility (deprecated)
  async discoverContentLegacy(mediaType: 'MOVIE' | 'TV', genreIds?: number[], page = 1): Promise<MovieCandidate[]> {
    console.warn('Using legacy discoverContentLegacy method - consider upgrading to discoverContent');
    return this.discoverContent(mediaType, genreIds);
  }
}

// Lambda Handler
export const handler: Handler<TMDBEvent, TMDBResponse> = async (event) => {
  console.log('TMDB Lambda received event:', JSON.stringify(event));

  try {
    const { mediaType, genreIds } = event;

    // Validate input
    if (!mediaType || !['MOVIE', 'TV'].includes(mediaType)) {
      console.error('Invalid mediaType:', mediaType);
      throw new Error('Invalid mediaType. Must be MOVIE or TV');
    }

    // Validate genre limit (max 2 as per master spec)
    if (genreIds && genreIds.length > 2) {
      console.error('Too many genres:', genreIds.length);
      throw new Error('Maximum 2 genres allowed');
    }

    // Check environment variables
    const tmdbReadToken = process.env.TMDB_READ_TOKEN || process.env.TMDB_API_KEY || '';
    if (!tmdbReadToken) {
      console.error('TMDB token not found in environment variables');
      console.error('Available env vars:', Object.keys(process.env).filter(key => key.includes('TMDB')));
      throw new Error('TMDB API token not configured');
    }

    console.log('TMDB token configured, length:', tmdbReadToken.length);

    const tmdbClient = new TMDBClient();
    
    // Use Smart Random Discovery algorithm
    console.log('Using Smart Random Discovery algorithm');
    const candidates = await tmdbClient.discoverContent(mediaType, genreIds);

    console.log(`Smart Random Discovery returned ${candidates.length} candidates`);

    return {
      statusCode: 200,
      body: {
        candidates,
        totalResults: candidates.length,
        page: 1, // Page is now abstracted in Smart Random Discovery
      },
    };

  } catch (error) {
    console.error('TMDB Lambda error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Environment variables:', {
      TMDB_API_KEY: process.env.TMDB_API_KEY ? 'SET' : 'NOT SET',
      TMDB_READ_TOKEN: process.env.TMDB_READ_TOKEN ? 'SET' : 'NOT SET',
      TMDB_BASE_URL: process.env.TMDB_BASE_URL || 'NOT SET'
    });
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return {
      statusCode: 500,
      body: {
        candidates: [],
        totalResults: 0,
        page: 1,
        error: errorMessage,
      },
    };
  }
};