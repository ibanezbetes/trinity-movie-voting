// Debug version of TMDB Handler
const axios = require('axios');

exports.handler = async (event) => {
    console.log('=== TMDB DEBUG HANDLER START ===');
    console.log('Event received:', JSON.stringify(event, null, 2));
    
    // Check environment variables
    console.log('Environment variables check:');
    console.log('TMDB_API_KEY exists:', !!process.env.TMDB_API_KEY);
    console.log('TMDB_API_KEY length:', process.env.TMDB_API_KEY ? process.env.TMDB_API_KEY.length : 0);
    console.log('TMDB_READ_TOKEN exists:', !!process.env.TMDB_READ_TOKEN);
    console.log('TMDB_READ_TOKEN length:', process.env.TMDB_READ_TOKEN ? process.env.TMDB_READ_TOKEN.length : 0);
    console.log('All env vars:', Object.keys(process.env).filter(key => key.includes('TMDB')));
    
    try {
        const { mediaType, genreIds } = event;
        
        // Validate input
        if (!mediaType || !['MOVIE', 'TV'].includes(mediaType)) {
            throw new Error('Invalid mediaType. Must be MOVIE or TV');
        }
        
        // Get API key
        const apiKey = process.env.TMDB_API_KEY || process.env.TMDB_READ_TOKEN || '';
        if (!apiKey) {
            console.error('No TMDB API key found in environment');
            throw new Error('TMDB API key not configured');
        }
        
        console.log('Using API key (first 10 chars):', apiKey.substring(0, 10) + '...');
        
        // Simple TMDB API call
        const endpoint = mediaType === 'MOVIE' ? '/discover/movie' : '/discover/tv';
        const baseUrl = 'https://api.themoviedb.org/3';
        
        const params = {
            page: 1,
            language: 'es-ES',
            sort_by: 'popularity.desc',
            include_adult: false,
            with_original_language: 'en|es|fr|it|de|pt',
            'vote_count.gte': 100
        };
        
        if (genreIds && genreIds.length > 0) {
            params.with_genres = genreIds.join(',');
        }
        
        console.log('Making TMDB API call to:', baseUrl + endpoint);
        console.log('With params:', JSON.stringify(params, null, 2));
        
        const response = await axios.get(baseUrl + endpoint, {
            headers: {
                'accept': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            params
        });
        
        console.log('TMDB API response status:', response.status);
        console.log('TMDB API response data keys:', Object.keys(response.data));
        console.log('Results count:', response.data.results ? response.data.results.length : 0);
        
        const results = response.data.results || [];
        
        // Simple transformation
        const candidates = results.slice(0, 20).map(item => ({
            id: item.id,
            title: item.title || item.name || '',
            overview: item.overview || '',
            posterPath: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
            releaseDate: item.release_date || item.first_air_date || '',
            mediaType: mediaType
        }));
        
        console.log('Processed candidates count:', candidates.length);
        console.log('=== TMDB DEBUG HANDLER SUCCESS ===');
        
        return {
            statusCode: 200,
            body: {
                candidates,
                totalResults: candidates.length,
                page: 1,
                debug: {
                    apiKeyConfigured: !!apiKey,
                    apiKeyLength: apiKey.length,
                    tmdbResponseStatus: response.status,
                    originalResultsCount: results.length
                }
            }
        };
        
    } catch (error) {
        console.error('=== TMDB DEBUG HANDLER ERROR ===');
        console.error('Error type:', error.constructor.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
        if (error.response) {
            console.error('HTTP Error Status:', error.response.status);
            console.error('HTTP Error Data:', error.response.data);
        }
        
        return {
            statusCode: 500,
            body: {
                candidates: [],
                totalResults: 0,
                page: 1,
                error: error.message,
                debug: {
                    errorType: error.constructor.name,
                    hasApiKey: !!process.env.TMDB_API_KEY,
                    hasReadToken: !!process.env.TMDB_READ_TOKEN,
                    httpStatus: error.response ? error.response.status : null
                }
            }
        };
    }
};