import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const RECOMMENDATIONS_TABLE = process.env.RECOMMENDATIONS_TABLE || 'trinity-recommendations';

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

export const handler = async (event: any) => {
  console.log('Recommendations Handler - Event:', JSON.stringify(event, null, 2));

  const fieldName = event.info.fieldName;

  try {
    switch (fieldName) {
      case 'getRecommendations':
        return await getRecommendations();
      
      case 'getRecommendationsByCategory':
        return await getRecommendationsByCategory(event.arguments.categoryId);
      
      default:
        throw new Error(`Unknown field: ${fieldName}`);
    }
  } catch (error) {
    console.error('Error in recommendations handler:', error);
    throw error;
  }
};

async function getRecommendations(): Promise<RecommendationCategory[]> {
  console.log('Getting all recommendations');

  // Scan all items from recommendations table
  const result = await docClient.send(
    new ScanCommand({
      TableName: RECOMMENDATIONS_TABLE,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    console.log('No recommendations found');
    return [];
  }

  // Group movies by category
  const categoriesMap = new Map<string, RecommendationCategory>();

  for (const item of result.Items) {
    const categoryId = item.categoryId;
    
    if (!categoriesMap.has(categoryId)) {
      categoriesMap.set(categoryId, {
        categoryId: item.categoryId,
        title: item.categoryTitle,
        description: item.categoryDescription,
        movies: [],
      });
    }

    const category = categoriesMap.get(categoryId)!;
    category.movies.push({
      movieId: item.movieId,
      title: item.title,
      posterPath: item.posterPath,
      alternativePosterUrl: item.alternativePosterUrl,
      year: item.year,
      description: item.description,
      trailerKey: item.trailerKey,
    });
  }

  // Convert map to array and sort movies by movieId
  const categories = Array.from(categoriesMap.values());
  categories.forEach(category => {
    category.movies.sort((a, b) => a.movieId - b.movieId);
  });

  console.log(`Returning ${categories.length} categories`);
  return categories;
}

async function getRecommendationsByCategory(categoryId: string): Promise<RecommendationCategory | null> {
  console.log('Getting recommendations for category:', categoryId);

  const result = await docClient.send(
    new QueryCommand({
      TableName: RECOMMENDATIONS_TABLE,
      KeyConditionExpression: 'categoryId = :categoryId',
      ExpressionAttributeValues: {
        ':categoryId': categoryId,
      },
    })
  );

  if (!result.Items || result.Items.length === 0) {
    console.log('No recommendations found for category:', categoryId);
    return null;
  }

  const firstItem = result.Items[0];
  const category: RecommendationCategory = {
    categoryId: firstItem.categoryId,
    title: firstItem.categoryTitle,
    description: firstItem.categoryDescription,
    movies: result.Items.map(item => ({
      movieId: item.movieId,
      title: item.title,
      posterPath: item.posterPath,
      alternativePosterUrl: item.alternativePosterUrl,
      year: item.year,
      description: item.description,
      trailerKey: item.trailerKey,
    })),
  };

  // Sort movies by movieId
  category.movies.sort((a, b) => a.movieId - b.movieId);

  console.log(`Returning category with ${category.movies.length} movies`);
  return category;
}
