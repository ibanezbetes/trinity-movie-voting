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
    async discoverContent(mediaType, genreIds, yearRange, platformIds) {
        const candidatesMap = new Map(); // Use Map to prevent duplicates
        const MIN_RESULTS_THRESHOLD = 50; // Minimum results to use strict AND logic
        try {
            console.log(`Starting Smart Random Discovery for ${mediaType} with genres: ${genreIds?.join(',') || 'none'}, years: ${yearRange ? `${yearRange.min}-${yearRange.max}` : 'all'}, platforms: ${platformIds?.join(',') || 'all'}`);
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
                    page: 1,
                    yearRange,
                    platformIds
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
                    page: 1,
                    yearRange,
                    platformIds
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
                        page: randomPage,
                        yearRange,
                        platformIds
                    });
                    const filtered = this.applyBaseFilters(results, mediaType, yearRange);
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
                    page: 1,
                    yearRange,
                    platformIds
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
                        page: randomPage,
                        yearRange,
                        platformIds
                    });
                    const filtered = this.applyBaseFilters(results, mediaType, yearRange);
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
                // First, get metadata to know how many pages are available
                const metadataResponse = await this.fetchFromTmdbWithMetadata(mediaType, {
                    genreIds,
                    page: 1,
                    yearRange,
                    platformIds
                });
                totalAvailablePages = Math.min(metadataResponse.total_pages, 500);
                const randomPage = Math.floor(Math.random() * totalAvailablePages) + 1;
                console.log(`  → Fetching page ${randomPage} of ${totalAvailablePages} available (no genre filter or single genre)`);
                const results = await this.fetchFromTmdb(mediaType, {
                    genreIds,
                    page: randomPage,
                    yearRange,
                    platformIds
                });
                const filtered = this.applyBaseFilters(results, mediaType, yearRange);
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
                // Get metadata to know available pages
                const metadataResponse = await this.fetchFromTmdbWithMetadata(mediaType, {
                    genreIds: genreIds && genreIds.length > 0 ? genreIds : undefined,
                    logicType: genreIds && genreIds.length > 1 ? logicType : undefined,
                    page: 1,
                    yearRange,
                    platformIds
                });
                const availablePages = Math.min(metadataResponse.total_pages, 500);
                if (availablePages === 0) {
                    console.log(`  → No pages available, stopping additional fetches`);
                    break;
                }
                const randomPage = Math.floor(Math.random() * availablePages) + 1;
                console.log(`  → Fetching page ${randomPage} of ${availablePages} available`);
                const results = await this.fetchFromTmdb(mediaType, {
                    genreIds: genreIds && genreIds.length > 0 ? genreIds : undefined,
                    logicType: genreIds && genreIds.length > 1 ? logicType : undefined,
                    page: randomPage,
                    yearRange,
                    platformIds
                });
                const filtered = this.applyBaseFilters(results, mediaType, yearRange);
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
        const { genreIds, logicType, page = 1, yearRange, platformIds } = options;
        const endpoint = mediaType === 'MOVIE' ? '/discover/movie' : '/discover/tv';
        const params = {
            page,
            language: 'es-ES', // Default language
            sort_by: 'popularity.desc',
            include_adult: false,
            with_original_language: 'en|es|fr|it|de|pt', // Western languages only
            'vote_count.gte': platformIds && platformIds.length > 0 ? 20 : 50, // Lower threshold when filtering by platform
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
        // Add year range filter
        if (yearRange) {
            if (mediaType === 'MOVIE') {
                params['primary_release_date.gte'] = `${yearRange.min}-01-01`;
                params['primary_release_date.lte'] = `${yearRange.max}-12-31`;
            }
            else {
                params['first_air_date.gte'] = `${yearRange.min}-01-01`;
                params['first_air_date.lte'] = `${yearRange.max}-12-31`;
            }
        }
        // Add platform filter (streaming providers)
        if (platformIds && platformIds.length > 0) {
            params.with_watch_providers = platformIds.join('|'); // OR logic for platforms
            params.watch_region = 'ES'; // Spain region
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
    applyBaseFilters(results, mediaType, yearRange) {
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
                if (item.vote_count && item.vote_count < 20) {
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
                // Year range filter - validate release date is within range
                if (yearRange && releaseDate) {
                    const releaseYear = parseInt(releaseDate.split('-')[0]);
                    if (!isNaN(releaseYear) && (releaseYear < yearRange.min || releaseYear > yearRange.max)) {
                        console.log(`Filtered out item outside year range: "${title}" (${releaseYear}, expected ${yearRange.min}-${yearRange.max})`);
                        continue;
                    }
                }
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
        return this.discoverContent(mediaType, genreIds, undefined, undefined);
    }
    /**
     * Discover mixed content (both movies and TV shows)
     */
    async discoverContentMixed(genreIds, yearRange, platformIds) {
        console.log('Discovering mixed content (MOVIE + TV)');
        // Fetch both movies and TV shows in parallel
        const [movieCandidates, tvCandidates] = await Promise.all([
            this.discoverContent('MOVIE', genreIds, yearRange, platformIds),
            this.discoverContent('TV', genreIds, yearRange, platformIds)
        ]);
        // Combine and shuffle
        const allCandidates = [...movieCandidates, ...tvCandidates];
        const shuffled = this.shuffleArray(allCandidates);
        console.log(`Mixed content discovery: ${movieCandidates.length} movies + ${tvCandidates.length} TV shows = ${shuffled.length} total`);
        return shuffled.slice(0, this.TARGET_COUNT);
    }
}
// Lambda Handler
const handler = async (event) => {
    console.log('TMDB Lambda received event:', JSON.stringify(event));
    try {
        const { mediaType, genreIds, yearRange, platformIds } = event;
        // Validate input
        if (!mediaType || !['MOVIE', 'TV', 'BOTH'].includes(mediaType)) {
            console.error('Invalid mediaType:', mediaType);
            throw new Error('Invalid mediaType. Must be MOVIE, TV, or BOTH');
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
        let candidates;
        // Handle BOTH media type (mixed content)
        if (mediaType === 'BOTH') {
            console.log('Using Mixed Content Discovery for BOTH');
            candidates = await tmdbClient.discoverContentMixed(genreIds, yearRange, platformIds);
        }
        else {
            // Use Smart Random Discovery algorithm for single media type
            console.log(`Using Smart Random Discovery algorithm for ${mediaType}`);
            candidates = await tmdbClient.discoverContent(mediaType, genreIds, yearRange, platformIds);
        }
        console.log(`Discovery returned ${candidates.length} candidates`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdG1kYi9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxrREFBMEI7QUF3RDFCLHlCQUF5QjtBQUN6QixNQUFNLG9CQUFvQjtJQUExQjtRQUNFLDRFQUE0RTtRQUM1RSxpRUFBaUU7UUFDaEQscUJBQWdCLEdBQUcscUZBQXFGLENBQUM7SUFVNUgsQ0FBQztJQVJDLGVBQWUsQ0FBQyxLQUFhLEVBQUUsUUFBZ0I7UUFDN0MsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDbkUsQ0FBQztJQUVELGFBQWEsQ0FBQyxJQUFZO1FBQ3hCLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFBRSxPQUFPLEtBQUssQ0FBQztRQUM5QyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDMUMsQ0FBQztDQUNGO0FBRUQsMENBQTBDO0FBQzFDLE1BQU0sVUFBVTtJQU1kO1FBRmlCLGlCQUFZLEdBQUcsRUFBRSxDQUFDLENBQUMsOEJBQThCO1FBR2hFLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksOEJBQThCLENBQUM7UUFDM0UsOERBQThEO1FBQzlELElBQUksQ0FBQyxTQUFTLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLElBQUksRUFBRSxDQUFDO1FBQy9FLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxvQkFBb0IsRUFBRSxDQUFDO1FBRTVDLE9BQU8sQ0FBQyxHQUFHLENBQUMsNEJBQTRCLENBQUMsQ0FBQztRQUMxQyxPQUFPLENBQUMsR0FBRyxD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LE9BQU8sQ0FBQyxLQUFLLENBQUMsd0JBQXdCLEVBQUU7WUFDdEMsWUFBWSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDMUQsZUFBZSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDaEUsYUFBYSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxJQUFJLFNBQVM7U0FDdEQsQ0FBQyxDQUFDO1FBRUgsTUFBTSxZQUFZLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUM7UUFFdkYsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFO2dCQUNKLFVBQVUsRUFBRSxFQUFFO2dCQUNkLFlBQVksRUFBRSxDQUFDO2dCQUNmLElBQUksRUFBRSxDQUFDO2dCQUNQLEtBQUssRUFBRSxZQUFZO2FBQ3BCO1NBQ0YsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUExRVcsUUFBQSxPQUFPLFdBMEVsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcclxuXHJcbi8vIFR5cGVzXHJcbmludGVyZmFjZSBUTURCRGlzY292ZXJ5UGFyYW1zIHtcclxuICBwYWdlOiBudW1iZXI7XHJcbiAgd2l0aF9nZW5yZXM/OiBzdHJpbmc7XHJcbiAgbGFuZ3VhZ2U6IHN0cmluZztcclxuICByZWdpb24/OiBzdHJpbmc7XHJcbiAgc29ydF9ieTogc3RyaW5nO1xyXG4gIGluY2x1ZGVfYWR1bHQ6IGJvb2xlYW47XHJcbiAgd2l0aF9vcmlnaW5hbF9sYW5ndWFnZTogc3RyaW5nOyAvLyBXZXN0ZXJuIGxhbmd1YWdlcyBvbmx5XHJcbiAgJ3ZvdGVfY291bnQuZ3RlJz86IG51bWJlcjsgLy8gTWluaW11bSB2b3RlIGNvdW50IGZpbHRlclxyXG59XHJcblxyXG5pbnRlcmZhY2UgVE1EQk1vdmllUmVzcG9uc2Uge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU/OiBzdHJpbmc7XHJcbiAgbmFtZT86IHN0cmluZzsgLy8gVFYgc2hvd3MgdXNlICduYW1lJyBpbnN0ZWFkIG9mICd0aXRsZSdcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3Rlcl9wYXRoOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJlbGVhc2VfZGF0ZT86IHN0cmluZztcclxuICBmaXJzdF9haXJfZGF0ZT86IHN0cmluZzsgLy8gVFYgc2hvd3MgdXNlICdmaXJzdF9haXJfZGF0ZSdcclxuICBnZW5yZV9pZHM6IG51bWJlcltdO1xyXG4gIG9yaWdpbmFsX2xhbmd1YWdlOiBzdHJpbmc7XHJcbiAgbWVkaWFfdHlwZT86ICdtb3ZpZScgfCAndHYnO1xyXG4gIHZvdGVfY291bnQ/OiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNb3ZpZUNhbmRpZGF0ZSB7XHJcbiAgaWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIG92ZXJ2aWV3OiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aDogc3RyaW5nIHwgbnVsbDtcclxuICByZWxlYXNlRGF0ZTogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgZ2VucmVJZHM/OiBudW1iZXJbXTsgLy8gU3RvcmUgZ2VucmUgSURzIGZvciBwcmlvcml0aXphdGlvblxyXG4gIHRyYWlsZXJLZXk/OiBzdHJpbmc7IC8vIFlvdVR1YmUgdHJhaWxlciBrZXkgKG9wdGlvbmFsKVxyXG59XHJcblxyXG5pbnRlcmZhY2UgVE1EQkV2ZW50IHtcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnIHwgJ0JPVEgnO1xyXG4gIGdlbnJlSWRzPzogbnVtYmVyW107XHJcbiAgeWVhclJhbmdlPzogeyBtaW46IG51bWJlcjsgbWF4OiBudW1iZXIgfTtcclxuICBwbGF0Zm9ybUlkcz86IG51bWJlcltdO1xyXG4gIHBhZ2U/OiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBUTURCUmVzcG9uc2Uge1xyXG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcclxuICBib2R5OiB7XHJcbiAgICBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdO1xyXG4gICAgdG90YWxSZXN1bHRzOiBudW1iZXI7XHJcbiAgICBwYWdlOiBudW1iZXI7XHJcbiAgfTtcclxufVxyXG5cclxuLy8gTGF0aW4gU2NyaXB0IFZhbGlkYXRvclxyXG5jbGFzcyBMYXRpblNjcmlwdFZhbGlkYXRvciB7XHJcbiAgLy8gUmVnZXggdG8gbWF0Y2ggTGF0aW4gY2hhcmFjdGVycywgbnVtYmVycywgcHVuY3R1YXRpb24sIGFuZCBjb21tb24gYWNjZW50c1xyXG4gIC8vIEV4Y2x1ZGVzIENKSyAoQ2hpbmVzZS9KYXBhbmVzZS9Lb3JlYW4pIGFuZCBDeXJpbGxpYyBjaGFyYWN0ZXJzXHJcbiAgcHJpdmF0ZSByZWFkb25seSBsYXRpblNjcmlwdFJlZ2V4ID0gL15bXFx1MDAwMC1cXHUwMDdGXFx1MDBBMC1cXHUwMEZGXFx1MDEwMC1cXHUwMTdGXFx1MDE4MC1cXHUwMjRGXFx1MUUwMC1cXHUxRUZGXFxzXFxwe1B9XFxwe059XSokL3U7XHJcbiAgXHJcbiAgdmFsaWRhdGVDb250ZW50KHRpdGxlOiBzdHJpbmcsIG92ZXJ2aWV3OiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIHJldHVybiB0aGlzLmlzTGF0aW5TY3JpcHQodGl0bGUpICYmIHRoaXMuaXNMYXRpblNjcmlwdChvdmVydmlldyk7XHJcbiAgfVxyXG4gIFxyXG4gIGlzTGF0aW5TY3JpcHQodGV4dDogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICBpZiAoIXRleHQgfHwgdGV4dC50cmltKCkgPT09ICcnKSByZXR1cm4gZmFsc2U7XHJcbiAgICByZXR1cm4gdGhpcy5sYXRpblNjcmlwdFJlZ2V4LnRlc3QodGV4dCk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBUTURCIENsaWVudCB3aXRoIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnlcclxuY2xhc3MgVE1EQkNsaWVudCB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBiYXNlVXJsOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSByZWFkVG9rZW46IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHZhbGlkYXRvcjogTGF0aW5TY3JpcHRWYWxpZGF0b3I7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBUQVJHRVRfQ09VTlQgPSA1MDsgLy8gVGFyZ2V0IG51bWJlciBvZiBjYW5kaWRhdGVzXHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5iYXNlVXJsID0gcHJvY2Vzcy5lbnYuVE1EQl9CQVNFX1VSTCB8fCAnaHR0cHM6Ly9hcGkudGhlbW92aWVkYi5vcmcvMyc7XHJcbiAgICAvLyBUcnkgYm90aCBUTURCX1JFQURfVE9LRU4gYW5kIFRNREJfQVBJX0tFWSBmb3IgY29tcGF0aWJpbGl0eVxyXG4gICAgdGhpcy5yZWFkVG9rZW4gPSBwcm9jZXNzLmVudi5UTURCX1JFQURfVE9LRU4gfHwgcHJvY2Vzcy5lbnYuVE1EQl9BUElfS0VZIHx8ICcnO1xyXG4gICAgdGhpcy52YWxpZGF0b3IgPSBuZXcgTGF0aW5TY3JpcHRWYWxpZGF0b3IoKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ1RNREJDbGllbnQgaW5pdGlhbGl6aW5nLi4uJyk7XHJcbiAgICBjb25zb2xlLmxvZygnQmFzZSBVUkw6JywgdGhpcy5iYXNlVXJsKTtcclxuICAgIGNvbnNvbGUubG9nKCdUb2tlbiBjb25maWd1cmVkOicsIHRoaXMucmVhZFRva2VuID8gJ1lFUycgOiAnTk8nKTtcclxuICAgIGNvbnNvbGUubG9nKCdUb2tlbiBsZW5ndGg6JywgdGhpcy5yZWFkVG9rZW4ubGVuZ3RoKTtcclxuICAgIGNvbnNvbGUubG9nKCdUb2tlbiBmaXJzdCAyMCBjaGFyczonLCB0aGlzLnJlYWRUb2tlbi5zdWJzdHJpbmcoMCwgMjApKTtcclxuICAgIGNvbnNvbGUubG9nKCdBbGwgZW52IHZhcnM6JywgT2JqZWN0LmtleXMocHJvY2Vzcy5lbnYpKTtcclxuICAgIGNvbnNvbGUubG9nKCdUTURCIGVudiB2YXJzOicsIE9iamVjdC5rZXlzKHByb2Nlc3MuZW52KS5maWx0ZXIoa2V5ID0+IGtleS5pbmNsdWRlcygnVE1EQicpKSk7XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5yZWFkVG9rZW4pIHtcclxuICAgICAgY29uc29sZS5lcnJvcignQXZhaWxhYmxlIGVudmlyb25tZW50IHZhcmlhYmxlczonLCBPYmplY3Qua2V5cyhwcm9jZXNzLmVudikuZmlsdGVyKGtleSA9PiBrZXkuaW5jbHVkZXMoJ1RNREInKSkpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RNREJfUkVBRF9UT0tFTiBvciBUTURCX0FQSV9LRVkgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgQWxnb3JpdGhtIChFbmhhbmNlZCB3aXRoIFN0cmljdCBQcmlvcml0eSlcclxuICAgKiAxLiBQaGFzZSAxOiBDaGVjayB0b3RhbCByZXN1bHRzIHdpdGggU1RSSUNUIChBTkQpIGxvZ2ljXHJcbiAgICogMi4gSWYgdG90YWxfcmVzdWx0cyA+PSA1MDogVXNlIG9ubHkgQU5EIGxvZ2ljIChwcmlvcml0aXplIGludGVyc2VjdGlvbilcclxuICAgKiAzLiBJZiB0b3RhbF9yZXN1bHRzIDwgNTA6IEZhbGxiYWNrIHRvIE9SIGxvZ2ljIChicm9hZGVyIHNlYXJjaClcclxuICAgKiA0LiBGZXRjaCBmcm9tIHJhbmRvbSBwYWdlcyB0byBlbnN1cmUgdmFyaWV0eVxyXG4gICAqIDUuIFNodWZmbGUgZmluYWwgcmVzdWx0cyBmb3IgbWF4aW11bSByYW5kb21uZXNzXHJcbiAgICovXHJcbiAgYXN5bmMgZGlzY292ZXJDb250ZW50KFxyXG4gICAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgXHJcbiAgICBnZW5yZUlkcz86IG51bWJlcltdLCBcclxuICAgIHllYXJSYW5nZT86IHsgbWluOiBudW1iZXI7IG1heDogbnVtYmVyIH0sIFxyXG4gICAgcGxhdGZvcm1JZHM/OiBudW1iZXJbXVxyXG4gICk6IFByb21pc2U8TW92aWVDYW5kaWRhdGVbXT4ge1xyXG4gICAgY29uc3QgY2FuZGlkYXRlc01hcCA9IG5ldyBNYXA8bnVtYmVyLCBNb3ZpZUNhbmRpZGF0ZT4oKTsgLy8gVXNlIE1hcCB0byBwcmV2ZW50IGR1cGxpY2F0ZXNcclxuICAgIGNvbnN0IE1JTl9SRVNVTFRTX1RIUkVTSE9MRCA9IDUwOyAvLyBNaW5pbXVtIHJlc3VsdHMgdG8gdXNlIHN0cmljdCBBTkQgbG9naWNcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coYFN0YXJ0aW5nIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgZm9yICR7bWVkaWFUeXBlfSB3aXRoIGdlbnJlczogJHtnZW5yZUlkcz8uam9pbignLCcpIHx8ICdub25lJ30sIHllYXJzOiAke3llYXJSYW5nZSA/IGAke3llYXJSYW5nZS5taW59LSR7eWVhclJhbmdlLm1heH1gIDogJ2FsbCd9LCBwbGF0Zm9ybXM6ICR7cGxhdGZvcm1JZHM/LmpvaW4oJywnKSB8fCAnYWxsJ31gKTtcclxuXHJcbiAgICAgIGxldCB1c2VTdHJpY3RMb2dpYyA9IGZhbHNlO1xyXG4gICAgICBsZXQgdG90YWxBdmFpbGFibGVSZXN1bHRzID0gMDtcclxuICAgICAgbGV0IHRvdGFsQXZhaWxhYmxlUGFnZXMgPSAxO1xyXG5cclxuICAgICAgLy8gUEhBU0UgMTogQ0hFQ0sgQVZBSUxBQklMSVRZIFdJVEggU1RSSUNUIChBTkQpIExPR0lDXHJcbiAgICAgIGlmIChnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1BIQVNFIDE6IENoZWNraW5nIGF2YWlsYWJpbGl0eSB3aXRoIFNUUklDVCAoQU5EKSBsb2dpYycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEZpcnN0LCBjaGVjayBob3cgbWFueSByZXN1bHRzIGV4aXN0IHdpdGggc3RyaWN0IEFORCBsb2dpY1xyXG4gICAgICAgIGNvbnN0IGNoZWNrUmVzcG9uc2UgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGJXaXRoTWV0YWRhdGEobWVkaWFUeXBlLCB7XHJcbiAgICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICAgIGxvZ2ljVHlwZTogJ0FORCcsXHJcbiAgICAgICAgICBwYWdlOiAxLFxyXG4gICAgICAgICAgeWVhclJhbmdlLFxyXG4gICAgICAgICAgcGxhdGZvcm1JZHNcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICB0b3RhbEF2YWlsYWJsZVJlc3VsdHMgPSBjaGVja1Jlc3BvbnNlLnRvdGFsX3Jlc3VsdHM7XHJcbiAgICAgICAgdG90YWxBdmFpbGFibGVQYWdlcyA9IGNoZWNrUmVzcG9uc2UudG90YWxfcGFnZXM7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc29sZS5sb2coYCAg4oaSIFN0cmljdCBBTkQgc2VhcmNoIGZvdW5kICR7dG90YWxBdmFpbGFibGVSZXN1bHRzfSB0b3RhbCByZXN1bHRzIGFjcm9zcyAke3RvdGFsQXZhaWxhYmxlUGFnZXN9IHBhZ2VzYCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gRGVjaWRlIHN0cmF0ZWd5IGJhc2VkIG9uIGF2YWlsYWJsZSByZXN1bHRzXHJcbiAgICAgICAgaWYgKHRvdGFsQXZhaWxhYmxlUmVzdWx0cyA+PSBNSU5fUkVTVUxUU19USFJFU0hPTEQpIHtcclxuICAgICAgICAgIHVzZVN0cmljdExvZ2ljID0gdHJ1ZTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGAgIOKchSBVc2luZyBTVFJJQ1QgKEFORCkgbG9naWMgLSBzdWZmaWNpZW50IHJlc3VsdHMgYXZhaWxhYmxlYCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIHVzZVN0cmljdExvZ2ljID0gZmFsc2U7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgICDimqDvuI8gVXNpbmcgRkFMTEJBQ0sgKE9SKSBsb2dpYyAtIG9ubHkgJHt0b3RhbEF2YWlsYWJsZVJlc3VsdHN9IHN0cmljdCByZXN1bHRzIGF2YWlsYWJsZWApO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIGlmIChnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPT09IDEpIHtcclxuICAgICAgICAvLyBTaW5nbGUgZ2VucmUgYWx3YXlzIHVzZXMgQU5EICh3aGljaCBpcyB0aGUgc2FtZSBhcyBPUiBmb3Igb25lIGdlbnJlKVxyXG4gICAgICAgIHVzZVN0cmljdExvZ2ljID0gdHJ1ZTtcclxuICAgICAgICBjb25zb2xlLmxvZygnU2luZ2xlIGdlbnJlIHNlbGVjdGVkIC0gdXNpbmcgc3RhbmRhcmQgbG9naWMnKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gUEhBU0UgMjogRkVUQ0ggQ09OVEVOVCBCQVNFRCBPTiBDSE9TRU4gU1RSQVRFR1lcclxuICAgICAgY29uc3QgbG9naWNUeXBlID0gdXNlU3RyaWN0TG9naWMgPyAnQU5EJyA6ICdPUic7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBQSEFTRSAyOiBGZXRjaGluZyBjb250ZW50IHdpdGggJHtsb2dpY1R5cGV9IGxvZ2ljYCk7XHJcblxyXG4gICAgICAvLyBJZiB3ZSdyZSB1c2luZyBzdHJpY3QgbG9naWMgYW5kIGNoZWNrZWQgYXZhaWxhYmlsaXR5LCB1c2UgdGhvc2UgcmVzdWx0c1xyXG4gICAgICBpZiAodXNlU3RyaWN0TG9naWMgJiYgZ2VucmVJZHMgJiYgZ2VucmVJZHMubGVuZ3RoID4gMSkge1xyXG4gICAgICAgIC8vIFJlLWZldGNoIHdpdGggbWV0YWRhdGEgdG8gZ2V0IHRvdGFsIHBhZ2VzIGZvciByYW5kb20gc2VsZWN0aW9uXHJcbiAgICAgICAgY29uc3QgbWV0YWRhdGFSZXNwb25zZSA9IGF3YWl0IHRoaXMuZmV0Y2hGcm9tVG1kYldpdGhNZXRhZGF0YShtZWRpYVR5cGUsIHtcclxuICAgICAgICAgIGdlbnJlSWRzLFxyXG4gICAgICAgICAgbG9naWNUeXBlOiAnQU5EJyxcclxuICAgICAgICAgIHBhZ2U6IDEsXHJcbiAgICAgICAgICB5ZWFyUmFuZ2UsXHJcbiAgICAgICAgICBwbGF0Zm9ybUlkc1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRvdGFsQXZhaWxhYmxlUGFnZXMgPSBNYXRoLm1pbihtZXRhZGF0YVJlc3BvbnNlLnRvdGFsX3BhZ2VzLCA1MDApOyAvLyBUTURCIGxpbWl0cyB0byA1MDAgcGFnZXNcclxuICAgICAgICBcclxuICAgICAgICAvLyBGZXRjaCBmcm9tIG11bHRpcGxlIHJhbmRvbSBwYWdlcyB0byByZWFjaCB0YXJnZXRcclxuICAgICAgICBjb25zdCBwYWdlc1RvRmV0Y2ggPSBNYXRoLm1pbigzLCB0b3RhbEF2YWlsYWJsZVBhZ2VzKTsgLy8gRmV0Y2ggdXAgdG8gMyByYW5kb20gcGFnZXNcclxuICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgRmV0Y2hpbmcgZnJvbSAke3BhZ2VzVG9GZXRjaH0gcmFuZG9tIHBhZ2VzIChvdXQgb2YgJHt0b3RhbEF2YWlsYWJsZVBhZ2VzfSBhdmFpbGFibGUpYCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYWdlc1RvRmV0Y2ggJiYgY2FuZGlkYXRlc01hcC5zaXplIDwgdGhpcy5UQVJHRVRfQ09VTlQ7IGkrKykge1xyXG4gICAgICAgICAgY29uc3QgcmFuZG9tUGFnZSA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIHRvdGFsQXZhaWxhYmxlUGFnZXMpICsgMTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBGZXRjaGluZyBwYWdlICR7cmFuZG9tUGFnZX0gd2l0aCBBTkQgbG9naWNgKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IHRoaXMuZmV0Y2hGcm9tVG1kYihtZWRpYVR5cGUsIHtcclxuICAgICAgICAgICAgZ2VucmVJZHMsXHJcbiAgICAgICAgICAgIGxvZ2ljVHlwZTogJ0FORCcsXHJcbiAgICAgICAgICAgIHBhZ2U6IHJhbmRvbVBhZ2UsXHJcbiAgICAgICAgICAgIHllYXJSYW5nZSxcclxuICAgICAgICAgICAgcGxhdGZvcm1JZHNcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBjb25zdCBmaWx0ZXJlZCA9IHRoaXMuYXBwbHlCYXNlRmlsdGVycyhyZXN1bHRzLCBtZWRpYVR5cGUsIHllYXJSYW5nZSk7XHJcbiAgICAgICAgICBmaWx0ZXJlZC5mb3JFYWNoKGNhbmRpZGF0ZSA9PiB7XHJcbiAgICAgICAgICAgIGlmIChjYW5kaWRhdGVzTWFwLnNpemUgPCB0aGlzLlRBUkdFVF9DT1VOVCkge1xyXG4gICAgICAgICAgICAgIGNhbmRpZGF0ZXNNYXAuc2V0KGNhbmRpZGF0ZS5pZCwgY2FuZGlkYXRlKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBBZGRlZCAke2ZpbHRlcmVkLmxlbmd0aH0gY2FuZGlkYXRlcyAodG90YWw6ICR7Y2FuZGlkYXRlc01hcC5zaXplfSlgKTtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSBpZiAoIXVzZVN0cmljdExvZ2ljICYmIGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA+IDEpIHtcclxuICAgICAgICAvLyBVc2luZyBPUiBsb2dpYyBmYWxsYmFja1xyXG4gICAgICAgIGNvbnN0IG1ldGFkYXRhUmVzcG9uc2UgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGJXaXRoTWV0YWRhdGEobWVkaWFUeXBlLCB7XHJcbiAgICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICAgIGxvZ2ljVHlwZTogJ09SJyxcclxuICAgICAgICAgIHBhZ2U6IDEsXHJcbiAgICAgICAgICB5ZWFyUmFuZ2UsXHJcbiAgICAgICAgICBwbGF0Zm9ybUlkc1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRvdGFsQXZhaWxhYmxlUGFnZXMgPSBNYXRoLm1pbihtZXRhZGF0YVJlc3BvbnNlLnRvdGFsX3BhZ2VzLCA1MDApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEZldGNoIGZyb20gbXVsdGlwbGUgcmFuZG9tIHBhZ2VzXHJcbiAgICAgICAgY29uc3QgcGFnZXNUb0ZldGNoID0gTWF0aC5taW4oMywgdG90YWxBdmFpbGFibGVQYWdlcyk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYCAg4oaSIEZldGNoaW5nIGZyb20gJHtwYWdlc1RvRmV0Y2h9IHJhbmRvbSBwYWdlcyB3aXRoIE9SIGxvZ2ljYCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYWdlc1RvRmV0Y2ggJiYgY2FuZGlkYXRlc01hcC5zaXplIDwgdGhpcy5UQVJHRVRfQ09VTlQ7IGkrKykge1xyXG4gICAgICAgICAgY29uc3QgcmFuZG9tUGFnZSA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIHRvdGFsQXZhaWxhYmxlUGFnZXMpICsgMTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBGZXRjaGluZyBwYWdlICR7cmFuZG9tUGFnZX0gd2l0aCBPUiBsb2dpY2ApO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgdGhpcy5mZXRjaEZyb21UbWRiKG1lZGlhVHlwZSwge1xyXG4gICAgICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICAgICAgbG9naWNUeXBlOiAnT1InLFxyXG4gICAgICAgICAgICBwYWdlOiByYW5kb21QYWdlLFxyXG4gICAgICAgICAgICB5ZWFyUmFuZ2UsXHJcbiAgICAgICAgICAgIHBsYXRmb3JtSWRzXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgY29uc3QgZmlsdGVyZWQgPSB0aGlzLmFwcGx5QmFzZUZpbHRlcnMocmVzdWx0cywgbWVkaWFUeXBlLCB5ZWFyUmFuZ2UpO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBXaGVuIHVzaW5nIE9SIGxvZ2ljLCBwcmlvcml0aXplIG1vdmllcyB0aGF0IG1hdGNoIEFMTCBnZW5yZXNcclxuICAgICAgICAgIGNvbnN0IHByaW9yaXRpemVkID0gdGhpcy5wcmlvcml0aXplTXVsdGlHZW5yZU1hdGNoZXMoZmlsdGVyZWQsIGdlbnJlSWRzKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgcHJpb3JpdGl6ZWQuZm9yRWFjaChjYW5kaWRhdGUgPT4ge1xyXG4gICAgICAgICAgICBpZiAoY2FuZGlkYXRlc01hcC5zaXplIDwgdGhpcy5UQVJHRVRfQ09VTlQpIHtcclxuICAgICAgICAgICAgICBjYW5kaWRhdGVzTWFwLnNldChjYW5kaWRhdGUuaWQsIGNhbmRpZGF0ZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgQWRkZWQgJHtwcmlvcml0aXplZC5sZW5ndGh9IGNhbmRpZGF0ZXMgKHRvdGFsOiAke2NhbmRpZGF0ZXNNYXAuc2l6ZX0pYCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vIE5vIGdlbnJlcyBvciBzaW5nbGUgZ2VucmUgLSBzdGFuZGFyZCBmZXRjaFxyXG4gICAgICAgIC8vIEZpcnN0LCBnZXQgbWV0YWRhdGEgdG8ga25vdyBob3cgbWFueSBwYWdlcyBhcmUgYXZhaWxhYmxlXHJcbiAgICAgICAgY29uc3QgbWV0YWRhdGFSZXNwb25zZSA9IGF3YWl0IHRoaXMuZmV0Y2hGcm9tVG1kYldpdGhNZXRhZGF0YShtZWRpYVR5cGUsIHtcclxuICAgICAgICAgIGdlbnJlSWRzLFxyXG4gICAgICAgICAgcGFnZTogMSxcclxuICAgICAgICAgIHllYXJSYW5nZSxcclxuICAgICAgICAgIHBsYXRmb3JtSWRzXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdG90YWxBdmFpbGFibGVQYWdlcyA9IE1hdGgubWluKG1ldGFkYXRhUmVzcG9uc2UudG90YWxfcGFnZXMsIDUwMCk7XHJcbiAgICAgICAgY29uc3QgcmFuZG9tUGFnZSA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIHRvdGFsQXZhaWxhYmxlUGFnZXMpICsgMTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgRmV0Y2hpbmcgcGFnZSAke3JhbmRvbVBhZ2V9IG9mICR7dG90YWxBdmFpbGFibGVQYWdlc30gYXZhaWxhYmxlIChubyBnZW5yZSBmaWx0ZXIgb3Igc2luZ2xlIGdlbnJlKWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGIobWVkaWFUeXBlLCB7XHJcbiAgICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICAgIHBhZ2U6IHJhbmRvbVBhZ2UsXHJcbiAgICAgICAgICB5ZWFyUmFuZ2UsXHJcbiAgICAgICAgICBwbGF0Zm9ybUlkc1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGZpbHRlcmVkID0gdGhpcy5hcHBseUJhc2VGaWx0ZXJzKHJlc3VsdHMsIG1lZGlhVHlwZSwgeWVhclJhbmdlKTtcclxuICAgICAgICBmaWx0ZXJlZC5mb3JFYWNoKGNhbmRpZGF0ZSA9PiBjYW5kaWRhdGVzTWFwLnNldChjYW5kaWRhdGUuaWQsIGNhbmRpZGF0ZSkpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKGAgIOKGkiBBZGRlZCAke2ZpbHRlcmVkLmxlbmd0aH0gY2FuZGlkYXRlc2ApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBQSEFTRSAzOiBBRERJVElPTkFMIEZFVENIRVMgSUYgTkVFREVEXHJcbiAgICAgIGxldCBmZXRjaEF0dGVtcHRzID0gMDtcclxuICAgICAgY29uc3QgbWF4QXR0ZW1wdHMgPSAzO1xyXG4gICAgICBcclxuICAgICAgd2hpbGUgKGNhbmRpZGF0ZXNNYXAuc2l6ZSA8IHRoaXMuVEFSR0VUX0NPVU5UICYmIGZldGNoQXR0ZW1wdHMgPCBtYXhBdHRlbXB0cykge1xyXG4gICAgICAgIGZldGNoQXR0ZW1wdHMrKztcclxuICAgICAgICBjb25zdCBuZWVkZWQgPSB0aGlzLlRBUkdFVF9DT1VOVCAtIGNhbmRpZGF0ZXNNYXAuc2l6ZTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgUEhBU0UgMyAoQXR0ZW1wdCAke2ZldGNoQXR0ZW1wdHN9KTogTmVlZCAke25lZWRlZH0gbW9yZSBjYW5kaWRhdGVzYCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gR2V0IG1ldGFkYXRhIHRvIGtub3cgYXZhaWxhYmxlIHBhZ2VzXHJcbiAgICAgICAgY29uc3QgbWV0YWRhdGFSZXNwb25zZSA9IGF3YWl0IHRoaXMuZmV0Y2hGcm9tVG1kYldpdGhNZXRhZGF0YShtZWRpYVR5cGUsIHtcclxuICAgICAgICAgIGdlbnJlSWRzOiBnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAwID8gZ2VucmVJZHMgOiB1bmRlZmluZWQsXHJcbiAgICAgICAgICBsb2dpY1R5cGU6IGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA+IDEgPyBsb2dpY1R5cGUgOiB1bmRlZmluZWQsXHJcbiAgICAgICAgICBwYWdlOiAxLFxyXG4gICAgICAgICAgeWVhclJhbmdlLFxyXG4gICAgICAgICAgcGxhdGZvcm1JZHNcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBhdmFpbGFibGVQYWdlcyA9IE1hdGgubWluKG1ldGFkYXRhUmVzcG9uc2UudG90YWxfcGFnZXMsIDUwMCk7XHJcbiAgICAgICAgaWYgKGF2YWlsYWJsZVBhZ2VzID09PSAwKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgTm8gcGFnZXMgYXZhaWxhYmxlLCBzdG9wcGluZyBhZGRpdGlvbmFsIGZldGNoZXNgKTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBjb25zdCByYW5kb21QYWdlID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogYXZhaWxhYmxlUGFnZXMpICsgMTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgICDihpIgRmV0Y2hpbmcgcGFnZSAke3JhbmRvbVBhZ2V9IG9mICR7YXZhaWxhYmxlUGFnZXN9IGF2YWlsYWJsZWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IHJlc3VsdHMgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGIobWVkaWFUeXBlLCB7XHJcbiAgICAgICAgICBnZW5yZUlkczogZ2VucmVJZHMgJiYgZ2VucmVJZHMubGVuZ3RoID4gMCA/IGdlbnJlSWRzIDogdW5kZWZpbmVkLFxyXG4gICAgICAgICAgbG9naWNUeXBlOiBnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAxID8gbG9naWNUeXBlIDogdW5kZWZpbmVkLFxyXG4gICAgICAgICAgcGFnZTogcmFuZG9tUGFnZSxcclxuICAgICAgICAgIHllYXJSYW5nZSxcclxuICAgICAgICAgIHBsYXRmb3JtSWRzXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgZmlsdGVyZWQgPSB0aGlzLmFwcGx5QmFzZUZpbHRlcnMocmVzdWx0cywgbWVkaWFUeXBlLCB5ZWFyUmFuZ2UpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGxldCBhZGRlZENvdW50ID0gMDtcclxuICAgICAgICBmaWx0ZXJlZC5mb3JFYWNoKGNhbmRpZGF0ZSA9PiB7XHJcbiAgICAgICAgICBpZiAoY2FuZGlkYXRlc01hcC5zaXplIDwgdGhpcy5UQVJHRVRfQ09VTlQgJiYgIWNhbmRpZGF0ZXNNYXAuaGFzKGNhbmRpZGF0ZS5pZCkpIHtcclxuICAgICAgICAgICAgY2FuZGlkYXRlc01hcC5zZXQoY2FuZGlkYXRlLmlkLCBjYW5kaWRhdGUpO1xyXG4gICAgICAgICAgICBhZGRlZENvdW50Kys7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc29sZS5sb2coYCAg4oaSIEFkZGVkICR7YWRkZWRDb3VudH0gbmV3IGNhbmRpZGF0ZXMgKHRvdGFsOiAke2NhbmRpZGF0ZXNNYXAuc2l6ZX0pYCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGFkZGVkQ291bnQgPT09IDApIGJyZWFrO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBQSEFTRSA0OiBTSFVGRkxFIC0gRmlzaGVyLVlhdGVzIHNodWZmbGUgZm9yIG1heGltdW0gcmFuZG9tbmVzc1xyXG4gICAgICBjb25zdCBjYW5kaWRhdGVzQXJyYXkgPSBBcnJheS5mcm9tKGNhbmRpZGF0ZXNNYXAudmFsdWVzKCkpO1xyXG4gICAgICBjb25zdCBzaHVmZmxlZENhbmRpZGF0ZXMgPSB0aGlzLnNodWZmbGVBcnJheShjYW5kaWRhdGVzQXJyYXkpO1xyXG4gICAgICBjb25zdCBmaW5hbENhbmRpZGF0ZXMgPSBzaHVmZmxlZENhbmRpZGF0ZXMuc2xpY2UoMCwgdGhpcy5UQVJHRVRfQ09VTlQpO1xyXG4gICAgICBcclxuICAgICAgLy8gUEhBU0UgNTogRkVUQ0ggVFJBSUxFUlMgZm9yIGZpbmFsIGNhbmRpZGF0ZXMgKGluIHBhcmFsbGVsKVxyXG4gICAgICBjb25zb2xlLmxvZyhgUEhBU0UgNTogRmV0Y2hpbmcgdHJhaWxlcnMgZm9yICR7ZmluYWxDYW5kaWRhdGVzLmxlbmd0aH0gY2FuZGlkYXRlc2ApO1xyXG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChcclxuICAgICAgICBmaW5hbENhbmRpZGF0ZXMubWFwKGFzeW5jIChjYW5kaWRhdGUpID0+IHtcclxuICAgICAgICAgIGNhbmRpZGF0ZS50cmFpbGVyS2V5ID0gYXdhaXQgdGhpcy5mZXRjaFRyYWlsZXJLZXkoY2FuZGlkYXRlLm1lZGlhVHlwZSwgY2FuZGlkYXRlLmlkKTtcclxuICAgICAgICB9KVxyXG4gICAgICApO1xyXG4gICAgICBjb25zdCBjYW5kaWRhdGVzV2l0aFRyYWlsZXJzID0gZmluYWxDYW5kaWRhdGVzLmZpbHRlcihjID0+IGMudHJhaWxlcktleSkubGVuZ3RoO1xyXG4gICAgICBjb25zb2xlLmxvZyhgICDihpIgJHtjYW5kaWRhdGVzV2l0aFRyYWlsZXJzfSBjYW5kaWRhdGVzIGhhdmUgdHJhaWxlcnNgKTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGDinIUgU21hcnQgUmFuZG9tIERpc2NvdmVyeSBjb21wbGV0ZTogJHtmaW5hbENhbmRpZGF0ZXMubGVuZ3RofSBjYW5kaWRhdGVzICh0YXJnZXQ6ICR7dGhpcy5UQVJHRVRfQ09VTlR9KWApO1xyXG4gICAgICBjb25zb2xlLmxvZyhgICAgU3RyYXRlZ3k6ICR7dXNlU3RyaWN0TG9naWMgPyAnU1RSSUNUIChBTkQpJyA6ICdGQUxMQkFDSyAoT1IpJ30sIFRvdGFsIGF2YWlsYWJsZTogJHt0b3RhbEF2YWlsYWJsZVJlc3VsdHN9YCk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gZmluYWxDYW5kaWRhdGVzO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBTbWFydCBSYW5kb20gRGlzY292ZXJ5IEVycm9yOicsIGVycm9yKTtcclxuICAgICAgY29uc3QgZmFsbGJhY2tDYW5kaWRhdGVzID0gQXJyYXkuZnJvbShjYW5kaWRhdGVzTWFwLnZhbHVlcygpKTtcclxuICAgICAgY29uc29sZS5sb2coYCAgIFJldHVybmluZyAke2ZhbGxiYWNrQ2FuZGlkYXRlcy5sZW5ndGh9IGNhbmRpZGF0ZXMgYXMgZmFsbGJhY2tgKTtcclxuICAgICAgcmV0dXJuIGZhbGxiYWNrQ2FuZGlkYXRlcztcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFByaW9yaXRpemUgY2FuZGlkYXRlcyB0aGF0IG1hdGNoIEFMTCBzZWxlY3RlZCBnZW5yZXMgKGZvciBPUiBzZWFyY2hlcylcclxuICAgKi9cclxuICBwcml2YXRlIHByaW9yaXRpemVNdWx0aUdlbnJlTWF0Y2hlcyhjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdLCBzZWxlY3RlZEdlbnJlSWRzOiBudW1iZXJbXSk6IE1vdmllQ2FuZGlkYXRlW10ge1xyXG4gICAgLy8gU29ydCBjYW5kaWRhdGVzOiB0aG9zZSBtYXRjaGluZyBBTEwgZ2VucmVzIGZpcnN0LCB0aGVuIG90aGVyc1xyXG4gICAgcmV0dXJuIGNhbmRpZGF0ZXMuc29ydCgoYSwgYikgPT4ge1xyXG4gICAgICBjb25zdCBhTWF0Y2hlc0FsbCA9IHNlbGVjdGVkR2VucmVJZHMuZXZlcnkoZ2VucmVJZCA9PiBhLmdlbnJlSWRzPy5pbmNsdWRlcyhnZW5yZUlkKSk7XHJcbiAgICAgIGNvbnN0IGJNYXRjaGVzQWxsID0gc2VsZWN0ZWRHZW5yZUlkcy5ldmVyeShnZW5yZUlkID0+IGIuZ2VucmVJZHM/LmluY2x1ZGVzKGdlbnJlSWQpKTtcclxuICAgICAgXHJcbiAgICAgIC8vIElmIGJvdGggbWF0Y2ggYWxsIG9yIGJvdGggZG9uJ3QsIG1haW50YWluIG9yaWdpbmFsIG9yZGVyXHJcbiAgICAgIGlmIChhTWF0Y2hlc0FsbCA9PT0gYk1hdGNoZXNBbGwpIHJldHVybiAwO1xyXG4gICAgICBcclxuICAgICAgLy8gUHV0IGl0ZW1zIG1hdGNoaW5nIGFsbCBnZW5yZXMgZmlyc3RcclxuICAgICAgcmV0dXJuIGFNYXRjaGVzQWxsID8gLTEgOiAxO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBGZXRjaCBjb250ZW50IGZyb20gVE1EQiB3aXRoIHNwZWNpZmllZCBwYXJhbWV0ZXJzIChyZXR1cm5zIG9ubHkgcmVzdWx0cylcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIGZldGNoRnJvbVRtZGIoXHJcbiAgICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnLCBcclxuICAgIG9wdGlvbnM6IHtcclxuICAgICAgZ2VucmVJZHM/OiBudW1iZXJbXTtcclxuICAgICAgbG9naWNUeXBlPzogJ0FORCcgfCAnT1InO1xyXG4gICAgICBwYWdlPzogbnVtYmVyO1xyXG4gICAgICB5ZWFyUmFuZ2U/OiB7IG1pbjogbnVtYmVyOyBtYXg6IG51bWJlciB9O1xyXG4gICAgICBwbGF0Zm9ybUlkcz86IG51bWJlcltdO1xyXG4gICAgfSA9IHt9XHJcbiAgKTogUHJvbWlzZTxUTURCTW92aWVSZXNwb25zZVtdPiB7XHJcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZmV0Y2hGcm9tVG1kYldpdGhNZXRhZGF0YShtZWRpYVR5cGUsIG9wdGlvbnMpO1xyXG4gICAgcmV0dXJuIHJlc3BvbnNlLnJlc3VsdHM7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBGZXRjaCBjb250ZW50IGZyb20gVE1EQiB3aXRoIG1ldGFkYXRhICh0b3RhbF9yZXN1bHRzLCB0b3RhbF9wYWdlcylcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIGZldGNoRnJvbVRtZGJXaXRoTWV0YWRhdGEoXHJcbiAgICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnLCBcclxuICAgIG9wdGlvbnM6IHtcclxuICAgICAgZ2VucmVJZHM/OiBudW1iZXJbXTtcclxuICAgICAgbG9naWNUeXBlPzogJ0FORCcgfCAnT1InO1xyXG4gICAgICBwYWdlPzogbnVtYmVyO1xyXG4gICAgICB5ZWFyUmFuZ2U/OiB7IG1pbjogbnVtYmVyOyBtYXg6IG51bWJlciB9O1xyXG4gICAgICBwbGF0Zm9ybUlkcz86IG51bWJlcltdO1xyXG4gICAgfSA9IHt9XHJcbiAgKTogUHJvbWlzZTx7IHJlc3VsdHM6IFRNREJNb3ZpZVJlc3BvbnNlW107IHRvdGFsX3Jlc3VsdHM6IG51bWJlcjsgdG90YWxfcGFnZXM6IG51bWJlciB9PiB7XHJcbiAgICBjb25zdCB7IGdlbnJlSWRzLCBsb2dpY1R5cGUsIHBhZ2UgPSAxLCB5ZWFyUmFuZ2UsIHBsYXRmb3JtSWRzIH0gPSBvcHRpb25zO1xyXG4gICAgY29uc3QgZW5kcG9pbnQgPSBtZWRpYVR5cGUgPT09ICdNT1ZJRScgPyAnL2Rpc2NvdmVyL21vdmllJyA6ICcvZGlzY292ZXIvdHYnO1xyXG4gICAgXHJcbiAgICBjb25zdCBwYXJhbXM6IFRNREJEaXNjb3ZlcnlQYXJhbXMgPSB7XHJcbiAgICAgIHBhZ2UsXHJcbiAgICAgIGxhbmd1YWdlOiAnZXMtRVMnLCAvLyBEZWZhdWx0IGxhbmd1YWdlXHJcbiAgICAgIHNvcnRfYnk6ICdwb3B1bGFyaXR5LmRlc2MnLFxyXG4gICAgICBpbmNsdWRlX2FkdWx0OiBmYWxzZSxcclxuICAgICAgd2l0aF9vcmlnaW5hbF9sYW5ndWFnZTogJ2VufGVzfGZyfGl0fGRlfHB0JywgLy8gV2VzdGVybiBsYW5ndWFnZXMgb25seVxyXG4gICAgICAndm90ZV9jb3VudC5ndGUnOiBwbGF0Zm9ybUlkcyAmJiBwbGF0Zm9ybUlkcy5sZW5ndGggPiAwID8gMjAgOiA1MCwgLy8gTG93ZXIgdGhyZXNob2xkIHdoZW4gZmlsdGVyaW5nIGJ5IHBsYXRmb3JtXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIEFkZCBnZW5yZSBmaWx0ZXIgYmFzZWQgb24gbG9naWMgdHlwZVxyXG4gICAgaWYgKGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgaWYgKGxvZ2ljVHlwZSA9PT0gJ09SJykge1xyXG4gICAgICAgIHBhcmFtcy53aXRoX2dlbnJlcyA9IGdlbnJlSWRzLmpvaW4oJ3wnKTsgLy8gT1IgbG9naWM6IGFueSBnZW5yZSBtYXRjaGVzXHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcGFyYW1zLndpdGhfZ2VucmVzID0gZ2VucmVJZHMuam9pbignLCcpOyAvLyBBTkQgbG9naWM6IGFsbCBnZW5yZXMgbXVzdCBtYXRjaFxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQWRkIHllYXIgcmFuZ2UgZmlsdGVyXHJcbiAgICBpZiAoeWVhclJhbmdlKSB7XHJcbiAgICAgIGlmIChtZWRpYVR5cGUgPT09ICdNT1ZJRScpIHtcclxuICAgICAgICAocGFyYW1zIGFzIGFueSlbJ3ByaW1hcnlfcmVsZWFzZV9kYXRlLmd0ZSddID0gYCR7eWVhclJhbmdlLm1pbn0tMDEtMDFgO1xyXG4gICAgICAgIChwYXJhbXMgYXMgYW55KVsncHJpbWFyeV9yZWxlYXNlX2RhdGUubHRlJ10gPSBgJHt5ZWFyUmFuZ2UubWF4fS0xMi0zMWA7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgKHBhcmFtcyBhcyBhbnkpWydmaXJzdF9haXJfZGF0ZS5ndGUnXSA9IGAke3llYXJSYW5nZS5taW59LTAxLTAxYDtcclxuICAgICAgICAocGFyYW1zIGFzIGFueSlbJ2ZpcnN0X2Fpcl9kYXRlLmx0ZSddID0gYCR7eWVhclJhbmdlLm1heH0tMTItMzFgO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQWRkIHBsYXRmb3JtIGZpbHRlciAoc3RyZWFtaW5nIHByb3ZpZGVycylcclxuICAgIGlmIChwbGF0Zm9ybUlkcyAmJiBwbGF0Zm9ybUlkcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgIChwYXJhbXMgYXMgYW55KS53aXRoX3dhdGNoX3Byb3ZpZGVycyA9IHBsYXRmb3JtSWRzLmpvaW4oJ3wnKTsgLy8gT1IgbG9naWMgZm9yIHBsYXRmb3Jtc1xyXG4gICAgICAocGFyYW1zIGFzIGFueSkud2F0Y2hfcmVnaW9uID0gJ0VTJzsgLy8gU3BhaW4gcmVnaW9uXHJcbiAgICB9XHJcblxyXG4gICAgY29uc29sZS5sb2coYEZldGNoaW5nIGZyb20gVE1EQiAke2VuZHBvaW50fSB3aXRoIHBhcmFtczpgLCBKU09OLnN0cmluZ2lmeShwYXJhbXMpKTtcclxuXHJcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldChgJHt0aGlzLmJhc2VVcmx9JHtlbmRwb2ludH1gLCB7XHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnYWNjZXB0JzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBdXRob3JpemF0aW9uJzogYEJlYXJlciAke3RoaXMucmVhZFRva2VufWBcclxuICAgICAgfSxcclxuICAgICAgcGFyYW1zXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCByZXN1bHRzOiBUTURCTW92aWVSZXNwb25zZVtdID0gcmVzcG9uc2UuZGF0YS5yZXN1bHRzIHx8IFtdO1xyXG4gICAgY29uc3QgdG90YWxfcmVzdWx0cyA9IHJlc3BvbnNlLmRhdGEudG90YWxfcmVzdWx0cyB8fCAwO1xyXG4gICAgY29uc3QgdG90YWxfcGFnZXMgPSByZXNwb25zZS5kYXRhLnRvdGFsX3BhZ2VzIHx8IDE7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKGBUTURCIHJldHVybmVkICR7cmVzdWx0cy5sZW5ndGh9IHJlc3VsdHMgZm9yIHBhZ2UgJHtwYWdlfSAodG90YWw6ICR7dG90YWxfcmVzdWx0c30gYWNyb3NzICR7dG90YWxfcGFnZXN9IHBhZ2VzKWApO1xyXG4gICAgXHJcbiAgICByZXR1cm4geyByZXN1bHRzLCB0b3RhbF9yZXN1bHRzLCB0b3RhbF9wYWdlcyB9O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRmV0Y2ggdHJhaWxlciBrZXkgZm9yIGEgbW92aWUvVFYgc2hvdyBmcm9tIFRNREJcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIGZldGNoVHJhaWxlcktleShtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnLCB0bWRiSWQ6IG51bWJlcik6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBlbmRwb2ludCA9IG1lZGlhVHlwZSA9PT0gJ01PVklFJyA/IGAvbW92aWUvJHt0bWRiSWR9L3ZpZGVvc2AgOiBgL3R2LyR7dG1kYklkfS92aWRlb3NgO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQoYCR7dGhpcy5iYXNlVXJsfSR7ZW5kcG9pbnR9YCwge1xyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdhY2NlcHQnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHt0aGlzLnJlYWRUb2tlbn1gXHJcbiAgICAgICAgfSxcclxuICAgICAgICBwYXJhbXM6IHtcclxuICAgICAgICAgIGxhbmd1YWdlOiAnZXMtRVMnIC8vIFRyeSBTcGFuaXNoIGZpcnN0XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHZpZGVvcyA9IHJlc3BvbnNlLmRhdGEucmVzdWx0cyB8fCBbXTtcclxuICAgICAgXHJcbiAgICAgIC8vIEZpbmQgb2ZmaWNpYWwgWW91VHViZSB0cmFpbGVyXHJcbiAgICAgIGNvbnN0IHRyYWlsZXIgPSB2aWRlb3MuZmluZCgodmlkZW86IGFueSkgPT4gXHJcbiAgICAgICAgdmlkZW8uc2l0ZSA9PT0gJ1lvdVR1YmUnICYmIFxyXG4gICAgICAgIHZpZGVvLnR5cGUgPT09ICdUcmFpbGVyJyAmJiBcclxuICAgICAgICB2aWRlby5vZmZpY2lhbCA9PT0gdHJ1ZVxyXG4gICAgICApO1xyXG4gICAgICBcclxuICAgICAgLy8gSWYgbm8gb2ZmaWNpYWwgU3BhbmlzaCB0cmFpbGVyLCB0cnkgRW5nbGlzaFxyXG4gICAgICBpZiAoIXRyYWlsZXIpIHtcclxuICAgICAgICBjb25zdCByZXNwb25zZUVuID0gYXdhaXQgYXhpb3MuZ2V0KGAke3RoaXMuYmFzZVVybH0ke2VuZHBvaW50fWAsIHtcclxuICAgICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICAgJ2FjY2VwdCc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7dGhpcy5yZWFkVG9rZW59YFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICAgIHBhcmFtczoge1xyXG4gICAgICAgICAgICBsYW5ndWFnZTogJ2VuLVVTJ1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBjb25zdCB2aWRlb3NFbiA9IHJlc3BvbnNlRW4uZGF0YS5yZXN1bHRzIHx8IFtdO1xyXG4gICAgICAgIGNvbnN0IHRyYWlsZXJFbiA9IHZpZGVvc0VuLmZpbmQoKHZpZGVvOiBhbnkpID0+IFxyXG4gICAgICAgICAgdmlkZW8uc2l0ZSA9PT0gJ1lvdVR1YmUnICYmIFxyXG4gICAgICAgICAgdmlkZW8udHlwZSA9PT0gJ1RyYWlsZXInXHJcbiAgICAgICAgKTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gdHJhaWxlckVuPy5rZXk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIHJldHVybiB0cmFpbGVyPy5rZXk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmxvZyhgQ291bGQgbm90IGZldGNoIHRyYWlsZXIgZm9yICR7bWVkaWFUeXBlfSAke3RtZGJJZH06YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQXBwbHkgYmFzZSBxdWFsaXR5IGZpbHRlcnMgdG8gVE1EQiByZXN1bHRzXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhcHBseUJhc2VGaWx0ZXJzKHJlc3VsdHM6IFRNREJNb3ZpZVJlc3BvbnNlW10sIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVicsIHllYXJSYW5nZT86IHsgbWluOiBudW1iZXI7IG1heDogbnVtYmVyIH0pOiBNb3ZpZUNhbmRpZGF0ZVtdIHtcclxuICAgIGNvbnN0IGNhbmRpZGF0ZXM6IE1vdmllQ2FuZGlkYXRlW10gPSBbXTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgcmVzdWx0cykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIEV4dHJhY3QgdGl0bGUgKG1vdmllcyB1c2UgJ3RpdGxlJywgVFYgc2hvd3MgdXNlICduYW1lJylcclxuICAgICAgICBjb25zdCB0aXRsZSA9IGl0ZW0udGl0bGUgfHwgaXRlbS5uYW1lIHx8ICcnO1xyXG4gICAgICAgIGNvbnN0IG92ZXJ2aWV3ID0gaXRlbS5vdmVydmlldyB8fCAnJztcclxuICAgICAgICBcclxuICAgICAgICAvLyBCYXNlIHF1YWxpdHkgZmlsdGVyc1xyXG4gICAgICAgIGlmICghaXRlbS5wb3N0ZXJfcGF0aCkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYEZpbHRlcmVkIG91dCBpdGVtIHdpdGhvdXQgcG9zdGVyOiBcIiR7dGl0bGV9XCJgKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoIW92ZXJ2aWV3IHx8IG92ZXJ2aWV3LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgaXRlbSB3aXRob3V0IG92ZXJ2aWV3OiBcIiR7dGl0bGV9XCJgKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gVm90ZSBjb3VudCBmaWx0ZXIgKGFkZGl0aW9uYWwgc2FmZXR5IGNoZWNrKVxyXG4gICAgICAgIGlmIChpdGVtLnZvdGVfY291bnQgJiYgaXRlbS52b3RlX2NvdW50IDwgMjApIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgbG93LXZvdGUgaXRlbTogXCIke3RpdGxlfVwiICgke2l0ZW0udm90ZV9jb3VudH0gdm90ZXMpYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIExhbmd1YWdlIGZpbHRlciAtIGVuc3VyZSBXZXN0ZXJuIGxhbmd1YWdlcyBvbmx5XHJcbiAgICAgICAgY29uc3QgYWxsb3dlZExhbmd1YWdlcyA9IFsnZW4nLCAnZXMnLCAnZnInLCAnaXQnLCAnZGUnLCAncHQnXTtcclxuICAgICAgICBpZiAoIWFsbG93ZWRMYW5ndWFnZXMuaW5jbHVkZXMoaXRlbS5vcmlnaW5hbF9sYW5ndWFnZSkpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgbm9uLVdlc3Rlcm4gbGFuZ3VhZ2U6IFwiJHt0aXRsZX1cIiAoJHtpdGVtLm9yaWdpbmFsX2xhbmd1YWdlfSlgKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBBcHBseSBMYXRpbiBTY3JpcHQgVmFsaWRhdG9yXHJcbiAgICAgICAgaWYgKCF0aGlzLnZhbGlkYXRvci52YWxpZGF0ZUNvbnRlbnQodGl0bGUsIG92ZXJ2aWV3KSkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYEZpbHRlcmVkIG91dCBub24tTGF0aW4gY29udGVudDogXCIke3RpdGxlfVwiYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIEV4dHJhY3QgcmVsZWFzZSBkYXRlXHJcbiAgICAgICAgY29uc3QgcmVsZWFzZURhdGUgPSBpdGVtLnJlbGVhc2VfZGF0ZSB8fCBpdGVtLmZpcnN0X2Fpcl9kYXRlIHx8ICcnO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFllYXIgcmFuZ2UgZmlsdGVyIC0gdmFsaWRhdGUgcmVsZWFzZSBkYXRlIGlzIHdpdGhpbiByYW5nZVxyXG4gICAgICAgIGlmICh5ZWFyUmFuZ2UgJiYgcmVsZWFzZURhdGUpIHtcclxuICAgICAgICAgIGNvbnN0IHJlbGVhc2VZZWFyID0gcGFyc2VJbnQocmVsZWFzZURhdGUuc3BsaXQoJy0nKVswXSk7XHJcbiAgICAgICAgICBpZiAoIWlzTmFOKHJlbGVhc2VZZWFyKSAmJiAocmVsZWFzZVllYXIgPCB5ZWFyUmFuZ2UubWluIHx8IHJlbGVhc2VZZWFyID4geWVhclJhbmdlLm1heCkpIHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYEZpbHRlcmVkIG91dCBpdGVtIG91dHNpZGUgeWVhciByYW5nZTogXCIke3RpdGxlfVwiICgke3JlbGVhc2VZZWFyfSwgZXhwZWN0ZWQgJHt5ZWFyUmFuZ2UubWlufS0ke3llYXJSYW5nZS5tYXh9KWApO1xyXG4gICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gVHJhbnNmb3JtIHRvIG91ciBmb3JtYXRcclxuICAgICAgICBjb25zdCBjYW5kaWRhdGU6IE1vdmllQ2FuZGlkYXRlID0ge1xyXG4gICAgICAgICAgaWQ6IGl0ZW0uaWQsXHJcbiAgICAgICAgICB0aXRsZSxcclxuICAgICAgICAgIG92ZXJ2aWV3LFxyXG4gICAgICAgICAgcG9zdGVyUGF0aDogYGh0dHBzOi8vaW1hZ2UudG1kYi5vcmcvdC9wL3c1MDAke2l0ZW0ucG9zdGVyX3BhdGh9YCxcclxuICAgICAgICAgIHJlbGVhc2VEYXRlLFxyXG4gICAgICAgICAgbWVkaWFUeXBlOiBtZWRpYVR5cGUgPT09ICdNT1ZJRScgPyAnTU9WSUUnIDogJ1RWJyxcclxuICAgICAgICAgIGdlbnJlSWRzOiBpdGVtLmdlbnJlX2lkcyB8fCBbXSwgLy8gU3RvcmUgZ2VucmUgSURzIGZvciBwcmlvcml0aXphdGlvblxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNhbmRpZGF0ZXMucHVzaChjYW5kaWRhdGUpO1xyXG5cclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIFRNREIgaXRlbSAke2l0ZW0uaWR9OmAsIGVycm9yKTtcclxuICAgICAgICAvLyBDb250aW51ZSBwcm9jZXNzaW5nIG90aGVyIGl0ZW1zXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gY2FuZGlkYXRlcztcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNodWZmbGUgYXJyYXkgdXNpbmcgRmlzaGVyLVlhdGVzIGFsZ29yaXRobVxyXG4gICAqL1xyXG4gIHByaXZhdGUgc2h1ZmZsZUFycmF5PFQ+KGFycmF5OiBUW10pOiBUW10ge1xyXG4gICAgY29uc3Qgc2h1ZmZsZWQgPSBbLi4uYXJyYXldO1xyXG4gICAgZm9yIChsZXQgaSA9IHNodWZmbGVkLmxlbmd0aCAtIDE7IGkgPiAwOyBpLS0pIHtcclxuICAgICAgY29uc3QgaiA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIChpICsgMSkpO1xyXG4gICAgICBbc2h1ZmZsZWRbaV0sIHNodWZmbGVkW2pdXSA9IFtzaHVmZmxlZFtqXSwgc2h1ZmZsZWRbaV1dO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHNodWZmbGVkO1xyXG4gIH1cclxuXHJcbiAgLy8gTGVnYWN5IG1ldGhvZCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eSAoZGVwcmVjYXRlZClcclxuICBhc3luYyBkaXNjb3ZlckNvbnRlbnRMZWdhY3kobWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgZ2VucmVJZHM/OiBudW1iZXJbXSwgcGFnZSA9IDEpOiBQcm9taXNlPE1vdmllQ2FuZGlkYXRlW10+IHtcclxuICAgIGNvbnNvbGUud2FybignVXNpbmcgbGVnYWN5IGRpc2NvdmVyQ29udGVudExlZ2FjeSBtZXRob2QgLSBjb25zaWRlciB1cGdyYWRpbmcgdG8gZGlzY292ZXJDb250ZW50Jyk7XHJcbiAgICByZXR1cm4gdGhpcy5kaXNjb3ZlckNvbnRlbnQobWVkaWFUeXBlLCBnZW5yZUlkcywgdW5kZWZpbmVkLCB1bmRlZmluZWQpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRGlzY292ZXIgbWl4ZWQgY29udGVudCAoYm90aCBtb3ZpZXMgYW5kIFRWIHNob3dzKVxyXG4gICAqL1xyXG4gIGFzeW5jIGRpc2NvdmVyQ29udGVudE1peGVkKGdlbnJlSWRzPzogbnVtYmVyW10sIHllYXJSYW5nZT86IHsgbWluOiBudW1iZXI7IG1heDogbnVtYmVyIH0sIHBsYXRmb3JtSWRzPzogbnVtYmVyW10pOiBQcm9taXNlPE1vdmllQ2FuZGlkYXRlW10+IHtcclxuICAgIGNvbnNvbGUubG9nKCdEaXNjb3ZlcmluZyBtaXhlZCBjb250ZW50IChNT1ZJRSArIFRWKScpO1xyXG4gICAgXHJcbiAgICAvLyBGZXRjaCBib3RoIG1vdmllcyBhbmQgVFYgc2hvd3MgaW4gcGFyYWxsZWxcclxuICAgIGNvbnN0IFttb3ZpZUNhbmRpZGF0ZXMsIHR2Q2FuZGlkYXRlc10gPSBhd2FpdCBQcm9taXNlLmFsbChbXHJcbiAgICAgIHRoaXMuZGlzY292ZXJDb250ZW50KCdNT1ZJRScsIGdlbnJlSWRzLCB5ZWFyUmFuZ2UsIHBsYXRmb3JtSWRzKSxcclxuICAgICAgdGhpcy5kaXNjb3ZlckNvbnRlbnQoJ1RWJywgZ2VucmVJZHMsIHllYXJSYW5nZSwgcGxhdGZvcm1JZHMpXHJcbiAgICBdKTtcclxuICAgIFxyXG4gICAgLy8gQ29tYmluZSBhbmQgc2h1ZmZsZVxyXG4gICAgY29uc3QgYWxsQ2FuZGlkYXRlcyA9IFsuLi5tb3ZpZUNhbmRpZGF0ZXMsIC4uLnR2Q2FuZGlkYXRlc107XHJcbiAgICBjb25zdCBzaHVmZmxlZCA9IHRoaXMuc2h1ZmZsZUFycmF5KGFsbENhbmRpZGF0ZXMpO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZyhgTWl4ZWQgY29udGVudCBkaXNjb3Zlcnk6ICR7bW92aWVDYW5kaWRhdGVzLmxlbmd0aH0gbW92aWVzICsgJHt0dkNhbmRpZGF0ZXMubGVuZ3RofSBUViBzaG93cyA9ICR7c2h1ZmZsZWQubGVuZ3RofSB0b3RhbGApO1xyXG4gICAgXHJcbiAgICByZXR1cm4gc2h1ZmZsZWQuc2xpY2UoMCwgdGhpcy5UQVJHRVRfQ09VTlQpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gTGFtYmRhIEhhbmRsZXJcclxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXI8VE1EQkV2ZW50LCBUTURCUmVzcG9uc2U+ID0gYXN5bmMgKGV2ZW50KSA9PiB7XHJcbiAgY29uc29sZS5sb2coJ1RNREIgTGFtYmRhIHJlY2VpdmVkIGV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCB7IG1lZGlhVHlwZSwgZ2VucmVJZHMsIHllYXJSYW5nZSwgcGxhdGZvcm1JZHMgfSA9IGV2ZW50O1xyXG5cclxuICAgIC8vIFZhbGlkYXRlIGlucHV0XHJcbiAgICBpZiAoIW1lZGlhVHlwZSB8fCAhWydNT1ZJRScsICdUVicsICdCT1RIJ10uaW5jbHVkZXMobWVkaWFUeXBlKSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdJbnZhbGlkIG1lZGlhVHlwZTonLCBtZWRpYVR5cGUpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbWVkaWFUeXBlLiBNdXN0IGJlIE1PVklFLCBUViwgb3IgQk9USCcpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFZhbGlkYXRlIGdlbnJlIGxpbWl0IChtYXggMiBhcyBwZXIgbWFzdGVyIHNwZWMpXHJcbiAgICBpZiAoZ2VucmVJZHMgJiYgZ2VucmVJZHMubGVuZ3RoID4gMikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdUb28gbWFueSBnZW5yZXM6JywgZ2VucmVJZHMubGVuZ3RoKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNYXhpbXVtIDIgZ2VucmVzIGFsbG93ZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDaGVjayBlbnZpcm9ubWVudCB2YXJpYWJsZXNcclxuICAgIGNvbnN0IHRtZGJSZWFkVG9rZW4gPSBwcm9jZXNzLmVudi5UTURCX1JFQURfVE9LRU4gfHwgcHJvY2Vzcy5lbnYuVE1EQl9BUElfS0VZIHx8ICcnO1xyXG4gICAgaWYgKCF0bWRiUmVhZFRva2VuKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1RNREIgdG9rZW4gbm90IGZvdW5kIGluIGVudmlyb25tZW50IHZhcmlhYmxlcycpO1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdBdmFpbGFibGUgZW52IHZhcnM6JywgT2JqZWN0LmtleXMocHJvY2Vzcy5lbnYpLmZpbHRlcihrZXkgPT4ga2V5LmluY2x1ZGVzKCdUTURCJykpKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdUTURCIEFQSSB0b2tlbiBub3QgY29uZmlndXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnNvbGUubG9nKCdUTURCIHRva2VuIGNvbmZpZ3VyZWQsIGxlbmd0aDonLCB0bWRiUmVhZFRva2VuLmxlbmd0aCk7XHJcblxyXG4gICAgY29uc3QgdG1kYkNsaWVudCA9IG5ldyBUTURCQ2xpZW50KCk7XHJcbiAgICBcclxuICAgIGxldCBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdO1xyXG4gICAgXHJcbiAgICAvLyBIYW5kbGUgQk9USCBtZWRpYSB0eXBlIChtaXhlZCBjb250ZW50KVxyXG4gICAgaWYgKG1lZGlhVHlwZSA9PT0gJ0JPVEgnKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdVc2luZyBNaXhlZCBDb250ZW50IERpc2NvdmVyeSBmb3IgQk9USCcpO1xyXG4gICAgICBjYW5kaWRhdGVzID0gYXdhaXQgdG1kYkNsaWVudC5kaXNjb3ZlckNvbnRlbnRNaXhlZChnZW5yZUlkcywgeWVhclJhbmdlLCBwbGF0Zm9ybUlkcyk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAvLyBVc2UgU21hcnQgUmFuZG9tIERpc2NvdmVyeSBhbGdvcml0aG0gZm9yIHNpbmdsZSBtZWRpYSB0eXBlXHJcbiAgICAgIGNvbnNvbGUubG9nKGBVc2luZyBTbWFydCBSYW5kb20gRGlzY292ZXJ5IGFsZ29yaXRobSBmb3IgJHttZWRpYVR5cGV9YCk7XHJcbiAgICAgIGNhbmRpZGF0ZXMgPSBhd2FpdCB0bWRiQ2xpZW50LmRpc2NvdmVyQ29udGVudChtZWRpYVR5cGUsIGdlbnJlSWRzLCB5ZWFyUmFuZ2UsIHBsYXRmb3JtSWRzKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLmxvZyhgRGlzY292ZXJ5IHJldHVybmVkICR7Y2FuZGlkYXRlcy5sZW5ndGh9IGNhbmRpZGF0ZXNgKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBjYW5kaWRhdGVzLFxyXG4gICAgICAgIHRvdGFsUmVzdWx0czogY2FuZGlkYXRlcy5sZW5ndGgsXHJcbiAgICAgICAgcGFnZTogMSwgLy8gUGFnZSBpcyBub3cgYWJzdHJhY3RlZCBpbiBTbWFydCBSYW5kb20gRGlzY292ZXJ5XHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignVE1EQiBMYW1iZGEgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3Igc3RhY2s6JywgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLnN0YWNrIDogJ05vIHN0YWNrIHRyYWNlJyk7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFbnZpcm9ubWVudCB2YXJpYWJsZXM6Jywge1xyXG4gICAgICBUTURCX0FQSV9LRVk6IHByb2Nlc3MuZW52LlRNREJfQVBJX0tFWSA/ICdTRVQnIDogJ05PVCBTRVQnLFxyXG4gICAgICBUTURCX1JFQURfVE9LRU46IHByb2Nlc3MuZW52LlRNREJfUkVBRF9UT0tFTiA/ICdTRVQnIDogJ05PVCBTRVQnLFxyXG4gICAgICBUTURCX0JBU0VfVVJMOiBwcm9jZXNzLmVudi5UTURCX0JBU0VfVVJMIHx8ICdOT1QgU0VUJ1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBjYW5kaWRhdGVzOiBbXSxcclxuICAgICAgICB0b3RhbFJlc3VsdHM6IDAsXHJcbiAgICAgICAgcGFnZTogMSxcclxuICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICB9XHJcbn07Il19