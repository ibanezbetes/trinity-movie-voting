# TMDB Integration Lambda Handler

This Lambda function interfaces with The Movie Database (TMDB) API and applies strict content filtering according to Trinity's business rules.

## Purpose

- Authenticate with TMDB API using Bearer token
- Query `/discover/movie` or `/discover/tv` endpoints
- Apply Latin Script Validator to filter content
- Enforce media type validation
- Return filtered candidate lists for voting rooms

## Input Event Structure

```typescript
interface TMDBEvent {
  mediaType: 'MOVIE' | 'TV';     // Required: Type of content to discover
  genreIds?: number[];           // Optional: Array of TMDB genre IDs (max 2)
  page?: number;                 // Optional: Page number for pagination (default: 1)
}
```

### Example Input
```json
{
  "mediaType": "MOVIE",
  "genreIds": [28, 12],
  "page": 1
}
```

## Output Logic

```typescript
interface TMDBResponse {
  statusCode: number;
  body: {
    candidates: MovieCandidate[];
    totalResults: number;
    page: number;
  };
}

interface MovieCandidate {
  id: number;
  title: string;
  overview: string;
  posterPath: string | null;
  releaseDate: string;
  mediaType: 'MOVIE' | 'TV';
}
```

### Example Output
```json
{
  "statusCode": 200,
  "body": {
    "candidates": [
      {
        "id": 550,
        "title": "Fight Club",
        "overview": "A ticking-time-bomb insomniac...",
        "posterPath": "https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
        "releaseDate": "1999-10-15",
        "mediaType": "MOVIE"
      }
    ],
    "totalResults": 1,
    "page": 1
  }
}
```

## Environment Variables

### Required
- `TMDB_READ_TOKEN`: Bearer token for TMDB API authentication
- `TMDB_BASE_URL`: TMDB API base URL (default: https://api.themoviedb.org/3)

### Optional
- `TMDB_API_KEY`: Legacy API key (not used, Bearer token preferred)

## Business Logic Rules

### 1. Western-Only Content Filter
- **Allowed Languages**: `en, es, fr, it, de, pt`
- **Banned Languages**: `ja, ko` (prevents Anime/Asian content flooding)
- Applied via `with_original_language` parameter in TMDB query

### 2. Latin Script Validator
- **Purpose**: Ensures title readability for Western users
- **Logic**: Accepts titles with Latin characters (A-Z, áéíóú, ñ) and rejects CJK characters
- **Example**: "Naruto" ✅ passes, "ナルト" ❌ rejected
- **Regex**: `/^[\u0000-\u007F\u00A0-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF\s\p{P}\p{N}]*$/u`

### 3. Strict Media Type Enforcement
- **Room Type 'TV'**: Queries `/discover/tv` endpoint only
- **Room Type 'MOVIE'**: Queries `/discover/movie` endpoint only
- **Validation**: Ensures no mixed media types in results

### 4. Quality Over Quantity Strategy
- Aims for batches of 50 items from TMDB
- If filtering reduces batch size (e.g., to 20 items), returns the 20 items
- **Does NOT** attempt to fill gaps with low-quality content
- **Does NOT** relax filters to increase quantity

## Error Handling

### TMDB API Errors
- Rate limiting: Logs error and returns empty results
- Service unavailable: Graceful degradation with empty candidate list
- Invalid response: Structured error logging with correlation IDs

### Input Validation Errors
- Invalid mediaType: Returns 500 with descriptive error
- Too many genres (>2): Returns 500 with validation error
- Missing required environment variables: Throws initialization error

### Content Filtering Errors
- Non-Latin script content: Silently filtered out (logged for debugging)
- Missing title/overview: Item skipped, processing continues
- Invalid poster path: Handled gracefully with null value

## Authentication

### Bearer Token Method (Preferred)
```javascript
headers: {
  'accept': 'application/json',
  'Authorization': `Bearer ${process.env.TMDB_READ_TOKEN}`
}
```

### API Key Method (Deprecated)
- Not used in this implementation
- Bearer token provides better security and rate limits

## TMDB API Endpoints

### Movie Discovery
- **Endpoint**: `/discover/movie`
- **Parameters**: 
  - `with_original_language=en|es|fr|it|de|pt`
  - `with_genres` (comma-separated genre IDs)
  - `sort_by=popularity.desc`
  - `include_adult=false`

### TV Discovery
- **Endpoint**: `/discover/tv`
- **Parameters**: Same as movie discovery
- **Note**: TV shows use `name` field instead of `title`

## Performance Considerations

### Caching Strategy
- No caching implemented (stateless Lambda)
- TMDB API has built-in caching
- Consider adding DynamoDB caching for frequently requested genres

### Rate Limiting
- TMDB API: 40 requests per 10 seconds
- Lambda timeout: 30 seconds
- Error handling for rate limit responses

### Memory Usage
- Lambda memory: 512MB
- Axios HTTP client for efficient requests
- JSON parsing optimized for large response payloads

## Monitoring

### CloudWatch Logs
- Structured logging with correlation IDs
- Request/response payload logging (debug level)
- Error details with stack traces

### Metrics
- Successful/failed TMDB API calls
- Content filtering statistics (items filtered vs kept)
- Lambda duration and memory usage

### Alarms
- High error rate (>5% over 5 minutes)
- Long duration (>10 seconds average)
- TMDB API failures (>10% over 5 minutes)

## Testing

### Unit Tests
- Latin Script Validator with comprehensive character sets
- TMDB response transformation logic
- Error handling scenarios

### Integration Tests
- Live TMDB API calls with test data
- End-to-end content filtering validation
- Rate limit handling verification

### Test Data Examples
```javascript
// Valid Latin script titles
"Fight Club", "El Padrino", "Les Misérables", "Der Pate"

// Invalid CJK titles (should be filtered)
"ナルト", "진격의 거인", "功夫熊猫"

// Edge cases
"", null, undefined, "123", "Movie-Title_2024!"
```