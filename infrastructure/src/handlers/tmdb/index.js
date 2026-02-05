"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const axios_1 = __importDefault(require("axios"));
// Latin Script Validator
class LatinScriptValidator {
    constructor() {
        // Regex to match Latin characters, numbers, punctuation, and common accents
        // Excludes CJK (Chinese/Japanese/Korean) and Cyrillic characters
        this.latinScriptRegex = /^[\u0000-\u007F\u00A0-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF\s\p{P}\p{N}]*$/u;
    }
    validateContent(title, overview) {
        return this.isLatinScript(title) && this.isLatinScript(overview);
    }
    isLatinScript(text) {
        if (!text || text.trim() === '')
            return false;
        return this.latinScriptRegex.test(text);
    }
}
// TMDB Client with Smart Random Discovery
class TMDBClient {
    constructor() {
        this.TARGET_COUNT = 50; // Target number of candidates
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
     * Smart Random Discovery Algorithm (Enhanced)
     * 1. Phase 1: Strict Search (AND logic) - All genres must match, random deep page
     * 2. Phase 2: Fallback Search (OR logic) - Any genre matches, different random page
     * 3. Phase 3: Multiple fetches if needed to reach 50 candidates
     * 4. Shuffle final results for maximum variety
     */
    async discoverContent(mediaType, genreIds) {
        const candidatesMap = new Map(); // Use Map to prevent duplicates
        try {
            console.log(`Starting Smart Random Discovery for ${mediaType} with genres: ${genreIds?.join(',') || 'none'}`);
            // PHASE 1: STRICT SEARCH (AND Logic) - Deep random page exploration
            if (genreIds && genreIds.length > 0) {
                console.log('PHASE 1: Strict search with ALL genres (AND logic)');
                const randomPageA = Math.floor(Math.random() * 50) + 1; // Explore pages 1-50
                console.log(`  → Fetching page ${randomPageA} with AND logic`);
                const strictResults = await this.fetchFromTmdb(mediaType, {
                    genreIds,
                    logicType: 'AND',
                    page: randomPageA
                });
                const filteredStrict = this.applyBaseFilters(strictResults, mediaType);
                filteredStrict.forEach(candidate => candidatesMap.set(candidate.id, candidate));
                console.log(`  → Phase 1 found ${filteredStrict.length} candidates (total: ${candidatesMap.size})`);
            }
            // PHASE 2: FALLBACK SEARCH (OR Logic) - Different random page
            if (candidatesMap.size < this.TARGET_COUNT && genreIds && genreIds.length > 0) {
                const needed = this.TARGET_COUNT - candidatesMap.size;
                console.log(`PHASE 2: Fallback search with ANY genre (OR logic) - need ${needed} more`);
                // Use a different random page range to avoid overlap
                const randomPageB = Math.floor(Math.random() * 50) + 1;
                console.log(`  → Fetching page ${randomPageB} with OR logic`);
                const looseResults = await this.fetchFromTmdb(mediaType, {
                    genreIds,
                    logicType: 'OR',
                    page: randomPageB
                });
                const filteredLoose = this.applyBaseFilters(looseResults, mediaType);
                filteredLoose.forEach(candidate => {
                    if (candidatesMap.size < this.TARGET_COUNT) {
                        candidatesMap.set(candidate.id, candidate);
                    }
                });
                console.log(`  → Phase 2 added ${filteredLoose.length} results (total: ${candidatesMap.size})`);
            }
            // PHASE 3: ADDITIONAL FETCHES - Keep fetching until we reach target
            let fetchAttempts = 0;
            const maxAttempts = 5; // Prevent infinite loops
            while (candidatesMap.size < this.TARGET_COUNT && fetchAttempts < maxAttempts) {
                fetchAttempts++;
                const needed = this.TARGET_COUNT - candidatesMap.size;
                console.log(`PHASE 3 (Attempt ${fetchAttempts}): Additional fetch - need ${needed} more`);
                // Use progressively deeper random pages
                const randomPageC = Math.floor(Math.random() * 50) + 1;
                console.log(`  → Fetching page ${randomPageC}`);
                const additionalResults = await this.fetchFromTmdb(mediaType, {
                    genreIds: genreIds && genreIds.length > 0 ? genreIds : undefined,
                    logicType: genreIds && genreIds.length > 0 ? 'OR' : undefined,
                    page: randomPageC
                });
                const filteredAdditional = this.applyBaseFilters(additionalResults, mediaType);
                let addedCount = 0;
                filteredAdditional.forEach(candidate => {
                    if (candidatesMap.size < this.TARGET_COUNT) {
                        if (!candidatesMap.has(candidate.id)) {
                            candidatesMap.set(candidate.id, candidate);
                            addedCount++;
                        }
                    }
                });
                console.log(`  → Phase 3 added ${addedCount} new candidates (total: ${candidatesMap.size})`);
                // If we didn't add any new candidates, break to avoid wasting API calls
                if (addedCount === 0) {
                    console.log(`  → No new candidates found, stopping additional fetches`);
                    break;
                }
            }
            // PHASE 4: SHUFFLE - Fisher-Yates shuffle for maximum randomness
            const candidatesArray = Array.from(candidatesMap.values());
            const shuffledCandidates = this.shuffleArray(candidatesArray);
            const finalCandidates = shuffledCandidates.slice(0, this.TARGET_COUNT);
            console.log(`✅ Smart Random Discovery complete: ${finalCandidates.length} candidates (target: ${this.TARGET_COUNT})`);
            console.log(`   Phases executed: ${fetchAttempts + 2}, Unique IDs: ${candidatesMap.size}`);
            return finalCandidates;
        }
        catch (error) {
            console.error('❌ Smart Random Discovery Error:', error);
            // Return whatever we managed to collect
            const fallbackCandidates = Array.from(candidatesMap.values());
            console.log(`   Returning ${fallbackCandidates.length} candidates as fallback`);
            return fallbackCandidates;
        }
    }
    /**
     * Fetch content from TMDB with specified parameters
     */
    async fetchFromTmdb(mediaType, options = {}) {
        const { genreIds, logicType, page = 1 } = options;
        const endpoint = mediaType === 'MOVIE' ? '/discover/movie' : '/discover/tv';
        const params = {
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
            }
            else {
                params.with_genres = genreIds.join(','); // AND logic: all genres must match
            }
        }
        console.log(`Fetching from TMDB ${endpoint} with params:`, JSON.stringify(params));
        const response = await axios_1.default.get(`${this.baseUrl}${endpoint}`, {
            headers: {
                'accept': 'application/json',
                'Authorization': `Bearer ${this.readToken}`
            },
            params
        });
        const results = response.data.results || [];
        console.log(`TMDB returned ${results.length} raw results for page ${page}`);
        return results;
    }
    /**
     * Apply base quality filters to TMDB results
     */
    applyBaseFilters(results, mediaType) {
        const candidates = [];
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
                const candidate = {
                    id: item.id,
                    title,
                    overview,
                    posterPath: `https://image.tmdb.org/t/p/w500${item.poster_path}`,
                    releaseDate,
                    mediaType: mediaType === 'MOVIE' ? 'MOVIE' : 'TV',
                };
                candidates.push(candidate);
            }
            catch (error) {
                console.error(`Error processing TMDB item ${item.id}:`, error);
                // Continue processing other items
            }
        }
        return candidates;
    }
    /**
     * Shuffle array using Fisher-Yates algorithm
     */
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
    // Legacy method for backward compatibility (deprecated)
    async discoverContentLegacy(mediaType, genreIds, page = 1) {
        console.warn('Using legacy discoverContentLegacy method - consider upgrading to discoverContent');
        return this.discoverContent(mediaType, genreIds);
    }
}
// Lambda Handler
const handler = async (event) => {
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
    }
    catch (error) {
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
exports.handler = handler;
