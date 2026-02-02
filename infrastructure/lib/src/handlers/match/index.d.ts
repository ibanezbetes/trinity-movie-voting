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
interface CheckUserMatchesEvent {
    operation: 'checkUserMatches';
    userId: string;
}
interface PublishRoomMatchEvent {
    operation: 'publishRoomMatch';
    roomId: string;
    matchData: {
        matchId: string;
        movieId: string;
        movieTitle: string;
        posterPath?: string;
        matchedUsers: string[];
        matchDetails: {
            voteCount: number;
            requiredVotes: number;
            matchType: string;
        };
    };
}
type MatchEvent = CreateMatchEvent | MatchCreatedEvent | GetUserMatchesEvent | CheckRoomMatchEvent | CheckUserMatchesEvent | NotifyMatchEvent | PublishRoomMatchEvent;
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
