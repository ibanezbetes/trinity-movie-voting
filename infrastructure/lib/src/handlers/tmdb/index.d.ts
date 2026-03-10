import { Handler } from 'aws-lambda';
interface MovieCandidate {
    id: number;
    title: string;
    overview: string;
    posterPath: string | null;
    releaseDate: string;
    mediaType: 'MOVIE' | 'TV';
    genreIds?: number[];
    trailerKey?: string;
}
interface TMDBEvent {
    mediaType: 'MOVIE' | 'TV' | 'BOTH';
    genreIds?: number[];
    yearRange?: {
        min: number;
        max: number;
    };
    platformIds?: number[];
    page?: number;
}
interface TMDBResponse {
    statusCode: number;
    body: {
        candidates: MovieCandidate[];
        totalResults: number;
        page: number;
    };
}
export declare const handler: Handler<TMDBEvent, TMDBResponse>;
export {};
