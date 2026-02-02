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
// TMDB Client
class TMDBClient {
    constructor() {
        this.baseUrl = process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3';
        this.readToken = process.env.TMDB_READ_TOKEN || '';
        this.validator = new LatinScriptValidator();
        if (!this.readToken) {
            throw new Error('TMDB_READ_TOKEN environment variable is required');
        }
    }
    async discoverContent(mediaType, genreIds, page = 1) {
        try {
            const endpoint = mediaType === 'MOVIE' ? '/discover/movie' : '/discover/tv';
            const params = {
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
            const response = await axios_1.default.get(`${this.baseUrl}${endpoint}`, {
                headers: {
                    'accept': 'application/json',
                    'Authorization': `Bearer ${this.readToken}`
                },
                params
            });
            const results = response.data.results || [];
            console.log(`TMDB returned ${results.length} raw results`);
            // Apply Latin Script Validator and media type enforcement
            const filteredCandidates = this.filterAndTransformResults(results, mediaType);
            console.log(`After filtering: ${filteredCandidates.length} candidates`);
            return filteredCandidates;
        }
        catch (error) {
            console.error('TMDB API Error:', error);
            if (axios_1.default.isAxiosError(error)) {
                console.error('Response data:', error.response?.data);
                console.error('Response status:', error.response?.status);
            }
            throw new Error(`TMDB API request failed: ${error}`);
        }
    }
    filterAndTransformResults(results, expectedMediaType) {
        const candidates = [];
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
                const candidate = {
                    id: item.id,
                    title,
                    overview,
                    posterPath: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
                    releaseDate,
                    mediaType: actualMediaType,
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
}
// Lambda Handler
const handler = async (event) => {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvaGFuZGxlcnMvdG1kYi9pbmRleC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFDQSxrREFBMEI7QUFrRDFCLHlCQUF5QjtBQUN6QixNQUFNLG9CQUFvQjtJQUExQjtRQUNFLDRFQUE0RTtRQUM1RSxpRUFBaUU7UUFDaEQscUJBQWdCLEdBQUcscUZBQXFGLENBQUM7SUFVNUgsQ0FBQztJQVJDLGVBQWUsQ0FBQyxLQUFhLEVBQUUsUUFBZ0I7UUFDN0MsT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUM7SUFDbkUsQ0FBQztJQUVELGFBQWEsQ0FBQyxJQUFZO1FBQ3hCLElBQUksQ0FBQyxJQUFJLElBQUksSUFBSSxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUU7WUFBRSxPQUFPLEtBQUssQ0FBQztRQUM5QyxPQUFPLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDMUMsQ0FBQztDQUNGO0FBRUQsY0FBYztBQUNkLE1BQU0sVUFBVTtJQUtkO1FBQ0UsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWEsSUFBSSw4QkFBOEIsQ0FBQztRQUMzRSxJQUFJLENBQUMsU0FBUyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZUFBZSxJQUFJLEVBQUUsQ0FBQztRQUNuRCxJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksb0JBQW9CLEVBQUUsQ0FBQztRQUU1QyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ3BCLE1BQU0sSUFBSSxLQUFLLENBQUMsa0RBQWtELENBQUMsQ0FBQztRQUN0RSxDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxlQUFlLENBQUMsU0FBeUIsRUFBRSxRQUFtQixFQUFF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LFNBQVMsQ0FBQyxFQUFFLENBQUM7WUFDdkQsTUFBTSxJQUFJLEtBQUssQ0FBQyx3Q0FBd0MsQ0FBQyxDQUFDO1FBQzVELENBQUM7UUFFRCxrREFBa0Q7UUFDbEQsSUFBSSxRQUFRLElBQUksUUFBUSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNwQyxNQUFNLElBQUksS0FBSyxDQUFDLDBCQUEwQixDQUFDLENBQUM7UUFDOUMsQ0FBQztRQUVELE1BQU0sVUFBVSxHQUFHLElBQUksVUFBVSxFQUFFLENBQUM7UUFDcEMsTUFBTSxVQUFVLEdBQUcsTUFBTSxVQUFVLENBQUMsZUFBZSxDQUFDLFNBQVMsRUFBRSxRQUFRLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFL0Usc0VBQXNFO1FBQ3RFLE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxVQUFVLENBQUMsTUFBTSxzQkFBc0IsQ0FBQyxDQUFDO1FBRWxFLE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLElBQUksRUFBRTtnQkFDSixVQUFVO2dCQUNWLFlBQVksRUFBRSxVQUFVLENBQUMsTUFBTTtnQkFDL0IsSUFBSTthQUNMO1NBQ0YsQ0FBQztJQUVKLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyxvQkFBb0IsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUUzQyxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixJQUFJLEVBQUU7Z0JBQ0osVUFBVSxFQUFFLEVBQUU7Z0JBQ2QsWUFBWSxFQUFFLENBQUM7Z0JBQ2YsSUFBSSxFQUFFLENBQUM7YUFDUjtTQUNGLENBQUM7SUFDSixDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBM0NXLFFBQUEsT0FBTyxXQTJDbEIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBIYW5kbGVyIH0gZnJvbSAnYXdzLWxhbWJkYSc7XHJcbmltcG9ydCBheGlvcyBmcm9tICdheGlvcyc7XHJcblxyXG4vLyBUeXBlc1xyXG5pbnRlcmZhY2UgVE1EQkRpc2NvdmVyeVBhcmFtcyB7XHJcbiAgcGFnZTogbnVtYmVyO1xyXG4gIHdpdGhfZ2VucmVzPzogc3RyaW5nO1xyXG4gIGxhbmd1YWdlOiBzdHJpbmc7XHJcbiAgcmVnaW9uPzogc3RyaW5nO1xyXG4gIHNvcnRfYnk6IHN0cmluZztcclxuICBpbmNsdWRlX2FkdWx0OiBib29sZWFuO1xyXG4gIHdpdGhfb3JpZ2luYWxfbGFuZ3VhZ2U6IHN0cmluZzsgLy8gV2VzdGVybiBsYW5ndWFnZXMgb25seVxyXG59XHJcblxyXG5pbnRlcmZhY2UgVE1EQk1vdmllUmVzcG9uc2Uge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU/OiBzdHJpbmc7XHJcbiAgbmFtZT86IHN0cmluZzsgLy8gVFYgc2hvd3MgdXNlICduYW1lJyBpbnN0ZWFkIG9mICd0aXRsZSdcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3Rlcl9wYXRoOiBzdHJpbmcgfCBudWxsO1xyXG4gIHJlbGVhc2VfZGF0ZT86IHN0cmluZztcclxuICBmaXJzdF9haXJfZGF0ZT86IHN0cmluZzsgLy8gVFYgc2hvd3MgdXNlICdmaXJzdF9haXJfZGF0ZSdcclxuICBnZW5yZV9pZHM6IG51bWJlcltdO1xyXG4gIG9yaWdpbmFsX2xhbmd1YWdlOiBzdHJpbmc7XHJcbiAgbWVkaWFfdHlwZT86ICdtb3ZpZScgfCAndHYnO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTW92aWVDYW5kaWRhdGUge1xyXG4gIGlkOiBudW1iZXI7XHJcbiAgdGl0bGU6IHN0cmluZztcclxuICBvdmVydmlldzogc3RyaW5nO1xyXG4gIHBvc3RlclBhdGg6IHN0cmluZyB8IG51bGw7XHJcbiAgcmVsZWFzZURhdGU6IHN0cmluZztcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgVE1EQkV2ZW50IHtcclxuICBtZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnO1xyXG4gIGdlbnJlSWRzPzogbnVtYmVyW107XHJcbiAgcGFnZT86IG51bWJlcjtcclxufVxyXG5cclxuaW50ZXJmYWNlIFRNREJSZXNwb25zZSB7XHJcbiAgc3RhdHVzQ29kZTogbnVtYmVyO1xyXG4gIGJvZHk6IHtcclxuICAgIGNhbmRpZGF0ZXM6IE1vdmllQ2FuZGlkYXRlW107XHJcbiAgICB0b3RhbFJlc3VsdHM6IG51bWJlcjtcclxuICAgIHBhZ2U6IG51bWJlcjtcclxuICB9O1xyXG59XHJcblxyXG4vLyBMYXRpbiBTY3JpcHQgVmFsaWRhdG9yXHJcbmNsYXNzIExhdGluU2NyaXB0VmFsaWRhdG9yIHtcclxuICAvLyBSZWdleCB0byBtYXRjaCBMYXRpbiBjaGFyYWN0ZXJzLCBudW1iZXJzLCBwdW5jdHVhdGlvbiwgYW5kIGNvbW1vbiBhY2NlbnRzXHJcbiAgLy8gRXhjbHVkZXMgQ0pLIChDaGluZXNlL0phcGFuZXNlL0tvcmVhbikgYW5kIEN5cmlsbGljIGNoYXJhY3RlcnNcclxuICBwcml2YXRlIHJlYWRvbmx5IGxhdGluU2NyaXB0UmVnZXggPSAvXltcXHUwMDAwLVxcdTAwN0ZcXHUwMEEwLVxcdTAwRkZcXHUwMTAwLVxcdTAxN0ZcXHUwMTgwLVxcdTAyNEZcXHUxRTAwLVxcdTFFRkZcXHNcXHB7UH1cXHB7Tn1dKiQvdTtcclxuICBcclxuICB2YWxpZGF0ZUNvbnRlbnQodGl0bGU6IHN0cmluZywgb3ZlcnZpZXc6IHN0cmluZyk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIHRoaXMuaXNMYXRpblNjcmlwdCh0aXRsZSkgJiYgdGhpcy5pc0xhdGluU2NyaXB0KG92ZXJ2aWV3KTtcclxuICB9XHJcbiAgXHJcbiAgaXNMYXRpblNjcmlwdCh0ZXh0OiBzdHJpbmcpOiBib29sZWFuIHtcclxuICAgIGlmICghdGV4dCB8fCB0ZXh0LnRyaW0oKSA9PT0gJycpIHJldHVybiBmYWxzZTtcclxuICAgIHJldHVybiB0aGlzLmxhdGluU2NyaXB0UmVnZXgudGVzdCh0ZXh0KTtcclxuICB9XHJcbn1cclxuXHJcbi8vIFRNREIgQ2xpZW50XHJcbmNsYXNzIFRNREJDbGllbnQge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgYmFzZVVybDogc3RyaW5nO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgcmVhZFRva2VuOiBzdHJpbmc7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB2YWxpZGF0b3I6IExhdGluU2NyaXB0VmFsaWRhdG9yO1xyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuYmFzZVVybCA9IHByb2Nlc3MuZW52LlRNREJfQkFTRV9VUkwgfHwgJ2h0dHBzOi8vYXBpLnRoZW1vdmllZGIub3JnLzMnO1xyXG4gICAgdGhpcy5yZWFkVG9rZW4gPSBwcm9jZXNzLmVudi5UTURCX1JFQURfVE9LRU4gfHwgJyc7XHJcbiAgICB0aGlzLnZhbGlkYXRvciA9IG5ldyBMYXRpblNjcmlwdFZhbGlkYXRvcigpO1xyXG4gICAgXHJcbiAgICBpZiAoIXRoaXMucmVhZFRva2VuKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVE1EQl9SRUFEX1RPS0VOIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIHJlcXVpcmVkJyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBkaXNjb3ZlckNvbnRlbnQobWVkaWFUeXBlOiAnTU9WSUUnIHwgJ1RWJywgZ2VucmVJZHM/OiBudW1iZXJbXSwgcGFnZSA9IDEpOiBQcm9taXNlPE1vdmllQ2FuZGlkYXRlW10+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGVuZHBvaW50ID0gbWVkaWFUeXBlID09PSAnTU9WSUUnID8gJy9kaXNjb3Zlci9tb3ZpZScgOiAnL2Rpc2NvdmVyL3R2JztcclxuICAgICAgXHJcbiAgICAgIGNvbnN0IHBhcmFtczogVE1EQkRpc2NvdmVyeVBhcmFtcyA9IHtcclxuICAgICAgICBwYWdlLFxyXG4gICAgICAgIGxhbmd1YWdlOiAnZXMtRVMnLCAvLyBEZWZhdWx0IGxhbmd1YWdlXHJcbiAgICAgICAgc29ydF9ieTogJ3BvcHVsYXJpdHkuZGVzYycsXHJcbiAgICAgICAgaW5jbHVkZV9hZHVsdDogZmFsc2UsXHJcbiAgICAgICAgd2l0aF9vcmlnaW5hbF9sYW5ndWFnZTogJ2VufGVzfGZyfGl0fGRlfHB0JywgLy8gV2VzdGVybiBsYW5ndWFnZXMgb25seSAtIE5PIGphLGtvXHJcbiAgICAgIH07XHJcblxyXG4gICAgICAvLyBBZGQgZ2VucmUgZmlsdGVyIGlmIHByb3ZpZGVkXHJcbiAgICAgIGlmIChnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgcGFyYW1zLndpdGhfZ2VucmVzID0gZ2VucmVJZHMuam9pbignLCcpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zb2xlLmxvZyhgUXVlcnlpbmcgVE1EQiAke2VuZHBvaW50fSB3aXRoIHBhcmFtczpgLCBKU09OLnN0cmluZ2lmeShwYXJhbXMpKTtcclxuXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MuZ2V0KGAke3RoaXMuYmFzZVVybH0ke2VuZHBvaW50fWAsIHtcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnYWNjZXB0JzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7dGhpcy5yZWFkVG9rZW59YFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgcGFyYW1zXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0czogVE1EQk1vdmllUmVzcG9uc2VbXSA9IHJlc3BvbnNlLmRhdGEucmVzdWx0cyB8fCBbXTtcclxuICAgICAgY29uc29sZS5sb2coYFRNREIgcmV0dXJuZWQgJHtyZXN1bHRzLmxlbmd0aH0gcmF3IHJlc3VsdHNgKTtcclxuXHJcbiAgICAgIC8vIEFwcGx5IExhdGluIFNjcmlwdCBWYWxpZGF0b3IgYW5kIG1lZGlhIHR5cGUgZW5mb3JjZW1lbnRcclxuICAgICAgY29uc3QgZmlsdGVyZWRDYW5kaWRhdGVzID0gdGhpcy5maWx0ZXJBbmRUcmFuc2Zvcm1SZXN1bHRzKHJlc3VsdHMsIG1lZGlhVHlwZSk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zb2xlLmxvZyhgQWZ0ZXIgZmlsdGVyaW5nOiAke2ZpbHRlcmVkQ2FuZGlkYXRlcy5sZW5ndGh9IGNhbmRpZGF0ZXNgKTtcclxuICAgICAgcmV0dXJuIGZpbHRlcmVkQ2FuZGlkYXRlcztcclxuXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdUTURCIEFQSSBFcnJvcjonLCBlcnJvcik7XHJcbiAgICAgIGlmIChheGlvcy5pc0F4aW9zRXJyb3IoZXJyb3IpKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignUmVzcG9uc2UgZGF0YTonLCBlcnJvci5yZXNwb25zZT8uZGF0YSk7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcignUmVzcG9uc2Ugc3RhdHVzOicsIGVycm9yLnJlc3BvbnNlPy5zdGF0dXMpO1xyXG4gICAgICB9XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVE1EQiBBUEkgcmVxdWVzdCBmYWlsZWQ6ICR7ZXJyb3J9YCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGZpbHRlckFuZFRyYW5zZm9ybVJlc3VsdHMocmVzdWx0czogVE1EQk1vdmllUmVzcG9uc2VbXSwgZXhwZWN0ZWRNZWRpYVR5cGU6ICdNT1ZJRScgfCAnVFYnKTogTW92aWVDYW5kaWRhdGVbXSB7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVzOiBNb3ZpZUNhbmRpZGF0ZVtdID0gW107XHJcblxyXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIHJlc3VsdHMpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBFeHRyYWN0IHRpdGxlIChtb3ZpZXMgdXNlICd0aXRsZScsIFRWIHNob3dzIHVzZSAnbmFtZScpXHJcbiAgICAgICAgY29uc3QgdGl0bGUgPSBpdGVtLnRpdGxlIHx8IGl0ZW0ubmFtZSB8fCAnJztcclxuICAgICAgICBjb25zdCBvdmVydmlldyA9IGl0ZW0ub3ZlcnZpZXcgfHwgJyc7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQXBwbHkgTGF0aW4gU2NyaXB0IFZhbGlkYXRvclxyXG4gICAgICAgIGlmICghdGhpcy52YWxpZGF0b3IudmFsaWRhdGVDb250ZW50KHRpdGxlLCBvdmVydmlldykpIHtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGBGaWx0ZXJlZCBvdXQgbm9uLUxhdGluIGNvbnRlbnQ6IFwiJHt0aXRsZX1cImApO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICAvLyBNZWRpYSB0eXBlIGVuZm9yY2VtZW50IC0gY3J1Y2lhbCBjaGVjayBmcm9tIG1hc3RlciBzcGVjXHJcbiAgICAgICAgY29uc3QgYWN0dWFsTWVkaWFUeXBlID0gZXhwZWN0ZWRNZWRpYVR5cGU7IC8vIFdlIHF1ZXJ5IHRoZSBjb3JyZWN0IGVuZHBvaW50LCBzbyB0eXBlIG1hdGNoZXNcclxuICAgICAgICBcclxuICAgICAgICAvLyBFeHRyYWN0IHJlbGVhc2UgZGF0ZVxyXG4gICAgICAgIGNvbnN0IHJlbGVhc2VEYXRlID0gaXRlbS5yZWxlYXNlX2RhdGUgfHwgaXRlbS5maXJzdF9haXJfZGF0ZSB8fCAnJztcclxuICAgICAgICBcclxuICAgICAgICAvLyBUcmFuc2Zvcm0gdG8gb3VyIGZvcm1hdFxyXG4gICAgICAgIGNvbnN0IGNhbmRpZGF0ZTogTW92aWVDYW5kaWRhdGUgPSB7XHJcbiAgICAgICAgICBpZDogaXRlbS5pZCxcclxuICAgICAgICAgIHRpdGxlLFxyXG4gICAgICAgICAgb3ZlcnZpZXcsXHJcbiAgICAgICAgICBwb3N0ZXJQYXRoOiBpdGVtLnBvc3Rlcl9wYXRoID8gYGh0dHBzOi8vaW1hZ2UudG1kYi5vcmcvdC9wL3c1MDAke2l0ZW0ucG9zdGVyX3BhdGh9YCA6IG51bGwsXHJcbiAgICAgICAgICByZWxlYXNlRGF0ZSxcclxuICAgICAgICAgIG1lZGlhVHlwZTogYWN0dWFsTWVkaWFUeXBlLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNhbmRpZGF0ZXMucHVzaChjYW5kaWRhdGUpO1xyXG5cclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIFRNREIgaXRlbSAke2l0ZW0uaWR9OmAsIGVycm9yKTtcclxuICAgICAgICAvLyBDb250aW51ZSBwcm9jZXNzaW5nIG90aGVyIGl0ZW1zXHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gY2FuZGlkYXRlcztcclxuICB9XHJcbn1cclxuXHJcbi8vIExhbWJkYSBIYW5kbGVyXHJcbmV4cG9ydCBjb25zdCBoYW5kbGVyOiBIYW5kbGVyPFRNREJFdmVudCwgVE1EQlJlc3BvbnNlPiA9IGFzeW5jIChldmVudCkgPT4ge1xyXG4gIGNvbnNvbGUubG9nKCdUTURCIExhbWJkYSByZWNlaXZlZCBldmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCkpO1xyXG5cclxuICB0cnkge1xyXG4gICAgY29uc3QgeyBtZWRpYVR5cGUsIGdlbnJlSWRzLCBwYWdlID0gMSB9ID0gZXZlbnQ7XHJcblxyXG4gICAgLy8gVmFsaWRhdGUgaW5wdXRcclxuICAgIGlmICghbWVkaWFUeXBlIHx8ICFbJ01PVklFJywgJ1RWJ10uaW5jbHVkZXMobWVkaWFUeXBlKSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgbWVkaWFUeXBlLiBNdXN0IGJlIE1PVklFIG9yIFRWJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVmFsaWRhdGUgZ2VucmUgbGltaXQgKG1heCAyIGFzIHBlciBtYXN0ZXIgc3BlYylcclxuICAgIGlmIChnZW5yZUlkcyAmJiBnZW5yZUlkcy5sZW5ndGggPiAyKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTWF4aW11bSAyIGdlbnJlcyBhbGxvd2VkJyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgdG1kYkNsaWVudCA9IG5ldyBUTURCQ2xpZW50KCk7XHJcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gYXdhaXQgdG1kYkNsaWVudC5kaXNjb3ZlckNvbnRlbnQobWVkaWFUeXBlLCBnZW5yZUlkcywgcGFnZSk7XHJcblxyXG4gICAgLy8gUXVhbGl0eSBvdmVyIHF1YW50aXR5IC0gcmV0dXJuIHdoYXQgd2UgaGF2ZSwgZG9uJ3QgdHJ5IHRvIGZpbGwgZ2Fwc1xyXG4gICAgY29uc29sZS5sb2coYFJldHVybmluZyAke2NhbmRpZGF0ZXMubGVuZ3RofSBmaWx0ZXJlZCBjYW5kaWRhdGVzYCk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdHVzQ29kZTogMjAwLFxyXG4gICAgICBib2R5OiB7XHJcbiAgICAgICAgY2FuZGlkYXRlcyxcclxuICAgICAgICB0b3RhbFJlc3VsdHM6IGNhbmRpZGF0ZXMubGVuZ3RoLFxyXG4gICAgICAgIHBhZ2UsXHJcbiAgICAgIH0sXHJcbiAgICB9O1xyXG5cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignVE1EQiBMYW1iZGEgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXHJcbiAgICAgIGJvZHk6IHtcclxuICAgICAgICBjYW5kaWRhdGVzOiBbXSxcclxuICAgICAgICB0b3RhbFJlc3VsdHM6IDAsXHJcbiAgICAgICAgcGFnZTogMSxcclxuICAgICAgfSxcclxuICAgIH07XHJcbiAgfVxyXG59OyJdfQ==