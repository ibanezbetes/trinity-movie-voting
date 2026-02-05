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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdG1kYi9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxrREFBMEI7QUFvRDFCLHlCQUF5QjtBQUN6QixNQUFNLG9CQUFvQjtJQUExQjtRQUNFLDRFQUE0RTtRQUM1RSxpRUFBaUU7UUFDaEQscUJBQWdCLEdBQUcscUZBQXFGLENBQUM7SUFVNUgsQ0FBQztJQVJDLGVBQWUsQ0FBQyxLQUFhLEVBQUUsUUFBZ0I7UUFDN0MsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDbkUsQ0FBQztJQUVELGFBQWEsQ0FBQyxJQUFZO1FBQ3hCLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFBRSxPQUFPLEtBQUssQ0FBQztRQUM5QyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDMUMsQ0FBQztDQUNGO0FBRUQsMENBQTBDO0FBQzFDLE1BQU0sVUFBVTtJQU1kO1FBRmlCLGlCQUFZLEdBQUcsRUFBRSxDQUFDLENBQUMsOEJBQThCO1FBR2hFLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksOEJBQThCLENBQUM7UUFDM0UsOERBQThEO1FBQzlELElBQUksQ0FBQyxTQUFTLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLElBQUksRUFBRSxDQUFDO1FBQy9FLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxvQkFBb0IsRUFBRSxDQUFDO1FBRTVDLE9BQU8sQ0FBQyxHQUFHLENBQUMsNEJBQTRCLENBQUMsQ0FBQztRQUMxQyxPQUFPLENBQUMsR0FBRyxD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dkYsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFO2dCQUNKLFVBQVUsRUFBRSxFQUFFO2dCQUNkLFlBQVksRUFBRSxDQUFDO2dCQUNmLElBQUksRUFBRSxDQUFDO2dCQUNQLEtBQUssRUFBRSxZQUFZO2FBQ3BCO1NBQ0YsQ0FBQztJQUNKLENBQUM7QUFDSCxDQUFDLENBQUM7QUFsRVcsUUFBQSxPQUFPLFdBa0VsQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEhhbmRsZXIgfSBmcm9tICdhd3MtbGFtYmRhJztcclxuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJztcclxuXHJcbi8vIFR5cGVzXHJcbmludGVyZmFjZSBUTURCRGlzY292ZXJ5UGFyYW1zIHtcclxuICBwYWdlOiBudW1iZXI7XHJcbiAgd2l0aF9nZW5yZXM/OiBzdHJpbmc7XHJcbiAgbGFuZ3VhZ2U6IHN0cmluZztcclxuICByZWdpb24/OiBzdHJpbmc7XHJcbiAgc29ydF9ieTogc3RyaW5nO1xyXG4gIGluY2x1ZGVfYWR1bHQ6IGJvb2xlYW47XHJcbiAgd2l0aF9vcmlnaW5hbF9sYW5ndWFnZTogc3RyaW5nOyAvLyBXZXN0ZXJuIGxhbmd1YWdlcyBvbmx5XHJcbiAgJ3ZvdGVfY291bnQuZ3RlJz86IG51bWJlcjsgLy8gTWluaW11bSB2b3RlIGNvdW50IGZpbHRlclxyXG59XHJcblxyXG5pbnRlcmZhY2UgVE1EQk1vdmllUmVzcG9uc2Uge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU/OiBzdHJpbmc7XHJcbiAgbmFtZT86IHN0cmluZzsgLy8gVFYgc2hvd3MgdXNlICduYW1lJyBpbnN0ZWFkIG9mICd0aXRsZSdcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3Rlcl9wYXRoOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJlbGVhc2VfZGF0ZT86IHN0cmluZztcclxuICBmaXJzdF9haXJfZGF0ZT86IHN0cmluZzsgLy8gVFYgc2hvd3MgdXNlICdmaXJzdF9haXJfZGF0ZSdcclxuICBnZW5yZV9pZHM6IG51bWJlcltdO1xyXG4gIG9yaWdpbmFsX2xhbmd1YWdlOiBzdHJpbmc7XHJcbiAgbWVkaWFfdHlwZT86ICdtb3ZpZScgfCAndHYnO1xyXG4gIHZvdGVfY291bnQ/OiBudW1iZXI7XHJcbn1cclxuXHJcbmludGVyZmFjZSBNb3ZpZUNhbmRpZGF0ZSB7XHJcbiAgaWQ6IG51bWJlcjtcclxuICB0aXRsZTogc3RyaW5nO1xyXG4gIG92ZXJ2aWV3OiBzdHJpbmc7XHJcbiAgcG9zdGVyUGF0aDogc3RyaW5nIHwgbnVsbDtcclxuICByZWxlYXNlRGF0ZTogc3RyaW5nO1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbn1cclxuXHJcbmludGVyZmFjZSBUTURCRXZlbnQge1xyXG4gIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVic7XHJcbiAgZ2VucmVJZHM/OiBudW1iZXJbXTtcclxuICBwYWdlPzogbnVtYmVyO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVE1EQlJlc3BvbnNlIHtcclxuICBzdGF0dXNDb2RlOiBudW1iZXI7XHJcbiAgYm9keToge1xyXG4gICAgY2FuZGlkYXRlczogTW92aWVDYW5kaWRhdGVbXTtcclxuICAgIHRvdGFsUmVzdWx0czogbnVtYmVyO1xyXG4gICAgcGFnZTogbnVtYmVyO1xyXG4gIH07XHJcbn1cclxuXHJcbi8vIExhdGluIFNjcmlwdCBWYWxpZGF0b3JcclxuY2xhc3MgTGF0aW5TY3JpcHRWYWxpZGF0b3Ige1xyXG4gIC8vIFJlZ2V4IHRvIG1hdGNoIExhdGluIGNoYXJhY3RlcnMsIG51bWJlcnMsIHB1bmN0dWF0aW9uLCBhbmQgY29tbW9uIGFjY2VudHNcclxuICAvLyBFeGNsdWRlcyBDSksgKENoaW5lc2UvSmFwYW5lc2UvS29yZWFuKSBhbmQgQ3lyaWxsaWMgY2hhcmFjdGVyc1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbGF0aW5TY3JpcHRSZWdleCA9IC9eW1xcdTAwMDAtXFx1MDA3RlxcdTAwQTAtXFx1MDBGRlxcdTAxMDAtXFx1MDE3RlxcdTAxODAtXFx1MDI0RlxcdTFFMDAtXFx1MUVGRlxcc1xccHtQfVxccHtOfV0qJC91O1xyXG4gIFxyXG4gIHZhbGlkYXRlQ29udGVudCh0aXRsZTogc3RyaW5nLCBvdmVydmlldzogc3RyaW5nKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gdGhpcy5pc0xhdGluU2NyaXB0KHRpdGxlKSAmJiB0aGlzLmlzTGF0aW5TY3JpcHQob3ZlcnZpZXcpO1xyXG4gIH1cclxuICBcclxuICBpc0xhdGluU2NyaXB0KHRleHQ6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgaWYgKCF0ZXh0IHx8IHRleHQudHJpbSgpID09PSAnJykgcmV0dXJuIGZhbHNlO1xyXG4gICAgcmV0dXJuIHRoaXMubGF0aW5TY3JpcHRSZWdleC50ZXN0KHRleHQpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gVE1EQiBDbGllbnQgd2l0aCBTbWFydCBSYW5kb20gRGlzY292ZXJ5XHJcbmNsYXNzIFRNREJDbGllbnQge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgYmFzZVVybDogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgcmVhZFRva2VuOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB2YWxpZGF0b3I6IExhdGluU2NyaXB0VmFsaWRhdG9yO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgVEFSR0VUX0NPVU5UID0gNTA7IC8vIFRhcmdldCBudW1iZXIgb2YgY2FuZGlkYXRlc1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuYmFzZVVybCA9IHByb2Nlc3MuZW52LlRNREJfQkFTRV9VUkwgfHwgJ2h0dHBzOi8vYXBpLnRoZW1vdmllZGIub3JnLzMnO1xyXG4gICAgLy8gVHJ5IGJvdGggVE1EQl9SRUFEX1RPS0VOIGFuZCBUTURCX0FQSV9LRVkgZm9yIGNvbXBhdGliaWxpdHlcclxuICAgIHRoaXMucmVhZFRva2VuID0gcHJvY2Vzcy5lbnYuVE1EQl9SRUFEX1RPS0VOIHx8IHByb2Nlc3MuZW52LlRNREJfQVBJX0tFWSB8fCAnJztcclxuICAgIHRoaXMudmFsaWRhdG9yID0gbmV3IExhdGluU2NyaXB0VmFsaWRhdG9yKCk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCdUTURCQ2xpZW50IGluaXRpYWxpemluZy4uLicpO1xyXG4gICAgY29uc29sZS5sb2coJ0Jhc2UgVVJMOicsIHRoaXMuYmFzZVVybCk7XHJcbiAgICBjb25zb2xlLmxvZygnVG9rZW4gY29uZmlndXJlZDonLCB0aGlzLnJlYWRUb2tlbiA/ICdZRVMnIDogJ05PJyk7XHJcbiAgICBjb25zb2xlLmxvZygnVG9rZW4gbGVuZ3RoOicsIHRoaXMucmVhZFRva2VuLmxlbmd0aCk7XHJcbiAgICBjb25zb2xlLmxvZygnVG9rZW4gZmlyc3QgMjAgY2hhcnM6JywgdGhpcy5yZWFkVG9rZW4uc3Vic3RyaW5nKDAsIDIwKSk7XHJcbiAgICBjb25zb2xlLmxvZygnQWxsIGVudiB2YXJzOicsIE9iamVjdC5rZXlzKHByb2Nlc3MuZW52KSk7XHJcbiAgICBjb25zb2xlLmxvZygnVE1EQiBlbnYgdmFyczonLCBPYmplY3Qua2V5cyhwcm9jZXNzLmVudikuZmlsdGVyKGtleSA9PiBrZXkuaW5jbHVkZXMoJ1RNREInKSkpO1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMucmVhZFRva2VuKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0F2YWlsYWJsZSBlbnZpcm9ubWVudCB2YXJpYWJsZXM6JywgT2JqZWN0LmtleXMocHJvY2Vzcy5lbnYpLmZpbHRlcihrZXkgPT4ga2V5LmluY2x1ZGVzKCdUTURCJykpKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdUTURCX1JFQURfVE9LRU4gb3IgVE1EQl9BUElfS0VZIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTbWFydCBSYW5kb20gRGlzY292ZXJ5IEFsZ29yaXRobVxyXG4gICAqIDEuIFByaW9yaXR5IFNlYXJjaCAoQU5EIGxvZ2ljKTogQWxsIGdlbnJlcyBtdXN0IG1hdGNoXHJcbiAgICogMi4gRmFsbGJhY2sgU2VhcmNoIChPUiBsb2dpYyk6IEFueSBnZW5yZSBjYW4gbWF0Y2hcclxuICAgKiAzLiBSYW5kb20gcGFnZSBzZWxlY3Rpb24gdG8gYXZvaWQgcmVwZXRpdGl2ZSBjb250ZW50XHJcbiAgICogNC4gU2h1ZmZsZSBmaW5hbCByZXN1bHRzIGZvciB2YXJpZXR5XHJcbiAgICovXHJcbiAgYXN5bmMgZGlzY292ZXJDb250ZW50KG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVicsIGdlbnJlSWRzPzogbnVtYmVyW10pOiBQcm9taXNlPE1vdmllQ2FuZGlkYXRlW10+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGxldCBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdID0gW107XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhgU3RhcnRpbmcgU21hcnQgUmFuZG9tIERpc2NvdmVyeSBmb3IgJHttZWRpYVR5cGV9IHdpdGggZ2VucmVzOiAke2dlbnJlSWRzPy5qb2luKCcsJykgfHwgJ25vbmUnfWApO1xyXG5cclxuICAgICAgLy8gU1RFUCBBOiBQcmlvcml0eSBTZWFyY2ggKEFORCBMb2dpYyBmb3IgR2VucmVzKVxyXG4gICAgICBpZiAoZ2VucmVJZHMgJiYgZ2VucmVJZHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdTVEVQIEE6IFByaW9yaXR5IHNlYXJjaCB3aXRoIEFMTCBnZW5yZXMgKEFORCBsb2dpYyknKTtcclxuICAgICAgICBjb25zdCByYW5kb21QYWdlQSA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIDIwKSArIDE7XHJcbiAgICAgICAgY29uc3Qgc3RyaWN0UmVzdWx0cyA9IGF3YWl0IHRoaXMuZmV0Y2hGcm9tVG1kYihtZWRpYVR5cGUsIHtcclxuICAgICAgICAgIGdlbnJlSWRzLFxyXG4gICAgICAgICAgbG9naWNUeXBlOiAnQU5EJyxcclxuICAgICAgICAgIHBhZ2U6IHJhbmRvbVBhZ2VBXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgZmlsdGVyZWRTdHJpY3QgPSB0aGlzLmFwcGx5QmFzZUZpbHRlcnMoc3RyaWN0UmVzdWx0cywgbWVkaWFUeXBlKTtcclxuICAgICAgICBjYW5kaWRhdGVzLnB1c2goLi4uZmlsdGVyZWRTdHJpY3QpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGBQcmlvcml0eSBzZWFyY2ggZm91bmQgJHtmaWx0ZXJlZFN0cmljdC5sZW5ndGh9IGNhbmRpZGF0ZXMgKHBhZ2UgJHtyYW5kb21QYWdlQX0pYCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNURVAgQjogRmFsbGJhY2sgU2VhcmNoIChPUiBMb2dpYykgaWYgbmVlZGVkXHJcbiAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA8IHRoaXMuVEFSR0VUX0NPVU5UICYmIGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgU1RFUCBCOiBGYWxsYmFjayBzZWFyY2ggd2l0aCBBTlkgZ2VucmUgKE9SIGxvZ2ljKSAtIG5lZWQgJHt0aGlzLlRBUkdFVF9DT1VOVCAtIGNhbmRpZGF0ZXMubGVuZ3RofSBtb3JlYCk7XHJcbiAgICAgICAgY29uc3QgcmFuZG9tUGFnZUIgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAyMCkgKyAxO1xyXG4gICAgICAgIGNvbnN0IGxvb3NlUmVzdWx0cyA9IGF3YWl0IHRoaXMuZmV0Y2hGcm9tVG1kYihtZWRpYVR5cGUsIHtcclxuICAgICAgICAgIGdlbnJlSWRzLFxyXG4gICAgICAgICAgbG9naWNUeXBlOiAnT1InLFxyXG4gICAgICAgICAgcGFnZTogcmFuZG9tUGFnZUJcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBmaWx0ZXJlZExvb3NlID0gdGhpcy5hcHBseUJhc2VGaWx0ZXJzKGxvb3NlUmVzdWx0cywgbWVkaWFUeXBlKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdW5pcXVlIGl0ZW1zIHVudGlsIHdlIHJlYWNoIHRhcmdldFxyXG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBmaWx0ZXJlZExvb3NlKSB7XHJcbiAgICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPj0gdGhpcy5UQVJHRVRfQ09VTlQpIGJyZWFrO1xyXG4gICAgICAgICAgaWYgKCFjYW5kaWRhdGVzLmZpbmQoYyA9PiBjLmlkID09PSBpdGVtLmlkKSkge1xyXG4gICAgICAgICAgICBjYW5kaWRhdGVzLnB1c2goaXRlbSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBBZnRlciBmYWxsYmFjayBzZWFyY2g6ICR7Y2FuZGlkYXRlcy5sZW5ndGh9IHRvdGFsIGNhbmRpZGF0ZXNgKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gU1RFUCBDOiBHZW5lcmFsIERpc2NvdmVyeSBpZiBzdGlsbCBub3QgZW5vdWdoIGNvbnRlbnRcclxuICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoIDwgdGhpcy5UQVJHRVRfQ09VTlQpIHtcclxuICAgICAgICBjb25zb2xlLmxvZyhgU1RFUCBDOiBHZW5lcmFsIGRpc2NvdmVyeSAtIG5lZWQgJHt0aGlzLlRBUkdFVF9DT1VOVCAtIGNhbmRpZGF0ZXMubGVuZ3RofSBtb3JlYCk7XHJcbiAgICAgICAgY29uc3QgcmFuZG9tUGFnZUMgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAyMCkgKyAxO1xyXG4gICAgICAgIGNvbnN0IGdlbmVyYWxSZXN1bHRzID0gYXdhaXQgdGhpcy5mZXRjaEZyb21UbWRiKG1lZGlhVHlwZSwge1xyXG4gICAgICAgICAgcGFnZTogcmFuZG9tUGFnZUNcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBjb25zdCBmaWx0ZXJlZEdlbmVyYWwgPSB0aGlzLmFwcGx5QmFzZUZpbHRlcnMoZ2VuZXJhbFJlc3VsdHMsIG1lZGlhVHlwZSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHVuaXF1ZSBpdGVtcyB1bnRpbCB3ZSByZWFjaCB0YXJnZXRcclxuICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgZmlsdGVyZWRHZW5lcmFsKSB7XHJcbiAgICAgICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPj0gdGhpcy5UQVJHRVRfQ09VTlQpIGJyZWFrO1xyXG4gICAgICAgICAgaWYgKCFjYW5kaWRhdGVzLmZpbmQoYyA9PiBjLmlkID09PSBpdGVtLmlkKSkge1xyXG4gICAgICAgICAgICBjYW5kaWRhdGVzLnB1c2goaXRlbSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnNvbGUubG9nKGBBZnRlciBnZW5lcmFsIGRpc2NvdmVyeTogJHtjYW5kaWRhdGVzLmxlbmd0aH0gdG90YWwgY2FuZGlkYXRlc2ApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTVEVQIEQ6IFNodWZmbGUgZmluYWwgcmVzdWx0cyBmb3IgdmFyaWV0eVxyXG4gICAgICBjb25zdCBzaHVmZmxlZENhbmRpZGF0ZXMgPSB0aGlzLnNodWZmbGVBcnJheShjYW5kaWRhdGVzKS5zbGljZSgwLCB0aGlzLlRBUkdFVF9DT1VOVCk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGBGaW5hbCByZXN1bHQ6ICR7c2h1ZmZsZWRDYW5kaWRhdGVzLmxlbmd0aH0gc2h1ZmZsZWQgY2FuZGlkYXRlc2ApO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHNodWZmbGVkQ2FuZGlkYXRlcztcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdTbWFydCBSYW5kb20gRGlzY292ZXJ5IEVycm9yOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTbWFydCBSYW5kb20gRGlzY292ZXJ5IGZhaWxlZDogJHtlcnJvcn1gKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEZldGNoIGNvbnRlbnQgZnJvbSBUTURCIHdpdGggc3BlY2lmaWVkIHBhcmFtZXRlcnNcclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIGZldGNoRnJvbVRtZGIoXHJcbiAgICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnLCBcclxuICAgIG9wdGlvbnM6IHtcclxuICAgICAgZ2VucmVJZHM/OiBudW1iZXJbXTtcclxuICAgICAgbG9naWNUeXBlPzogJ0FORCcgfCAnT1InO1xyXG4gICAgICBwYWdlPzogbnVtYmVyO1xyXG4gICAgfSA9IHt9XHJcbiAgKTogUHJvbWlzZTxUTURCTW92aWVSZXNwb25zZVtdPiB7XHJcbiAgICBjb25zdCB7IGdlbnJlSWRzLCBsb2dpY1R5cGUsIHBhZ2UgPSAxIH0gPSBvcHRpb25zO1xyXG4gICAgY29uc3QgZW5kcG9pbnQgPSBtZWRpYVR5cGUgPT09ICdNT1ZJRScgPyAnL2Rpc2NvdmVyL21vdmllJyA6ICcvZGlzY292ZXIvdHYnO1xyXG4gICAgXHJcbiAgICBjb25zdCBwYXJhbXM6IFRNREJEaXNjb3ZlcnlQYXJhbXMgPSB7XHJcbiAgICAgIHBhZ2UsXHJcbiAgICAgIGxhbmd1YWdlOiAnZXMtRVMnLCAvLyBEZWZhdWx0IGxhbmd1YWdlXHJcbiAgICAgIHNvcnRfYnk6ICdwb3B1bGFyaXR5LmRlc2MnLFxyXG4gICAgICBpbmNsdWRlX2FkdWx0OiBmYWxzZSxcclxuICAgICAgd2l0aF9vcmlnaW5hbF9sYW5ndWFnZTogJ2VufGVzfGZyfGl0fGRlfHB0JywgLy8gV2VzdGVybiBsYW5ndWFnZXMgb25seVxyXG4gICAgICAndm90ZV9jb3VudC5ndGUnOiAxMDAsIC8vIE1pbmltdW0gMTAwIHZvdGVzIHRvIGF2b2lkIGdhcmJhZ2UgY29udGVudFxyXG4gICAgfTtcclxuXHJcbiAgICAvLyBBZGQgZ2VucmUgZmlsdGVyIGJhc2VkIG9uIGxvZ2ljIHR5cGVcclxuICAgIGlmIChnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgIGlmIChsb2dpY1R5cGUgPT09ICdPUicpIHtcclxuICAgICAgICBwYXJhbXMud2l0aF9nZW5yZXMgPSBnZW5yZUlkcy5qb2luKCd8Jyk7IC8vIE9SIGxvZ2ljOiBhbnkgZ2VucmUgbWF0Y2hlc1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHBhcmFtcy53aXRoX2dlbnJlcyA9IGdlbnJlSWRzLmpvaW4oJywnKTsgLy8gQU5EIGxvZ2ljOiBhbGwgZ2VucmVzIG11c3QgbWF0Y2hcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGNvbnNvbGUubG9nKGBGZXRjaGluZyBmcm9tIFRNREIgJHtlbmRwb2ludH0gd2l0aCBwYXJhbXM6YCwgSlNPTi5zdHJpbmdpZnkocGFyYW1zKSk7XHJcblxyXG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5nZXQoYCR7dGhpcy5iYXNlVXJsfSR7ZW5kcG9pbnR9YCwge1xyXG4gICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgJ2FjY2VwdCc6ICdhcHBsaWNhdGlvbi9qc29uJyxcclxuICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHt0aGlzLnJlYWRUb2tlbn1gXHJcbiAgICAgIH0sXHJcbiAgICAgIHBhcmFtc1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgcmVzdWx0czogVE1EQk1vdmllUmVzcG9uc2VbXSA9IHJlc3BvbnNlLmRhdGEucmVzdWx0cyB8fCBbXTtcclxuICAgIGNvbnNvbGUubG9nKGBUTURCIHJldHVybmVkICR7cmVzdWx0cy5sZW5ndGh9IHJhdyByZXN1bHRzIGZvciBwYWdlICR7cGFnZX1gKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHJlc3VsdHM7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBBcHBseSBiYXNlIHF1YWxpdHkgZmlsdGVycyB0byBUTURCIHJlc3VsdHNcclxuICAgKi9cclxuICBwcml2YXRlIGFwcGx5QmFzZUZpbHRlcnMocmVzdWx0czogVE1EQk1vdmllUmVzcG9uc2VbXSwgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJyk6IE1vdmllQ2FuZGlkYXRlW10ge1xyXG4gICAgY29uc3QgY2FuZGlkYXRlczogTW92aWVDYW5kaWRhdGVbXSA9IFtdO1xyXG5cclxuICAgIGZvciAoY29uc3QgaXRlbSBvZiByZXN1bHRzKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gRXh0cmFjdCB0aXRsZSAobW92aWVzIHVzZSAndGl0bGUnLCBUViBzaG93cyB1c2UgJ25hbWUnKVxyXG4gICAgICAgIGNvbnN0IHRpdGxlID0gaXRlbS50aXRsZSB8fCBpdGVtLm5hbWUgfHwgJyc7XHJcbiAgICAgICAgY29uc3Qgb3ZlcnZpZXcgPSBpdGVtLm92ZXJ2aWV3IHx8ICcnO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEJhc2UgcXVhbGl0eSBmaWx0ZXJzXHJcbiAgICAgICAgaWYgKCFpdGVtLnBvc3Rlcl9wYXRoKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgb3V0IGl0ZW0gd2l0aG91dCBwb3N0ZXI6IFwiJHt0aXRsZX1cImApO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghb3ZlcnZpZXcgfHwgb3ZlcnZpZXcudHJpbSgpID09PSAnJykge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYEZpbHRlcmVkIG91dCBpdGVtIHdpdGhvdXQgb3ZlcnZpZXc6IFwiJHt0aXRsZX1cImApO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBWb3RlIGNvdW50IGZpbHRlciAoYWRkaXRpb25hbCBzYWZldHkgY2hlY2spXHJcbiAgICAgICAgaWYgKGl0ZW0udm90ZV9jb3VudCAmJiBpdGVtLnZvdGVfY291bnQgPCAxMDApIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgbG93LXZvdGUgaXRlbTogXCIke3RpdGxlfVwiICgke2l0ZW0udm90ZV9jb3VudH0gdm90ZXMpYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIExhbmd1YWdlIGZpbHRlciAtIGVuc3VyZSBXZXN0ZXJuIGxhbmd1YWdlcyBvbmx5XHJcbiAgICAgICAgY29uc3QgYWxsb3dlZExhbmd1YWdlcyA9IFsnZW4nLCAnZXMnLCAnZnInLCAnaXQnLCAnZGUnLCAncHQnXTtcclxuICAgICAgICBpZiAoIWFsbG93ZWRMYW5ndWFnZXMuaW5jbHVkZXMoaXRlbS5vcmlnaW5hbF9sYW5ndWFnZSkpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgbm9uLVdlc3Rlcm4gbGFuZ3VhZ2U6IFwiJHt0aXRsZX1cIiAoJHtpdGVtLm9yaWdpbmFsX2xhbmd1YWdlfSlgKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBBcHBseSBMYXRpbiBTY3JpcHQgVmFsaWRhdG9yXHJcbiAgICAgICAgaWYgKCF0aGlzLnZhbGlkYXRvci52YWxpZGF0ZUNvbnRlbnQodGl0bGUsIG92ZXJ2aWV3KSkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYEZpbHRlcmVkIG91dCBub24tTGF0aW4gY29udGVudDogXCIke3RpdGxlfVwiYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIEV4dHJhY3QgcmVsZWFzZSBkYXRlXHJcbiAgICAgICAgY29uc3QgcmVsZWFzZURhdGUgPSBpdGVtLnJlbGVhc2VfZGF0ZSB8fCBpdGVtLmZpcnN0X2Fpcl9kYXRlIHx8ICcnO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFRyYW5zZm9ybSB0byBvdXIgZm9ybWF0XHJcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlOiBNb3ZpZUNhbmRpZGF0ZSA9IHtcclxuICAgICAgICAgIGlkOiBpdGVtLmlkLFxyXG4gICAgICAgICAgdGl0bGUsXHJcbiAgICAgICAgICBvdmVydmlldyxcclxuICAgICAgICAgIHBvc3RlclBhdGg6IGBodHRwczovL2ltYWdlLnRtZGIub3JnL3QvcC93NTAwJHtpdGVtLnBvc3Rlcl9wYXRofWAsXHJcbiAgICAgICAgICByZWxlYXNlRGF0ZSxcclxuICAgICAgICAgIG1lZGlhVHlwZTogbWVkaWFUeXBlID09PSAnTU9WSUUnID8gJ01PVklFJyA6ICdUVicsXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY2FuZGlkYXRlcy5wdXNoKGNhbmRpZGF0ZSk7XHJcblxyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgVE1EQiBpdGVtICR7aXRlbS5pZH06YCwgZXJyb3IpO1xyXG4gICAgICAgIC8vIENvbnRpbnVlIHByb2Nlc3Npbmcgb3RoZXIgaXRlbXNcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBjYW5kaWRhdGVzO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2h1ZmZsZSBhcnJheSB1c2luZyBGaXNoZXItWWF0ZXMgYWxnb3JpdGhtXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBzaHVmZmxlQXJyYXk8VD4oYXJyYXk6IFRbXSk6IFRbXSB7XHJcbiAgICBjb25zdCBzaHVmZmxlZCA9IFsuLi5hcnJheV07XHJcbiAgICBmb3IgKGxldCBpID0gc2h1ZmZsZWQubGVuZ3RoIC0gMTsgaSA+IDA7IGktLSkge1xyXG4gICAgICBjb25zdCBqID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogKGkgKyAxKSk7XHJcbiAgICAgIFtzaHVmZmxlZFtpXSwgc2h1ZmZsZWRbal1dID0gW3NodWZmbGVkW2pdLCBzaHVmZmxlZFtpXV07XHJcbiAgICB9XHJcbiAgICByZXR1cm4gc2h1ZmZsZWQ7XHJcbiAgfVxyXG5cclxuICAvLyBMZWdhY3kgbWV0aG9kIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5IChkZXByZWNhdGVkKVxyXG4gIGFzeW5jIGRpc2NvdmVyQ29udGVudExlZ2FjeShtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnLCBnZW5yZUlkcz86IG51bWJlcltdLCBwYWdlID0gMSk6IFByb21pc2U8TW92aWVDYW5kaWRhdGVbXT4ge1xyXG4gICAgY29uc29sZS53YXJuKCdVc2luZyBsZWdhY3kgZGlzY292ZXJDb250ZW50TGVnYWN5IG1ldGhvZCAtIGNvbnNpZGVyIHVwZ3JhZGluZyB0byBkaXNjb3ZlckNvbnRlbnQnKTtcclxuICAgIHJldHVybiB0aGlzLmRpc2NvdmVyQ29udGVudChtZWRpYVR5cGUsIGdlbnJlSWRzKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIExhbWJkYSBIYW5kbGVyXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyPFRNREJFdmVudCwgVE1EQlJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdUTURCIExhbWJkYSByZWNlaXZlZCBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCkpO1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgeyBtZWRpYVR5cGUsIGdlbnJlSWRzIH0gPSBldmVudDtcclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dFxyXG4gICAgaWYgKCFtZWRpYVR5cGUgfHwgIVsnTU9WSUUnLCAnVFYnXS5pbmNsdWRlcyhtZWRpYVR5cGUpKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0ludmFsaWQgbWVkaWFUeXBlOicsIG1lZGlhVHlwZSk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBtZWRpYVR5cGUuIE11c3QgYmUgTU9WSUUgb3IgVFYnKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBWYWxpZGF0ZSBnZW5yZSBsaW1pdCAobWF4IDIgYXMgcGVyIG1hc3RlciBzcGVjKVxyXG4gICAgaWYgKGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA+IDIpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignVG9vIG1hbnkgZ2VucmVzOicsIGdlbnJlSWRzLmxlbmd0aCk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTWF4aW11bSAyIGdlbnJlcyBhbGxvd2VkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ2hlY2sgZW52aXJvbm1lbnQgdmFyaWFibGVzXHJcbiAgICBjb25zdCB0bWRiUmVhZFRva2VuID0gcHJvY2Vzcy5lbnYuVE1EQl9SRUFEX1RPS0VOIHx8IHByb2Nlc3MuZW52LlRNREJfQVBJX0tFWSB8fCAnJztcclxuICAgIGlmICghdG1kYlJlYWRUb2tlbikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdUTURCIHRva2VuIG5vdCBmb3VuZCBpbiBlbnZpcm9ubWVudCB2YXJpYWJsZXMnKTtcclxuICAgICAgY29uc29sZS5lcnJvcignQXZhaWxhYmxlIGVudiB2YXJzOicsIE9iamVjdC5rZXlzKHByb2Nlc3MuZW52KS5maWx0ZXIoa2V5ID0+IGtleS5pbmNsdWRlcygnVE1EQicpKSk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVE1EQiBBUEkgdG9rZW4gbm90IGNvbmZpZ3VyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLmxvZygnVE1EQiB0b2tlbiBjb25maWd1cmVkLCBsZW5ndGg6JywgdG1kYlJlYWRUb2tlbi5sZW5ndGgpO1xyXG5cclxuICAgIGNvbnN0IHRtZGJDbGllbnQgPSBuZXcgVE1EQkNsaWVudCgpO1xyXG4gICAgXHJcbiAgICAvLyBVc2UgU21hcnQgUmFuZG9tIERpc2NvdmVyeSBhbGdvcml0aG1cclxuICAgIGNvbnNvbGUubG9nKCdVc2luZyBTbWFydCBSYW5kb20gRGlzY292ZXJ5IGFsZ29yaXRobScpO1xyXG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IGF3YWl0IHRtZGJDbGllbnQuZGlzY292ZXJDb250ZW50KG1lZGlhVHlwZSwgZ2VucmVJZHMpO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGBTbWFydCBSYW5kb20gRGlzY292ZXJ5IHJldHVybmVkICR7Y2FuZGlkYXRlcy5sZW5ndGh9IGNhbmRpZGF0ZXNgKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBjYW5kaWRhdGVzLFxyXG4gICAgICAgIHRvdGFsUmVzdWx0czogY2FuZGlkYXRlcy5sZW5ndGgsXHJcbiAgICAgICAgcGFnZTogMSwgLy8gUGFnZSBpcyBub3cgYWJzdHJhY3RlZCBpbiBTbWFydCBSYW5kb20gRGlzY292ZXJ5XHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignVE1EQiBMYW1iZGEgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgY29uc29sZS5lcnJvcignRXJyb3Igc3RhY2s6JywgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLnN0YWNrIDogJ05vIHN0YWNrIHRyYWNlJyk7XHJcbiAgICBjb25zb2xlLmVycm9yKCdFbnZpcm9ubWVudCB2YXJpYWJsZXM6Jywge1xyXG4gICAgICBUTURCX0FQSV9LRVk6IHByb2Nlc3MuZW52LlRNREJfQVBJX0tFWSA/ICdTRVQnIDogJ05PVCBTRVQnLFxyXG4gICAgICBUTURCX1JFQURfVE9LRU46IHByb2Nlc3MuZW52LlRNREJfUkVBRF9UT0tFTiA/ICdTRVQnIDogJ05PVCBTRVQnLFxyXG4gICAgICBUTURCX0JBU0VfVVJMOiBwcm9jZXNzLmVudi5UTURCX0JBU0VfVVJMIHx8ICdOT1QgU0VUJ1xyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIGNvbnN0IGVycm9yTWVzc2FnZSA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBjYW5kaWRhdGVzOiBbXSxcclxuICAgICAgICB0b3RhbFJlc3VsdHM6IDAsXHJcbiAgICAgICAgcGFnZTogMSxcclxuICAgICAgICBlcnJvcjogZXJyb3JNZXNzYWdlLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICB9XHJcbn07Il19