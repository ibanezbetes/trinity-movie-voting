import { Handler } from 'aws-lambda';
interface MovieCandidate {
    id: number;
    title: string;
    overview: string;
    posterPath: string | null;
    releaseDate: string;
    mediaType: 'MOVIE' | 'TV';
}
interface Room {
    id: string;
    code: string;
    hostId: string;
    mediaType: 'MOVIE' | 'TV';
    genreIds: number[];
    candidates: MovieCandidate[];
    createdAt: string;
    ttl: number;
}
interface CreateRoomEvent {
    operation: 'createRoom';
    userId: string;
    input: {
        mediaType: 'MOVIE' | 'TV';
        genreIds: number[];
    };
}
interface JoinRoomEvent {
    operation: 'joinRoom';
    userId: string;
    code: string;
}
interface GetRoomEvent {
    operation: 'getRoom';
    userId: string;
    roomId: string;
}
interface GetMyRoomsEvent {
    operation: 'getMyRooms';
    userId: string;
}
type RoomEvent = CreateRoomEvent | JoinRoomEvent | GetRoomEvent | GetMyRoomsEvent;
interface RoomResponse {
    statusCode: number;
    body: Room | Room[] | {
        error: string;
    };
}
export declare const handler: Handler<RoomEvent, RoomResponse>;
export {};
