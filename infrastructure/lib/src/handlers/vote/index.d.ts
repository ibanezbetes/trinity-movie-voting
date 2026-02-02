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
interface VoteEvent {
    operation: 'vote';
    userId: string;
    input: {
        roomId: string;
        movieId: number;
        vote: boolean;
    };
}
interface VoteResponse {
    statusCode: number;
    body: {
        success: boolean;
        match?: Match;
        error?: string;
    };
}
export declare const handler: Handler<VoteEvent, VoteResponse>;
export {};
