#!/usr/bin/env node

/**
 * Trinity App - Migrate Existing Matches
 * 
 * This script migrates existing matches to work with the new GSI structure.
 * It creates individual user match records for existing matches.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

// Initialize AWS clients
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const MATCHES_TABLE = process.env.MATCHES_TABLE || 'TrinityMatches';

async function migrateExistingMatches() {
  console.log('🔄 Migrating existing matches for new GSI structure...');
  console.log(`📊 Table: ${MATCHES_TABLE}`);
  
  try {
    // Scan all existing matches
    console.log('📖 Scanning existing matches...');
    
    const result = await docClient.send(new ScanCommand({
      TableName: MATCHES_TABLE,
      FilterExpression: 'attribute_exists(matchedUsers) AND NOT attribute_exists(userId)',
    }));

    const existingMatches = result.Items || [];
    console.log(`📋 Found ${existingMatches.length} matches to migrate`);

    if (existingMatches.length === 0) {
      console.log('✅ No matches need migration');
      return;
    }

    let migratedCount = 0;
    let errorCount = 0;

    // Process each match
    for (const match of existingMatches) {
      try {
        console.log(`🔄 Migrating match: ${match.id} (${match.title})`);
        
        if (!match.matchedUsers || !Array.isArray(match.matchedUsers)) {
          console.warn(`⚠️  Skipping match ${match.id}: no matchedUsers array`);
          continue;
        }

        // Create individual user match records
        const userMatchPromises = match.matchedUsers.map(async (userId) => {
          const userMatch = {
            ...match,
            userId, // Add userId field for GSI
            id: `${userId}#${match.id}`, // Unique ID per user
            roomId: `${userId}#${match.roomId}`, // Composite key to avoid conflicts
          };

          try {
            await docClient.send(new PutCommand({
              TableName: MATCHES_TABLE,
              Item: userMatch,
              ConditionExpression: 'attribute_not_exists(roomId) AND attribute_not_exists(movieId)',
            }));
            console.log(`  ✅ Created user record for ${userId}`);
          } catch (error) {
            if (error.name === 'ConditionalCheckFailedException') {
              console.log(`  ℹ️  User record already exists for ${userId}`);
            } else {
              console.error(`  ❌ Error creating user record for ${userId}:`, error.message);
              throw error;
            }
          }
        });

        await Promise.allSettled(userMatchPromises);
        migratedCount++;
        console.log(`✅ Migrated match: ${match.id}`);

      } catch (error) {
        console.error(`❌ Error migrating match ${match.id}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`  • Total matches found: ${existingMatches.length}`);
    console.log(`  • Successfully migrated: ${migratedCount}`);
    console.log(`  • Errors: ${errorCount}`);
    
    if (errorCount === 0) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log('⚠️  Migration completed with some errors');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Check if running as script
if (require.main === module) {
  // Get table name from command line or environment
  const tableName = process.argv[2] || process.env.MATCHES_TABLE;
  
  if (!tableName) {
    console.error('❌ Error: MATCHES_TABLE environment variable or table name argument required');
    console.error('Usage: node migrate-existing-matches.js [TABLE_NAME]');
    console.error('   or: MATCHES_TABLE=TrinityMatches node migrate-existing-matches.js');
    process.exit(1);
  }

  // Override table name if provided as argument
  if (process.argv[2]) {
    process.env.MATCHES_TABLE = process.argv[2];
  }

  console.log('🚀 Trinity App - Match Migration Tool');
  console.log('====================================');
  
  migrateExistingMatches()
    .then(() => {
      console.log('\n🎉 Migration process completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration process failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateExistingMatches };