import { generateClient } from 'aws-amplify/api';
import { logger } from './logger';

const client = generateClient();

export interface RecommendationMovie {
  movieId: number;
  title: string;
  posterPath: string;
  alternativePosterUrl?: string;
  year: string;
  description: string;
  trailerKey?: string;
}

export interface RecommendationCategory {
  categoryId: string;
  title: string;
  description: string;
  movies: RecommendationMovie[];
}

const GET_RECOMMENDATIONS = `
  query GetRecommendations {
    getRecommendations {
      categoryId
      title
      description
      movies {
        movieId
        title
        posterPath
        alternativePosterUrl
        year
        description
        trailerKey
      }
    }
  }
`;

const GET_RECOMMENDATIONS_BY_CATEGORY = `
  query GetRecommendationsByCategory($categoryId: String!) {
    getRecommendationsByCategory(categoryId: $categoryId) {
      categoryId
      title
      description
      movies {
        movieId
        title
        posterPath
        alternativePosterUrl
        year
        description
        trailerKey
      }
    }
  }
`;

export async function getRecommendations(): Promise<RecommendationCategory[]> {
  try {
    logger.info('Fetching recommendations from DynamoDB');
    
    const result = await client.graphql({
      query: GET_RECOMMENDATIONS,
      authMode: 'iam', // Usar IAM para soportar tanto User Pool como Identity Pool
    });

    const recommendations = (result.data as any).getRecommendations || [];
    
    logger.info('Recommendations fetched successfully', {
      count: recommendations.length,
    });

    return recommendations;
  } catch (error: any) {
    console.error('❌ Error fetching recommendations:', error);
    console.error('Error message:', error?.message);
    console.error('Error errors:', error?.errors);
    console.error('Error stack:', error?.stack);
    logger.error('Error fetching recommendations', error);
    return [];
  }
}

export async function getRecommendationsByCategory(
  categoryId: string
): Promise<RecommendationCategory | null> {
  try {
    logger.info('Fetching recommendations by category', { categoryId });
    
    const result = await client.graphql({
      query: GET_RECOMMENDATIONS_BY_CATEGORY,
      variables: { categoryId },
      authMode: 'iam', // Usar IAM para soportar tanto User Pool como Identity Pool
    });

    const category = (result.data as any).getRecommendationsByCategory;
    
    if (category) {
      logger.info('Category fetched successfully', {
        categoryId,
        movieCount: category.movies?.length || 0,
      });
    }

    return category;
  } catch (error) {
    logger.error('Error fetching category', error, { categoryId });
    return null;
  }
}
