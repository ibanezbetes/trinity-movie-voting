interface RecommendationMovie {
    movieId: number;
    title: string;
    posterPath: string;
    alternativePosterUrl?: string;
    year: string;
    description: string;
    trailerKey?: string;
}
interface RecommendationCategory {
    categoryId: string;
    title: string;
    description: string;
    movies: RecommendationMovie[];
}
export declare const handler: (event: any) => Promise<RecommendationCategory | RecommendationCategory[] | null>;
export {};
