// Script to update trinity-recommendations table with new movies
// Run with: node infrastructure/scripts/update-recommendations.js

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');

const client = new DynamoDBClient({ region: 'eu-west-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'trinity-recommendations';

async function deleteAllItems() {
  console.log('🗑️  Deleting all existing items...\n');

  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
    })
  );

  if (!result.Items || result.Items.length === 0) {
    console.log('No items to delete.\n');
    return 0;
  }

  let deleted = 0;
  for (const item of result.Items) {
    await docClient.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: {
          categoryId: item.categoryId,
          movieId: item.movieId,
        },
      })
    );
    deleted++;
  }

  console.log(`✅ Deleted ${deleted} items\n`);
  return deleted;
}

async function insertMovies(movies) {
  console.log('📥 Inserting new movies...\n');

  let inserted = 0;
  let errors = 0;

  for (const movie of movies) {
    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: movie,
        })
      );
      console.log(`  ✅ ${movie.title} (${movie.year})`);
      inserted++;
    } catch (error) {
      console.error(`  ❌ Error inserting ${movie.title}:`, error.message);
      errors++;
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`  Total inserted: ${inserted}`);
  console.log(`  Total errors: ${errors}`);
  console.log(`  Categories: 7`);
  console.log(`  Movies per category: 10`);

  return { inserted, errors };
}

async function main() {
  console.log('🚀 Updating trinity-recommendations table\n');
  console.log('=' .repeat(50) + '\n');

  // Read movies from JSON file
  const jsonPath = path.join(__dirname, '../../FORMATO_JSON_PELICULAS.md');
  const content = fs.readFileSync(jsonPath, 'utf8');
  
  // Extract JSON array from markdown file
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON array in file');
  }
  
  const movies = JSON.parse(jsonMatch[0]);
  console.log(`📋 Loaded ${movies.length} movies from JSON\n`);

  // Delete all existing items
  await deleteAllItems();

  // Insert new movies
  const { inserted, errors } = await insertMovies(movies);

  console.log('\n' + '='.repeat(50));
  console.log('\n✅ Update complete!');
  console.log(`\n📱 Next steps:`);
  console.log(`  1. Reload the app in Expo Go`);
  console.log(`  2. Go to "Descubre"`);
  console.log(`  3. Verify 7 categories with 10 movies each`);
  console.log(`  4. Test horizontal scroll`);
  console.log(`  5. Verify all posters load correctly\n`);
}

main().catch(console.error);
