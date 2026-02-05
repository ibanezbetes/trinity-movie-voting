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
    async discoverContent(mediaType, genreIds) {
        try {
            let candidates = [];
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
                    if (candidates.length >= this.TARGET_COUNT)
                        break;
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
                    if (candidates.length >= this.TARGET_COUNT)
                        break;
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
        }
        catch (error) {
            console.error('Smart Random Discovery Error:', error);
            throw new Error(`Smart Random Discovery failed: ${error}`);
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
            'vote_count.gte': 100, // Minimum 100 votes to avoid garbage content
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdG1kYi9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxrREFBMEI7QUFvRDFCLHlCQUF5QjtBQUN6QixNQUFNLG9CQUFvQjtJQUExQjtRQUNFLDRFQUE0RTtRQUM1RSxpRUFBaUU7UUFDaEQscUJBQWdCLEdBQUcscUZBQXFGLENBQUM7SUFVNUgsQ0FBQztJQVJDLGVBQWUsQ0FBQyxLQUFhLEVBQUUsUUFBZ0I7UUFDN0MsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDbkUsQ0FBQztJQUVELGFBQWEsQ0FBQyxJQUFZO1FBQ3hCLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFBRSxPQUFPLEtBQUssQ0FBQztRQUM5QyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDMUMsQ0FBQztDQUNGO0FBRUQsMENBQTBDO0FBQzFDLE1BQU0sVUFBVTtJQU1kO1FBRmlCLGlCQUFZLEdBQUcsRUFBRSxDQUFDLENBQUMsOEJBQThCO1FBR2hFLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksOEJBQThCLENBQUM7UUFDM0UsOERBQThEO1FBQzlELElBQUksQ0FBQyxTQUFTLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLElBQUksRUFBRSxDQUFDO1FBQy9FLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxvQkFBb0IsRUFBRSxDQUFDO1FBRTVDLE9BQU8sQ0FBQyxHQUFHLENBQUMsNEJBQTRCLENBQUMsQ0FBQztRQUMxQyxPQUFPLENBQUMsR0FBRyxD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LENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUMzQyxPQUFPLENBQUMsS0FBSyxDQUFDLGNBQWMsRUFBRSxLQUFLLFlBQVksS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ3ZGLE9BQU8sQ0FBQyxLQUFLLENBQUMsd0JBQXdCLEVBQUU7WUFDdEMsWUFBWSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsWUFBWSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDMUQsZUFBZSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLFNBQVM7WUFDaEUsYUFBYSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxJQUFJLFNBQVM7U0FDdEQsQ0FBQyxDQUFDO1FBRUgsTUFBTSxZQUFZLEdBQUcsS0FBSyxZQUFZLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsd0JBQXdCLENBQUM7UUFFdkYsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFO2dCQUNKLFVBQVUsRUFBRSxFQUFFO2dCQUNkLFlBQVksRUFBRSxDQUFDO2dCQUNmLElBQUksRUFBRSxDQUFDO2dCQUNQLEtBQUssRUFBRSxZQUFZO2FBQ3BCO1NBQ0YsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUFsRVcsUUFBQSxPQUFPLFdBa0VsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcclxuXHJcbi8vIFR5cGVzXHJcbmludGVyZmFjZSBUTURCRGlzY292ZXJ5UGFyYW1zIHtcclxuICBwYWdlOiBudW1iZXI7XHJcbiAgd2l0aF9nZW5yZXM/OiBzdHJpbmc7XHJcbiAgbGFuZ3VhZ2U6IHN0cmluZztcclxuICByZWdpb24/OiBzdHJpbmc7XHJcbiAgc29ydF9ieTogc3RyaW5nO1xyXG4gIGluY2x1ZGVfYWR1bHQ6IGJvb2xlYW47XHJcbiAgd2l0aF9vcmlnaW5hbF9sYW5ndWFnZTogc3RyaW5nOyAvLyBXZXN0ZXJuIGxhbmd1YWdlcyBvbmx5XHJcbiAgJ3ZvdGVfY291bnQuZ3RlJz86IG51bWJlcjsgLy8gTWluaW11bSB2b3RlIGNvdW50IGZpbHRlclxyXG59XHJcblxyXG5pbnRlcmZhY2UgVE1EQk1vdmllUmVzcG9uc2Uge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU/OiBzdHJpbmc7XHJcbiAgbmFtZT86IHN0cmluZzsgLy8gVFYgc2hvd3MgdXNlICduYW1lJyBpbnN0ZWFkIG9mICd0aXRsZSdcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3Rlcl9wYXRoOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJlbGVhc2VfZGF0ZT86IHN0cmluZztcclxuICBmaXJzdF9haXJfZGF0ZT86IHN0cmluZzsgLy8gVFYgc2hvd3MgdXNlICdmaXJzdF9haXJfZGF0ZSdcclxuICBnZW5yZV9pZHM6IG51bWJlcltdO1xyXG4gIG9yaWdpbmFsX2xhbmd1YWdlOiBzdHJpbmc7XHJcbiAgbWVkaWFfdHlwZT86ICdtb3ZpZScgfCAndHYnO1xyXG4gIHZvdGVfY291bnQ/OiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNb3ZpZUNhbmRpZGF0ZSB7XHJcbiAgaWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIG92ZXJ2aWV3OiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aDogc3RyaW5nIHwgbnVsbDtcclxuICByZWxlYXNlRGF0ZTogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbn1cclxuXHJcbmludGVyZmFjZSBUTURCRXZlbnQge1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgZ2VucmVJZHM/OiBudW1iZXJbXTtcclxuICBwYWdlPzogbnVtYmVyO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVE1EQlJlc3BvbnNlIHtcclxuICBzdGF0dXNDb2RlOiBudW1iZXI7XHJcbiAgYm9keToge1xyXG4gICAgY2FuZGlkYXRlczogTW92aWVDYW5kaWRhdGVbXTtcclxuICAgIHRvdGFsUmVzdWx0czogbnVtYmVyO1xyXG4gICAgcGFnZTogbnVtYmVyO1xyXG4gIH07XHJcbn1cclxuXHJcbi8vIExhdGluIFNjcmlwdCBWYWxpZGF0b3JcclxuY2xhc3MgTGF0aW5TY3JpcHRWYWxpZGF0b3Ige1xyXG4gIC8vIFJlZ2V4IHRvIG1hdGNoIExhdGluIGNoYXJhY3RlcnMsIG51bWJlcnMsIHB1bmN0dWF0aW9uLCBhbmQgY29tbW9uIGFjY2VudHNcclxuICAvLyBFeGNsdWRlcyBDSksgKENoaW5lc2UvSmFwYW5lc2UvS29yZWFuKSBhbmQgQ3lyaWxsaWMgY2hhcmFjdGVyc1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbGF0aW5TY3JpcHRSZWdleCA9IC9eW1xcdTAwMDAtXFx1MDA3RlxcdTAwQTAtXFx1MDBGRlxcdTAxMDAtXFx1MDE3RlxcdTAxODAtXFx1MDI0RlxcdTFFMDAtXFx1MUVGRlxcc1xccHtQfVxccHtOfV0qJC91O1xyXG4gIFxyXG4gIHZhbGlkYXRlQ29udGVudCh0aXRsZTogc3RyaW5nLCBvdmVydmlldzogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gdGhpcy5pc0xhdGluU2NyaXB0KHRpdGxlKSAmJiB0aGlzLmlzTGF0aW5TY3JpcHQob3ZlcnZpZXcpO1xyXG4gIH1cclxuICBcclxuICBpc0xhdGluU2NyaXB0KHRleHQ6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgaWYgKCF0ZXh0IHx8IHRleHQudHJpbSgpID09PSAnJykgcmV0dXJuIGZhbHNlO1xyXG4gICAgcmV0dXJuIHRoaXMubGF0aW5TY3JpcHRSZWdleC50ZXN0KHRleHQpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVE1EQiBDbGllbnQgd2l0aCBTbWFydCBSYW5kb20gRGlzY292ZXJ5XHJcbmNsYXNzIFRNREJDbGllbnQge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgYmFzZVVybDogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgcmVhZFRva2VuOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB2YWxpZGF0b3I6IExhdGluU2NyaXB0VmFsaWRhdG9yO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgVEFSR0VUX0NPVU5UID0gNTA7IC8vIFRhcmdldCBudW1iZXIgb2YgY2FuZGlkYXRlc1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuYmFzZVVybCA9IHByb2Nlc3MuZW52LlRNREJfQkFTRV9VUkwgfHwgJ2h0dHBzOi8vYXBpLnRoZW1vdmllZGIub3JnLzMnO1xyXG4gICAgLy8gVHJ5IGJvdGggVE1EQl9SRUFEX1RPS0VOIGFuZCBUTURCX0FQSV9LRVkgZm9yIGNvbXBhdGliaWxpdHlcclxuICAgIHRoaXMucmVhZFRva2VuID0gcHJvY2Vzcy5lbnYuVE1EQl9SRUFEX1RPS0VOIHx8IHByb2Nlc3MuZW52LlRNREJfQVBJX0tFWSB8fCAnJztcclxuICAgIHRoaXMudmFsaWRhdG9yID0gbmV3IExhdGluU2NyaXB0VmFsaWRhdG9yKCk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCdUTURCQ2xpZW50IGluaXRpYWxpemluZy4uLicpO1xyXG4gICAgY29uc29sZS5sb2coJ0Jhc2UgVVJMOicsIHRoaXMuYmFzZVVybCk7XHJcbiAgICBjb25zb2xlLmxvZygnVG9rZW4gY29uZmlndXJlZDonLCB0aGlzLnJlYWRUb2tlbiA/ICdZRVMnIDogJ05PJyk7XHJcbiAgICBjb25zb2xlLmxvZygnVG9rZW4gbGVuZ3RoOicsIHRoaXMucmVhZFRva2VuLmxlbmd0aCk7XHJcbiAgICBcclxuICAgIGlmICghdGhpcy5yZWFkVG9rZW4pIHtcclxuICAgICAgY29uc29sZS5lcnJvcignQXZhaWxhYmxlIGVudmlyb25tZW50IHZhcmlhYmxlczonLCBPYmplY3Qua2V5cyhwcm9jZXNzLmVudikuZmlsdGVyKGtleSA9PiBrZXkuaW5jbHVkZXMoJ1RNREInKSkpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RNREJfUkVBRF9UT0tFTiBvciBUTURCX0FQSV9LRVkgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgcmVxdWlyZWQnKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgQWxnb3JpdGhtXHJcbiAgICogMS4gUHJpb3JpdHkgU2VhcmNoIChBTkQgbG9naWMpOiBBbGwgZ2VucmVzIG11c3QgbWF0Y2hcclxuICAgKiAyLiBGYWxsYmFjayBTZWFyY2ggKE9SIGxvZ2ljKTogQW55IGdlbnJlIGNhbiBtYXRjaFxyXG4gICAqIDMuIFJhbmRvbSBwYWdlIHNlbGVjdGlvbiB0byBhdm9pZCByZXBldGl0aXZlIGNvbnRlbnRcclxuICAgKiA0LiBTaHVmZmxlIGZpbmFsIHJlc3VsdHMgZm9yIHZhcmlldHlcclxuICAgKi9cclxuICBhc3luYyBkaXNjb3ZlckNvbnRlbnQobWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgZ2VucmVJZHM/OiBudW1iZXJbXSk6IFByb21pc2U8TW92aWVDYW5kaWRhdGVbXT4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgbGV0IGNhbmRpZGF0ZXM6IE1vdmllQ2FuZGlkYXRlW10gPSBbXTtcclxuICAgICAgXHJcbiAgICAgIGNvbnNvbGUubG9nKGBTdGFydGluZyBTbWFydCBSYW5kb20gRGlzY292ZXJ5IGZvciAke21lZGlhVHlwZX0gd2l0aCBnZW5yZXM6ICR7Z2VucmVJZHM/LmpvaW4oJywnKSB8fCAnbm9uZSd9YCk7XHJcblxyXG4gICAgICAvLyBTVEVQIEE6IFByaW9yaXR5IFNlYXJjaCAoQU5EIExvZ2ljIGZvciBHZW5yZXMpXHJcbiAgICAgIGlmIChnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ1NURVAgQTogUHJpb3JpdHkgc2VhcmNoIHdpdGggQUxMIGdlbnJlcyAoQU5EIGxvZ2ljKScpO1xyXG4gICAgICAgIGNvbnN0IHJhbmRvbVBhZ2VBID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMjApICsgMTtcclxuICAgICAgICBjb25zdCBzdHJpY3RSZXN1bHRzID0gYXdhaXQgdGhpcy5mZXRjaEZyb21UbWRiKG1lZGlhVHlwZSwge1xyXG4gICAgICAgICAgZ2VucmVJZHMsXHJcbiAgICAgICAgICBsb2dpY1R5cGU6ICdBTkQnLFxyXG4gICAgICAgICAgcGFnZTogcmFuZG9tUGFnZUFcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBmaWx0ZXJlZFN0cmljdCA9IHRoaXMuYXBwbHlCYXNlRmlsdGVycyhzdHJpY3RSZXN1bHRzLCBtZWRpYVR5cGUpO1xyXG4gICAgICAgIGNhbmRpZGF0ZXMucHVzaCguLi5maWx0ZXJlZFN0cmljdCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFByaW9yaXR5IHNlYXJjaCBmb3VuZCAke2ZpbHRlcmVkU3RyaWN0Lmxlbmd0aH0gY2FuZGlkYXRlcyAocGFnZSAke3JhbmRvbVBhZ2VBfSlgKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gU1RFUCBCOiBGYWxsYmFjayBTZWFyY2ggKE9SIExvZ2ljKSBpZiBuZWVkZWRcclxuICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoIDwgdGhpcy5UQVJHRVRfQ09VTlQgJiYgZ2VucmVJZHMgJiYgZ2VucmVJZHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBTVEVQIEI6IEZhbGxiYWNrIHNlYXJjaCB3aXRoIEFOWSBnZW5yZSAoT1IgbG9naWMpIC0gbmVlZCAke3RoaXMuVEFSR0VUX0NPVU5UIC0gY2FuZGlkYXRlcy5sZW5ndGh9IG1vcmVgKTtcclxuICAgICAgICBjb25zdCByYW5kb21QYWdlQiA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDIwKSArIDE7XHJcbiAgICAgICAgY29uc3QgbG9vc2VSZXN1bHRzID0gYXdhaXQgdGhpcy5mZXRjaEZyb21UbWRiKG1lZGlhVHlwZSwge1xyXG4gICAgICAgICAgZ2VucmVJZHMsXHJcbiAgICAgICAgICBsb2dpY1R5cGU6ICdPUicsXHJcbiAgICAgICAgICBwYWdlOiByYW5kb21QYWdlQlxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGZpbHRlcmVkTG9vc2UgPSB0aGlzLmFwcGx5QmFzZUZpbHRlcnMobG9vc2VSZXN1bHRzLCBtZWRpYVR5cGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCB1bmlxdWUgaXRlbXMgdW50aWwgd2UgcmVhY2ggdGFyZ2V0XHJcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGZpbHRlcmVkTG9vc2UpIHtcclxuICAgICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA+PSB0aGlzLlRBUkdFVF9DT1VOVCkgYnJlYWs7XHJcbiAgICAgICAgICBpZiAoIWNhbmRpZGF0ZXMuZmluZChjID0+IGMuaWQgPT09IGl0ZW0uaWQpKSB7XHJcbiAgICAgICAgICAgIGNhbmRpZGF0ZXMucHVzaChpdGVtKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc29sZS5sb2coYEFmdGVyIGZhbGxiYWNrIHNlYXJjaDogJHtjYW5kaWRhdGVzLmxlbmd0aH0gdG90YWwgY2FuZGlkYXRlc2ApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTVEVQIEM6IEdlbmVyYWwgRGlzY292ZXJ5IGlmIHN0aWxsIG5vdCBlbm91Z2ggY29udGVudFxyXG4gICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPCB0aGlzLlRBUkdFVF9DT1VOVCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBTVEVQIEM6IEdlbmVyYWwgZGlzY292ZXJ5IC0gbmVlZCAke3RoaXMuVEFSR0VUX0NPVU5UIC0gY2FuZGlkYXRlcy5sZW5ndGh9IG1vcmVgKTtcclxuICAgICAgICBjb25zdCByYW5kb21QYWdlQyA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDIwKSArIDE7XHJcbiAgICAgICAgY29uc3QgZ2VuZXJhbFJlc3VsdHMgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGIobWVkaWFUeXBlLCB7XHJcbiAgICAgICAgICBwYWdlOiByYW5kb21QYWdlQ1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGZpbHRlcmVkR2VuZXJhbCA9IHRoaXMuYXBwbHlCYXNlRmlsdGVycyhnZW5lcmFsUmVzdWx0cywgbWVkaWFUeXBlKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdW5pcXVlIGl0ZW1zIHVudGlsIHdlIHJlYWNoIHRhcmdldFxyXG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBmaWx0ZXJlZEdlbmVyYWwpIHtcclxuICAgICAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA+PSB0aGlzLlRBUkdFVF9DT1VOVCkgYnJlYWs7XHJcbiAgICAgICAgICBpZiAoIWNhbmRpZGF0ZXMuZmluZChjID0+IGMuaWQgPT09IGl0ZW0uaWQpKSB7XHJcbiAgICAgICAgICAgIGNhbmRpZGF0ZXMucHVzaChpdGVtKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgY29uc29sZS5sb2coYEFmdGVyIGdlbmVyYWwgZGlzY292ZXJ5OiAke2NhbmRpZGF0ZXMubGVuZ3RofSB0b3RhbCBjYW5kaWRhdGVzYCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNURVAgRDogU2h1ZmZsZSBmaW5hbCByZXN1bHRzIGZvciB2YXJpZXR5XHJcbiAgICAgIGNvbnN0IHNodWZmbGVkQ2FuZGlkYXRlcyA9IHRoaXMuc2h1ZmZsZUFycmF5KGNhbmRpZGF0ZXMpLnNsaWNlKDAsIHRoaXMuVEFSR0VUX0NPVU5UKTtcclxuICAgICAgY29uc29sZS5sb2coYEZpbmFsIHJlc3VsdDogJHtzaHVmZmxlZENhbmRpZGF0ZXMubGVuZ3RofSBzaHVmZmxlZCBjYW5kaWRhdGVzYCk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gc2h1ZmZsZWRDYW5kaWRhdGVzO1xyXG5cclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1NtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgRXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgZmFpbGVkOiAke2Vycm9yfWApO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRmV0Y2ggY29udGVudCBmcm9tIFRNREIgd2l0aCBzcGVjaWZpZWQgcGFyYW1ldGVyc1xyXG4gICAqL1xyXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hGcm9tVG1kYihcclxuICAgIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVicsIFxyXG4gICAgb3B0aW9uczoge1xyXG4gICAgICBnZW5yZUlkcz86IG51bWJlcltdO1xyXG4gICAgICBsb2dpY1R5cGU/OiAnQU5EJyB8ICdPUic7XHJcbiAgICAgIHBhZ2U/OiBudW1iZXI7XHJcbiAgICB9ID0ge31cclxuICApOiBQcm9taXNlPFRNREJNb3ZpZVJlc3BvbnNlW10+IHtcclxuICAgIGNvbnN0IHsgZ2VucmVJZHMsIGxvZ2ljVHlwZSwgcGFnZSA9IDEgfSA9IG9wdGlvbnM7XHJcbiAgICBjb25zdCBlbmRwb2ludCA9IG1lZGlhVHlwZSA9PT0gJ01PVklFJyA/ICcvZGlzY292ZXIvbW92aWUnIDogJy9kaXNjb3Zlci90dic7XHJcbiAgICBcclxuICAgIGNvbnN0IHBhcmFtczogVE1EQkRpc2NvdmVyeVBhcmFtcyA9IHtcclxuICAgICAgcGFnZSxcclxuICAgICAgbGFuZ3VhZ2U6ICdlcy1FUycsIC8vIERlZmF1bHQgbGFuZ3VhZ2VcclxuICAgICAgc29ydF9ieTogJ3BvcHVsYXJpdHkuZGVzYycsXHJcbiAgICAgIGluY2x1ZGVfYWR1bHQ6IGZhbHNlLFxyXG4gICAgICB3aXRoX29yaWdpbmFsX2xhbmd1YWdlOiAnZW58ZXN8ZnJ8aXR8ZGV8cHQnLCAvLyBXZXN0ZXJuIGxhbmd1YWdlcyBvbmx5XHJcbiAgICAgICd2b3RlX2NvdW50Lmd0ZSc6IDEwMCwgLy8gTWluaW11bSAxMDAgdm90ZXMgdG8gYXZvaWQgZ2FyYmFnZSBjb250ZW50XHJcbiAgICB9O1xyXG5cclxuICAgIC8vIEFkZCBnZW5yZSBmaWx0ZXIgYmFzZWQgb24gbG9naWMgdHlwZVxyXG4gICAgaWYgKGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgaWYgKGxvZ2ljVHlwZSA9PT0gJ09SJykge1xyXG4gICAgICAgIHBhcmFtcy53aXRoX2dlbnJlcyA9IGdlbnJlSWRzLmpvaW4oJ3wnKTsgLy8gT1IgbG9naWM6IGFueSBnZW5yZSBtYXRjaGVzXHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcGFyYW1zLndpdGhfZ2VucmVzID0gZ2VucmVJZHMuam9pbignLCcpOyAvLyBBTkQgbG9naWM6IGFsbCBnZW5yZXMgbXVzdCBtYXRjaFxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc29sZS5sb2coYEZldGNoaW5nIGZyb20gVE1EQiAke2VuZHBvaW50fSB3aXRoIHBhcmFtczpgLCBKU09OLnN0cmluZ2lmeShwYXJhbXMpKTtcclxuXHJcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGF4aW9zLmdldChgJHt0aGlzLmJhc2VVcmx9JHtlbmRwb2ludH1gLCB7XHJcbiAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAnYWNjZXB0JzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICdBdXRob3JpemF0aW9uJzogYEJlYXJlciAke3RoaXMucmVhZFRva2VufWBcclxuICAgICAgfSxcclxuICAgICAgcGFyYW1zXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCByZXN1bHRzOiBUTURCTW92aWVSZXNwb25zZVtdID0gcmVzcG9uc2UuZGF0YS5yZXN1bHRzIHx8IFtdO1xyXG4gICAgY29uc29sZS5sb2coYFRNREIgcmV0dXJuZWQgJHtyZXN1bHRzLmxlbmd0aH0gcmF3IHJlc3VsdHMgZm9yIHBhZ2UgJHtwYWdlfWApO1xyXG4gICAgXHJcbiAgICByZXR1cm4gcmVzdWx0cztcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEFwcGx5IGJhc2UgcXVhbGl0eSBmaWx0ZXJzIHRvIFRNREIgcmVzdWx0c1xyXG4gICAqL1xyXG4gIHByaXZhdGUgYXBwbHlCYXNlRmlsdGVycyhyZXN1bHRzOiBUTURCTW92aWVSZXNwb25zZVtdLCBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnKTogTW92aWVDYW5kaWRhdGVbXSB7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdID0gW107XHJcblxyXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIHJlc3VsdHMpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBFeHRyYWN0IHRpdGxlIChtb3ZpZXMgdXNlICd0aXRsZScsIFRWIHNob3dzIHVzZSAnbmFtZScpXHJcbiAgICAgICAgY29uc3QgdGl0bGUgPSBpdGVtLnRpdGxlIHx8IGl0ZW0ubmFtZSB8fCAnJztcclxuICAgICAgICBjb25zdCBvdmVydmlldyA9IGl0ZW0ub3ZlcnZpZXcgfHwgJyc7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQmFzZSBxdWFsaXR5IGZpbHRlcnNcclxuICAgICAgICBpZiAoIWl0ZW0ucG9zdGVyX3BhdGgpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgaXRlbSB3aXRob3V0IHBvc3RlcjogXCIke3RpdGxlfVwiYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFvdmVydmlldyB8fCBvdmVydmlldy50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgb3V0IGl0ZW0gd2l0aG91dCBvdmVydmlldzogXCIke3RpdGxlfVwiYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIFZvdGUgY291bnQgZmlsdGVyIChhZGRpdGlvbmFsIHNhZmV0eSBjaGVjaylcclxuICAgICAgICBpZiAoaXRlbS52b3RlX2NvdW50ICYmIGl0ZW0udm90ZV9jb3VudCA8IDEwMCkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYEZpbHRlcmVkIG91dCBsb3ctdm90ZSBpdGVtOiBcIiR7dGl0bGV9XCIgKCR7aXRlbS52b3RlX2NvdW50fSB2b3RlcylgKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gTGFuZ3VhZ2UgZmlsdGVyIC0gZW5zdXJlIFdlc3Rlcm4gbGFuZ3VhZ2VzIG9ubHlcclxuICAgICAgICBjb25zdCBhbGxvd2VkTGFuZ3VhZ2VzID0gWydlbicsICdlcycsICdmcicsICdpdCcsICdkZScsICdwdCddO1xyXG4gICAgICAgIGlmICghYWxsb3dlZExhbmd1YWdlcy5pbmNsdWRlcyhpdGVtLm9yaWdpbmFsX2xhbmd1YWdlKSkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYEZpbHRlcmVkIG91dCBub24tV2VzdGVybiBsYW5ndWFnZTogXCIke3RpdGxlfVwiICgke2l0ZW0ub3JpZ2luYWxfbGFuZ3VhZ2V9KWApO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFwcGx5IExhdGluIFNjcmlwdCBWYWxpZGF0b3JcclxuICAgICAgICBpZiAoIXRoaXMudmFsaWRhdG9yLnZhbGlkYXRlQ29udGVudCh0aXRsZSwgb3ZlcnZpZXcpKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgb3V0IG5vbi1MYXRpbiBjb250ZW50OiBcIiR7dGl0bGV9XCJgKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gRXh0cmFjdCByZWxlYXNlIGRhdGVcclxuICAgICAgICBjb25zdCByZWxlYXNlRGF0ZSA9IGl0ZW0ucmVsZWFzZV9kYXRlIHx8IGl0ZW0uZmlyc3RfYWlyX2RhdGUgfHwgJyc7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gVHJhbnNmb3JtIHRvIG91ciBmb3JtYXRcclxuICAgICAgICBjb25zdCBjYW5kaWRhdGU6IE1vdmllQ2FuZGlkYXRlID0ge1xyXG4gICAgICAgICAgaWQ6IGl0ZW0uaWQsXHJcbiAgICAgICAgICB0aXRsZSxcclxuICAgICAgICAgIG92ZXJ2aWV3LFxyXG4gICAgICAgICAgcG9zdGVyUGF0aDogYGh0dHBzOi8vaW1hZ2UudG1kYi5vcmcvdC9wL3c1MDAke2l0ZW0ucG9zdGVyX3BhdGh9YCxcclxuICAgICAgICAgIHJlbGVhc2VEYXRlLFxyXG4gICAgICAgICAgbWVkaWFUeXBlOiBtZWRpYVR5cGUgPT09ICdNT1ZJRScgPyAnTU9WSUUnIDogJ1RWJyxcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBjYW5kaWRhdGVzLnB1c2goY2FuZGlkYXRlKTtcclxuXHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyBUTURCIGl0ZW0gJHtpdGVtLmlkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgLy8gQ29udGludWUgcHJvY2Vzc2luZyBvdGhlciBpdGVtc1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGNhbmRpZGF0ZXM7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTaHVmZmxlIGFycmF5IHVzaW5nIEZpc2hlci1ZYXRlcyBhbGdvcml0aG1cclxuICAgKi9cclxuICBwcml2YXRlIHNodWZmbGVBcnJheTxUPihhcnJheTogVFtdKTogVFtdIHtcclxuICAgIGNvbnN0IHNodWZmbGVkID0gWy4uLmFycmF5XTtcclxuICAgIGZvciAobGV0IGkgPSBzaHVmZmxlZC5sZW5ndGggLSAxOyBpID4gMDsgaS0tKSB7XHJcbiAgICAgIGNvbnN0IGogPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAoaSArIDEpKTtcclxuICAgICAgW3NodWZmbGVkW2ldLCBzaHVmZmxlZFtqXV0gPSBbc2h1ZmZsZWRbal0sIHNodWZmbGVkW2ldXTtcclxuICAgIH1cclxuICAgIHJldHVybiBzaHVmZmxlZDtcclxuICB9XHJcblxyXG4gIC8vIExlZ2FjeSBtZXRob2QgZm9yIGJhY2t3YXJkIGNvbXBhdGliaWxpdHkgKGRlcHJlY2F0ZWQpXHJcbiAgYXN5bmMgZGlzY292ZXJDb250ZW50TGVnYWN5KG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVicsIGdlbnJlSWRzPzogbnVtYmVyW10sIHBhZ2UgPSAxKTogUHJvbWlzZTxNb3ZpZUNhbmRpZGF0ZVtdPiB7XHJcbiAgICBjb25zb2xlLndhcm4oJ1VzaW5nIGxlZ2FjeSBkaXNjb3ZlckNvbnRlbnRMZWdhY3kgbWV0aG9kIC0gY29uc2lkZXIgdXBncmFkaW5nIHRvIGRpc2NvdmVyQ29udGVudCcpO1xyXG4gICAgcmV0dXJuIHRoaXMuZGlzY292ZXJDb250ZW50KG1lZGlhVHlwZSwgZ2VucmVJZHMpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gTGFtYmRhIEhhbmRsZXJcclxuZXhwb3J0IGNvbnN0IGhhbmRsZXI6IEhhbmRsZXI8VE1EQkV2ZW50LCBUTURCUmVzcG9uc2U+ID0gYXN5bmMgKGV2ZW50KSA9PiB7XHJcbiAgY29uc29sZS5sb2coJ1RNREIgTGFtYmRhIHJlY2VpdmVkIGV2ZW50OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50KSk7XHJcblxyXG4gIHRyeSB7XHJcbiAgICBjb25zdCB7IG1lZGlhVHlwZSwgZ2VucmVJZHMgfSA9IGV2ZW50O1xyXG5cclxuICAgIC8vIFZhbGlkYXRlIGlucHV0XHJcbiAgICBpZiAoIW1lZGlhVHlwZSB8fCAhWydNT1ZJRScsICdUViddLmluY2x1ZGVzKG1lZGlhVHlwZSkpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignSW52YWxpZCBtZWRpYVR5cGU6JywgbWVkaWFUeXBlKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIG1lZGlhVHlwZS4gTXVzdCBiZSBNT1ZJRSBvciBUVicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFZhbGlkYXRlIGdlbnJlIGxpbWl0IChtYXggMiBhcyBwZXIgbWFzdGVyIHNwZWMpXHJcbiAgICBpZiAoZ2VucmVJZHMgJiYgZ2VucmVJZHMubGVuZ3RoID4gMikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdUb28gbWFueSBnZW5yZXM6JywgZ2VucmVJZHMubGVuZ3RoKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdNYXhpbXVtIDIgZ2VucmVzIGFsbG93ZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDaGVjayBlbnZpcm9ubWVudCB2YXJpYWJsZXNcclxuICAgIGNvbnN0IHRtZGJSZWFkVG9rZW4gPSBwcm9jZXNzLmVudi5UTURCX1JFQURfVE9LRU4gfHwgcHJvY2Vzcy5lbnYuVE1EQl9BUElfS0VZIHx8ICcnO1xyXG4gICAgaWYgKCF0bWRiUmVhZFRva2VuKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1RNREIgdG9rZW4gbm90IGZvdW5kIGluIGVudmlyb25tZW50IHZhcmlhYmxlcycpO1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdBdmFpbGFibGUgZW52IHZhcnM6JywgT2JqZWN0LmtleXMocHJvY2Vzcy5lbnYpLmZpbHRlcihrZXkgPT4ga2V5LmluY2x1ZGVzKCdUTURCJykpKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdUTURCIEFQSSB0b2tlbiBub3QgY29uZmlndXJlZCcpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnNvbGUubG9nKCdUTURCIHRva2VuIGNvbmZpZ3VyZWQsIGxlbmd0aDonLCB0bWRiUmVhZFRva2VuLmxlbmd0aCk7XHJcblxyXG4gICAgY29uc3QgdG1kYkNsaWVudCA9IG5ldyBUTURCQ2xpZW50KCk7XHJcbiAgICBcclxuICAgIC8vIFVzZSBTbWFydCBSYW5kb20gRGlzY292ZXJ5IGFsZ29yaXRobVxyXG4gICAgY29uc29sZS5sb2coJ1VzaW5nIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgYWxnb3JpdGhtJyk7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gYXdhaXQgdG1kYkNsaWVudC5kaXNjb3ZlckNvbnRlbnQobWVkaWFUeXBlLCBnZW5yZUlkcyk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgcmV0dXJuZWQgJHtjYW5kaWRhdGVzLmxlbmd0aH0gY2FuZGlkYXRlc2ApO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgYm9keToge1xyXG4gICAgICAgIGNhbmRpZGF0ZXMsXHJcbiAgICAgICAgdG90YWxSZXN1bHRzOiBjYW5kaWRhdGVzLmxlbmd0aCxcclxuICAgICAgICBwYWdlOiAxLCAvLyBQYWdlIGlzIG5vdyBhYnN0cmFjdGVkIGluIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnlcclxuICAgICAgfSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdUTURCIExhbWJkYSBlcnJvcjonLCBlcnJvcik7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzdGFjazonLCBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3Iuc3RhY2sgOiAnTm8gc3RhY2sgdHJhY2UnKTtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ0Vudmlyb25tZW50IHZhcmlhYmxlczonLCB7XHJcbiAgICAgIFRNREJfQVBJX0tFWTogcHJvY2Vzcy5lbnYuVE1EQl9BUElfS0VZID8gJ1NFVCcgOiAnTk9UIFNFVCcsXHJcbiAgICAgIFRNREJfUkVBRF9UT0tFTjogcHJvY2Vzcy5lbnYuVE1EQl9SRUFEX1RPS0VOID8gJ1NFVCcgOiAnTk9UIFNFVCcsXHJcbiAgICAgIFRNREJfQkFTRV9VUkw6IHByb2Nlc3MuZW52LlRNREJfQkFTRV9VUkwgfHwgJ05PVCBTRVQnXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgY29uc3QgZXJyb3JNZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCc7XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgYm9keToge1xyXG4gICAgICAgIGNhbmRpZGF0ZXM6IFtdLFxyXG4gICAgICAgIHRvdGFsUmVzdWx0czogMCxcclxuICAgICAgICBwYWdlOiAxLFxyXG4gICAgICAgIGVycm9yOiBlcnJvck1lc3NhZ2UsXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG4gIH1cclxufTsiXX0=