#!/usr/bin/env node

/**
 * Script para sincronizar el código local con el estado actual de AWS
 * Verifica el estado actual de los recursos desplegados
 */

const { LambdaClient, GetFunctionCommand } = require('@aws-sdk/client-lambda');
const { CloudFormationClient, ListStackResourcesCommand } = require('@aws-sdk/client-cloudformation');
const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const fs = require('fs');
const path = require('path');

// Configuración
const REGION = process.env.AWS_REGION || 'eu-west-1';
const STACK_NAME = 'TrinityStack';

// Inicializar clientes AWS
const lambdaClient = new LambdaClient({ region: REGION });
const cloudformationClient = new CloudFormationClient({ region: REGION });
const dynamodbClient = new DynamoDBClient({ region: REGION });

async function getStackResources() {
  console.log('🔍 Obteniendo recursos del stack...');
  
  try {
    const command = new ListStackResourcesCommand({
      StackName: STACK_NAME
    });
    
    const response = await cloudformationClient.send(command);
    
    return response.StackResourceSummaries.filter(
      resource => resource.ResourceType === 'AWS::Lambda::Function'
    );
  } catch (error) {
    console.error('❌ Error obteniendo recursos del stack:', error.message);
    process.exit(1);
  }
}

async function downloadLambdaFunction(functionName, handlerPath) {
  console.log(`📥 Descargando función: ${functionName}`);
  
  try {
    // Obtener código de la función
    const command = new GetFunctionCommand({
      FunctionName: functionName
    });
    
    const response = await lambdaClient.send(command);
    
    // Obtener configuración
    const config = response.Configuration;
    console.log(`   - Runtime: ${config.Runtime}`);
    console.log(`   - Handler: ${config.Handler}`);
    console.log(`   - Timeout: ${config.Timeout}s`);
    console.log(`   - Memory: ${config.MemorySize}MB`);
    
    // Mostrar variables de entorno
    if (config.Environment && config.Environment.Variables) {
      console.log('   - Environment Variables:');
      Object.entries(config.Environment.Variables).forEach(([key, value]) => {
        console.log(`     ${key}: ${value}`);
      });
    }
    
    return {
      config,
      codeLocation: response.Code.Location
    };
    
  } catch (error) {
    console.error(`❌ Error descargando función ${functionName}:`, error.message);
    return null;
  }
}

async function syncLambdaFunctions() {
  console.log('🚀 Iniciando sincronización de funciones Lambda...\n');
  
  const resources = await getStackResources();
  const lambdaFunctions = resources.filter(r => 
    r.LogicalResourceId.includes('Handler')
  );
  
  console.log(`📋 Encontradas ${lambdaFunctions.length} funciones Lambda:\n`);
  
  for (const resource of lambdaFunctions) {
    const functionName = resource.PhysicalResourceId;
    const logicalId = resource.LogicalResourceId;
    
    console.log(`\n🔄 Procesando: ${logicalId} (${functionName})`);
    
    const functionData = await downloadLambdaFunction(functionName);
    
    if (functionData) {
      // Determinar el directorio local basado en el nombre lógico
      let handlerDir;
      if (logicalId.includes('Tmdb')) {
        handlerDir = 'src/handlers/tmdb';
      } else if (logicalId.includes('Room')) {
        handlerDir = 'src/handlers/room';
      } else if (logicalId.includes('Vote')) {
        handlerDir = 'src/handlers/vote';
      } else if (logicalId.includes('Match')) {
        handlerDir = 'src/handlers/match';
      }
      
      if (handlerDir) {
        console.log(`   ✅ Función mapeada a: ${handlerDir}`);
        
        // Verificar que el directorio local existe
        const fullPath = path.join(__dirname, '..', handlerDir);
        if (fs.existsSync(fullPath)) {
          console.log(`   ✅ Directorio local existe: ${fullPath}`);
        } else {
          console.log(`   ⚠️  Directorio local no existe: ${fullPath}`);
        }
      } else {
        console.log(`   ⚠️  No se pudo mapear la función a un directorio local`);
      }
    }
  }
}

