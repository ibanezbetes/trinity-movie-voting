#!/usr/bin/env node

/**
 * Script para actualizar la configuración móvil con los valores actuales de AWS
 * Ejecutar desde el directorio infrastructure: node scripts/update-mobile-config.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function updateMobileConfig() {
  try {
    console.log('🔄 Obteniendo configuración actual de AWS...');
    
    // Obtener outputs del stack de CloudFormation
    const outputsJson = execSync(
      'aws cloudformation describe-stacks --stack-name TrinityStack --query "Stacks[0].Outputs" --output json',
      { encoding: 'utf8' }
    );
    
    const outputs = JSON.parse(outputsJson);
    
    // Extraer valores necesarios
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
      }
    });
    
    console.log('📋 Configuración obtenida:', config);
    
    // Generar archivo de configuración
    const configContent = `// Auto-generated AWS configuration
// Generated on: ${new Date().toISOString()}
// Stack: TrinityStack

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
`;

    // Escribir archivo de configuración
    const configPath = path.join(__dirname, '../../mobile/src/config/aws-config.ts');
    fs.writeFileSync(configPath, configContent);
    
    console.log('✅ Configuración móvil actualizada:', configPath);
    
    // También actualizar app.json si existe
    const appJsonPath = path.join(__dirname, '../../mobile/app.json');
    if (fs.existsSync(appJsonPath)) {
      const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      
      // Actualizar variables de entorno en app.json
      if (!appJson.expo.extra) {
        appJson.expo.extra = {};
      }
      
      appJson.expo.extra.aws = {
        region: config.region,
        userPoolId: config.userPoolId,
        userPoolWebClientId: config.userPoolWebClientId,
        graphqlEndpoint: config.graphqlEndpoint,
        authenticationType: 'AMAZON_COGNITO_USER_POOLS',
      };
      
      fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2));
      console.log('✅ app.json actualizado con configuración AWS');
    }
    
    console.log('🎉 Configuración móvil sincronizada con AWS exitosamente!');
    
  } catch (error) {
    console.error('❌ Error actualizando configuración móvil:', error.message);
    process.exit(1);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  updateMobileConfig();
}

module.exports = { updateMobileConfig };