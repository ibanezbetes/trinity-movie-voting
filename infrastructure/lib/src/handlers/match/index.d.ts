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
interface CreateMatchEvent {
    operation: 'createMatch';
    input: {
        roomId: string;
        movieId: number;
        title: string;
        posterPath?: string;
        matchedUsers: string[];
    };
}
interface GetUserMatchesEvent {
    operation: 'getUserMatches';
    userId: string;
}
interface CheckRoomMatchEvent {
    operation: 'checkRoomMatch';
    roomId: string;
}
interface NotifyMatchEvent {
    operation: 'notifyMatch';
    match: Match;
}
interface MatchCreatedEvent {
    operation: 'matchCreated';
    match: Match;
}
type MatchEvent = CreateMatchEvent | MatchCreatedEvent | GetUserMatchesEvent | CheckRoomMatchEvent | NotifyMatchEvent;
interface MatchResponse {
    statusCode: number;
    body: {
        matches?: Match[];
        match?: Match;
        success?: boolean;
        error?: string;
    };
}
export declare const handler: Handler<MatchEvent, MatchResponse>;
export {};
