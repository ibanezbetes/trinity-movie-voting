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
  genreIds?: number[]; // Store genre IDs for prioritization
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
   * Smart Random Discovery Algorithm (Enhanced with Strict Priority)
   * 1. Phase 1: Check total results with STRICT (AND) logic
   * 2. If total_results >= 50: Use only AND logic (prioritize intersection)
   * 3. If total_results < 50: Fallback to OR logic (broader search)
   * 4. Fetch from random pages to ensure variety
   * 5. Shuffle final results for maximum randomness
   */
  async discoverContent(mediaType: 'MOVIE' | 'TV', genreIds?: number[]): Promise<MovieCandidate[]> {
    const candidatesMap = new Map<number, MovieCandidate>(); // Use Map to prevent duplicates
    const MIN_RESULTS_THRESHOLD = 50; // Minimum results to use strict AND logic
    
    try {
      console.log(`Starting Smart Random Discovery for ${mediaType} with genres: ${genreIds?.join(',') || 'none'}`);

      let useStrictLogic = false;
      let totalAvailableResults = 0;
      let totalAvailablePages = 1;

      // PHASE 1: CHECK AVAILABILITY WITH STRICT (AND) LOGIC
      if (genreIds && genreIds.length > 1) {
        console.log('PHASE 1: Checking availability with STRICT (AND) logic');
        
        // First, check how many results exist with strict AND logic
        const checkResponse = await this.fetchFromTmdbWithMetadata(mediaType, {
          genreIds,
          logicType: 'AND',
          page: 1
        });
        
        totalAvailableResults = checkResponse.total_results;
        totalAvailablePages = checkResponse.total_pages;
        
        console.log(`  → Strict AND search found ${totalAvailableResults} total results across ${totalAvailablePages} pages`);
        
        // Decide strategy based on available results
        if (totalAvailableResults >= MIN_RESULTS_THRESHOLD) {
          useStrictLogic = true;
          console.log(`  ✅ Using STRICT (AND) logic - sufficient results available`);
        } else {
          useStrictLogic = false;
          console.log(`  ⚠️ Using FALLBACK (OR) logic - only ${totalAvailableResults} strict results available`);
        }
      } else if (genreIds && genreIds.length === 1) {
        // Single genre always uses AND (which is the same as OR for one genre)
        useStrictLogic = true;
        console.log('Single genre selected - using standard logic');
      }

      // PHASE 2: FETCH CONTENT BASED ON CHOSEN STRATEGY
      const logicType = useStrictLogic ? 'AND' : 'OR';
      console.log(`PHASE 2: Fetching content with ${logicType} logic`);

      // If we're using strict logic and checked availability, use those results
      if (useStrictLogic && genreIds && genreIds.length > 1) {
        // Re-fetch with metadata to get total pages for random selection
        const metadataResponse = await this.fetchFromTmdbWithMetadata(mediaType, {
          genreIds,
          logicType: 'AND',
          page: 1
        });
        
        totalAvailablePages = Math.min(metadataResponse.total_pages, 500); // TMDB limits to 500 pages
        
        // Fetch from multiple random pages to reach target
        const pagesToFetch = Math.min(3, totalAvailablePages); // Fetch up to 3 random pages
        console.log(`  → Fetching from ${pagesToFetch} random pages (out of ${totalAvailablePages} available)`);
        
        for (let i = 0; i < pagesToFetch && candidatesMap.size < this.TARGET_COUNT; i++) {
          const randomPage = Math.floor(Math.random() * totalAvailablePages) + 1;
          console.log(`  → Fetching page ${randomPage} with AND logic`);
          
          const results = await this.fetchFromTmdb(mediaType, {
            genreIds,
            logicType: 'AND',
            page: randomPage
          });
          
          const filtered = this.applyBaseFilters(results, mediaType);
          filtered.forEach(candidate => {
            if (candidatesMap.size < this.TARGET_COUNT) {
              candidatesMap.set(candidate.id, candidate);
            }
          });
          
          console.log(`  → Added ${filtered.length} candidates (total: ${candidatesMap.size})`);
        }
      } else if (!useStrictLogic && genreIds && genreIds.length > 1) {
        // Using OR logic fallback
        const metadataResponse = await this.fetchFromTmdbWithMetadata(mediaType, {
          genreIds,
          logicType: 'OR',
          page: 1
        });
        
        totalAvailablePages = Math.min(metadataResponse.total_pages, 500);
        
        // Fetch from multiple random pages
        const pagesToFetch = Math.min(3, totalAvailablePages);
        console.log(`  → Fetching from ${pagesToFetch} random pages with OR logic`);
        
        for (let i = 0; i < pagesToFetch && candidatesMap.size < this.TARGET_COUNT; i++) {
          const randomPage = Math.floor(Math.random() * totalAvailablePages) + 1;
          console.log(`  → Fetching page ${randomPage} with OR logic`);
          
          const results = await this.fetchFromTmdb(mediaType, {
            genreIds,
            logicType: 'OR',
            page: randomPage
          });
          
          const filtered = this.applyBaseFilters(results, mediaType);
          
          // When using OR logic, prioritize movies that match ALL genres
          const prioritized = this.prioritizeMultiGenreMatches(filtered, genreIds);
          
          prioritized.forEach(candidate => {
            if (candidatesMap.size < this.TARGET_COUNT) {
              candidatesMap.set(candidate.id, candidate);
            }
          });
          
          console.log(`  → Added ${prioritized.length} candidates (total: ${candidatesMap.size})`);
        }
      } else {
        // No genres or single genre - standard fetch
        const randomPage = Math.floor(Math.random() * 50) + 1;
        console.log(`  → Fetching page ${randomPage} (no genre filter or single genre)`);
        
        const results = await this.fetchFromTmdb(mediaType, {
          genreIds,
          page: randomPage
        });
        
        const filtered = this.applyBaseFilters(results, mediaType);
        filtered.forEach(candidate => candidatesMap.set(candidate.id, candidate));
        
        console.log(`  → Added ${filtered.length} candidates`);
      }

      // PHASE 3: ADDITIONAL FETCHES IF NEEDED
      let fetchAttempts = 0;
      const maxAttempts = 3;
      
      while (candidatesMap.size < this.TARGET_COUNT && fetchAttempts < maxAttempts) {
        fetchAttempts++;
        const needed = this.TARGET_COUNT - candidatesMap.size;
        console.log(`PHASE 3 (Attempt ${fetchAttempts}): Need ${needed} more candidates`);
        
        const randomPage = Math.floor(Math.random() * 50) + 1;
        const results = await this.fetchFromTmdb(mediaType, {
          genreIds: genreIds && genreIds.length > 0 ? genreIds : undefined,
          logicType: genreIds && genreIds.length > 1 ? logicType : undefined,
          page: randomPage
        });
        
        const filtered = this.applyBaseFilters(results, mediaType);
        
        let addedCount = 0;
        filtered.forEach(candidate => {
          if (candidatesMap.size < this.TARGET_COUNT && !candidatesMap.has(candidate.id)) {
            candidatesMap.set(candidate.id, candidate);
            addedCount++;
          }
        });
        
        console.log(`  → Added ${addedCount} new candidates (total: ${candidatesMap.size})`);
        
        if (addedCount === 0) break;
      }

      // PHASE 4: SHUFFLE - Fisher-Yates shuffle for maximum randomness
      const candidatesArray = Array.from(candidatesMap.values());
      const shuffledCandidates = this.shuffleArray(candidatesArray);
      const finalCandidates = shuffledCandidates.slice(0, this.TARGET_COUNT);
      
      console.log(`✅ Smart Random Discovery complete: ${finalCandidates.length} candidates (target: ${this.TARGET_COUNT})`);
      console.log(`   Strategy: ${useStrictLogic ? 'STRICT (AND)' : 'FALLBACK (OR)'}, Total available: ${totalAvailableResults}`);
      
      return finalCandidates;

    } catch (error) {
      console.error('❌ Smart Random Discovery Error:', error);
      const fallbackCandidates = Array.from(candidatesMap.values());
      console.log(`   Returning ${fallbackCandidates.length} candidates as fallback`);
      return fallbackCandidates;
    }
  }

  /**
   * Prioritize candidates that match ALL selected genres (for OR searches)
   */
  private prioritizeMultiGenreMatches(candidates: MovieCandidate[], selectedGenreIds: number[]): MovieCandidate[] {
    // Sort candidates: those matching ALL genres first, then others
    return candidates.sort((a, b) => {
      const aMatchesAll = selectedGenreIds.every(genreId => a.genreIds?.includes(genreId));
      const bMatchesAll = selectedGenreIds.every(genreId => b.genreIds?.includes(genreId));
      
      // If both match all or both don't, maintain original order
      if (aMatchesAll === bMatchesAll) return 0;
      
      // Put items matching all genres first
      return aMatchesAll ? -1 : 1;
    });
  }

  /**
   * Fetch content from TMDB with specified parameters (returns only results)
   */
  private async fetchFromTmdb(
    mediaType: 'MOVIE' | 'TV', 
    options: {
      genreIds?: number[];
      logicType?: 'AND' | 'OR';
      page?: number;
    } = {}
  ): Promise<TMDBMovieResponse[]> {
    const response = await this.fetchFromTmdbWithMetadata(mediaType, options);
    return response.results;
  }

  /**
   * Fetch content from TMDB with metadata (total_results, total_pages)
   */
  private async fetchFromTmdbWithMetadata(
    mediaType: 'MOVIE' | 'TV', 
    options: {
      genreIds?: number[];
      logicType?: 'AND' | 'OR';
      page?: number;
    } = {}
  ): Promise<{ results: TMDBMovieResponse[]; total_results: number; total_pages: number }> {
    const { genreIds, logicType, page = 1 } = options;
    const endpoint = mediaType === 'MOVIE' ? '/discover/movie' : '/discover/tv';
    
    const params: TMDBDiscoveryParams = {
      page,
      language: 'es-ES', // Default language
      sort_by: 'popularity.desc',
      include_adult: false,
      with_original_language: 'en|es|fr|it|de|pt', // Western languages only
      'vote_count.gte': 50, // Minimum 50 votes to avoid garbage content while allowing more variety
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
    const total_results = response.data.total_results || 0;
    const total_pages = response.data.total_pages || 1;
    
    console.log(`TMDB returned ${results.length} results for page ${page} (total: ${total_results} across ${total_pages} pages)`);
    
    return { results, total_results, total_pages };
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
        if (item.vote_count && item.vote_count < 50) {
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
          genreIds: item.genre_ids || [], // Store genre IDs for prioritization
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