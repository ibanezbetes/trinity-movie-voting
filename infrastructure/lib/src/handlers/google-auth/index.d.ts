export declare const handler: (event: any) => Promise<{
    success: boolean;
    accessToken: string | undefined;
    idToken: string | undefined;
    refreshToken: string | undefined;
    email: string;
}>;
