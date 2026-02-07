#!/usr/bin/env node

/**
 * Script para sincronizar completamente el código local con AWS
 * Descarga el código de las funciones Lambda y actualiza archivos locales
 */

const { LambdaClient, GetFunctionCommand } = require('@aws-sdk/client-lambda');
const { CloudFormationClient, ListStackResourcesCommand, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const fs = require('fs');
const path = require('path');
const https = require('https');
const AdmZip = require('adm-zip');

// Configuración
const REGION = process.env.AWS_REGION || 'eu-west-1';
const STACK_NAME = 'TrinityStack';

// Inicializar clientes AWS
const lambdaClient = new LambdaClient({ region: REGION });
const cloudformationClient = new CloudFormationClient({ region: REGION });
const dynamodbClient = new DynamoDBClient({ region: REGION });

console.log('🔄 Trinity AWS Full Sync Tool');
console.log('=============================\n');
console.log(`Region: ${REGION}`);
console.log(`Stack: ${STACK_NAME}\n`);

async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

async function getStackResources() {
  console.log('🔍 Obteniendo recursos del stack...');
  
  try {
    const command = new ListStackResourcesCommand({
      StackName: STACK_NAME
    });
    
    const response = await cloudformationClient.send(command);
    console.log(`   ✅ Encontrados ${response.StackResourceSummaries.length} recursos\n`);
    
    return response.StackResourceSummaries;
  } catch (error) {
    console.error('❌ Error obteniendo recursos del stack:', error.message);
    throw error;
  }
}

async function getStackOutputs() {
  console.log('📋 Obteniendo outputs del stack...');
  
  try {
    const command = new DescribeStacksCommand({
      StackName: STACK_NAME
    });
    
    const response = await cloudformationClient.send(command);
    const stack = response.Stacks[0];
    
    if (!stack || !stack.Outputs) {
      console.log('   ⚠️  No se encontraron outputs');
      return {};
    }
    
    const outputs = {};
    stack.Outputs.forEach(output => {
      outputs[output.OutputKey] = output.OutputValue;
      console.log(`   ✅ ${output.OutputKey}: ${output.OutputValue}`);
    });
    
    console.log('');
    return outputs;
  } catch (error) {
    console.error('❌ Error obteniendo outputs:', error.message);
    return {};
  }
}

async function downloadLambdaCode(functionName, outputDir) {
  console.log(`📥 Descargando código de: ${functionName}`);
  
  try {
    const command = new GetFunctionCommand({
      FunctionName: functionName
    });
    
    const response = await lambdaClient.send(command);
    const config = response.Configuration;
    const codeUrl = response.Code.Location;
    
    console.log(`   - Runtime: ${config.Runtime}`);
    console.log(`   - Handler: ${config.Handler}`);
    console.log(`   - Timeout: ${config.Timeout}s`);
    console.log(`   - Memory: ${config.MemorySize}MB`);
    
    // Mostrar variables de entorno (sin valores sensibles)
    if (config.Environment && config.Environment.Variables) {
      console.log('   - Environment Variables:');
      Object.keys(config.Environment.Variables).forEach(key => {
        console.log(`     * ${key}`);
      });
    }
    
    // Descargar el código
    const zipPath = path.join(outputDir, `${functionName}.zip`);
    console.log(`   📦 Descargando ZIP a: ${zipPath}`);
    
    await downloadFile(codeUrl, zipPath);
    console.log(`   ✅ Descarga completada`);
    
    // Extraer el ZIP
    const extractDir = path.join(outputDir, functionName);
    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
    }
    
    console.log(`   📂 Extrayendo a: ${extractDir}`);
    
    // Usar adm-zip para extraer
    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);
      console.log(`   ✅ Extracción completada`);
    } catch (extractError) {
      console.error(`   ❌ Error extrayendo ZIP: ${extractError.message}`);
      fs.unlinkSync(zipPath);
      return null;
    }
    
    // Eliminar el ZIP
    fs.unlinkSync(zipPath);
    
    return {
      config,
      extractDir
    };
    
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    return null;
  }
}

function mapLogicalIdToHandler(logicalId) {
  const mapping = {
    'TmdbHandler': 'tmdb',
    'RoomHandler': 'room',
    'VoteHandler': 'vote',
    'MatchHandler': 'match'
  };
  
  for (const [key, value] of Object.entries(mapping)) {
    if (logicalId.includes(key)) {
      return value;
    }
  }
  
  return null;
}

