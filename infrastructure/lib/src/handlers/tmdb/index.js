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
     * Smart Random Discovery Algorithm (Enhanced with Strict Priority)
     * 1. Phase 1: Check total results with STRICT (AND) logic
     * 2. If total_results >= 50: Use only AND logic (prioritize intersection)
     * 3. If total_results < 50: Fallback to OR logic (broader search)
     * 4. Fetch from random pages to ensure variety
     * 5. Shuffle final results for maximum randomness
     */
    async discoverContent(mediaType, genreIds) {
        const candidatesMap = new Map(); // Use Map to prevent duplicates
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
                }
                else {
                    useStrictLogic = false;
                    console.log(`  ⚠️ Using FALLBACK (OR) logic - only ${totalAvailableResults} strict results available`);
                }
            }
            else if (genreIds && genreIds.length === 1) {
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
            }
            else if (!useStrictLogic && genreIds && genreIds.length > 1) {
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
            }
            else {
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
                if (addedCount === 0)
                    break;
            }
            // PHASE 4: SHUFFLE - Fisher-Yates shuffle for maximum randomness
            const candidatesArray = Array.from(candidatesMap.values());
            const shuffledCandidates = this.shuffleArray(candidatesArray);
            const finalCandidates = shuffledCandidates.slice(0, this.TARGET_COUNT);
            console.log(`✅ Smart Random Discovery complete: ${finalCandidates.length} candidates (target: ${this.TARGET_COUNT})`);
            console.log(`   Strategy: ${useStrictLogic ? 'STRICT (AND)' : 'FALLBACK (OR)'}, Total available: ${totalAvailableResults}`);
            return finalCandidates;
        }
        catch (error) {
            console.error('❌ Smart Random Discovery Error:', error);
            const fallbackCandidates = Array.from(candidatesMap.values());
            console.log(`   Returning ${fallbackCandidates.length} candidates as fallback`);
            return fallbackCandidates;
        }
    }
    /**
     * Prioritize candidates that match ALL selected genres (for OR searches)
     */
    prioritizeMultiGenreMatches(candidates, selectedGenreIds) {
        // Sort candidates: those matching ALL genres first, then others
        return candidates.sort((a, b) => {
            const aMatchesAll = selectedGenreIds.every(genreId => a.genreIds?.includes(genreId));
            const bMatchesAll = selectedGenreIds.every(genreId => b.genreIds?.includes(genreId));
            // If both match all or both don't, maintain original order
            if (aMatchesAll === bMatchesAll)
                return 0;
            // Put items matching all genres first
            return aMatchesAll ? -1 : 1;
        });
    }
    /**
     * Fetch content from TMDB with specified parameters (returns only results)
     */
    async fetchFromTmdb(mediaType, options = {}) {
        const response = await this.fetchFromTmdbWithMetadata(mediaType, options);
        return response.results;
    }
    /**
     * Fetch content from TMDB with metadata (total_results, total_pages)
     */
    async fetchFromTmdbWithMetadata(mediaType, options = {}) {
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
        const total_results = response.data.total_results || 0;
        const total_pages = response.data.total_pages || 1;
        console.log(`TMDB returned ${results.length} results for page ${page} (total: ${total_results} across ${total_pages} pages)`);
        return { results, total_results, total_pages };
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
                    genreIds: item.genre_ids || [], // Store genre IDs for prioritization
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdG1kYi9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxrREFBMEI7QUFxRDFCLHlCQUF5QjtBQUN6QixNQUFNLG9CQUFvQjtJQUExQjtRQUNFLDRFQUE0RTtRQUM1RSxpRUFBaUU7UUFDaEQscUJBQWdCLEdBQUcscUZBQXFGLENBQUM7SUFVNUgsQ0FBQztJQVJDLGVBQWUsQ0FBQyxLQUFhLEVBQUUsUUFBZ0I7UUFDN0MsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDbkUsQ0FBQztJQUVELGFBQWEsQ0FBQyxJQUFZO1FBQ3hCLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFBRSxPQUFPLEtBQUssQ0FBQztRQUM5QyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDMUMsQ0FBQztDQUNGO0FBRUQsMENBQTBDO0FBQzFDLE1BQU0sVUFBVTtJQU1kO1FBRmlCLGlCQUFZLEdBQUcsRUFBRSxDQUFDLENBQUMsOEJBQThCO1FBR2hFLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksOEJBQThCLENBQUM7UUFDM0UsOERBQThEO1FBQzlELElBQUksQ0FBQyxTQUFTLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLElBQUksRUFBRSxDQUFDO1FBQy9FLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxvQkFBb0IsRUFBRSxDQUFDO1FBRTVDLE9BQU8sQ0FBQyxHQUFHLENBQUMsNEJBQTRCLENBQUMsQ0FBQztRQUMxQyxPQUFPLENBQUMsR0FBRyxD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QztnQkFDZixJQUFJLEVBQUUsQ0FBQztnQkFDUCxLQUFLLEVBQUUsWUFBWTthQUNwQjtTQUNGLENBQUM7SUFDSixDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBbEVXLFFBQUEsT0FBTyxXQWtFbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCBheGlvcyBmcm9tICdheGlvcyc7XHJcblxyXG4vLyBUeXBlc1xyXG5pbnRlcmZhY2UgVE1EQkRpc2NvdmVyeVBhcmFtcyB7XHJcbiAgcGFnZTogbnVtYmVyO1xyXG4gIHdpdGhfZ2VucmVzPzogc3RyaW5nO1xyXG4gIGxhbmd1YWdlOiBzdHJpbmc7XHJcbiAgcmVnaW9uPzogc3RyaW5nO1xyXG4gIHNvcnRfYnk6IHN0cmluZztcclxuICBpbmNsdWRlX2FkdWx0OiBib29sZWFuO1xyXG4gIHdpdGhfb3JpZ2luYWxfbGFuZ3VhZ2U6IHN0cmluZzsgLy8gV2VzdGVybiBsYW5ndWFnZXMgb25seVxyXG4gICd2b3RlX2NvdW50Lmd0ZSc/OiBudW1iZXI7IC8vIE1pbmltdW0gdm90ZSBjb3VudCBmaWx0ZXJcclxufVxyXG5cclxuaW50ZXJmYWNlIFRNREJNb3ZpZVJlc3BvbnNlIHtcclxuICBpZDogbnVtYmVyO1xyXG4gIHRpdGxlPzogc3RyaW5nO1xyXG4gIG5hbWU/OiBzdHJpbmc7IC8vIFRWIHNob3dzIHVzZSAnbmFtZScgaW5zdGVhZCBvZiAndGl0bGUnXHJcbiAgb3ZlcnZpZXc6IHN0cmluZztcclxuICBwb3N0ZXJfcGF0aDogc3RyaW5nIHwgbnVsbDtcclxuICByZWxlYXNlX2RhdGU/OiBzdHJpbmc7XHJcbiAgZmlyc3RfYWlyX2RhdGU/OiBzdHJpbmc7IC8vIFRWIHNob3dzIHVzZSAnZmlyc3RfYWlyX2RhdGUnXHJcbiAgZ2VucmVfaWRzOiBudW1iZXJbXTtcclxuICBvcmlnaW5hbF9sYW5ndWFnZTogc3RyaW5nO1xyXG4gIG1lZGlhX3R5cGU/OiAnbW92aWUnIHwgJ3R2JztcclxuICB2b3RlX2NvdW50PzogbnVtYmVyO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTW92aWVDYW5kaWRhdGUge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg6IHN0cmluZyB8IG51bGw7XHJcbiAgcmVsZWFzZURhdGU6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIGdlbnJlSWRzPzogbnVtYmVyW107IC8vIFN0b3JlIGdlbnJlIElEcyBmb3IgcHJpb3JpdGl6YXRpb25cclxufVxyXG5cclxuaW50ZXJmYWNlIFRNREJFdmVudCB7XHJcbiAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJztcclxuICBnZW5yZUlkcz86IG51bWJlcltdO1xyXG4gIHBhZ2U/OiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBUTURCUmVzcG9uc2Uge1xyXG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcclxuICBib2R5OiB7XHJcbiAgICBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdO1xyXG4gICAgdG90YWxSZXN1bHRzOiBudW1iZXI7XHJcbiAgICBwYWdlOiBudW1iZXI7XHJcbiAgfTtcclxufVxyXG5cclxuLy8gTGF0aW4gU2NyaXB0IFZhbGlkYXRvclxyXG5jbGFzcyBMYXRpblNjcmlwdFZhbGlkYXRvciB7XHJcbiAgLy8gUmVnZXggdG8gbWF0Y2ggTGF0aW4gY2hhcmFjdGVycywgbnVtYmVycywgcHVuY3R1YXRpb24sIGFuZCBjb21tb24gYWNjZW50c1xyXG4gIC8vIEV4Y2x1ZGVzIENKSyAoQ2hpbmVzZS9KYXBhbmVzZS9Lb3JlYW4pIGFuZCBDeXJpbGxpYyBjaGFyYWN0ZXJzXHJcbiAgcHJpdmF0ZSByZWFkb25seSBsYXRpblNjcmlwdFJlZ2V4ID0gL15bXFx1MDAwMC1cXHUwMDdGXFx1MDBBMC1cXHUwMEZGXFx1MDEwMC1cXHUwMTdGXFx1MDE4MC1cXHUwMjRGXFx1MUUwMC1cXHUxRUZGXFxzXFxwe1B9XFxwe059XSokL3U7XHJcbiAgXHJcbiAgdmFsaWRhdGVDb250ZW50KHRpdGxlOiBzdHJpbmcsIG92ZXJ2aWV3OiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIHJldHVybiB0aGlzLmlzTGF0aW5TY3JpcHQodGl0bGUpICYmIHRoaXMuaXNMYXRpblNjcmlwdChvdmVydmlldyk7XHJcbiAgfVxyXG4gIFxyXG4gIGlzTGF0aW5TY3JpcHQodGV4dDogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICBpZiAoIXRleHQgfHwgdGV4dC50cmltKCkgPT09ICcnKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gdGhpcy5sYXRpblNjcmlwdFJlZ2V4LnRlc3QodGV4dCk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBUTURCIENsaWVudCB3aXRoIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnlcclxuY2xhc3MgVE1EQkNsaWVudCB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBiYXNlVXJsOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSByZWFkVG9rZW46IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHZhbGlkYXRvcjogTGF0aW5TY3JpcHRWYWxpZGF0b3I7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBUQVJHRVRfQ09VTlQgPSA1MDsgLy8gVGFyZ2V0IG51bWJlciBvZiBjYW5kaWRhdGVzXHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5iYXNlVXJsID0gcHJvY2Vzcy5lbnYuVE1EQl9CQVNFX1VSTCB8fCAnaHR0cHM6Ly9hcGkudGhlbW92aWVkYi5vcmcvMyc7XHJcbiAgICAvLyBUcnkgYm90aCBUTURCX1JFQURfVE9LRU4gYW5kIFRNREJfQVBJX0tFWSBmb3IgY29tcGF0aWJpbGl0eVxyXG4gICAgdGhpcy5yZWFkVG9rZW4gPSBwcm9jZXNzLmVudi5UTURCX1JFQURfVE9LRU4gfHwgcHJvY2Vzcy5lbnYuVE1EQl9BUElfS0VZIHx8ICcnO1xyXG4gICAgdGhpcy52YWxpZGF0b3IgPSBuZXcgTGF0aW5TY3JpcHRWYWxpZGF0b3IoKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ1RNREJDbGllbnQgaW5pdGlhbGl6aW5nLi4uJyk7XHJcbiAgICBjb25zb2xlLmxvZygnQmFzZSBVUkw6JywgdGhpcy5iYXNlVXJsKTtcclxuICAgIGNvbnNvbGUubG9nKCdUb2tlbiBjb25maWd1cmVkOicsIHRoaXMucmVhZFRva2VuID8gJ1lFUycgOiAnTk8nKTtcclxuICAgIGNvbnNvbGUubG9nKCdUb2tlbiBsZW5ndGg6JywgdGhpcy5yZWFkVG9rZW4ubGVuZ3RoKTtcclxuICAgIGNvbnNvbGUubG9nKCdUb2tlbiBmaXJzdCAyMCBjaGFyczonLCB0aGlzLnJlYWRUb2tlbi5zdWJzdHJpbmcoMCwgMjApKTtcclxuICAgIGNvbnNvbGUubG9nKCdBbGwgZW52IHZhcnM6JywgT2JqZWN0LmtleXMocHJvY2Vzcy5lbnYpKTtcclxuICAgIGNvbnNvbGUubG9nKCdUTURCIGVudiB2YXJzOicsIE9iamVjdC5rZXlzKHByb2Nlc3MuZW52KS5maWx0ZXIoa2V5ID0+IGtleS5pbmNsdWRlcygnVE1EQicpKSk7XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5yZWFkVG9rZW4pIHtcclxuICAgICAgY29uc29sZS5lcnJvcignQXZhaWxhYmxlIGVudmlyb25tZW50IHZhcmlhYmxlczonLCBPYmplY3Qua2V5cyhwcm9jZXNzLmVudikuZmlsdGVyKGtleSA9PiBrZXkuaW5jbHVkZXMoJ1RNREInKSkpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RNREJfUkVBRF9UT0tFTiBvciBUTURCX0FQSV9LRVkgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgQWxnb3JpdGhtIChFbmhhbmNlZCB3aXRoIFN0cmljdCBQcmlvcml0eSlcclxuICAgKiAxLiBQaGFzZSAxOiBDaGVjayB0b3RhbCByZXN1bHRzIHdpdGggU1RSSUNUIChBTkQpIGxvZ2ljXHJcbiAgICogMi4gSWYgdG90YWxfcmVzdWx0cyA+PSA1MDogVXNlIG9ubHkgQU5EIGxvZ2ljIChwcmlvcml0aXplIGludGVyc2VjdGlvbilcclxuICAgKiAzLiBJZiB0b3RhbF9yZXN1bHRzIDwgNTA6IEZhbGxiYWNrIHRvIE9SIGxvZ2ljIChicm9hZGVyIHNlYXJjaClcclxuICAgKiA0LiBGZXRjaCBmcm9tIHJhbmRvbSBwYWdlcyB0byBlbnN1cmUgdmFyaWV0eVxyXG4gICAqIDUuIFNodWZmbGUgZmluYWwgcmVzdWx0cyBmb3IgbWF4aW11bSByYW5kb21uZXNzXHJcbiAgICovXHJcbiAgYXN5bmMgZGlzY292ZXJDb250ZW50KG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVicsIGdlbnJlSWRzPzogbnVtYmVyW10pOiBQcm9taXNlPE1vdmllQ2FuZGlkYXRlW10+IHtcclxuICAgIGNvbnN0IGNhbmRpZGF0ZXNNYXAgPSBuZXcgTWFwPG51bWJlciwgTW92aWVDYW5kaWRhdGU+KCk7IC8vIFVzZSBNYXAgdG8gcHJldmVudCBkdXBsaWNhdGVzXHJcbiAgICBjb25zdCBNSU5fUkVTVUxUU19USFJFU0hPTEQgPSA1MDsgLy8gTWluaW11bSByZXN1bHRzIHRvIHVzZSBzdHJpY3QgQU5EIGxvZ2ljXHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBTdGFydGluZyBTbWFydCBSYW5kb20gRGlzY292ZXJ5IGZvciAke21lZGlhVHlwZX0gd2l0aCBnZW5yZXM6ICR7Z2VucmVJZHM/LmpvaW4oJywnKSB8fCAnbm9uZSd9YCk7XHJcblxyXG4gICAgICBsZXQgdXNlU3RyaWN0TG9naWMgPSBmYWxzZTtcclxuICAgICAgbGV0IHRvdGFsQXZhaWxhYmxlUmVzdWx0cyA9IDA7XHJcbiAgICAgIGxldCB0b3RhbEF2YWlsYWJsZVBhZ2VzID0gMTtcclxuXHJcbiAgICAgIC8vIFBIQVNFIDE6IENIRUNLIEFWQUlMQUJJTElUWSBXSVRIIFNUUklDVCAoQU5EKSBMT0dJQ1xyXG4gICAgICBpZiAoZ2VucmVJZHMgJiYgZ2VucmVJZHMubGVuZ3RoID4gMSkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdQSEFTRSAxOiBDaGVja2luZyBhdmFpbGFiaWxpdHkgd2l0aCBTVFJJQ1QgKEFORCkgbG9naWMnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBGaXJzdCwgY2hlY2sgaG93IG1hbnkgcmVzdWx0cyBleGlzdCB3aXRoIHN0cmljdCBBTkQgbG9naWNcclxuICAgICAgICBjb25zdCBjaGVja1Jlc3BvbnNlID0gYXdhaXQgdGhpcy5mZXRjaEZyb21UbWRiV2l0aE1ldGFkYXRhKG1lZGlhVHlwZSwge1xyXG4gICAgICAgICAgZ2VucmVJZHMsXHJcbiAgICAgICAgICBsb2dpY1R5cGU6ICdBTkQnLFxyXG4gICAgICAgICAgcGFnZTogMVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRvdGFsQXZhaWxhYmxlUmVzdWx0cyA9IGNoZWNrUmVzcG9uc2UudG90YWxfcmVzdWx0cztcclxuICAgICAgICB0b3RhbEF2YWlsYWJsZVBhZ2VzID0gY2hlY2tSZXNwb25zZS50b3RhbF9wYWdlcztcclxuICAgICAgICBcclxuICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgU3RyaWN0IEFORCBzZWFyY2ggZm91bmQgJHt0b3RhbEF2YWlsYWJsZVJlc3VsdHN9IHRvdGFsIHJlc3VsdHMgYWNyb3NzICR7dG90YWxBdmFpbGFibGVQYWdlc30gcGFnZXNgKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBEZWNpZGUgc3RyYXRlZ3kgYmFzZWQgb24gYXZhaWxhYmxlIHJlc3VsdHNcclxuICAgICAgICBpZiAodG90YWxBdmFpbGFibGVSZXN1bHRzID49IE1JTl9SRVNVTFRTX1RIUkVTSE9MRCkge1xyXG4gICAgICAgICAgdXNlU3RyaWN0TG9naWMgPSB0cnVlO1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYCAg4pyFIFVzaW5nIFNUUklDVCAoQU5EKSBsb2dpYyAtIHN1ZmZpY2llbnQgcmVzdWx0cyBhdmFpbGFibGVgKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgdXNlU3RyaWN0TG9naWMgPSBmYWxzZTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGAgIOKaoO+4jyBVc2luZyBGQUxMQkFDSyAoT1IpIGxvZ2ljIC0gb25seSAke3RvdGFsQXZhaWxhYmxlUmVzdWx0c30gc3RyaWN0IHJlc3VsdHMgYXZhaWxhYmxlYCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA9PT0gMSkge1xyXG4gICAgICAgIC8vIFNpbmdsZSBnZW5yZSBhbHdheXMgdXNlcyBBTkQgKHdoaWNoIGlzIHRoZSBzYW1lIGFzIE9SIGZvciBvbmUgZ2VucmUpXHJcbiAgICAgICAgdXNlU3RyaWN0TG9naWMgPSB0cnVlO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdTaW5nbGUgZ2VucmUgc2VsZWN0ZWQgLSB1c2luZyBzdGFuZGFyZCBsb2dpYycpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBQSEFTRSAyOiBGRVRDSCBDT05URU5UIEJBU0VEIE9OIENIT1NFTiBTVFJBVEVHWVxyXG4gICAgICBjb25zdCBsb2dpY1R5cGUgPSB1c2VTdHJpY3RMb2dpYyA/ICdBTkQnIDogJ09SJztcclxuICAgICAgY29uc29sZS5sb2coYFBIQVNFIDI6IEZldGNoaW5nIGNvbnRlbnQgd2l0aCAke2xvZ2ljVHlwZX0gbG9naWNgKTtcclxuXHJcbiAgICAgIC8vIElmIHdlJ3JlIHVzaW5nIHN0cmljdCBsb2dpYyBhbmQgY2hlY2tlZCBhdmFpbGFiaWxpdHksIHVzZSB0aG9zZSByZXN1bHRzXHJcbiAgICAgIGlmICh1c2VTdHJpY3RMb2dpYyAmJiBnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgLy8gUmUtZmV0Y2ggd2l0aCBtZXRhZGF0YSB0byBnZXQgdG90YWwgcGFnZXMgZm9yIHJhbmRvbSBzZWxlY3Rpb25cclxuICAgICAgICBjb25zdCBtZXRhZGF0YVJlc3BvbnNlID0gYXdhaXQgdGhpcy5mZXRjaEZyb21UbWRiV2l0aE1ldGFkYXRhKG1lZGlhVHlwZSwge1xyXG4gICAgICAgICAgZ2VucmVJZHMsXHJcbiAgICAgICAgICBsb2dpY1R5cGU6ICdBTkQnLFxyXG4gICAgICAgICAgcGFnZTogMVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRvdGFsQXZhaWxhYmxlUGFnZXMgPSBNYXRoLm1pbihtZXRhZGF0YVJlc3BvbnNlLnRvdGFsX3BhZ2VzLCA1MDApOyAvLyBUTURCIGxpbWl0cyB0byA1MDAgcGFnZXNcclxuICAgICAgICBcclxuICAgICAgICAvLyBGZXRjaCBmcm9tIG11bHRpcGxlIHJhbmRvbSBwYWdlcyB0byByZWFjaCB0YXJnZXRcclxuICAgICAgICBjb25zdCBwYWdlc1RvRmV0Y2ggPSBNYXRoLm1pbigzLCB0b3RhbEF2YWlsYWJsZVBhZ2VzKTsgLy8gRmV0Y2ggdXAgdG8gMyByYW5kb20gcGFnZXNcclxuICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgRmV0Y2hpbmcgZnJvbSAke3BhZ2VzVG9GZXRjaH0gcmFuZG9tIHBhZ2VzIChvdXQgb2YgJHt0b3RhbEF2YWlsYWJsZVBhZ2VzfSBhdmFpbGFibGUpYCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYWdlc1RvRmV0Y2ggJiYgY2FuZGlkYXRlc01hcC5zaXplIDwgdGhpcy5UQVJHRVRfQ09VTlQ7IGkrKykge1xyXG4gICAgICAgICAgY29uc3QgcmFuZG9tUGFnZSA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIHRvdGFsQXZhaWxhYmxlUGFnZXMpICsgMTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBGZXRjaGluZyBwYWdlICR7cmFuZG9tUGFnZX0gd2l0aCBBTkQgbG9naWNgKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMuZmV0Y2hGcm9tVG1kYihtZWRpYVR5cGUsIHtcclxuICAgICAgICAgICAgZ2VucmVJZHMsXHJcbiAgICAgICAgICAgIGxvZ2ljVHlwZTogJ0FORCcsXHJcbiAgICAgICAgICAgIHBhZ2U6IHJhbmRvbVBhZ2VcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBjb25zdCBmaWx0ZXJlZCA9IHRoaXMuYXBwbHlCYXNlRmlsdGVycyhyZXN1bHRzLCBtZWRpYVR5cGUpO1xyXG4gICAgICAgICAgZmlsdGVyZWQuZm9yRWFjaChjYW5kaWRhdGUgPT4ge1xyXG4gICAgICAgICAgICBpZiAoY2FuZGlkYXRlc01hcC5zaXplIDwgdGhpcy5UQVJHRVRfQ09VTlQpIHtcclxuICAgICAgICAgICAgICBjYW5kaWRhdGVzTWFwLnNldChjYW5kaWRhdGUuaWQsIGNhbmRpZGF0ZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgQWRkZWQgJHtmaWx0ZXJlZC5sZW5ndGh9IGNhbmRpZGF0ZXMgKHRvdGFsOiAke2NhbmRpZGF0ZXNNYXAuc2l6ZX0pYCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKCF1c2VTdHJpY3RMb2dpYyAmJiBnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgLy8gVXNpbmcgT1IgbG9naWMgZmFsbGJhY2tcclxuICAgICAgICBjb25zdCBtZXRhZGF0YVJlc3BvbnNlID0gYXdhaXQgdGhpcy5mZXRjaEZyb21UbWRiV2l0aE1ldGFkYXRhKG1lZGlhVHlwZSwge1xyXG4gICAgICAgICAgZ2VucmVJZHMsXHJcbiAgICAgICAgICBsb2dpY1R5cGU6ICdPUicsXHJcbiAgICAgICAgICBwYWdlOiAxXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdG90YWxBdmFpbGFibGVQYWdlcyA9IE1hdGgubWluKG1ldGFkYXRhUmVzcG9uc2UudG90YWxfcGFnZXMsIDUwMCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gRmV0Y2ggZnJvbSBtdWx0aXBsZSByYW5kb20gcGFnZXNcclxuICAgICAgICBjb25zdCBwYWdlc1RvRmV0Y2ggPSBNYXRoLm1pbigzLCB0b3RhbEF2YWlsYWJsZVBhZ2VzKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgRmV0Y2hpbmcgZnJvbSAke3BhZ2VzVG9GZXRjaH0gcmFuZG9tIHBhZ2VzIHdpdGggT1IgbG9naWNgKTtcclxuICAgICAgICBcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBhZ2VzVG9GZXRjaCAmJiBjYW5kaWRhdGVzTWFwLnNpemUgPCB0aGlzLlRBUkdFVF9DT1VOVDsgaSsrKSB7XHJcbiAgICAgICAgICBjb25zdCByYW5kb21QYWdlID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogdG90YWxBdmFpbGFibGVQYWdlcykgKyAxO1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYCAg4oaSIEZldGNoaW5nIHBhZ2UgJHtyYW5kb21QYWdlfSB3aXRoIE9SIGxvZ2ljYCk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGIobWVkaWFUeXBlLCB7XHJcbiAgICAgICAgICAgIGdlbnJlSWRzLFxyXG4gICAgICAgICAgICBsb2dpY1R5cGU6ICdPUicsXHJcbiAgICAgICAgICAgIHBhZ2U6IHJhbmRvbVBhZ2VcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBjb25zdCBmaWx0ZXJlZCA9IHRoaXMuYXBwbHlCYXNlRmlsdGVycyhyZXN1bHRzLCBtZWRpYVR5cGUpO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBXaGVuIHVzaW5nIE9SIGxvZ2ljLCBwcmlvcml0aXplIG1vdmllcyB0aGF0IG1hdGNoIEFMTCBnZW5yZXNcclxuICAgICAgICAgIGNvbnN0IHByaW9yaXRpemVkID0gdGhpcy5wcmlvcml0aXplTXVsdGlHZW5yZU1hdGNoZXMoZmlsdGVyZWQsIGdlbnJlSWRzKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgcHJpb3JpdGl6ZWQuZm9yRWFjaChjYW5kaWRhdGUgPT4ge1xyXG4gICAgICAgICAgICBpZiAoY2FuZGlkYXRlc01hcC5zaXplIDwgdGhpcy5UQVJHRVRfQ09VTlQpIHtcclxuICAgICAgICAgICAgICBjYW5kaWRhdGVzTWFwLnNldChjYW5kaWRhdGUuaWQsIGNhbmRpZGF0ZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgQWRkZWQgJHtwcmlvcml0aXplZC5sZW5ndGh9IGNhbmRpZGF0ZXMgKHRvdGFsOiAke2NhbmRpZGF0ZXNNYXAuc2l6ZX0pYCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIE5vIGdlbnJlcyBvciBzaW5nbGUgZ2VucmUgLSBzdGFuZGFyZCBmZXRjaFxyXG4gICAgICAgIGNvbnN0IHJhbmRvbVBhZ2UgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiA1MCkgKyAxO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBGZXRjaGluZyBwYWdlICR7cmFuZG9tUGFnZX0gKG5vIGdlbnJlIGZpbHRlciBvciBzaW5nbGUgZ2VucmUpYCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMuZmV0Y2hGcm9tVG1kYihtZWRpYVR5cGUsIHtcclxuICAgICAgICAgIGdlbnJlSWRzLFxyXG4gICAgICAgICAgcGFnZTogcmFuZG9tUGFnZVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGZpbHRlcmVkID0gdGhpcy5hcHBseUJhc2VGaWx0ZXJzKHJlc3VsdHMsIG1lZGlhVHlwZSk7XHJcbiAgICAgICAgZmlsdGVyZWQuZm9yRWFjaChjYW5kaWRhdGUgPT4gY2FuZGlkYXRlc01hcC5zZXQoY2FuZGlkYXRlLmlkLCBjYW5kaWRhdGUpKTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgQWRkZWQgJHtmaWx0ZXJlZC5sZW5ndGh9IGNhbmRpZGF0ZXNgKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gUEhBU0UgMzogQURESVRJT05BTCBGRVRDSEVTIElGIE5FRURFRFxyXG4gICAgICBsZXQgZmV0Y2hBdHRlbXB0cyA9IDA7XHJcbiAgICAgIGNvbnN0IG1heEF0dGVtcHRzID0gMztcclxuICAgICAgXHJcbiAgICAgIHdoaWxlIChjYW5kaWRhdGVzTWFwLnNpemUgPCB0aGlzLlRBUkdFVF9DT1VOVCAmJiBmZXRjaEF0dGVtcHRzIDwgbWF4QXR0ZW1wdHMpIHtcclxuICAgICAgICBmZXRjaEF0dGVtcHRzKys7XHJcbiAgICAgICAgY29uc3QgbmVlZGVkID0gdGhpcy5UQVJHRVRfQ09VTlQgLSBjYW5kaWRhdGVzTWFwLnNpemU7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFBIQVNFIDMgKEF0dGVtcHQgJHtmZXRjaEF0dGVtcHRzfSk6IE5lZWQgJHtuZWVkZWR9IG1vcmUgY2FuZGlkYXRlc2ApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IHJhbmRvbVBhZ2UgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiA1MCkgKyAxO1xyXG4gICAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGIobWVkaWFUeXBlLCB7XHJcbiAgICAgICAgICBnZW5yZUlkczogZ2VucmVJZHMgJiYgZ2VucmVJZHMubGVuZ3RoID4gMCA/IGdlbnJlSWRzIDogdW5kZWZpbmVkLFxyXG4gICAgICAgICAgbG9naWNUeXBlOiBnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAxID8gbG9naWNUeXBlIDogdW5kZWZpbmVkLFxyXG4gICAgICAgICAgcGFnZTogcmFuZG9tUGFnZVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGZpbHRlcmVkID0gdGhpcy5hcHBseUJhc2VGaWx0ZXJzKHJlc3VsdHMsIG1lZGlhVHlwZSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbGV0IGFkZGVkQ291bnQgPSAwO1xyXG4gICAgICAgIGZpbHRlcmVkLmZvckVhY2goY2FuZGlkYXRlID0+IHtcclxuICAgICAgICAgIGlmIChjYW5kaWRhdGVzTWFwLnNpemUgPCB0aGlzLlRBUkdFVF9DT1VOVCAmJiAhY2FuZGlkYXRlc01hcC5oYXMoY2FuZGlkYXRlLmlkKSkge1xyXG4gICAgICAgICAgICBjYW5kaWRhdGVzTWFwLnNldChjYW5kaWRhdGUuaWQsIGNhbmRpZGF0ZSk7XHJcbiAgICAgICAgICAgIGFkZGVkQ291bnQrKztcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgQWRkZWQgJHthZGRlZENvdW50fSBuZXcgY2FuZGlkYXRlcyAodG90YWw6ICR7Y2FuZGlkYXRlc01hcC5zaXplfSlgKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoYWRkZWRDb3VudCA9PT0gMCkgYnJlYWs7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFBIQVNFIDQ6IFNIVUZGTEUgLSBGaXNoZXItWWF0ZXMgc2h1ZmZsZSBmb3IgbWF4aW11bSByYW5kb21uZXNzXHJcbiAgICAgIGNvbnN0IGNhbmRpZGF0ZXNBcnJheSA9IEFycmF5LmZyb20oY2FuZGlkYXRlc01hcC52YWx1ZXMoKSk7XHJcbiAgICAgIGNvbnN0IHNodWZmbGVkQ2FuZGlkYXRlcyA9IHRoaXMuc2h1ZmZsZUFycmF5KGNhbmRpZGF0ZXNBcnJheSk7XHJcbiAgICAgIGNvbnN0IGZpbmFsQ2FuZGlkYXRlcyA9IHNodWZmbGVkQ2FuZGlkYXRlcy5zbGljZSgwLCB0aGlzLlRBUkdFVF9DT1VOVCk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhg4pyFIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgY29tcGxldGU6ICR7ZmluYWxDYW5kaWRhdGVzLmxlbmd0aH0gY2FuZGlkYXRlcyAodGFyZ2V0OiAke3RoaXMuVEFSR0VUX0NPVU5UfSlgKTtcclxuICAgICAgY29uc29sZS5sb2coYCAgIFN0cmF0ZWd5OiAke3VzZVN0cmljdExvZ2ljID8gJ1NUUklDVCAoQU5EKScgOiAnRkFMTEJBQ0sgKE9SKSd9LCBUb3RhbCBhdmFpbGFibGU6ICR7dG90YWxBdmFpbGFibGVSZXN1bHRzfWApO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIGZpbmFsQ2FuZGlkYXRlcztcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgU21hcnQgUmFuZG9tIERpc2NvdmVyeSBFcnJvcjonLCBlcnJvcik7XHJcbiAgICAgIGNvbnN0IGZhbGxiYWNrQ2FuZGlkYXRlcyA9IEFycmF5LmZyb20oY2FuZGlkYXRlc01hcC52YWx1ZXMoKSk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGAgICBSZXR1cm5pbmcgJHtmYWxsYmFja0NhbmRpZGF0ZXMubGVuZ3RofSBjYW5kaWRhdGVzIGFzIGZhbGxiYWNrYCk7XHJcbiAgICAgIHJldHVybiBmYWxsYmFja0NhbmRpZGF0ZXM7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQcmlvcml0aXplIGNhbmRpZGF0ZXMgdGhhdCBtYXRjaCBBTEwgc2VsZWN0ZWQgZ2VucmVzIChmb3IgT1Igc2VhcmNoZXMpXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBwcmlvcml0aXplTXVsdGlHZW5yZU1hdGNoZXMoY2FuZGlkYXRlczogTW92aWVDYW5kaWRhdGVbXSwgc2VsZWN0ZWRHZW5yZUlkczogbnVtYmVyW10pOiBNb3ZpZUNhbmRpZGF0ZVtdIHtcclxuICAgIC8vIFNvcnQgY2FuZGlkYXRlczogdGhvc2UgbWF0Y2hpbmcgQUxMIGdlbnJlcyBmaXJzdCwgdGhlbiBvdGhlcnNcclxuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvcnQoKGEsIGIpID0+IHtcclxuICAgICAgY29uc3QgYU1hdGNoZXNBbGwgPSBzZWxlY3RlZEdlbnJlSWRzLmV2ZXJ5KGdlbnJlSWQgPT4gYS5nZW5yZUlkcz8uaW5jbHVkZXMoZ2VucmVJZCkpO1xyXG4gICAgICBjb25zdCBiTWF0Y2hlc0FsbCA9IHNlbGVjdGVkR2VucmVJZHMuZXZlcnkoZ2VucmVJZCA9PiBiLmdlbnJlSWRzPy5pbmNsdWRlcyhnZW5yZUlkKSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBJZiBib3RoIG1hdGNoIGFsbCBvciBib3RoIGRvbid0LCBtYWludGFpbiBvcmlnaW5hbCBvcmRlclxyXG4gICAgICBpZiAoYU1hdGNoZXNBbGwgPT09IGJNYXRjaGVzQWxsKSByZXR1cm4gMDtcclxuICAgICAgXHJcbiAgICAgIC8vIFB1dCBpdGVtcyBtYXRjaGluZyBhbGwgZ2VucmVzIGZpcnN0XHJcbiAgICAgIHJldHVybiBhTWF0Y2hlc0FsbCA/IC0xIDogMTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRmV0Y2ggY29udGVudCBmcm9tIFRNREIgd2l0aCBzcGVjaWZpZWQgcGFyYW1ldGVycyAocmV0dXJucyBvbmx5IHJlc3VsdHMpXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhc3luYyBmZXRjaEZyb21UbWRiKFxyXG4gICAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgXHJcbiAgICBvcHRpb25zOiB7XHJcbiAgICAgIGdlbnJlSWRzPzogbnVtYmVyW107XHJcbiAgICAgIGxvZ2ljVHlwZT86ICdBTkQnIHwgJ09SJztcclxuICAgICAgcGFnZT86IG51bWJlcjtcclxuICAgIH0gPSB7fVxyXG4gICk6IFByb21pc2U8VE1EQk1vdmllUmVzcG9uc2VbXT4ge1xyXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGJXaXRoTWV0YWRhdGEobWVkaWFUeXBlLCBvcHRpb25zKTtcclxuICAgIHJldHVybiByZXNwb25zZS5yZXN1bHRzO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRmV0Y2ggY29udGVudCBmcm9tIFRNREIgd2l0aCBtZXRhZGF0YSAodG90YWxfcmVzdWx0cywgdG90YWxfcGFnZXMpXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhc3luYyBmZXRjaEZyb21UbWRiV2l0aE1ldGFkYXRhKFxyXG4gICAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgXHJcbiAgICBvcHRpb25zOiB7XHJcbiAgICAgIGdlbnJlSWRzPzogbnVtYmVyW107XHJcbiAgICAgIGxvZ2ljVHlwZT86ICdBTkQnIHwgJ09SJztcclxuICAgICAgcGFnZT86IG51bWJlcjtcclxuICAgIH0gPSB7fVxyXG4gICk6IFByb21pc2U8eyByZXN1bHRzOiBUTURCTW92aWVSZXNwb25zZVtdOyB0b3RhbF9yZXN1bHRzOiBudW1iZXI7IHRvdGFsX3BhZ2VzOiBudW1iZXIgfT4ge1xyXG4gICAgY29uc3QgeyBnZW5yZUlkcywgbG9naWNUeXBlLCBwYWdlID0gMSB9ID0gb3B0aW9ucztcclxuICAgIGNvbnN0IGVuZHBvaW50ID0gbWVkaWFUeXBlID09PSAnTU9WSUUnID8gJy9kaXNjb3Zlci9tb3ZpZScgOiAnL2Rpc2NvdmVyL3R2JztcclxuICAgIFxyXG4gICAgY29uc3QgcGFyYW1zOiBUTURCRGlzY292ZXJ5UGFyYW1zID0ge1xyXG4gICAgICBwYWdlLFxyXG4gICAgICBsYW5ndWFnZTogJ2VzLUVTJywgLy8gRGVmYXVsdCBsYW5ndWFnZVxyXG4gICAgICBzb3J0X2J5OiAncG9wdWxhcml0eS5kZXNjJyxcclxuICAgICAgaW5jbHVkZV9hZHVsdDogZmFsc2UsXHJcbiAgICAgIHdpdGhfb3JpZ2luYWxfbGFuZ3VhZ2U6ICdlbnxlc3xmcnxpdHxkZXxwdCcsIC8vIFdlc3Rlcm4gbGFuZ3VhZ2VzIG9ubHlcclxuICAgICAgJ3ZvdGVfY291bnQuZ3RlJzogNTAsIC8vIE1pbmltdW0gNTAgdm90ZXMgdG8gYXZvaWQgZ2FyYmFnZSBjb250ZW50IHdoaWxlIGFsbG93aW5nIG1vcmUgdmFyaWV0eVxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBBZGQgZ2VucmUgZmlsdGVyIGJhc2VkIG9uIGxvZ2ljIHR5cGVcclxuICAgIGlmIChnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgIGlmIChsb2dpY1R5cGUgPT09ICdPUicpIHtcclxuICAgICAgICBwYXJhbXMud2l0aF9nZW5yZXMgPSBnZW5yZUlkcy5qb2luKCd8Jyk7IC8vIE9SIGxvZ2ljOiBhbnkgZ2VucmUgbWF0Y2hlc1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHBhcmFtcy53aXRoX2dlbnJlcyA9IGdlbnJlSWRzLmpvaW4oJywnKTsgLy8gQU5EIGxvZ2ljOiBhbGwgZ2VucmVzIG11c3QgbWF0Y2hcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnNvbGUubG9nKGBGZXRjaGluZyBmcm9tIFRNREIgJHtlbmRwb2ludH0gd2l0aCBwYXJhbXM6YCwgSlNPTi5zdHJpbmdpZnkocGFyYW1zKSk7XHJcblxyXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQoYCR7dGhpcy5iYXNlVXJsfSR7ZW5kcG9pbnR9YCwge1xyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ2FjY2VwdCc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHt0aGlzLnJlYWRUb2tlbn1gXHJcbiAgICAgIH0sXHJcbiAgICAgIHBhcmFtc1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgcmVzdWx0czogVE1EQk1vdmllUmVzcG9uc2VbXSA9IHJlc3BvbnNlLmRhdGEucmVzdWx0cyB8fCBbXTtcclxuICAgIGNvbnN0IHRvdGFsX3Jlc3VsdHMgPSByZXNwb25zZS5kYXRhLnRvdGFsX3Jlc3VsdHMgfHwgMDtcclxuICAgIGNvbnN0IHRvdGFsX3BhZ2VzID0gcmVzcG9uc2UuZGF0YS50b3RhbF9wYWdlcyB8fCAxO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZyhgVE1EQiByZXR1cm5lZCAke3Jlc3VsdHMubGVuZ3RofSByZXN1bHRzIGZvciBwYWdlICR7cGFnZX0gKHRvdGFsOiAke3RvdGFsX3Jlc3VsdHN9IGFjcm9zcyAke3RvdGFsX3BhZ2VzfSBwYWdlcylgKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHsgcmVzdWx0cywgdG90YWxfcmVzdWx0cywgdG90YWxfcGFnZXMgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEFwcGx5IGJhc2UgcXVhbGl0eSBmaWx0ZXJzIHRvIFRNREIgcmVzdWx0c1xyXG4gICAqL1xyXG4gIHByaXZhdGUgYXBwbHlCYXNlRmlsdGVycyhyZXN1bHRzOiBUTURCTW92aWVSZXNwb25zZVtdLCBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnKTogTW92aWVDYW5kaWRhdGVbXSB7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdID0gW107XHJcblxyXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIHJlc3VsdHMpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBFeHRyYWN0IHRpdGxlIChtb3ZpZXMgdXNlICd0aXRsZScsIFRWIHNob3dzIHVzZSAnbmFtZScpXHJcbiAgICAgICAgY29uc3QgdGl0bGUgPSBpdGVtLnRpdGxlIHx8IGl0ZW0ubmFtZSB8fCAnJztcclxuICAgICAgICBjb25zdCBvdmVydmlldyA9IGl0ZW0ub3ZlcnZpZXcgfHwgJyc7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQmFzZSBxdWFsaXR5IGZpbHRlcnNcclxuICAgICAgICBpZiAoIWl0ZW0ucG9zdGVyX3BhdGgpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgaXRlbSB3aXRob3V0IHBvc3RlcjogXCIke3RpdGxlfVwiYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFvdmVydmlldyB8fCBvdmVydmlldy50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgb3V0IGl0ZW0gd2l0aG91dCBvdmVydmlldzogXCIke3RpdGxlfVwiYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFZvdGUgY291bnQgZmlsdGVyIChhZGRpdGlvbmFsIHNhZmV0eSBjaGVjaylcclxuICAgICAgICBpZiAoaXRlbS52b3RlX2NvdW50ICYmIGl0ZW0udm90ZV9jb3VudCA8IDUwKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgb3V0IGxvdy12b3RlIGl0ZW06IFwiJHt0aXRsZX1cIiAoJHtpdGVtLnZvdGVfY291bnR9IHZvdGVzKWApO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYW5ndWFnZSBmaWx0ZXIgLSBlbnN1cmUgV2VzdGVybiBsYW5ndWFnZXMgb25seVxyXG4gICAgICAgIGNvbnN0IGFsbG93ZWRMYW5ndWFnZXMgPSBbJ2VuJywgJ2VzJywgJ2ZyJywgJ2l0JywgJ2RlJywgJ3B0J107XHJcbiAgICAgICAgaWYgKCFhbGxvd2VkTGFuZ3VhZ2VzLmluY2x1ZGVzKGl0ZW0ub3JpZ2luYWxfbGFuZ3VhZ2UpKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgb3V0IG5vbi1XZXN0ZXJuIGxhbmd1YWdlOiBcIiR7dGl0bGV9XCIgKCR7aXRlbS5vcmlnaW5hbF9sYW5ndWFnZX0pYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQXBwbHkgTGF0aW4gU2NyaXB0IFZhbGlkYXRvclxyXG4gICAgICAgIGlmICghdGhpcy52YWxpZGF0b3IudmFsaWRhdGVDb250ZW50KHRpdGxlLCBvdmVydmlldykpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgbm9uLUxhdGluIGNvbnRlbnQ6IFwiJHt0aXRsZX1cImApO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBFeHRyYWN0IHJlbGVhc2UgZGF0ZVxyXG4gICAgICAgIGNvbnN0IHJlbGVhc2VEYXRlID0gaXRlbS5yZWxlYXNlX2RhdGUgfHwgaXRlbS5maXJzdF9haXJfZGF0ZSB8fCAnJztcclxuICAgICAgICBcclxuICAgICAgICAvLyBUcmFuc2Zvcm0gdG8gb3VyIGZvcm1hdFxyXG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZTogTW92aWVDYW5kaWRhdGUgPSB7XHJcbiAgICAgICAgICBpZDogaXRlbS5pZCxcclxuICAgICAgICAgIHRpdGxlLFxyXG4gICAgICAgICAgb3ZlcnZpZXcsXHJcbiAgICAgICAgICBwb3N0ZXJQYXRoOiBgaHR0cHM6Ly9pbWFnZS50bWRiLm9yZy90L3AvdzUwMCR7aXRlbS5wb3N0ZXJfcGF0aH1gLFxyXG4gICAgICAgICAgcmVsZWFzZURhdGUsXHJcbiAgICAgICAgICBtZWRpYVR5cGU6IG1lZGlhVHlwZSA9PT0gJ01PVklFJyA/ICdNT1ZJRScgOiAnVFYnLFxyXG4gICAgICAgICAgZ2VucmVJZHM6IGl0ZW0uZ2VucmVfaWRzIHx8IFtdLCAvLyBTdG9yZSBnZW5yZSBJRHMgZm9yIHByaW9yaXRpemF0aW9uXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY2FuZGlkYXRlcy5wdXNoKGNhbmRpZGF0ZSk7XHJcblxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgVE1EQiBpdGVtICR7aXRlbS5pZH06YCwgZXJyb3IpO1xyXG4gICAgICAgIC8vIENvbnRpbnVlIHByb2Nlc3Npbmcgb3RoZXIgaXRlbXNcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBjYW5kaWRhdGVzO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2h1ZmZsZSBhcnJheSB1c2luZyBGaXNoZXItWWF0ZXMgYWxnb3JpdGhtXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBzaHVmZmxlQXJyYXk8VD4oYXJyYXk6IFRbXSk6IFRbXSB7XHJcbiAgICBjb25zdCBzaHVmZmxlZCA9IFsuLi5hcnJheV07XHJcbiAgICBmb3IgKGxldCBpID0gc2h1ZmZsZWQubGVuZ3RoIC0gMTsgaSA+IDA7IGktLSkge1xyXG4gICAgICBjb25zdCBqID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogKGkgKyAxKSk7XHJcbiAgICAgIFtzaHVmZmxlZFtpXSwgc2h1ZmZsZWRbal1dID0gW3NodWZmbGVkW2pdLCBzaHVmZmxlZFtpXV07XHJcbiAgICB9XHJcbiAgICByZXR1cm4gc2h1ZmZsZWQ7XHJcbiAgfVxyXG5cclxuICAvLyBMZWdhY3kgbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5IChkZXByZWNhdGVkKVxyXG4gIGFzeW5jIGRpc2NvdmVyQ29udGVudExlZ2FjeShtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnLCBnZW5yZUlkcz86IG51bWJlcltdLCBwYWdlID0gMSk6IFByb21pc2U8TW92aWVDYW5kaWRhdGVbXT4ge1xyXG4gICAgY29uc29sZS53YXJuKCdVc2luZyBsZWdhY3kgZGlzY292ZXJDb250ZW50TGVnYWN5IG1ldGhvZCAtIGNvbnNpZGVyIHVwZ3JhZGluZyB0byBkaXNjb3ZlckNvbnRlbnQnKTtcclxuICAgIHJldHVybiB0aGlzLmRpc2NvdmVyQ29udGVudChtZWRpYVR5cGUsIGdlbnJlSWRzKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIExhbWJkYSBIYW5kbGVyXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyPFRNREJFdmVudCwgVE1EQlJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdUTURCIExhbWJkYSByZWNlaXZlZCBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCkpO1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgeyBtZWRpYVR5cGUsIGdlbnJlSWRzIH0gPSBldmVudDtcclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCFtZWRpYVR5cGUgfHwgIVsnTU9WSUUnLCAnVFYnXS5pbmNsdWRlcyhtZWRpYVR5cGUpKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgbWVkaWFUeXBlOicsIG1lZGlhVHlwZSk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBtZWRpYVR5cGUuIE11c3QgYmUgTU9WSUUgb3IgVFYnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBnZW5yZSBsaW1pdCAobWF4IDIgYXMgcGVyIG1hc3RlciBzcGVjKVxyXG4gICAgaWYgKGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA+IDIpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignVG9vIG1hbnkgZ2VucmVzOicsIGdlbnJlSWRzLmxlbmd0aCk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTWF4aW11bSAyIGdlbnJlcyBhbGxvd2VkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ2hlY2sgZW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbiAgICBjb25zdCB0bWRiUmVhZFRva2VuID0gcHJvY2Vzcy5lbnYuVE1EQl9SRUFEX1RPS0VOIHx8IHByb2Nlc3MuZW52LlRNREJfQVBJX0tFWSB8fCAnJztcclxuICAgIGlmICghdG1kYlJlYWRUb2tlbikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdUTURCIHRva2VuIG5vdCBmb3VuZCBpbiBlbnZpcm9ubWVudCB2YXJpYWJsZXMnKTtcclxuICAgICAgY29uc29sZS5lcnJvcignQXZhaWxhYmxlIGVudiB2YXJzOicsIE9iamVjdC5rZXlzKHByb2Nlc3MuZW52KS5maWx0ZXIoa2V5ID0+IGtleS5pbmNsdWRlcygnVE1EQicpKSk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVE1EQiBBUEkgdG9rZW4gbm90IGNvbmZpZ3VyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLmxvZygnVE1EQiB0b2tlbiBjb25maWd1cmVkLCBsZW5ndGg6JywgdG1kYlJlYWRUb2tlbi5sZW5ndGgpO1xyXG5cclxuICAgIGNvbnN0IHRtZGJDbGllbnQgPSBuZXcgVE1EQkNsaWVudCgpO1xyXG4gICAgXHJcbiAgICAvLyBVc2UgU21hcnQgUmFuZG9tIERpc2NvdmVyeSBhbGdvcml0aG1cclxuICAgIGNvbnNvbGUubG9nKCdVc2luZyBTbWFydCBSYW5kb20gRGlzY292ZXJ5IGFsZ29yaXRobScpO1xyXG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGF3YWl0IHRtZGJDbGllbnQuZGlzY292ZXJDb250ZW50KG1lZGlhVHlwZSwgZ2VucmVJZHMpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBTbWFydCBSYW5kb20gRGlzY292ZXJ5IHJldHVybmVkICR7Y2FuZGlkYXRlcy5sZW5ndGh9IGNhbmRpZGF0ZXNgKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBjYW5kaWRhdGVzLFxyXG4gICAgICAgIHRvdGFsUmVzdWx0czogY2FuZGlkYXRlcy5sZW5ndGgsXHJcbiAgICAgICAgcGFnZTogMSwgLy8gUGFnZSBpcyBub3cgYWJzdHJhY3RlZCBpbiBTbWFydCBSYW5kb20gRGlzY292ZXJ5XHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignVE1EQiBMYW1iZGEgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3Igc3RhY2s6JywgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLnN0YWNrIDogJ05vIHN0YWNrIHRyYWNlJyk7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFbnZpcm9ubWVudCB2YXJpYWJsZXM6Jywge1xyXG4gICAgICBUTURCX0FQSV9LRVk6IHByb2Nlc3MuZW52LlRNREJfQVBJX0tFWSA/ICdTRVQnIDogJ05PVCBTRVQnLFxyXG4gICAgICBUTURCX1JFQURfVE9LRU46IHByb2Nlc3MuZW52LlRNREJfUkVBRF9UT0tFTiA/ICdTRVQnIDogJ05PVCBTRVQnLFxyXG4gICAgICBUTURCX0JBU0VfVVJMOiBwcm9jZXNzLmVudi5UTURCX0JBU0VfVVJMIHx8ICdOT1QgU0VUJ1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBjYW5kaWRhdGVzOiBbXSxcclxuICAgICAgICB0b3RhbFJlc3VsdHM6IDAsXHJcbiAgICAgICAgcGFnZTogMSxcclxuICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICB9XHJcbn07Il19