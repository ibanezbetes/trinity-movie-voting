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
