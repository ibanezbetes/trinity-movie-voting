interface AppSyncEvent {
    info: {
        fieldName: string;
    };
    arguments: {
        username?: string;
    };
    identity: {
        claims: {
            sub: string;
            email: string;
            preferred_username?: string;
        };
    };
}
export declare const handler: (event: AppSyncEvent) => Promise<{
    username: any;
    email: any;
} | {
    success: boolean;
    message: string;
    deletedItems: {
        username: boolean;
        rooms: number;
        votes: number;
        matches: number;
    };
} | null>;
export {};
