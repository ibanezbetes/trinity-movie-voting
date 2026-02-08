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
            // PHASE 5: FETCH TRAILERS for final candidates (in parallel)
            console.log(`PHASE 5: Fetching trailers for ${finalCandidates.length} candidates`);
            await Promise.all(finalCandidates.map(async (candidate) => {
                candidate.trailerKey = await this.fetchTrailerKey(candidate.mediaType, candidate.id);
            }));
            const candidatesWithTrailers = finalCandidates.filter(c => c.trailerKey).length;
            console.log(`  → ${candidatesWithTrailers} candidates have trailers`);
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
     * Fetch trailer key for a movie/TV show from TMDB
     */
    async fetchTrailerKey(mediaType, tmdbId) {
        try {
            const endpoint = mediaType === 'MOVIE' ? `/movie/${tmdbId}/videos` : `/tv/${tmdbId}/videos`;
            const response = await axios_1.default.get(`${this.baseUrl}${endpoint}`, {
                headers: {
                    'accept': 'application/json',
                    'Authorization': `Bearer ${this.readToken}`
                },
                params: {
                    language: 'es-ES' // Try Spanish first
                }
            });
            const videos = response.data.results || [];
            // Find official YouTube trailer
            const trailer = videos.find((video) => video.site === 'YouTube' &&
                video.type === 'Trailer' &&
                video.official === true);
            // If no official Spanish trailer, try English
            if (!trailer) {
                const responseEn = await axios_1.default.get(`${this.baseUrl}${endpoint}`, {
                    headers: {
                        'accept': 'application/json',
                        'Authorization': `Bearer ${this.readToken}`
                    },
                    params: {
                        language: 'en-US'
                    }
                });
                const videosEn = responseEn.data.results || [];
                const trailerEn = videosEn.find((video) => video.site === 'YouTube' &&
                    video.type === 'Trailer');
                return trailerEn?.key;
            }
            return trailer?.key;
        }
        catch (error) {
            console.log(`Could not fetch trailer for ${mediaType} ${tmdbId}:`, error);
            return undefined;
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdG1kYi9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxrREFBMEI7QUFzRDFCLHlCQUF5QjtBQUN6QixNQUFNLG9CQUFvQjtJQUExQjtRQUNFLDRFQUE0RTtRQUM1RSxpRUFBaUU7UUFDaEQscUJBQWdCLEdBQUcscUZBQXFGLENBQUM7SUFVNUgsQ0FBQztJQVJDLGVBQWUsQ0FBQyxLQUFhLEVBQUUsUUFBZ0I7UUFDN0MsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDbkUsQ0FBQztJQUVELGFBQWEsQ0FBQyxJQUFZO1FBQ3hCLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFBRSxPQUFPLEtBQUssQ0FBQztRQUM5QyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDMUMsQ0FBQztDQUNGO0FBRUQsMENBQTBDO0FBQzFDLE1BQU0sVUFBVTtJQU1kO1FBRmlCLGlCQUFZLEdBQUcsRUFBRSxDQUFDLENBQUMsOEJBQThCO1FBR2hFLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksOEJBQThCLENBQUM7UUFDM0UsOERBQThEO1FBQzlELElBQUksQ0FBQyxTQUFTLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLElBQUksRUFBRSxDQUFDO1FBQy9FLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxvQkFBb0IsRUFBRSxDQUFDO1FBRTVDLE9BQU8sQ0FBQyxHQUFHLENBQUMsNEJBQTRCLENBQUMsQ0FBQztRQUMxQyxPQUFPLENBQUMsR0FBRyxD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O2dCQUNQLEtBQUssRUFBRSxZQUFZO2FBQ3BCO1NBQ0YsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUFsRVcsUUFBQSxPQUFPLFdBa0VsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcclxuXHJcbi8vIFR5cGVzXHJcbmludGVyZmFjZSBUTURCRGlzY292ZXJ5UGFyYW1zIHtcclxuICBwYWdlOiBudW1iZXI7XHJcbiAgd2l0aF9nZW5yZXM/OiBzdHJpbmc7XHJcbiAgbGFuZ3VhZ2U6IHN0cmluZztcclxuICByZWdpb24/OiBzdHJpbmc7XHJcbiAgc29ydF9ieTogc3RyaW5nO1xyXG4gIGluY2x1ZGVfYWR1bHQ6IGJvb2xlYW47XHJcbiAgd2l0aF9vcmlnaW5hbF9sYW5ndWFnZTogc3RyaW5nOyAvLyBXZXN0ZXJuIGxhbmd1YWdlcyBvbmx5XHJcbiAgJ3ZvdGVfY291bnQuZ3RlJz86IG51bWJlcjsgLy8gTWluaW11bSB2b3RlIGNvdW50IGZpbHRlclxyXG59XHJcblxyXG5pbnRlcmZhY2UgVE1EQk1vdmllUmVzcG9uc2Uge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU/OiBzdHJpbmc7XHJcbiAgbmFtZT86IHN0cmluZzsgLy8gVFYgc2hvd3MgdXNlICduYW1lJyBpbnN0ZWFkIG9mICd0aXRsZSdcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3Rlcl9wYXRoOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJlbGVhc2VfZGF0ZT86IHN0cmluZztcclxuICBmaXJzdF9haXJfZGF0ZT86IHN0cmluZzsgLy8gVFYgc2hvd3MgdXNlICdmaXJzdF9haXJfZGF0ZSdcclxuICBnZW5yZV9pZHM6IG51bWJlcltdO1xyXG4gIG9yaWdpbmFsX2xhbmd1YWdlOiBzdHJpbmc7XHJcbiAgbWVkaWFfdHlwZT86ICdtb3ZpZScgfCAndHYnO1xyXG4gIHZvdGVfY291bnQ/OiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNb3ZpZUNhbmRpZGF0ZSB7XHJcbiAgaWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIG92ZXJ2aWV3OiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aDogc3RyaW5nIHwgbnVsbDtcclxuICByZWxlYXNlRGF0ZTogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgZ2VucmVJZHM/OiBudW1iZXJbXTsgLy8gU3RvcmUgZ2VucmUgSURzIGZvciBwcmlvcml0aXphdGlvblxyXG4gIHRyYWlsZXJLZXk/OiBzdHJpbmc7IC8vIFlvdVR1YmUgdHJhaWxlciBrZXkgKG9wdGlvbmFsKVxyXG59XHJcblxyXG5pbnRlcmZhY2UgVE1EQkV2ZW50IHtcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIGdlbnJlSWRzPzogbnVtYmVyW107XHJcbiAgcGFnZT86IG51bWJlcjtcclxufVxyXG5cclxuaW50ZXJmYWNlIFRNREJSZXNwb25zZSB7XHJcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xyXG4gIGJvZHk6IHtcclxuICAgIGNhbmRpZGF0ZXM6IE1vdmllQ2FuZGlkYXRlW107XHJcbiAgICB0b3RhbFJlc3VsdHM6IG51bWJlcjtcclxuICAgIHBhZ2U6IG51bWJlcjtcclxuICB9O1xyXG59XHJcblxyXG4vLyBMYXRpbiBTY3JpcHQgVmFsaWRhdG9yXHJcbmNsYXNzIExhdGluU2NyaXB0VmFsaWRhdG9yIHtcclxuICAvLyBSZWdleCB0byBtYXRjaCBMYXRpbiBjaGFyYWN0ZXJzLCBudW1iZXJzLCBwdW5jdHVhdGlvbiwgYW5kIGNvbW1vbiBhY2NlbnRzXHJcbiAgLy8gRXhjbHVkZXMgQ0pLIChDaGluZXNlL0phcGFuZXNlL0tvcmVhbikgYW5kIEN5cmlsbGljIGNoYXJhY3RlcnNcclxuICBwcml2YXRlIHJlYWRvbmx5IGxhdGluU2NyaXB0UmVnZXggPSAvXltcXHUwMDAwLVxcdTAwN0ZcXHUwMEEwLVxcdTAwRkZcXHUwMTAwLVxcdTAxN0ZcXHUwMTgwLVxcdTAyNEZcXHUxRTAwLVxcdTFFRkZcXHNcXHB7UH1cXHB7Tn1dKiQvdTtcclxuICBcclxuICB2YWxpZGF0ZUNvbnRlbnQodGl0bGU6IHN0cmluZywgb3ZlcnZpZXc6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIHRoaXMuaXNMYXRpblNjcmlwdCh0aXRsZSkgJiYgdGhpcy5pc0xhdGluU2NyaXB0KG92ZXJ2aWV3KTtcclxuICB9XHJcbiAgXHJcbiAgaXNMYXRpblNjcmlwdCh0ZXh0OiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIGlmICghdGV4dCB8fCB0ZXh0LnRyaW0oKSA9PT0gJycpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiB0aGlzLmxhdGluU2NyaXB0UmVnZXgudGVzdCh0ZXh0KTtcclxuICB9XHJcbn1cclxuXHJcbi8vIFRNREIgQ2xpZW50IHdpdGggU21hcnQgUmFuZG9tIERpc2NvdmVyeVxyXG5jbGFzcyBUTURCQ2xpZW50IHtcclxuICBwcml2YXRlIHJlYWRvbmx5IGJhc2VVcmw6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHJlYWRUb2tlbjogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgdmFsaWRhdG9yOiBMYXRpblNjcmlwdFZhbGlkYXRvcjtcclxuICBwcml2YXRlIHJlYWRvbmx5IFRBUkdFVF9DT1VOVCA9IDUwOyAvLyBUYXJnZXQgbnVtYmVyIG9mIGNhbmRpZGF0ZXNcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmJhc2VVcmwgPSBwcm9jZXNzLmVudi5UTURCX0JBU0VfVVJMIHx8ICdodHRwczovL2FwaS50aGVtb3ZpZWRiLm9yZy8zJztcclxuICAgIC8vIFRyeSBib3RoIFRNREJfUkVBRF9UT0tFTiBhbmQgVE1EQl9BUElfS0VZIGZvciBjb21wYXRpYmlsaXR5XHJcbiAgICB0aGlzLnJlYWRUb2tlbiA9IHByb2Nlc3MuZW52LlRNREJfUkVBRF9UT0tFTiB8fCBwcm9jZXNzLmVudi5UTURCX0FQSV9LRVkgfHwgJyc7XHJcbiAgICB0aGlzLnZhbGlkYXRvciA9IG5ldyBMYXRpblNjcmlwdFZhbGlkYXRvcigpO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZygnVE1EQkNsaWVudCBpbml0aWFsaXppbmcuLi4nKTtcclxuICAgIGNvbnNvbGUubG9nKCdCYXNlIFVSTDonLCB0aGlzLmJhc2VVcmwpO1xyXG4gICAgY29uc29sZS5sb2coJ1Rva2VuIGNvbmZpZ3VyZWQ6JywgdGhpcy5yZWFkVG9rZW4gPyAnWUVTJyA6ICdOTycpO1xyXG4gICAgY29uc29sZS5sb2coJ1Rva2VuIGxlbmd0aDonLCB0aGlzLnJlYWRUb2tlbi5sZW5ndGgpO1xyXG4gICAgY29uc29sZS5sb2coJ1Rva2VuIGZpcnN0IDIwIGNoYXJzOicsIHRoaXMucmVhZFRva2VuLnN1YnN0cmluZygwLCAyMCkpO1xyXG4gICAgY29uc29sZS5sb2coJ0FsbCBlbnYgdmFyczonLCBPYmplY3Qua2V5cyhwcm9jZXNzLmVudikpO1xyXG4gICAgY29uc29sZS5sb2coJ1RNREIgZW52IHZhcnM6JywgT2JqZWN0LmtleXMocHJvY2Vzcy5lbnYpLmZpbHRlcihrZXkgPT4ga2V5LmluY2x1ZGVzKCdUTURCJykpKTtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLnJlYWRUb2tlbikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdBdmFpbGFibGUgZW52aXJvbm1lbnQgdmFyaWFibGVzOicsIE9iamVjdC5rZXlzKHByb2Nlc3MuZW52KS5maWx0ZXIoa2V5ID0+IGtleS5pbmNsdWRlcygnVE1EQicpKSk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVE1EQl9SRUFEX1RPS0VOIG9yIFRNREJfQVBJX0tFWSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU21hcnQgUmFuZG9tIERpc2NvdmVyeSBBbGdvcml0aG0gKEVuaGFuY2VkIHdpdGggU3RyaWN0IFByaW9yaXR5KVxyXG4gICAqIDEuIFBoYXNlIDE6IENoZWNrIHRvdGFsIHJlc3VsdHMgd2l0aCBTVFJJQ1QgKEFORCkgbG9naWNcclxuICAgKiAyLiBJZiB0b3RhbF9yZXN1bHRzID49IDUwOiBVc2Ugb25seSBBTkQgbG9naWMgKHByaW9yaXRpemUgaW50ZXJzZWN0aW9uKVxyXG4gICAqIDMuIElmIHRvdGFsX3Jlc3VsdHMgPCA1MDogRmFsbGJhY2sgdG8gT1IgbG9naWMgKGJyb2FkZXIgc2VhcmNoKVxyXG4gICAqIDQuIEZldGNoIGZyb20gcmFuZG9tIHBhZ2VzIHRvIGVuc3VyZSB2YXJpZXR5XHJcbiAgICogNS4gU2h1ZmZsZSBmaW5hbCByZXN1bHRzIGZvciBtYXhpbXVtIHJhbmRvbW5lc3NcclxuICAgKi9cclxuICBhc3luYyBkaXNjb3ZlckNvbnRlbnQobWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgZ2VucmVJZHM/OiBudW1iZXJbXSk6IFByb21pc2U8TW92aWVDYW5kaWRhdGVbXT4ge1xyXG4gICAgY29uc3QgY2FuZGlkYXRlc01hcCA9IG5ldyBNYXA8bnVtYmVyLCBNb3ZpZUNhbmRpZGF0ZT4oKTsgLy8gVXNlIE1hcCB0byBwcmV2ZW50IGR1cGxpY2F0ZXNcclxuICAgIGNvbnN0IE1JTl9SRVNVTFRTX1RIUkVTSE9MRCA9IDUwOyAvLyBNaW5pbXVtIHJlc3VsdHMgdG8gdXNlIHN0cmljdCBBTkQgbG9naWNcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYFN0YXJ0aW5nIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgZm9yICR7bWVkaWFUeXBlfSB3aXRoIGdlbnJlczogJHtnZW5yZUlkcz8uam9pbignLCcpIHx8ICdub25lJ31gKTtcclxuXHJcbiAgICAgIGxldCB1c2VTdHJpY3RMb2dpYyA9IGZhbHNlO1xyXG4gICAgICBsZXQgdG90YWxBdmFpbGFibGVSZXN1bHRzID0gMDtcclxuICAgICAgbGV0IHRvdGFsQXZhaWxhYmxlUGFnZXMgPSAxO1xyXG5cclxuICAgICAgLy8gUEhBU0UgMTogQ0hFQ0sgQVZBSUxBQklMSVRZIFdJVEggU1RSSUNUIChBTkQpIExPR0lDXHJcbiAgICAgIGlmIChnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1BIQVNFIDE6IENoZWNraW5nIGF2YWlsYWJpbGl0eSB3aXRoIFNUUklDVCAoQU5EKSBsb2dpYycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEZpcnN0LCBjaGVjayBob3cgbWFueSByZXN1bHRzIGV4aXN0IHdpdGggc3RyaWN0IEFORCBsb2dpY1xyXG4gICAgICAgIGNvbnN0IGNoZWNrUmVzcG9uc2UgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGJXaXRoTWV0YWRhdGEobWVkaWFUeXBlLCB7XHJcbiAgICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICAgIGxvZ2ljVHlwZTogJ0FORCcsXHJcbiAgICAgICAgICBwYWdlOiAxXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdG90YWxBdmFpbGFibGVSZXN1bHRzID0gY2hlY2tSZXNwb25zZS50b3RhbF9yZXN1bHRzO1xyXG4gICAgICAgIHRvdGFsQXZhaWxhYmxlUGFnZXMgPSBjaGVja1Jlc3BvbnNlLnRvdGFsX3BhZ2VzO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBTdHJpY3QgQU5EIHNlYXJjaCBmb3VuZCAke3RvdGFsQXZhaWxhYmxlUmVzdWx0c30gdG90YWwgcmVzdWx0cyBhY3Jvc3MgJHt0b3RhbEF2YWlsYWJsZVBhZ2VzfSBwYWdlc2ApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIERlY2lkZSBzdHJhdGVneSBiYXNlZCBvbiBhdmFpbGFibGUgcmVzdWx0c1xyXG4gICAgICAgIGlmICh0b3RhbEF2YWlsYWJsZVJlc3VsdHMgPj0gTUlOX1JFU1VMVFNfVEhSRVNIT0xEKSB7XHJcbiAgICAgICAgICB1c2VTdHJpY3RMb2dpYyA9IHRydWU7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgICDinIUgVXNpbmcgU1RSSUNUIChBTkQpIGxvZ2ljIC0gc3VmZmljaWVudCByZXN1bHRzIGF2YWlsYWJsZWApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICB1c2VTdHJpY3RMb2dpYyA9IGZhbHNlO1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYCAg4pqg77iPIFVzaW5nIEZBTExCQUNLIChPUikgbG9naWMgLSBvbmx5ICR7dG90YWxBdmFpbGFibGVSZXN1bHRzfSBzdHJpY3QgcmVzdWx0cyBhdmFpbGFibGVgKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSBpZiAoZ2VucmVJZHMgJiYgZ2VucmVJZHMubGVuZ3RoID09PSAxKSB7XHJcbiAgICAgICAgLy8gU2luZ2xlIGdlbnJlIGFsd2F5cyB1c2VzIEFORCAod2hpY2ggaXMgdGhlIHNhbWUgYXMgT1IgZm9yIG9uZSBnZW5yZSlcclxuICAgICAgICB1c2VTdHJpY3RMb2dpYyA9IHRydWU7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1NpbmdsZSBnZW5yZSBzZWxlY3RlZCAtIHVzaW5nIHN0YW5kYXJkIGxvZ2ljJyk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFBIQVNFIDI6IEZFVENIIENPTlRFTlQgQkFTRUQgT04gQ0hPU0VOIFNUUkFURUdZXHJcbiAgICAgIGNvbnN0IGxvZ2ljVHlwZSA9IHVzZVN0cmljdExvZ2ljID8gJ0FORCcgOiAnT1InO1xyXG4gICAgICBjb25zb2xlLmxvZyhgUEhBU0UgMjogRmV0Y2hpbmcgY29udGVudCB3aXRoICR7bG9naWNUeXBlfSBsb2dpY2ApO1xyXG5cclxuICAgICAgLy8gSWYgd2UncmUgdXNpbmcgc3RyaWN0IGxvZ2ljIGFuZCBjaGVja2VkIGF2YWlsYWJpbGl0eSwgdXNlIHRob3NlIHJlc3VsdHNcclxuICAgICAgaWYgKHVzZVN0cmljdExvZ2ljICYmIGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA+IDEpIHtcclxuICAgICAgICAvLyBSZS1mZXRjaCB3aXRoIG1ldGFkYXRhIHRvIGdldCB0b3RhbCBwYWdlcyBmb3IgcmFuZG9tIHNlbGVjdGlvblxyXG4gICAgICAgIGNvbnN0IG1ldGFkYXRhUmVzcG9uc2UgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGJXaXRoTWV0YWRhdGEobWVkaWFUeXBlLCB7XHJcbiAgICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICAgIGxvZ2ljVHlwZTogJ0FORCcsXHJcbiAgICAgICAgICBwYWdlOiAxXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdG90YWxBdmFpbGFibGVQYWdlcyA9IE1hdGgubWluKG1ldGFkYXRhUmVzcG9uc2UudG90YWxfcGFnZXMsIDUwMCk7IC8vIFRNREIgbGltaXRzIHRvIDUwMCBwYWdlc1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEZldGNoIGZyb20gbXVsdGlwbGUgcmFuZG9tIHBhZ2VzIHRvIHJlYWNoIHRhcmdldFxyXG4gICAgICAgIGNvbnN0IHBhZ2VzVG9GZXRjaCA9IE1hdGgubWluKDMsIHRvdGFsQXZhaWxhYmxlUGFnZXMpOyAvLyBGZXRjaCB1cCB0byAzIHJhbmRvbSBwYWdlc1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBGZXRjaGluZyBmcm9tICR7cGFnZXNUb0ZldGNofSByYW5kb20gcGFnZXMgKG91dCBvZiAke3RvdGFsQXZhaWxhYmxlUGFnZXN9IGF2YWlsYWJsZSlgKTtcclxuICAgICAgICBcclxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBhZ2VzVG9GZXRjaCAmJiBjYW5kaWRhdGVzTWFwLnNpemUgPCB0aGlzLlRBUkdFVF9DT1VOVDsgaSsrKSB7XHJcbiAgICAgICAgICBjb25zdCByYW5kb21QYWdlID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogdG90YWxBdmFpbGFibGVQYWdlcykgKyAxO1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYCAg4oaSIEZldGNoaW5nIHBhZ2UgJHtyYW5kb21QYWdlfSB3aXRoIEFORCBsb2dpY2ApO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgdGhpcy5mZXRjaEZyb21UbWRiKG1lZGlhVHlwZSwge1xyXG4gICAgICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICAgICAgbG9naWNUeXBlOiAnQU5EJyxcclxuICAgICAgICAgICAgcGFnZTogcmFuZG9tUGFnZVxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGNvbnN0IGZpbHRlcmVkID0gdGhpcy5hcHBseUJhc2VGaWx0ZXJzKHJlc3VsdHMsIG1lZGlhVHlwZSk7XHJcbiAgICAgICAgICBmaWx0ZXJlZC5mb3JFYWNoKGNhbmRpZGF0ZSA9PiB7XHJcbiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzTWFwLnNpemUgPCB0aGlzLlRBUkdFVF9DT1VOVCkge1xyXG4gICAgICAgICAgICAgIGNhbmRpZGF0ZXNNYXAuc2V0KGNhbmRpZGF0ZS5pZCwgY2FuZGlkYXRlKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBBZGRlZCAke2ZpbHRlcmVkLmxlbmd0aH0gY2FuZGlkYXRlcyAodG90YWw6ICR7Y2FuZGlkYXRlc01hcC5zaXplfSlgKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSBpZiAoIXVzZVN0cmljdExvZ2ljICYmIGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA+IDEpIHtcclxuICAgICAgICAvLyBVc2luZyBPUiBsb2dpYyBmYWxsYmFja1xyXG4gICAgICAgIGNvbnN0IG1ldGFkYXRhUmVzcG9uc2UgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGJXaXRoTWV0YWRhdGEobWVkaWFUeXBlLCB7XHJcbiAgICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICAgIGxvZ2ljVHlwZTogJ09SJyxcclxuICAgICAgICAgIHBhZ2U6IDFcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICB0b3RhbEF2YWlsYWJsZVBhZ2VzID0gTWF0aC5taW4obWV0YWRhdGFSZXNwb25zZS50b3RhbF9wYWdlcywgNTAwKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBGZXRjaCBmcm9tIG11bHRpcGxlIHJhbmRvbSBwYWdlc1xyXG4gICAgICAgIGNvbnN0IHBhZ2VzVG9GZXRjaCA9IE1hdGgubWluKDMsIHRvdGFsQXZhaWxhYmxlUGFnZXMpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBGZXRjaGluZyBmcm9tICR7cGFnZXNUb0ZldGNofSByYW5kb20gcGFnZXMgd2l0aCBPUiBsb2dpY2ApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGFnZXNUb0ZldGNoICYmIGNhbmRpZGF0ZXNNYXAuc2l6ZSA8IHRoaXMuVEFSR0VUX0NPVU5UOyBpKyspIHtcclxuICAgICAgICAgIGNvbnN0IHJhbmRvbVBhZ2UgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiB0b3RhbEF2YWlsYWJsZVBhZ2VzKSArIDE7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgRmV0Y2hpbmcgcGFnZSAke3JhbmRvbVBhZ2V9IHdpdGggT1IgbG9naWNgKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMuZmV0Y2hGcm9tVG1kYihtZWRpYVR5cGUsIHtcclxuICAgICAgICAgICAgZ2VucmVJZHMsXHJcbiAgICAgICAgICAgIGxvZ2ljVHlwZTogJ09SJyxcclxuICAgICAgICAgICAgcGFnZTogcmFuZG9tUGFnZVxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGNvbnN0IGZpbHRlcmVkID0gdGhpcy5hcHBseUJhc2VGaWx0ZXJzKHJlc3VsdHMsIG1lZGlhVHlwZSk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIFdoZW4gdXNpbmcgT1IgbG9naWMsIHByaW9yaXRpemUgbW92aWVzIHRoYXQgbWF0Y2ggQUxMIGdlbnJlc1xyXG4gICAgICAgICAgY29uc3QgcHJpb3JpdGl6ZWQgPSB0aGlzLnByaW9yaXRpemVNdWx0aUdlbnJlTWF0Y2hlcyhmaWx0ZXJlZCwgZ2VucmVJZHMpO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBwcmlvcml0aXplZC5mb3JFYWNoKGNhbmRpZGF0ZSA9PiB7XHJcbiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzTWFwLnNpemUgPCB0aGlzLlRBUkdFVF9DT1VOVCkge1xyXG4gICAgICAgICAgICAgIGNhbmRpZGF0ZXNNYXAuc2V0KGNhbmRpZGF0ZS5pZCwgY2FuZGlkYXRlKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBBZGRlZCAke3ByaW9yaXRpemVkLmxlbmd0aH0gY2FuZGlkYXRlcyAodG90YWw6ICR7Y2FuZGlkYXRlc01hcC5zaXplfSlgKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gTm8gZ2VucmVzIG9yIHNpbmdsZSBnZW5yZSAtIHN0YW5kYXJkIGZldGNoXHJcbiAgICAgICAgY29uc3QgcmFuZG9tUGFnZSA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDUwKSArIDE7XHJcbiAgICAgICAgY29uc29sZS5sb2coYCAg4oaSIEZldGNoaW5nIHBhZ2UgJHtyYW5kb21QYWdlfSAobm8gZ2VucmUgZmlsdGVyIG9yIHNpbmdsZSBnZW5yZSlgKTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgdGhpcy5mZXRjaEZyb21UbWRiKG1lZGlhVHlwZSwge1xyXG4gICAgICAgICAgZ2VucmVJZHMsXHJcbiAgICAgICAgICBwYWdlOiByYW5kb21QYWdlXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgZmlsdGVyZWQgPSB0aGlzLmFwcGx5QmFzZUZpbHRlcnMocmVzdWx0cywgbWVkaWFUeXBlKTtcclxuICAgICAgICBmaWx0ZXJlZC5mb3JFYWNoKGNhbmRpZGF0ZSA9PiBjYW5kaWRhdGVzTWFwLnNldChjYW5kaWRhdGUuaWQsIGNhbmRpZGF0ZSkpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBBZGRlZCAke2ZpbHRlcmVkLmxlbmd0aH0gY2FuZGlkYXRlc2ApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBQSEFTRSAzOiBBRERJVElPTkFMIEZFVENIRVMgSUYgTkVFREVEXHJcbiAgICAgIGxldCBmZXRjaEF0dGVtcHRzID0gMDtcclxuICAgICAgY29uc3QgbWF4QXR0ZW1wdHMgPSAzO1xyXG4gICAgICBcclxuICAgICAgd2hpbGUgKGNhbmRpZGF0ZXNNYXAuc2l6ZSA8IHRoaXMuVEFSR0VUX0NPVU5UICYmIGZldGNoQXR0ZW1wdHMgPCBtYXhBdHRlbXB0cykge1xyXG4gICAgICAgIGZldGNoQXR0ZW1wdHMrKztcclxuICAgICAgICBjb25zdCBuZWVkZWQgPSB0aGlzLlRBUkdFVF9DT1VOVCAtIGNhbmRpZGF0ZXNNYXAuc2l6ZTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgUEhBU0UgMyAoQXR0ZW1wdCAke2ZldGNoQXR0ZW1wdHN9KTogTmVlZCAke25lZWRlZH0gbW9yZSBjYW5kaWRhdGVzYCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgcmFuZG9tUGFnZSA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDUwKSArIDE7XHJcbiAgICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMuZmV0Y2hGcm9tVG1kYihtZWRpYVR5cGUsIHtcclxuICAgICAgICAgIGdlbnJlSWRzOiBnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAwID8gZ2VucmVJZHMgOiB1bmRlZmluZWQsXHJcbiAgICAgICAgICBsb2dpY1R5cGU6IGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA+IDEgPyBsb2dpY1R5cGUgOiB1bmRlZmluZWQsXHJcbiAgICAgICAgICBwYWdlOiByYW5kb21QYWdlXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgZmlsdGVyZWQgPSB0aGlzLmFwcGx5QmFzZUZpbHRlcnMocmVzdWx0cywgbWVkaWFUeXBlKTtcclxuICAgICAgICBcclxuICAgICAgICBsZXQgYWRkZWRDb3VudCA9IDA7XHJcbiAgICAgICAgZmlsdGVyZWQuZm9yRWFjaChjYW5kaWRhdGUgPT4ge1xyXG4gICAgICAgICAgaWYgKGNhbmRpZGF0ZXNNYXAuc2l6ZSA8IHRoaXMuVEFSR0VUX0NPVU5UICYmICFjYW5kaWRhdGVzTWFwLmhhcyhjYW5kaWRhdGUuaWQpKSB7XHJcbiAgICAgICAgICAgIGNhbmRpZGF0ZXNNYXAuc2V0KGNhbmRpZGF0ZS5pZCwgY2FuZGlkYXRlKTtcclxuICAgICAgICAgICAgYWRkZWRDb3VudCsrO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBBZGRlZCAke2FkZGVkQ291bnR9IG5ldyBjYW5kaWRhdGVzICh0b3RhbDogJHtjYW5kaWRhdGVzTWFwLnNpemV9KWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChhZGRlZENvdW50ID09PSAwKSBicmVhaztcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gUEhBU0UgNDogU0hVRkZMRSAtIEZpc2hlci1ZYXRlcyBzaHVmZmxlIGZvciBtYXhpbXVtIHJhbmRvbW5lc3NcclxuICAgICAgY29uc3QgY2FuZGlkYXRlc0FycmF5ID0gQXJyYXkuZnJvbShjYW5kaWRhdGVzTWFwLnZhbHVlcygpKTtcclxuICAgICAgY29uc3Qgc2h1ZmZsZWRDYW5kaWRhdGVzID0gdGhpcy5zaHVmZmxlQXJyYXkoY2FuZGlkYXRlc0FycmF5KTtcclxuICAgICAgY29uc3QgZmluYWxDYW5kaWRhdGVzID0gc2h1ZmZsZWRDYW5kaWRhdGVzLnNsaWNlKDAsIHRoaXMuVEFSR0VUX0NPVU5UKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFBIQVNFIDU6IEZFVENIIFRSQUlMRVJTIGZvciBmaW5hbCBjYW5kaWRhdGVzIChpbiBwYXJhbGxlbClcclxuICAgICAgY29uc29sZS5sb2coYFBIQVNFIDU6IEZldGNoaW5nIHRyYWlsZXJzIGZvciAke2ZpbmFsQ2FuZGlkYXRlcy5sZW5ndGh9IGNhbmRpZGF0ZXNgKTtcclxuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXHJcbiAgICAgICAgZmluYWxDYW5kaWRhdGVzLm1hcChhc3luYyAoY2FuZGlkYXRlKSA9PiB7XHJcbiAgICAgICAgICBjYW5kaWRhdGUudHJhaWxlcktleSA9IGF3YWl0IHRoaXMuZmV0Y2hUcmFpbGVyS2V5KGNhbmRpZGF0ZS5tZWRpYVR5cGUsIGNhbmRpZGF0ZS5pZCk7XHJcbiAgICAgICAgfSlcclxuICAgICAgKTtcclxuICAgICAgY29uc3QgY2FuZGlkYXRlc1dpdGhUcmFpbGVycyA9IGZpbmFsQ2FuZGlkYXRlcy5maWx0ZXIoYyA9PiBjLnRyYWlsZXJLZXkpLmxlbmd0aDtcclxuICAgICAgY29uc29sZS5sb2coYCAg4oaSICR7Y2FuZGlkYXRlc1dpdGhUcmFpbGVyc30gY2FuZGlkYXRlcyBoYXZlIHRyYWlsZXJzYCk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhg4pyFIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgY29tcGxldGU6ICR7ZmluYWxDYW5kaWRhdGVzLmxlbmd0aH0gY2FuZGlkYXRlcyAodGFyZ2V0OiAke3RoaXMuVEFSR0VUX0NPVU5UfSlgKTtcclxuICAgICAgY29uc29sZS5sb2coYCAgIFN0cmF0ZWd5OiAke3VzZVN0cmljdExvZ2ljID8gJ1NUUklDVCAoQU5EKScgOiAnRkFMTEJBQ0sgKE9SKSd9LCBUb3RhbCBhdmFpbGFibGU6ICR7dG90YWxBdmFpbGFibGVSZXN1bHRzfWApO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIGZpbmFsQ2FuZGlkYXRlcztcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgU21hcnQgUmFuZG9tIERpc2NvdmVyeSBFcnJvcjonLCBlcnJvcik7XHJcbiAgICAgIGNvbnN0IGZhbGxiYWNrQ2FuZGlkYXRlcyA9IEFycmF5LmZyb20oY2FuZGlkYXRlc01hcC52YWx1ZXMoKSk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGAgICBSZXR1cm5pbmcgJHtmYWxsYmFja0NhbmRpZGF0ZXMubGVuZ3RofSBjYW5kaWRhdGVzIGFzIGZhbGxiYWNrYCk7XHJcbiAgICAgIHJldHVybiBmYWxsYmFja0NhbmRpZGF0ZXM7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQcmlvcml0aXplIGNhbmRpZGF0ZXMgdGhhdCBtYXRjaCBBTEwgc2VsZWN0ZWQgZ2VucmVzIChmb3IgT1Igc2VhcmNoZXMpXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBwcmlvcml0aXplTXVsdGlHZW5yZU1hdGNoZXMoY2FuZGlkYXRlczogTW92aWVDYW5kaWRhdGVbXSwgc2VsZWN0ZWRHZW5yZUlkczogbnVtYmVyW10pOiBNb3ZpZUNhbmRpZGF0ZVtdIHtcclxuICAgIC8vIFNvcnQgY2FuZGlkYXRlczogdGhvc2UgbWF0Y2hpbmcgQUxMIGdlbnJlcyBmaXJzdCwgdGhlbiBvdGhlcnNcclxuICAgIHJldHVybiBjYW5kaWRhdGVzLnNvcnQoKGEsIGIpID0+IHtcclxuICAgICAgY29uc3QgYU1hdGNoZXNBbGwgPSBzZWxlY3RlZEdlbnJlSWRzLmV2ZXJ5KGdlbnJlSWQgPT4gYS5nZW5yZUlkcz8uaW5jbHVkZXMoZ2VucmVJZCkpO1xyXG4gICAgICBjb25zdCBiTWF0Y2hlc0FsbCA9IHNlbGVjdGVkR2VucmVJZHMuZXZlcnkoZ2VucmVJZCA9PiBiLmdlbnJlSWRzPy5pbmNsdWRlcyhnZW5yZUlkKSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBJZiBib3RoIG1hdGNoIGFsbCBvciBib3RoIGRvbid0LCBtYWludGFpbiBvcmlnaW5hbCBvcmRlclxyXG4gICAgICBpZiAoYU1hdGNoZXNBbGwgPT09IGJNYXRjaGVzQWxsKSByZXR1cm4gMDtcclxuICAgICAgXHJcbiAgICAgIC8vIFB1dCBpdGVtcyBtYXRjaGluZyBhbGwgZ2VucmVzIGZpcnN0XHJcbiAgICAgIHJldHVybiBhTWF0Y2hlc0FsbCA/IC0xIDogMTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRmV0Y2ggY29udGVudCBmcm9tIFRNREIgd2l0aCBzcGVjaWZpZWQgcGFyYW1ldGVycyAocmV0dXJucyBvbmx5IHJlc3VsdHMpXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhc3luYyBmZXRjaEZyb21UbWRiKFxyXG4gICAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgXHJcbiAgICBvcHRpb25zOiB7XHJcbiAgICAgIGdlbnJlSWRzPzogbnVtYmVyW107XHJcbiAgICAgIGxvZ2ljVHlwZT86ICdBTkQnIHwgJ09SJztcclxuICAgICAgcGFnZT86IG51bWJlcjtcclxuICAgIH0gPSB7fVxyXG4gICk6IFByb21pc2U8VE1EQk1vdmllUmVzcG9uc2VbXT4ge1xyXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGJXaXRoTWV0YWRhdGEobWVkaWFUeXBlLCBvcHRpb25zKTtcclxuICAgIHJldHVybiByZXNwb25zZS5yZXN1bHRzO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRmV0Y2ggY29udGVudCBmcm9tIFRNREIgd2l0aCBtZXRhZGF0YSAodG90YWxfcmVzdWx0cywgdG90YWxfcGFnZXMpXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhc3luYyBmZXRjaEZyb21UbWRiV2l0aE1ldGFkYXRhKFxyXG4gICAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgXHJcbiAgICBvcHRpb25zOiB7XHJcbiAgICAgIGdlbnJlSWRzPzogbnVtYmVyW107XHJcbiAgICAgIGxvZ2ljVHlwZT86ICdBTkQnIHwgJ09SJztcclxuICAgICAgcGFnZT86IG51bWJlcjtcclxuICAgIH0gPSB7fVxyXG4gICk6IFByb21pc2U8eyByZXN1bHRzOiBUTURCTW92aWVSZXNwb25zZVtdOyB0b3RhbF9yZXN1bHRzOiBudW1iZXI7IHRvdGFsX3BhZ2VzOiBudW1iZXIgfT4ge1xyXG4gICAgY29uc3QgeyBnZW5yZUlkcywgbG9naWNUeXBlLCBwYWdlID0gMSB9ID0gb3B0aW9ucztcclxuICAgIGNvbnN0IGVuZHBvaW50ID0gbWVkaWFUeXBlID09PSAnTU9WSUUnID8gJy9kaXNjb3Zlci9tb3ZpZScgOiAnL2Rpc2NvdmVyL3R2JztcclxuICAgIFxyXG4gICAgY29uc3QgcGFyYW1zOiBUTURCRGlzY292ZXJ5UGFyYW1zID0ge1xyXG4gICAgICBwYWdlLFxyXG4gICAgICBsYW5ndWFnZTogJ2VzLUVTJywgLy8gRGVmYXVsdCBsYW5ndWFnZVxyXG4gICAgICBzb3J0X2J5OiAncG9wdWxhcml0eS5kZXNjJyxcclxuICAgICAgaW5jbHVkZV9hZHVsdDogZmFsc2UsXHJcbiAgICAgIHdpdGhfb3JpZ2luYWxfbGFuZ3VhZ2U6ICdlbnxlc3xmcnxpdHxkZXxwdCcsIC8vIFdlc3Rlcm4gbGFuZ3VhZ2VzIG9ubHlcclxuICAgICAgJ3ZvdGVfY291bnQuZ3RlJzogNTAsIC8vIE1pbmltdW0gNTAgdm90ZXMgdG8gYXZvaWQgZ2FyYmFnZSBjb250ZW50IHdoaWxlIGFsbG93aW5nIG1vcmUgdmFyaWV0eVxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBBZGQgZ2VucmUgZmlsdGVyIGJhc2VkIG9uIGxvZ2ljIHR5cGVcclxuICAgIGlmIChnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgIGlmIChsb2dpY1R5cGUgPT09ICdPUicpIHtcclxuICAgICAgICBwYXJhbXMud2l0aF9nZW5yZXMgPSBnZW5yZUlkcy5qb2luKCd8Jyk7IC8vIE9SIGxvZ2ljOiBhbnkgZ2VucmUgbWF0Y2hlc1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHBhcmFtcy53aXRoX2dlbnJlcyA9IGdlbnJlSWRzLmpvaW4oJywnKTsgLy8gQU5EIGxvZ2ljOiBhbGwgZ2VucmVzIG11c3QgbWF0Y2hcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnNvbGUubG9nKGBGZXRjaGluZyBmcm9tIFRNREIgJHtlbmRwb2ludH0gd2l0aCBwYXJhbXM6YCwgSlNPTi5zdHJpbmdpZnkocGFyYW1zKSk7XHJcblxyXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQoYCR7dGhpcy5iYXNlVXJsfSR7ZW5kcG9pbnR9YCwge1xyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ2FjY2VwdCc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHt0aGlzLnJlYWRUb2tlbn1gXHJcbiAgICAgIH0sXHJcbiAgICAgIHBhcmFtc1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgcmVzdWx0czogVE1EQk1vdmllUmVzcG9uc2VbXSA9IHJlc3BvbnNlLmRhdGEucmVzdWx0cyB8fCBbXTtcclxuICAgIGNvbnN0IHRvdGFsX3Jlc3VsdHMgPSByZXNwb25zZS5kYXRhLnRvdGFsX3Jlc3VsdHMgfHwgMDtcclxuICAgIGNvbnN0IHRvdGFsX3BhZ2VzID0gcmVzcG9uc2UuZGF0YS50b3RhbF9wYWdlcyB8fCAxO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZyhgVE1EQiByZXR1cm5lZCAke3Jlc3VsdHMubGVuZ3RofSByZXN1bHRzIGZvciBwYWdlICR7cGFnZX0gKHRvdGFsOiAke3RvdGFsX3Jlc3VsdHN9IGFjcm9zcyAke3RvdGFsX3BhZ2VzfSBwYWdlcylgKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHsgcmVzdWx0cywgdG90YWxfcmVzdWx0cywgdG90YWxfcGFnZXMgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEZldGNoIHRyYWlsZXIga2V5IGZvciBhIG1vdmllL1RWIHNob3cgZnJvbSBUTURCXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhc3luYyBmZXRjaFRyYWlsZXJLZXkobWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgdG1kYklkOiBudW1iZXIpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgZW5kcG9pbnQgPSBtZWRpYVR5cGUgPT09ICdNT1ZJRScgPyBgL21vdmllLyR7dG1kYklkfS92aWRlb3NgIDogYC90di8ke3RtZGJJZH0vdmlkZW9zYDtcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0KGAke3RoaXMuYmFzZVVybH0ke2VuZHBvaW50fWAsIHtcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnYWNjZXB0JzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7dGhpcy5yZWFkVG9rZW59YFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgcGFyYW1zOiB7XHJcbiAgICAgICAgICBsYW5ndWFnZTogJ2VzLUVTJyAvLyBUcnkgU3BhbmlzaCBmaXJzdFxyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjb25zdCB2aWRlb3MgPSByZXNwb25zZS5kYXRhLnJlc3VsdHMgfHwgW107XHJcbiAgICAgIFxyXG4gICAgICAvLyBGaW5kIG9mZmljaWFsIFlvdVR1YmUgdHJhaWxlclxyXG4gICAgICBjb25zdCB0cmFpbGVyID0gdmlkZW9zLmZpbmQoKHZpZGVvOiBhbnkpID0+IFxyXG4gICAgICAgIHZpZGVvLnNpdGUgPT09ICdZb3VUdWJlJyAmJiBcclxuICAgICAgICB2aWRlby50eXBlID09PSAnVHJhaWxlcicgJiYgXHJcbiAgICAgICAgdmlkZW8ub2ZmaWNpYWwgPT09IHRydWVcclxuICAgICAgKTtcclxuICAgICAgXHJcbiAgICAgIC8vIElmIG5vIG9mZmljaWFsIFNwYW5pc2ggdHJhaWxlciwgdHJ5IEVuZ2xpc2hcclxuICAgICAgaWYgKCF0cmFpbGVyKSB7XHJcbiAgICAgICAgY29uc3QgcmVzcG9uc2VFbiA9IGF3YWl0IGF4aW9zLmdldChgJHt0aGlzLmJhc2VVcmx9JHtlbmRwb2ludH1gLCB7XHJcbiAgICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAgICdhY2NlcHQnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICAgICdBdXRob3JpemF0aW9uJzogYEJlYXJlciAke3RoaXMucmVhZFRva2VufWBcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgICBwYXJhbXM6IHtcclxuICAgICAgICAgICAgbGFuZ3VhZ2U6ICdlbi1VUydcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgY29uc3QgdmlkZW9zRW4gPSByZXNwb25zZUVuLmRhdGEucmVzdWx0cyB8fCBbXTtcclxuICAgICAgICBjb25zdCB0cmFpbGVyRW4gPSB2aWRlb3NFbi5maW5kKCh2aWRlbzogYW55KSA9PiBcclxuICAgICAgICAgIHZpZGVvLnNpdGUgPT09ICdZb3VUdWJlJyAmJiBcclxuICAgICAgICAgIHZpZGVvLnR5cGUgPT09ICdUcmFpbGVyJ1xyXG4gICAgICAgICk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIHRyYWlsZXJFbj8ua2V5O1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gdHJhaWxlcj8ua2V5O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5sb2coYENvdWxkIG5vdCBmZXRjaCB0cmFpbGVyIGZvciAke21lZGlhVHlwZX0gJHt0bWRiSWR9OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEFwcGx5IGJhc2UgcXVhbGl0eSBmaWx0ZXJzIHRvIFRNREIgcmVzdWx0c1xyXG4gICAqL1xyXG4gIHByaXZhdGUgYXBwbHlCYXNlRmlsdGVycyhyZXN1bHRzOiBUTURCTW92aWVSZXNwb25zZVtdLCBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnKTogTW92aWVDYW5kaWRhdGVbXSB7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdID0gW107XHJcblxyXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIHJlc3VsdHMpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBFeHRyYWN0IHRpdGxlIChtb3ZpZXMgdXNlICd0aXRsZScsIFRWIHNob3dzIHVzZSAnbmFtZScpXHJcbiAgICAgICAgY29uc3QgdGl0bGUgPSBpdGVtLnRpdGxlIHx8IGl0ZW0ubmFtZSB8fCAnJztcclxuICAgICAgICBjb25zdCBvdmVydmlldyA9IGl0ZW0ub3ZlcnZpZXcgfHwgJyc7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQmFzZSBxdWFsaXR5IGZpbHRlcnNcclxuICAgICAgICBpZiAoIWl0ZW0ucG9zdGVyX3BhdGgpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgaXRlbSB3aXRob3V0IHBvc3RlcjogXCIke3RpdGxlfVwiYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFvdmVydmlldyB8fCBvdmVydmlldy50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgb3V0IGl0ZW0gd2l0aG91dCBvdmVydmlldzogXCIke3RpdGxlfVwiYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFZvdGUgY291bnQgZmlsdGVyIChhZGRpdGlvbmFsIHNhZmV0eSBjaGVjaylcclxuICAgICAgICBpZiAoaXRlbS52b3RlX2NvdW50ICYmIGl0ZW0udm90ZV9jb3VudCA8IDUwKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgb3V0IGxvdy12b3RlIGl0ZW06IFwiJHt0aXRsZX1cIiAoJHtpdGVtLnZvdGVfY291bnR9IHZvdGVzKWApO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYW5ndWFnZSBmaWx0ZXIgLSBlbnN1cmUgV2VzdGVybiBsYW5ndWFnZXMgb25seVxyXG4gICAgICAgIGNvbnN0IGFsbG93ZWRMYW5ndWFnZXMgPSBbJ2VuJywgJ2VzJywgJ2ZyJywgJ2l0JywgJ2RlJywgJ3B0J107XHJcbiAgICAgICAgaWYgKCFhbGxvd2VkTGFuZ3VhZ2VzLmluY2x1ZGVzKGl0ZW0ub3JpZ2luYWxfbGFuZ3VhZ2UpKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgb3V0IG5vbi1XZXN0ZXJuIGxhbmd1YWdlOiBcIiR7dGl0bGV9XCIgKCR7aXRlbS5vcmlnaW5hbF9sYW5ndWFnZX0pYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQXBwbHkgTGF0aW4gU2NyaXB0IFZhbGlkYXRvclxyXG4gICAgICAgIGlmICghdGhpcy52YWxpZGF0b3IudmFsaWRhdGVDb250ZW50KHRpdGxlLCBvdmVydmlldykpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgbm9uLUxhdGluIGNvbnRlbnQ6IFwiJHt0aXRsZX1cImApO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBFeHRyYWN0IHJlbGVhc2UgZGF0ZVxyXG4gICAgICAgIGNvbnN0IHJlbGVhc2VEYXRlID0gaXRlbS5yZWxlYXNlX2RhdGUgfHwgaXRlbS5maXJzdF9haXJfZGF0ZSB8fCAnJztcclxuICAgICAgICBcclxuICAgICAgICAvLyBUcmFuc2Zvcm0gdG8gb3VyIGZvcm1hdFxyXG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZTogTW92aWVDYW5kaWRhdGUgPSB7XHJcbiAgICAgICAgICBpZDogaXRlbS5pZCxcclxuICAgICAgICAgIHRpdGxlLFxyXG4gICAgICAgICAgb3ZlcnZpZXcsXHJcbiAgICAgICAgICBwb3N0ZXJQYXRoOiBgaHR0cHM6Ly9pbWFnZS50bWRiLm9yZy90L3AvdzUwMCR7aXRlbS5wb3N0ZXJfcGF0aH1gLFxyXG4gICAgICAgICAgcmVsZWFzZURhdGUsXHJcbiAgICAgICAgICBtZWRpYVR5cGU6IG1lZGlhVHlwZSA9PT0gJ01PVklFJyA/ICdNT1ZJRScgOiAnVFYnLFxyXG4gICAgICAgICAgZ2VucmVJZHM6IGl0ZW0uZ2VucmVfaWRzIHx8IFtdLCAvLyBTdG9yZSBnZW5yZSBJRHMgZm9yIHByaW9yaXRpemF0aW9uXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY2FuZGlkYXRlcy5wdXNoKGNhbmRpZGF0ZSk7XHJcblxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgVE1EQiBpdGVtICR7aXRlbS5pZH06YCwgZXJyb3IpO1xyXG4gICAgICAgIC8vIENvbnRpbnVlIHByb2Nlc3Npbmcgb3RoZXIgaXRlbXNcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBjYW5kaWRhdGVzO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2h1ZmZsZSBhcnJheSB1c2luZyBGaXNoZXItWWF0ZXMgYWxnb3JpdGhtXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBzaHVmZmxlQXJyYXk8VD4oYXJyYXk6IFRbXSk6IFRbXSB7XHJcbiAgICBjb25zdCBzaHVmZmxlZCA9IFsuLi5hcnJheV07XHJcbiAgICBmb3IgKGxldCBpID0gc2h1ZmZsZWQubGVuZ3RoIC0gMTsgaSA+IDA7IGktLSkge1xyXG4gICAgICBjb25zdCBqID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogKGkgKyAxKSk7XHJcbiAgICAgIFtzaHVmZmxlZFtpXSwgc2h1ZmZsZWRbal1dID0gW3NodWZmbGVkW2pdLCBzaHVmZmxlZFtpXV07XHJcbiAgICB9XHJcbiAgICByZXR1cm4gc2h1ZmZsZWQ7XHJcbiAgfVxyXG5cclxuICAvLyBMZWdhY3kgbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5IChkZXByZWNhdGVkKVxyXG4gIGFzeW5jIGRpc2NvdmVyQ29udGVudExlZ2FjeShtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnLCBnZW5yZUlkcz86IG51bWJlcltdLCBwYWdlID0gMSk6IFByb21pc2U8TW92aWVDYW5kaWRhdGVbXT4ge1xyXG4gICAgY29uc29sZS53YXJuKCdVc2luZyBsZWdhY3kgZGlzY292ZXJDb250ZW50TGVnYWN5IG1ldGhvZCAtIGNvbnNpZGVyIHVwZ3JhZGluZyB0byBkaXNjb3ZlckNvbnRlbnQnKTtcclxuICAgIHJldHVybiB0aGlzLmRpc2NvdmVyQ29udGVudChtZWRpYVR5cGUsIGdlbnJlSWRzKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIExhbWJkYSBIYW5kbGVyXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyPFRNREJFdmVudCwgVE1EQlJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdUTURCIExhbWJkYSByZWNlaXZlZCBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCkpO1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgeyBtZWRpYVR5cGUsIGdlbnJlSWRzIH0gPSBldmVudDtcclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCFtZWRpYVR5cGUgfHwgIVsnTU9WSUUnLCAnVFYnXS5pbmNsdWRlcyhtZWRpYVR5cGUpKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgbWVkaWFUeXBlOicsIG1lZGlhVHlwZSk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBtZWRpYVR5cGUuIE11c3QgYmUgTU9WSUUgb3IgVFYnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBnZW5yZSBsaW1pdCAobWF4IDIgYXMgcGVyIG1hc3RlciBzcGVjKVxyXG4gICAgaWYgKGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA+IDIpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignVG9vIG1hbnkgZ2VucmVzOicsIGdlbnJlSWRzLmxlbmd0aCk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTWF4aW11bSAyIGdlbnJlcyBhbGxvd2VkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ2hlY2sgZW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbiAgICBjb25zdCB0bWRiUmVhZFRva2VuID0gcHJvY2Vzcy5lbnYuVE1EQl9SRUFEX1RPS0VOIHx8IHByb2Nlc3MuZW52LlRNREJfQVBJX0tFWSB8fCAnJztcclxuICAgIGlmICghdG1kYlJlYWRUb2tlbikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdUTURCIHRva2VuIG5vdCBmb3VuZCBpbiBlbnZpcm9ubWVudCB2YXJpYWJsZXMnKTtcclxuICAgICAgY29uc29sZS5lcnJvcignQXZhaWxhYmxlIGVudiB2YXJzOicsIE9iamVjdC5rZXlzKHByb2Nlc3MuZW52KS5maWx0ZXIoa2V5ID0+IGtleS5pbmNsdWRlcygnVE1EQicpKSk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVE1EQiBBUEkgdG9rZW4gbm90IGNvbmZpZ3VyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLmxvZygnVE1EQiB0b2tlbiBjb25maWd1cmVkLCBsZW5ndGg6JywgdG1kYlJlYWRUb2tlbi5sZW5ndGgpO1xyXG5cclxuICAgIGNvbnN0IHRtZGJDbGllbnQgPSBuZXcgVE1EQkNsaWVudCgpO1xyXG4gICAgXHJcbiAgICAvLyBVc2UgU21hcnQgUmFuZG9tIERpc2NvdmVyeSBhbGdvcml0aG1cclxuICAgIGNvbnNvbGUubG9nKCdVc2luZyBTbWFydCBSYW5kb20gRGlzY292ZXJ5IGFsZ29yaXRobScpO1xyXG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGF3YWl0IHRtZGJDbGllbnQuZGlzY292ZXJDb250ZW50KG1lZGlhVHlwZSwgZ2VucmVJZHMpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBTbWFydCBSYW5kb20gRGlzY292ZXJ5IHJldHVybmVkICR7Y2FuZGlkYXRlcy5sZW5ndGh9IGNhbmRpZGF0ZXNgKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBjYW5kaWRhdGVzLFxyXG4gICAgICAgIHRvdGFsUmVzdWx0czogY2FuZGlkYXRlcy5sZW5ndGgsXHJcbiAgICAgICAgcGFnZTogMSwgLy8gUGFnZSBpcyBub3cgYWJzdHJhY3RlZCBpbiBTbWFydCBSYW5kb20gRGlzY292ZXJ5XHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignVE1EQiBMYW1iZGEgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3Igc3RhY2s6JywgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLnN0YWNrIDogJ05vIHN0YWNrIHRyYWNlJyk7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFbnZpcm9ubWVudCB2YXJpYWJsZXM6Jywge1xyXG4gICAgICBUTURCX0FQSV9LRVk6IHByb2Nlc3MuZW52LlRNREJfQVBJX0tFWSA/ICdTRVQnIDogJ05PVCBTRVQnLFxyXG4gICAgICBUTURCX1JFQURfVE9LRU46IHByb2Nlc3MuZW52LlRNREJfUkVBRF9UT0tFTiA/ICdTRVQnIDogJ05PVCBTRVQnLFxyXG4gICAgICBUTURCX0JBU0VfVVJMOiBwcm9jZXNzLmVudi5UTURCX0JBU0VfVVJMIHx8ICdOT1QgU0VUJ1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBjYW5kaWRhdGVzOiBbXSxcclxuICAgICAgICB0b3RhbFJlc3VsdHM6IDAsXHJcbiAgICAgICAgcGFnZTogMSxcclxuICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICB9XHJcbn07Il19