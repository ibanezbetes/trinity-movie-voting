#!/usr/bin/env node

/**
 * Script para sincronizar completamente el proyecto local con AWS
 * Descarga esquemas, configuraciones y actualiza archivos locales
 * Ejecutar desde el directorio infrastructure: node scripts/sync-from-aws.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function syncFromAWS() {
  try {
    console.log('🔄 Iniciando sincronización completa con AWS...');
    
    // 1. Obtener configuración actual del stack
    console.log('📋 Obteniendo configuración del stack...');
    const outputsJson = execSync(
      'aws cloudformation describe-stacks --stack-name TrinityStack --query "Stacks[0].Outputs" --output json',
      { encoding: 'utf8' }
    );
    
    const outputs = JSON.parse(outputsJson);
    const config = {};
    
    outputs.forEach(output => {
      switch (output.OutputKey) {
        case 'AWSRegion':
          config.region = output.OutputValue;
          break;
        case 'UserPoolId':
          config.userPoolId = output.OutputValue;
          break;
        case 'UserPoolClientId':
          config.userPoolWebClientId = output.OutputValue;
          break;
        case 'GraphQLEndpoint':
          config.graphqlEndpoint = output.OutputValue;
          break;
        case 'RoomsTableName':
          config.roomsTable = output.OutputValue;
          break;
        case 'VotesTableName':
          config.votesTable = output.OutputValue;
          break;
        case 'MatchesTableName':
          config.matchesTable = output.OutputValue;
          break;
        case 'UsersTableName':
          config.usersTable = output.OutputValue;
          break;
      }
    });
    
    console.log('✅ Configuración obtenida:', config);
    
    // 2. Descargar esquema GraphQL actual
    console.log('📥 Descargando esquema GraphQL desde AppSync...');
    try {
      // Extraer API ID del endpoint
      const apiId = config.graphqlEndpoint.split('//')[1].split('.')[0];
      
      const schemaJson = execSync(
        `aws appsync get-introspection-schema --api-id ${apiId} --format SDL --output text`,
        { encoding: 'utf8' }
      );
      
      // Guardar esquema descargado
      const schemaPath = path.join(__dirname, '../schema-from-aws.graphql');
      fs.writeFileSync(schemaPath, schemaJson);
      console.log('✅ Esquema GraphQL descargado:', schemaPath);
      
    } catch (error) {
      console.warn('⚠️ No se pudo descargar el esquema GraphQL:', error.message);
    }
    
    // 3. Actualizar configuración móvil
    console.log('📱 Actualizando configuración móvil...');
    const configContent = `// Auto-generated AWS configuration
// Generated on: ${new Date().toISOString()}
// Stack: TrinityStack
// Synced from AWS

export interface AWSConfig {
  region: string;
  userPoolId: string;
  userPoolWebClientId: string;
  graphqlEndpoint: string;
  authenticationType: string;
}

export const awsConfig: AWSConfig = {
  region: '${config.region}',
  userPoolId: '${config.userPoolId}',
  userPoolWebClientId: '${config.userPoolWebClientId}',
  graphqlEndpoint: '${config.graphqlEndpoint}',
  authenticationType: 'AMAZON_COGNITO_USER_POOLS',
};

// Environment variables for Expo
export const expoConfig = {
  EXPO_PUBLIC_AWS_REGION: '${config.region}',
  EXPO_PUBLIC_USER_POOL_ID: '${config.userPoolId}',
  EXPO_PUBLIC_USER_POOL_CLIENT_ID: '${config.userPoolWebClientId}',
  EXPO_PUBLIC_GRAPHQL_ENDPOINT: '${config.graphqlEndpoint}',
  EXPO_PUBLIC_AUTH_TYPE: 'AMAZON_COGNITO_USER_POOLS',
};

// Table names (for reference)
export const tableNames = {
  rooms: '${config.roomsTable}',
  votes: '${config.votesTable}',
  matches: '${config.matchesTable}',
  users: '${config.usersTable}',
};
`;

    const configPath = path.join(__dirname, '../../mobile/src/config/aws-config.ts');
    fs.writeFileSync(configPath, configContent);
    console.log('✅ Configuración móvil actualizada');
    
    // 4. Actualizar app.json
    console.log('📄 Actualizando app.json...');
    const appJsonPath = path.join(__dirname, '../../mobile/app.json');
    if (fs.existsSync(appJsonPath)) {
      const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      
      if (!appJson.expo.extra) {
        appJson.expo.extra = {};
      }
      
      appJson.expo.extra.aws = {
        region: config.region,
        userPoolId: config.userPoolId,
        userPoolWebClientId: config.userPoolWebClientId,
        graphqlEndpoint: config.graphqlEndpoint,
        authenticationType: 'AMAZON_COGNITO_USER_POOLS',
        tables: {
          rooms: config.roomsTable,
          votes: config.votesTable,
          matches: config.matchesTable,
          users: config.usersTable,
        },
        syncedAt: new Date().toISOString(),
      };
      
      fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2));
      console.log('✅ app.json actualizado');
    }
    
    // 5. Crear resumen de sincronización
    const summaryPath = path.join(__dirname, '../sync-summary.json');
    const summary = {
      syncedAt: new Date().toISOString(),
      stack: 'TrinityStack',
      region: config.region,
      resources: {
        userPool: config.userPoolId,
        userPoolClient: config.userPoolWebClientId,
        graphqlEndpoint: config.graphqlEndpoint,
        tables: {
          rooms: config.roomsTable,
          votes: config.votesTable,
          matches: config.matchesTable,
          users: config.usersTable,
        }
      },
      filesUpdated: [
        'mobile/src/config/aws-config.ts',
        'mobile/app.json',
        'infrastructure/schema-from-aws.graphql',
        'infrastructure/sync-summary.json'
      ]
    };
    
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    
    console.log('🎉 Sincronización completa exitosa!');
    console.log('📋 Resumen guardado en:', summaryPath);
    console.log('');
    console.log('📁 Archivos actualizados:');
    summary.filesUpdated.forEach(file => {
      console.log(`   ✅ ${file}`);
    });
    
  } catch (error) {
    console.error('❌ Error en sincronización:', error.message);
    process.exit(1);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  syncFromAWS();
}

module.exports = { syncFromAWS };