async function syncLambdaFunctions(resources) {
  console.log('🚀 Sincronizando funciones Lambda...\n');
  
  const lambdaFunctions = resources.filter(r => 
    r.ResourceType === 'AWS::Lambda::Function' &&
    r.LogicalResourceId.includes('Handler')
  );
  
  console.log(`📋 Encontradas ${lambdaFunctions.length} funciones Lambda\n`);
  
  const tempDir = path.join(__dirname, '..', 'temp-lambda-downloads');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const syncResults = [];
  
  for (const resource of lambdaFunctions) {
    const functionName = resource.PhysicalResourceId;
    const logicalId = resource.LogicalResourceId;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 ${logicalId}`);
    console.log(`${'='.repeat(60)}`);
    
    const handlerType = mapLogicalIdToHandler(logicalId);
    
    if (!handlerType) {
      console.log(`   ⚠️  No se pudo mapear a un handler local`);
      continue;
    }
    
    const localHandlerDir = path.join(__dirname, '..', 'src', 'handlers', handlerType);
    console.log(`   📁 Handler local: src/handlers/${handlerType}`);
    
    // Descargar código de AWS
    const downloadResult = await downloadLambdaCode(functionName, tempDir);
    
    if (downloadResult) {
      const { extractDir } = downloadResult;
      
      // Buscar el archivo index.js en el directorio extraído
      const indexJsPath = path.join(extractDir, 'index.js');
      
      if (fs.existsSync(indexJsPath)) {
        // Copiar index.js al directorio local
        const localIndexPath = path.join(localHandlerDir, 'index.js');
        
        console.log(`   📝 Actualizando: ${localIndexPath}`);
        fs.copyFileSync(indexJsPath, localIndexPath);
        console.log(`   ✅ Archivo actualizado`);
        
        // Verificar si hay package.json
        const packageJsonPath = path.join(extractDir, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
          const localPackagePath = path.join(localHandlerDir, 'package.json');
          console.log(`   📝 Actualizando: package.json`);
          fs.copyFileSync(packageJsonPath, localPackagePath);
          console.log(`   ✅ package.json actualizado`);
        }
        
        // Verificar si hay node_modules (para vote handler)
        const nodeModulesPath = path.join(extractDir, 'node_modules');
        if (fs.existsSync(nodeModulesPath)) {
          console.log(`   📦 Encontrado node_modules (${handlerType} tiene dependencias)`);
        }
        
        syncResults.push({
          handler: handlerType,
          status: 'success',
          functionName
        });
        
      } else {
        console.log(`   ⚠️  No se encontró index.js en el ZIP descargado`);
        syncResults.push({
          handler: handlerType,
          status: 'error',
          error: 'index.js not found'
        });
      }
    } else {
      syncResults.push({
        handler: handlerType,
        status: 'error',
        error: 'download failed'
      });
    }
  }
  
  // Limpiar directorio temporal
  console.log(`\n🧹 Limpiando archivos temporales...`);
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`   ✅ Limpieza completada`);
  
  return syncResults;
}

async function syncDynamoDBInfo(resources) {
  console.log('\n🗄️  Verificando tablas DynamoDB...\n');
  
  const tables = resources.filter(r => 
    r.ResourceType === 'AWS::DynamoDB::Table'
  );
  
  const tableInfo = [];
  
  for (const table of tables) {
    const tableName = table.PhysicalResourceId;
    
    try {
      const command = new DescribeTableCommand({
        TableName: tableName
      });
      
      const response = await dynamodbClient.send(command);
      const tableData = response.Table;
      
      console.log(`   ✅ ${tableName}`);
      console.log(`      - Estado: ${tableData.TableStatus}`);
      console.log(`      - Items: ~${tableData.ItemCount || 0}`);
      console.log(`      - Tamaño: ${(tableData.TableSizeBytes || 0)} bytes`);
      
      // Mostrar esquema de claves
      console.log(`      - Keys:`);
      tableData.KeySchema.forEach(key => {
        const attr = tableData.AttributeDefinitions.find(a => a.AttributeName === key.AttributeName);
        console.log(`        * ${key.AttributeName} (${key.KeyType}): ${attr.AttributeType}`);
      });
      
      // Mostrar índices
      if (tableData.GlobalSecondaryIndexes && tableData.GlobalSecondaryIndexes.length > 0) {
        console.log(`      - GSI: ${tableData.GlobalSecondaryIndexes.length}`);
        tableData.GlobalSecondaryIndexes.forEach(gsi => {
          console.log(`        * ${gsi.IndexName}: ${gsi.IndexStatus}`);
        });
      }
      
      // Mostrar TTL
      if (tableData.TimeToLiveDescription && tableData.TimeToLiveDescription.TimeToLiveStatus === 'ENABLED') {
        console.log(`      - TTL: Enabled (${tableData.TimeToLiveDescription.AttributeName})`);
      }
      
      console.log('');
      
      tableInfo.push({
        name: tableName,
        status: tableData.TableStatus,
        itemCount: tableData.ItemCount || 0,
        keys: tableData.KeySchema,
        gsi: tableData.GlobalSecondaryIndexes || []
      });
      
    } catch (error) {
      console.error(`   ❌ Error verificando ${tableName}:`, error.message);
    }
  }
  
  return tableInfo;
}

async function updateMobileConfig(outputs) {
  console.log('\n📱 Actualizando configuración de mobile...\n');
  
  const mobileEnvPath = path.join(__dirname, '..', '..', 'mobile', '.env');
  
  const config = {
    EXPO_PUBLIC_AWS_REGION: REGION,
    EXPO_PUBLIC_GRAPHQL_ENDPOINT: outputs.GraphQLEndpoint || '',
    EXPO_PUBLIC_USER_POOL_ID: outputs.UserPoolId || '',
    EXPO_PUBLIC_USER_POOL_CLIENT_ID: outputs.UserPoolClientId || ''
  };
  
  let envContent = '';
  Object.entries(config).forEach(([key, value]) => {
    envContent += `${key}=${value}\n`;
    console.log(`   ${key}=${value}`);
  });
  
  fs.writeFileSync(mobileEnvPath, envContent);
  console.log(`\n   ✅ Archivo actualizado: mobile/.env`);
}

async function generateSyncReport(syncResults, tableInfo, outputs) {
  console.log('\n📊 Generando reporte de sincronización...\n');
  
  const report = {
    timestamp: new Date().toISOString(),
    region: REGION,
    stackName: STACK_NAME,
    lambdaFunctions: syncResults,
    dynamodbTables: tableInfo,
    outputs: outputs,
    summary: {
      totalLambdas: syncResults.length,
      successfulSyncs: syncResults.filter(r => r.status === 'success').length,
      failedSyncs: syncResults.filter(r => r.status === 'error').length,
      totalTables: tableInfo.length
    }
  };
  
  const reportPath = path.join(__dirname, '..', 'sync-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  console.log(`   ✅ Reporte guardado: infrastructure/sync-report.json`);
  
  // Mostrar resumen
  console.log('\n📈 Resumen de Sincronización:');
  console.log(`   - Lambda Functions: ${report.summary.successfulSyncs}/${report.summary.totalLambdas} sincronizadas`);
  console.log(`   - DynamoDB Tables: ${report.summary.totalTables} verificadas`);
  console.log(`   - Mobile Config: Actualizado`);
  
  return report;
}

async function main() {
  try {
    // 1. Obtener recursos del stack
    const resources = await getStackResources();
    
    // 2. Obtener outputs del stack
    const outputs = await getStackOutputs();
    
    // 3. Sincronizar funciones Lambda
    const syncResults = await syncLambdaFunctions(resources);
    
    // 4. Verificar tablas DynamoDB
    const tableInfo = await syncDynamoDBInfo(resources);
    
    // 5. Actualizar configuración de mobile
    await updateMobileConfig(outputs);
    
    // 6. Generar reporte
    const report = await generateSyncReport(syncResults, tableInfo, outputs);
    
    console.log('\n✅ Sincronización completada exitosamente!\n');
    
    console.log('📝 Próximos pasos:');
    console.log('   1. Revisar los archivos actualizados en src/handlers/');
    console.log('   2. Verificar mobile/.env con las nuevas credenciales');
    console.log('   3. Compilar TypeScript si es necesario: npm run build');
    console.log('   4. Ejecutar tests: npm test');
    console.log('   5. Hacer commit de los cambios\n');
    
    // Mostrar archivos actualizados
    if (report.summary.successfulSyncs > 0) {
      console.log('📂 Archivos actualizados:');
      syncResults.filter(r => r.status === 'success').forEach(r => {
        console.log(`   ✅ src/handlers/${r.handler}/index.js`);
      });
      console.log('   ✅ mobile/.env\n');
    }
    
  } catch (error) {
    console.error('\n❌ Error durante la sincronización:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Ejecutar
if (require.main === module) {
  main();
}

module.exports = { main };
