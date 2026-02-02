import { Handler } from 'aws-lambda';
interface Match {
    id: string;
    roomId: string;
    movieId: number;
    title: string;
    posterPath?: string;
    mediaType: 'MOVIE' | 'TV';
    matchedUsers: string[];
    timestamp: string;
}
interface MatchCreatedEvent {
    operation: 'matchCreated';
    match: Match;
}
interface GetUserMatchesEvent {
    operation: 'getUserMatches';
    userId: string;
}
type MatchEvent = MatchCreatedEvent | GetUserMatchesEvent;
interface MatchResponse {
    statusCode: number;
    body: {
        matches?: Match[];
        success?: boolean;
        error?: string;
    };
}
export declare const handler: Handler<MatchEvent, MatchResponse>;
export {};