async function syncGraphQLSchema() {
  console.log('\n📋 Verificando API GraphQL...');
  
  try {
    // Obtener outputs del stack para el endpoint GraphQL
    const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
    const cfClient = new CloudFormationClient({ region: REGION });
    
    const command = new DescribeStacksCommand({
      StackName: STACK_NAME
    });
    
    const response = await cfClient.send(command);
    const stack = response.Stacks[0];
    
    if (stack && stack.Outputs) {
      const graphqlOutput = stack.Outputs.find(output => 
        output.OutputKey === 'GraphQLEndpoint'
      );
      
      if (graphqlOutput) {
        console.log(`   ✅ GraphQL Endpoint: ${graphqlOutput.OutputValue}`);
        
        const userPoolOutput = stack.Outputs.find(output => 
          output.OutputKey === 'UserPoolId'
        );
        
        const clientOutput = stack.Outputs.find(output => 
          output.OutputKey === 'UserPoolClientId'
        );
        
        if (userPoolOutput) {
          console.log(`   ✅ User Pool ID: ${userPoolOutput.OutputValue}`);
        }
        
        if (clientOutput) {
          console.log(`   ✅ User Pool Client ID: ${clientOutput.OutputValue}`);
        }
        
        // Generar configuración para mobile
        const mobileConfig = {
          EXPO_PUBLIC_AWS_REGION: REGION,
          EXPO_PUBLIC_GRAPHQL_ENDPOINT: graphqlOutput.OutputValue,
          EXPO_PUBLIC_USER_POOL_ID: userPoolOutput?.OutputValue || '',
          EXPO_PUBLIC_USER_POOL_CLIENT_ID: clientOutput?.OutputValue || ''
        };
        
        console.log('\n📱 Configuración para mobile/.env:');
        Object.entries(mobileConfig).forEach(([key, value]) => {
          console.log(`${key}=${value}`);
        });
        
      } else {
        console.log('   ⚠️  GraphQL Endpoint no encontrado en outputs');
      }
    }
    
  } catch (error) {
    console.error('❌ Error verificando API GraphQL:', error.message);
  }
}

async function syncDynamoDBTables() {
  console.log('\n🗄️  Verificando tablas DynamoDB...');
  
  const expectedTables = [
    'trinity-rooms',
    'trinity-votes', 
    'trinity-matches'
  ];
  
  for (const tableName of expectedTables) {
    try {
      const command = new DescribeTableCommand({
        TableName: tableName
      });
      
      const response = await dynamodbClient.send(command);
      const table = response.Table;
      
      console.log(`   ✅ Tabla: ${tableName}`);
      console.log(`      - Estado: ${table.TableStatus}`);
      console.log(`      - Items: ~${table.ItemCount || 0}`);
      console.log(`      - Tamaño: ${(table.TableSizeBytes || 0)} bytes`);
      
      // Mostrar índices
      if (table.GlobalSecondaryIndexes) {
        console.log(`      - GSI: ${table.GlobalSecondaryIndexes.length}`);
        table.GlobalSecondaryIndexes.forEach(gsi => {
          console.log(`        * ${gsi.IndexName}: ${gsi.IndexStatus}`);
        });
      }
      
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        console.log(`   ❌ Tabla no encontrada: ${tableName}`);
      } else {
        console.error(`   ❌ Error verificando tabla ${tableName}:`, error.message);
      }
    }
  }
}

async function generateSyncReport() {
  console.log('\n📊 Generando reporte de sincronización...');
  
  const report = {
    timestamp: new Date().toISOString(),
    region: REGION,
    stackName: STACK_NAME,
    sync: {
      lambdaFunctions: [],
      graphqlApi: null,
      dynamodbTables: []
    }
  };
  
  // Guardar reporte
  const reportPath = path.join(__dirname, '..', 'sync-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  console.log(`   ✅ Reporte guardado en: ${reportPath}`);
}

async function main() {
  console.log('🔄 Trinity AWS Sync Tool');
  console.log('========================\n');
  
  try {
    await syncLambdaFunctions();
    await syncGraphQLSchema();
    await syncDynamoDBTables();
    await generateSyncReport();
    
    console.log('\n✅ Sincronización completada exitosamente!');
    console.log('\n📝 Próximos pasos:');
    console.log('   1. Revisar el código local vs el estado de AWS');
    console.log('   2. Actualizar archivos locales si es necesario');
    console.log('   3. Ejecutar tests para verificar funcionalidad');
    console.log('   4. Hacer commit de los cambios');
    
  } catch (error) {
    console.error('\n❌ Error durante la sincronización:', error);
    process.exit(1);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main();
}

module.exports = {
  syncLambdaFunctions,
  syncGraphQLSchema,
  syncDynamoDBTables
};