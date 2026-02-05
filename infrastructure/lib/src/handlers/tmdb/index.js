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
        this.readToken = process.env.TMDB_READ_TOKEN || '';
        this.validator = new LatinScriptValidator();
        if (!this.readToken) {
            throw new Error('TMDB_READ_TOKEN environment variable is required');
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
            throw new Error('Invalid mediaType. Must be MOVIE or TV');
        }
        // Validate genre limit (max 2 as per master spec)
        if (genreIds && genreIds.length > 2) {
            throw new Error('Maximum 2 genres allowed');
        }
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
exports.handler = handler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdG1kYi9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxrREFBMEI7QUFvRDFCLHlCQUF5QjtBQUN6QixNQUFNLG9CQUFvQjtJQUExQjtRQUNFLDRFQUE0RTtRQUM1RSxpRUFBaUU7UUFDaEQscUJBQWdCLEdBQUcscUZBQXFGLENBQUM7SUFVNUgsQ0FBQztJQVJDLGVBQWUsQ0FBQyxLQUFhLEVBQUUsUUFBZ0I7UUFDN0MsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDbkUsQ0FBQztJQUVELGFBQWEsQ0FBQyxJQUFZO1FBQ3hCLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFBRSxPQUFPLEtBQUssQ0FBQztRQUM5QyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDMUMsQ0FBQztDQUNGO0FBRUQsMENBQTBDO0FBQzFDLE1BQU0sVUFBVTtJQU1kO1FBRmlCLGlCQUFZLEdBQUcsRUFBRSxDQUFDLENBQUMsOEJBQThCO1FBR2hFLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxhQUFhLElBQUksOEJBQThCLENBQUM7UUFDM0UsSUFBSSxDQUFDLFNBQVMsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWUsSUFBSSxFQUFFLENBQUM7UUFDbkQsSUFBSSxDQUFDLFNBQVMsR0FBRyxJQUFJLG9CQUFvQixFQUFFLENBQUM7UUFFNUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNwQixNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxDQUFDLENBQUM7UUFDdEUsQ0FBQztJQUNILENBQUM7SUFF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QUU7Z0JBQ2QsWUFBWSxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxFQUFFLENBQUM7YUFDUjtTQUNGLENBQUM7SUFDSixDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBN0NXLFFBQUEsT0FBTyxXQTZDbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCBheGlvcyBmcm9tICdheGlvcyc7XHJcblxyXG4vLyBUeXBlc1xyXG5pbnRlcmZhY2UgVE1EQkRpc2NvdmVyeVBhcmFtcyB7XHJcbiAgcGFnZTogbnVtYmVyO1xyXG4gIHdpdGhfZ2VucmVzPzogc3RyaW5nO1xyXG4gIGxhbmd1YWdlOiBzdHJpbmc7XHJcbiAgcmVnaW9uPzogc3RyaW5nO1xyXG4gIHNvcnRfYnk6IHN0cmluZztcclxuICBpbmNsdWRlX2FkdWx0OiBib29sZWFuO1xyXG4gIHdpdGhfb3JpZ2luYWxfbGFuZ3VhZ2U6IHN0cmluZzsgLy8gV2VzdGVybiBsYW5ndWFnZXMgb25seVxyXG4gICd2b3RlX2NvdW50Lmd0ZSc/OiBudW1iZXI7IC8vIE1pbmltdW0gdm90ZSBjb3VudCBmaWx0ZXJcclxufVxyXG5cclxuaW50ZXJmYWNlIFRNREJNb3ZpZVJlc3BvbnNlIHtcclxuICBpZDogbnVtYmVyO1xyXG4gIHRpdGxlPzogc3RyaW5nO1xyXG4gIG5hbWU/OiBzdHJpbmc7IC8vIFRWIHNob3dzIHVzZSAnbmFtZScgaW5zdGVhZCBvZiAndGl0bGUnXHJcbiAgb3ZlcnZpZXc6IHN0cmluZztcclxuICBwb3N0ZXJfcGF0aDogc3RyaW5nIHwgbnVsbDtcclxuICByZWxlYXNlX2RhdGU/OiBzdHJpbmc7XHJcbiAgZmlyc3RfYWlyX2RhdGU/OiBzdHJpbmc7IC8vIFRWIHNob3dzIHVzZSAnZmlyc3RfYWlyX2RhdGUnXHJcbiAgZ2VucmVfaWRzOiBudW1iZXJbXTtcclxuICBvcmlnaW5hbF9sYW5ndWFnZTogc3RyaW5nO1xyXG4gIG1lZGlhX3R5cGU/OiAnbW92aWUnIHwgJ3R2JztcclxuICB2b3RlX2NvdW50PzogbnVtYmVyO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTW92aWVDYW5kaWRhdGUge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg6IHN0cmluZyB8IG51bGw7XHJcbiAgcmVsZWFzZURhdGU6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVE1EQkV2ZW50IHtcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIGdlbnJlSWRzPzogbnVtYmVyW107XHJcbiAgcGFnZT86IG51bWJlcjtcclxufVxyXG5cclxuaW50ZXJmYWNlIFRNREJSZXNwb25zZSB7XHJcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xyXG4gIGJvZHk6IHtcclxuICAgIGNhbmRpZGF0ZXM6IE1vdmllQ2FuZGlkYXRlW107XHJcbiAgICB0b3RhbFJlc3VsdHM6IG51bWJlcjtcclxuICAgIHBhZ2U6IG51bWJlcjtcclxuICB9O1xyXG59XHJcblxyXG4vLyBMYXRpbiBTY3JpcHQgVmFsaWRhdG9yXHJcbmNsYXNzIExhdGluU2NyaXB0VmFsaWRhdG9yIHtcclxuICAvLyBSZWdleCB0byBtYXRjaCBMYXRpbiBjaGFyYWN0ZXJzLCBudW1iZXJzLCBwdW5jdHVhdGlvbiwgYW5kIGNvbW1vbiBhY2NlbnRzXHJcbiAgLy8gRXhjbHVkZXMgQ0pLIChDaGluZXNlL0phcGFuZXNlL0tvcmVhbikgYW5kIEN5cmlsbGljIGNoYXJhY3RlcnNcclxuICBwcml2YXRlIHJlYWRvbmx5IGxhdGluU2NyaXB0UmVnZXggPSAvXltcXHUwMDAwLVxcdTAwN0ZcXHUwMEEwLVxcdTAwRkZcXHUwMTAwLVxcdTAxN0ZcXHUwMTgwLVxcdTAyNEZcXHUxRTAwLVxcdTFFRkZcXHNcXHB7UH1cXHB7Tn1dKiQvdTtcclxuICBcclxuICB2YWxpZGF0ZUNvbnRlbnQodGl0bGU6IHN0cmluZywgb3ZlcnZpZXc6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIHRoaXMuaXNMYXRpblNjcmlwdCh0aXRsZSkgJiYgdGhpcy5pc0xhdGluU2NyaXB0KG92ZXJ2aWV3KTtcclxuICB9XHJcbiAgXHJcbiAgaXNMYXRpblNjcmlwdCh0ZXh0OiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIGlmICghdGV4dCB8fCB0ZXh0LnRyaW0oKSA9PT0gJycpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiB0aGlzLmxhdGluU2NyaXB0UmVnZXgudGVzdCh0ZXh0KTtcclxuICB9XHJcbn1cclxuXHJcbi8vIFRNREIgQ2xpZW50IHdpdGggU21hcnQgUmFuZG9tIERpc2NvdmVyeVxyXG5jbGFzcyBUTURCQ2xpZW50IHtcclxuICBwcml2YXRlIHJlYWRvbmx5IGJhc2VVcmw6IHN0cmluZztcclxuICBwcml2YXRlIHJlYWRvbmx5IHJlYWRUb2tlbjogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgdmFsaWRhdG9yOiBMYXRpblNjcmlwdFZhbGlkYXRvcjtcclxuICBwcml2YXRlIHJlYWRvbmx5IFRBUkdFVF9DT1VOVCA9IDUwOyAvLyBUYXJnZXQgbnVtYmVyIG9mIGNhbmRpZGF0ZXNcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmJhc2VVcmwgPSBwcm9jZXNzLmVudi5UTURCX0JBU0VfVVJMIHx8ICdodHRwczovL2FwaS50aGVtb3ZpZWRiLm9yZy8zJztcclxuICAgIHRoaXMucmVhZFRva2VuID0gcHJvY2Vzcy5lbnYuVE1EQl9SRUFEX1RPS0VOIHx8ICcnO1xyXG4gICAgdGhpcy52YWxpZGF0b3IgPSBuZXcgTGF0aW5TY3JpcHRWYWxpZGF0b3IoKTtcclxuICAgIFxyXG4gICAgaWYgKCF0aGlzLnJlYWRUb2tlbikge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RNREJfUkVBRF9UT0tFTiBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyByZXF1aXJlZCcpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU21hcnQgUmFuZG9tIERpc2NvdmVyeSBBbGdvcml0aG1cclxuICAgKiAxLiBQcmlvcml0eSBTZWFyY2ggKEFORCBsb2dpYyk6IEFsbCBnZW5yZXMgbXVzdCBtYXRjaFxyXG4gICAqIDIuIEZhbGxiYWNrIFNlYXJjaCAoT1IgbG9naWMpOiBBbnkgZ2VucmUgY2FuIG1hdGNoXHJcbiAgICogMy4gUmFuZG9tIHBhZ2Ugc2VsZWN0aW9uIHRvIGF2b2lkIHJlcGV0aXRpdmUgY29udGVudFxyXG4gICAqIDQuIFNodWZmbGUgZmluYWwgcmVzdWx0cyBmb3IgdmFyaWV0eVxyXG4gICAqL1xyXG4gIGFzeW5jIGRpc2NvdmVyQ29udGVudChtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnLCBnZW5yZUlkcz86IG51bWJlcltdKTogUHJvbWlzZTxNb3ZpZUNhbmRpZGF0ZVtdPiB7XHJcbiAgICB0cnkge1xyXG4gICAgICBsZXQgY2FuZGlkYXRlczogTW92aWVDYW5kaWRhdGVbXSA9IFtdO1xyXG4gICAgICBcclxuICAgICAgY29uc29sZS5sb2coYFN0YXJ0aW5nIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgZm9yICR7bWVkaWFUeXBlfSB3aXRoIGdlbnJlczogJHtnZW5yZUlkcz8uam9pbignLCcpIHx8ICdub25lJ31gKTtcclxuXHJcbiAgICAgIC8vIFNURVAgQTogUHJpb3JpdHkgU2VhcmNoIChBTkQgTG9naWMgZm9yIEdlbnJlcylcclxuICAgICAgaWYgKGdlbnJlSWRzICYmIGdlbnJlSWRzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnU1RFUCBBOiBQcmlvcml0eSBzZWFyY2ggd2l0aCBBTEwgZ2VucmVzIChBTkQgbG9naWMpJyk7XHJcbiAgICAgICAgY29uc3QgcmFuZG9tUGFnZUEgPSBNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiAyMCkgKyAxO1xyXG4gICAgICAgIGNvbnN0IHN0cmljdFJlc3VsdHMgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGIobWVkaWFUeXBlLCB7XHJcbiAgICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICAgIGxvZ2ljVHlwZTogJ0FORCcsXHJcbiAgICAgICAgICBwYWdlOiByYW5kb21QYWdlQVxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGZpbHRlcmVkU3RyaWN0ID0gdGhpcy5hcHBseUJhc2VGaWx0ZXJzKHN0cmljdFJlc3VsdHMsIG1lZGlhVHlwZSk7XHJcbiAgICAgICAgY2FuZGlkYXRlcy5wdXNoKC4uLmZpbHRlcmVkU3RyaWN0KTtcclxuICAgICAgICBjb25zb2xlLmxvZyhgUHJpb3JpdHkgc2VhcmNoIGZvdW5kICR7ZmlsdGVyZWRTdHJpY3QubGVuZ3RofSBjYW5kaWRhdGVzIChwYWdlICR7cmFuZG9tUGFnZUF9KWApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTVEVQIEI6IEZhbGxiYWNrIFNlYXJjaCAoT1IgTG9naWMpIGlmIG5lZWRlZFxyXG4gICAgICBpZiAoY2FuZGlkYXRlcy5sZW5ndGggPCB0aGlzLlRBUkdFVF9DT1VOVCAmJiBnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFNURVAgQjogRmFsbGJhY2sgc2VhcmNoIHdpdGggQU5ZIGdlbnJlIChPUiBsb2dpYykgLSBuZWVkICR7dGhpcy5UQVJHRVRfQ09VTlQgLSBjYW5kaWRhdGVzLmxlbmd0aH0gbW9yZWApO1xyXG4gICAgICAgIGNvbnN0IHJhbmRvbVBhZ2VCID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMjApICsgMTtcclxuICAgICAgICBjb25zdCBsb29zZVJlc3VsdHMgPSBhd2FpdCB0aGlzLmZldGNoRnJvbVRtZGIobWVkaWFUeXBlLCB7XHJcbiAgICAgICAgICBnZW5yZUlkcyxcclxuICAgICAgICAgIGxvZ2ljVHlwZTogJ09SJyxcclxuICAgICAgICAgIHBhZ2U6IHJhbmRvbVBhZ2VCXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgZmlsdGVyZWRMb29zZSA9IHRoaXMuYXBwbHlCYXNlRmlsdGVycyhsb29zZVJlc3VsdHMsIG1lZGlhVHlwZSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHVuaXF1ZSBpdGVtcyB1bnRpbCB3ZSByZWFjaCB0YXJnZXRcclxuICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgZmlsdGVyZWRMb29zZSkge1xyXG4gICAgICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID49IHRoaXMuVEFSR0VUX0NPVU5UKSBicmVhaztcclxuICAgICAgICAgIGlmICghY2FuZGlkYXRlcy5maW5kKGMgPT4gYy5pZCA9PT0gaXRlbS5pZCkpIHtcclxuICAgICAgICAgICAgY2FuZGlkYXRlcy5wdXNoKGl0ZW0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zb2xlLmxvZyhgQWZ0ZXIgZmFsbGJhY2sgc2VhcmNoOiAke2NhbmRpZGF0ZXMubGVuZ3RofSB0b3RhbCBjYW5kaWRhdGVzYCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFNURVAgQzogR2VuZXJhbCBEaXNjb3ZlcnkgaWYgc3RpbGwgbm90IGVub3VnaCBjb250ZW50XHJcbiAgICAgIGlmIChjYW5kaWRhdGVzLmxlbmd0aCA8IHRoaXMuVEFSR0VUX0NPVU5UKSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coYFNURVAgQzogR2VuZXJhbCBkaXNjb3ZlcnkgLSBuZWVkICR7dGhpcy5UQVJHRVRfQ09VTlQgLSBjYW5kaWRhdGVzLmxlbmd0aH0gbW9yZWApO1xyXG4gICAgICAgIGNvbnN0IHJhbmRvbVBhZ2VDID0gTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogMjApICsgMTtcclxuICAgICAgICBjb25zdCBnZW5lcmFsUmVzdWx0cyA9IGF3YWl0IHRoaXMuZmV0Y2hGcm9tVG1kYihtZWRpYVR5cGUsIHtcclxuICAgICAgICAgIHBhZ2U6IHJhbmRvbVBhZ2VDXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgZmlsdGVyZWRHZW5lcmFsID0gdGhpcy5hcHBseUJhc2VGaWx0ZXJzKGdlbmVyYWxSZXN1bHRzLCBtZWRpYVR5cGUpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCB1bmlxdWUgaXRlbXMgdW50aWwgd2UgcmVhY2ggdGFyZ2V0XHJcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGZpbHRlcmVkR2VuZXJhbCkge1xyXG4gICAgICAgICAgaWYgKGNhbmRpZGF0ZXMubGVuZ3RoID49IHRoaXMuVEFSR0VUX0NPVU5UKSBicmVhaztcclxuICAgICAgICAgIGlmICghY2FuZGlkYXRlcy5maW5kKGMgPT4gYy5pZCA9PT0gaXRlbS5pZCkpIHtcclxuICAgICAgICAgICAgY2FuZGlkYXRlcy5wdXNoKGl0ZW0pO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zb2xlLmxvZyhgQWZ0ZXIgZ2VuZXJhbCBkaXNjb3Zlcnk6ICR7Y2FuZGlkYXRlcy5sZW5ndGh9IHRvdGFsIGNhbmRpZGF0ZXNgKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gU1RFUCBEOiBTaHVmZmxlIGZpbmFsIHJlc3VsdHMgZm9yIHZhcmlldHlcclxuICAgICAgY29uc3Qgc2h1ZmZsZWRDYW5kaWRhdGVzID0gdGhpcy5zaHVmZmxlQXJyYXkoY2FuZGlkYXRlcykuc2xpY2UoMCwgdGhpcy5UQVJHRVRfQ09VTlQpO1xyXG4gICAgICBjb25zb2xlLmxvZyhgRmluYWwgcmVzdWx0OiAke3NodWZmbGVkQ2FuZGlkYXRlcy5sZW5ndGh9IHNodWZmbGVkIGNhbmRpZGF0ZXNgKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiBzaHVmZmxlZENhbmRpZGF0ZXM7XHJcblxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignU21hcnQgUmFuZG9tIERpc2NvdmVyeSBFcnJvcjonLCBlcnJvcik7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgU21hcnQgUmFuZG9tIERpc2NvdmVyeSBmYWlsZWQ6ICR7ZXJyb3J9YCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBGZXRjaCBjb250ZW50IGZyb20gVE1EQiB3aXRoIHNwZWNpZmllZCBwYXJhbWV0ZXJzXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhc3luYyBmZXRjaEZyb21UbWRiKFxyXG4gICAgbWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgXHJcbiAgICBvcHRpb25zOiB7XHJcbiAgICAgIGdlbnJlSWRzPzogbnVtYmVyW107XHJcbiAgICAgIGxvZ2ljVHlwZT86ICdBTkQnIHwgJ09SJztcclxuICAgICAgcGFnZT86IG51bWJlcjtcclxuICAgIH0gPSB7fVxyXG4gICk6IFByb21pc2U8VE1EQk1vdmllUmVzcG9uc2VbXT4ge1xyXG4gICAgY29uc3QgeyBnZW5yZUlkcywgbG9naWNUeXBlLCBwYWdlID0gMSB9ID0gb3B0aW9ucztcclxuICAgIGNvbnN0IGVuZHBvaW50ID0gbWVkaWFUeXBlID09PSAnTU9WSUUnID8gJy9kaXNjb3Zlci9tb3ZpZScgOiAnL2Rpc2NvdmVyL3R2JztcclxuICAgIFxyXG4gICAgY29uc3QgcGFyYW1zOiBUTURCRGlzY292ZXJ5UGFyYW1zID0ge1xyXG4gICAgICBwYWdlLFxyXG4gICAgICBsYW5ndWFnZTogJ2VzLUVTJywgLy8gRGVmYXVsdCBsYW5ndWFnZVxyXG4gICAgICBzb3J0X2J5OiAncG9wdWxhcml0eS5kZXNjJyxcclxuICAgICAgaW5jbHVkZV9hZHVsdDogZmFsc2UsXHJcbiAgICAgIHdpdGhfb3JpZ2luYWxfbGFuZ3VhZ2U6ICdlbnxlc3xmcnxpdHxkZXxwdCcsIC8vIFdlc3Rlcm4gbGFuZ3VhZ2VzIG9ubHlcclxuICAgICAgJ3ZvdGVfY291bnQuZ3RlJzogMTAwLCAvLyBNaW5pbXVtIDEwMCB2b3RlcyB0byBhdm9pZCBnYXJiYWdlIGNvbnRlbnRcclxuICAgIH07XHJcblxyXG4gICAgLy8gQWRkIGdlbnJlIGZpbHRlciBiYXNlZCBvbiBsb2dpYyB0eXBlXHJcbiAgICBpZiAoZ2VucmVJZHMgJiYgZ2VucmVJZHMubGVuZ3RoID4gMCkge1xyXG4gICAgICBpZiAobG9naWNUeXBlID09PSAnT1InKSB7XHJcbiAgICAgICAgcGFyYW1zLndpdGhfZ2VucmVzID0gZ2VucmVJZHMuam9pbignfCcpOyAvLyBPUiBsb2dpYzogYW55IGdlbnJlIG1hdGNoZXNcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBwYXJhbXMud2l0aF9nZW5yZXMgPSBnZW5yZUlkcy5qb2luKCcsJyk7IC8vIEFORCBsb2dpYzogYWxsIGdlbnJlcyBtdXN0IG1hdGNoXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBjb25zb2xlLmxvZyhgRmV0Y2hpbmcgZnJvbSBUTURCICR7ZW5kcG9pbnR9IHdpdGggcGFyYW1zOmAsIEpTT04uc3RyaW5naWZ5KHBhcmFtcykpO1xyXG5cclxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0KGAke3RoaXMuYmFzZVVybH0ke2VuZHBvaW50fWAsIHtcclxuICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICdhY2NlcHQnOiAnYXBwbGljYXRpb24vanNvbicsXHJcbiAgICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7dGhpcy5yZWFkVG9rZW59YFxyXG4gICAgICB9LFxyXG4gICAgICBwYXJhbXNcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHJlc3VsdHM6IFRNREJNb3ZpZVJlc3BvbnNlW10gPSByZXNwb25zZS5kYXRhLnJlc3VsdHMgfHwgW107XHJcbiAgICBjb25zb2xlLmxvZyhgVE1EQiByZXR1cm5lZCAke3Jlc3VsdHMubGVuZ3RofSByYXcgcmVzdWx0cyBmb3IgcGFnZSAke3BhZ2V9YCk7XHJcbiAgICBcclxuICAgIHJldHVybiByZXN1bHRzO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQXBwbHkgYmFzZSBxdWFsaXR5IGZpbHRlcnMgdG8gVE1EQiByZXN1bHRzXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhcHBseUJhc2VGaWx0ZXJzKHJlc3VsdHM6IFRNREJNb3ZpZVJlc3BvbnNlW10sIG1lZGlhVHlwZTogJ01PVklFJyB8ICdUVicpOiBNb3ZpZUNhbmRpZGF0ZVtdIHtcclxuICAgIGNvbnN0IGNhbmRpZGF0ZXM6IE1vdmllQ2FuZGlkYXRlW10gPSBbXTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgcmVzdWx0cykge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIEV4dHJhY3QgdGl0bGUgKG1vdmllcyB1c2UgJ3RpdGxlJywgVFYgc2hvd3MgdXNlICduYW1lJylcclxuICAgICAgICBjb25zdCB0aXRsZSA9IGl0ZW0udGl0bGUgfHwgaXRlbS5uYW1lIHx8ICcnO1xyXG4gICAgICAgIGNvbnN0IG92ZXJ2aWV3ID0gaXRlbS5vdmVydmlldyB8fCAnJztcclxuICAgICAgICBcclxuICAgICAgICAvLyBCYXNlIHF1YWxpdHkgZmlsdGVyc1xyXG4gICAgICAgIGlmICghaXRlbS5wb3N0ZXJfcGF0aCkge1xyXG4gICAgICAgICAgY29uc29sZS5sb2coYEZpbHRlcmVkIG91dCBpdGVtIHdpdGhvdXQgcG9zdGVyOiBcIiR7dGl0bGV9XCJgKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoIW92ZXJ2aWV3IHx8IG92ZXJ2aWV3LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgaXRlbSB3aXRob3V0IG92ZXJ2aWV3OiBcIiR7dGl0bGV9XCJgKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gVm90ZSBjb3VudCBmaWx0ZXIgKGFkZGl0aW9uYWwgc2FmZXR5IGNoZWNrKVxyXG4gICAgICAgIGlmIChpdGVtLnZvdGVfY291bnQgJiYgaXRlbS52b3RlX2NvdW50IDwgMTAwKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgb3V0IGxvdy12b3RlIGl0ZW06IFwiJHt0aXRsZX1cIiAoJHtpdGVtLnZvdGVfY291bnR9IHZvdGVzKWApO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBMYW5ndWFnZSBmaWx0ZXIgLSBlbnN1cmUgV2VzdGVybiBsYW5ndWFnZXMgb25seVxyXG4gICAgICAgIGNvbnN0IGFsbG93ZWRMYW5ndWFnZXMgPSBbJ2VuJywgJ2VzJywgJ2ZyJywgJ2l0JywgJ2RlJywgJ3B0J107XHJcbiAgICAgICAgaWYgKCFhbGxvd2VkTGFuZ3VhZ2VzLmluY2x1ZGVzKGl0ZW0ub3JpZ2luYWxfbGFuZ3VhZ2UpKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhgRmlsdGVyZWQgb3V0IG5vbi1XZXN0ZXJuIGxhbmd1YWdlOiBcIiR7dGl0bGV9XCIgKCR7aXRlbS5vcmlnaW5hbF9sYW5ndWFnZX0pYCk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQXBwbHkgTGF0aW4gU2NyaXB0IFZhbGlkYXRvclxyXG4gICAgICAgIGlmICghdGhpcy52YWxpZGF0b3IudmFsaWRhdGVDb250ZW50KHRpdGxlLCBvdmVydmlldykpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgbm9uLUxhdGluIGNvbnRlbnQ6IFwiJHt0aXRsZX1cImApO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBFeHRyYWN0IHJlbGVhc2UgZGF0ZVxyXG4gICAgICAgIGNvbnN0IHJlbGVhc2VEYXRlID0gaXRlbS5yZWxlYXNlX2RhdGUgfHwgaXRlbS5maXJzdF9haXJfZGF0ZSB8fCAnJztcclxuICAgICAgICBcclxuICAgICAgICAvLyBUcmFuc2Zvcm0gdG8gb3VyIGZvcm1hdFxyXG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZTogTW92aWVDYW5kaWRhdGUgPSB7XHJcbiAgICAgICAgICBpZDogaXRlbS5pZCxcclxuICAgICAgICAgIHRpdGxlLFxyXG4gICAgICAgICAgb3ZlcnZpZXcsXHJcbiAgICAgICAgICBwb3N0ZXJQYXRoOiBgaHR0cHM6Ly9pbWFnZS50bWRiLm9yZy90L3AvdzUwMCR7aXRlbS5wb3N0ZXJfcGF0aH1gLFxyXG4gICAgICAgICAgcmVsZWFzZURhdGUsXHJcbiAgICAgICAgICBtZWRpYVR5cGU6IG1lZGlhVHlwZSA9PT0gJ01PVklFJyA/ICdNT1ZJRScgOiAnVFYnLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNhbmRpZGF0ZXMucHVzaChjYW5kaWRhdGUpO1xyXG5cclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIFRNREIgaXRlbSAke2l0ZW0uaWR9OmAsIGVycm9yKTtcclxuICAgICAgICAvLyBDb250aW51ZSBwcm9jZXNzaW5nIG90aGVyIGl0ZW1zXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gY2FuZGlkYXRlcztcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNodWZmbGUgYXJyYXkgdXNpbmcgRmlzaGVyLVlhdGVzIGFsZ29yaXRobVxyXG4gICAqL1xyXG4gIHByaXZhdGUgc2h1ZmZsZUFycmF5PFQ+KGFycmF5OiBUW10pOiBUW10ge1xyXG4gICAgY29uc3Qgc2h1ZmZsZWQgPSBbLi4uYXJyYXldO1xyXG4gICAgZm9yIChsZXQgaSA9IHNodWZmbGVkLmxlbmd0aCAtIDE7IGkgPiAwOyBpLS0pIHtcclxuICAgICAgY29uc3QgaiA9IE1hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIChpICsgMSkpO1xyXG4gICAgICBbc2h1ZmZsZWRbaV0sIHNodWZmbGVkW2pdXSA9IFtzaHVmZmxlZFtqXSwgc2h1ZmZsZWRbaV1dO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHNodWZmbGVkO1xyXG4gIH1cclxuXHJcbiAgLy8gTGVnYWN5IG1ldGhvZCBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eSAoZGVwcmVjYXRlZClcclxuICBhc3luYyBkaXNjb3ZlckNvbnRlbnRMZWdhY3kobWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgZ2VucmVJZHM/OiBudW1iZXJbXSwgcGFnZSA9IDEpOiBQcm9taXNlPE1vdmllQ2FuZGlkYXRlW10+IHtcclxuICAgIGNvbnNvbGUud2FybignVXNpbmcgbGVnYWN5IGRpc2NvdmVyQ29udGVudExlZ2FjeSBtZXRob2QgLSBjb25zaWRlciB1cGdyYWRpbmcgdG8gZGlzY292ZXJDb250ZW50Jyk7XHJcbiAgICByZXR1cm4gdGhpcy5kaXNjb3ZlckNvbnRlbnQobWVkaWFUeXBlLCBnZW5yZUlkcyk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyBMYW1iZGEgSGFuZGxlclxyXG5leHBvcnQgY29uc3QgaGFuZGxlcjogSGFuZGxlcjxUTURCRXZlbnQsIFRNREJSZXNwb25zZT4gPSBhc3luYyAoZXZlbnQpID0+IHtcclxuICBjb25zb2xlLmxvZygnVE1EQiBMYW1iZGEgcmVjZWl2ZWQgZXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQpKTtcclxuXHJcbiAgdHJ5IHtcclxuICAgIGNvbnN0IHsgbWVkaWFUeXBlLCBnZW5yZUlkcyB9ID0gZXZlbnQ7XHJcblxyXG4gICAgLy8gVmFsaWRhdGUgaW5wdXRcclxuICAgIGlmICghbWVkaWFUeXBlIHx8ICFbJ01PVklFJywgJ1RWJ10uaW5jbHVkZXMobWVkaWFUeXBlKSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbWVkaWFUeXBlLiBNdXN0IGJlIE1PVklFIG9yIFRWJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVmFsaWRhdGUgZ2VucmUgbGltaXQgKG1heCAyIGFzIHBlciBtYXN0ZXIgc3BlYylcclxuICAgIGlmIChnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAyKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTWF4aW11bSAyIGdlbnJlcyBhbGxvd2VkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgdG1kYkNsaWVudCA9IG5ldyBUTURCQ2xpZW50KCk7XHJcbiAgICBcclxuICAgIC8vIFVzZSBTbWFydCBSYW5kb20gRGlzY292ZXJ5IGFsZ29yaXRobVxyXG4gICAgY29uc29sZS5sb2coJ1VzaW5nIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgYWxnb3JpdGhtJyk7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gYXdhaXQgdG1kYkNsaWVudC5kaXNjb3ZlckNvbnRlbnQobWVkaWFUeXBlLCBnZW5yZUlkcyk7XHJcblxyXG4gICAgY29uc29sZS5sb2coYFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnkgcmV0dXJuZWQgJHtjYW5kaWRhdGVzLmxlbmd0aH0gY2FuZGlkYXRlc2ApO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcclxuICAgICAgYm9keToge1xyXG4gICAgICAgIGNhbmRpZGF0ZXMsXHJcbiAgICAgICAgdG90YWxSZXN1bHRzOiBjYW5kaWRhdGVzLmxlbmd0aCxcclxuICAgICAgICBwYWdlOiAxLCAvLyBQYWdlIGlzIG5vdyBhYnN0cmFjdGVkIGluIFNtYXJ0IFJhbmRvbSBEaXNjb3ZlcnlcclxuICAgICAgfSxcclxuICAgIH07XHJcblxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKCdUTURCIExhbWJkYSBlcnJvcjonLCBlcnJvcik7XHJcbiAgICBcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXR1c0NvZGU6IDUwMCxcclxuICAgICAgYm9keToge1xyXG4gICAgICAgIGNhbmRpZGF0ZXM6IFtdLFxyXG4gICAgICAgIHRvdGFsUmVzdWx0czogMCxcclxuICAgICAgICBwYWdlOiAxLFxyXG4gICAgICB9LFxyXG4gICAgfTtcclxuICB9XHJcbn07Il19