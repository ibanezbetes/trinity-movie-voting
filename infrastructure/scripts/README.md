# Trinity Infrastructure Scripts

Scripts de utilidad para gestionar la infraestructura de Trinity en AWS.

## 📋 Scripts Disponibles

### 1. `cleanup-test-rooms.ps1`

**Propósito**: Limpiar todas las salas, votos y matches de prueba en DynamoDB.

**Uso**:
```powershell
cd infrastructure/scripts
.\cleanup-test-rooms.ps1
```

**Qué hace**:
1. Muestra el estado actual de las tablas (número de items)
2. Solicita confirmación antes de eliminar
3. Elimina todos los items de las siguientes tablas:
   - `trinity-matches` (matches detectados)
   - `trinity-votes` (votos de usuarios)
   - `trinity-rooms` (salas creadas)
4. Muestra un resumen de items eliminados

**Cuándo usar**:
- Antes de lanzar a producción
- Para limpiar datos de desarrollo/testing
- Cuando quieras empezar con tablas limpias

**⚠️ Advertencia**: Esta operación es **irreversible**. Todos los datos serán eliminados permanentemente.

---

### 2. `sync-from-aws.js`

**Propósito**: Verificar el estado actual de los recursos desplegados en AWS.

**Uso**:
```bash
cd infrastructure/scripts
node sync-from-aws.js
```

**Qué hace**:
1. Lista todas las funciones Lambda del stack
2. Muestra configuración de cada función (runtime, timeout, memory, env vars)
3. Verifica el estado de las tablas DynamoDB
4. Muestra información de la API GraphQL y Cognito
5. Genera un reporte de sincronización

**Cuándo usar**:
- Para verificar que el deployment fue exitoso
- Para obtener información de configuración actual
- Para debugging de problemas de infraestructura

---

### 3. `generate-mobile-config.js`

**Propósito**: Generar el archivo de configuración para la app móvil.

**Uso**:
```bash
cd infrastructure/scripts
node generate-mobile-config.js
```

**Qué hace**:
1. Obtiene los outputs del stack de CloudFormation
2. Genera el archivo `mobile/.env` con:
   - GraphQL Endpoint
   - User Pool ID
   - User Pool Client ID
   - AWS Region

**Cuándo usar**:
- Después de un nuevo deployment
- Cuando cambien las credenciales de AWS
- Para configurar un nuevo entorno de desarrollo

---

### 4. `update-mobile-config.js`

**Propósito**: Actualizar la configuración móvil desde AWS.

**Uso**:
```bash
cd infrastructure/scripts
node update-mobile-config.js
```

**Qué hace**:
- Similar a `generate-mobile-config.js` pero actualiza un archivo existente
- Preserva otras variables de entorno que puedan existir

---

## 🔧 Requisitos

### AWS CLI
Todos los scripts requieren AWS CLI configurado:

```bash
# Verificar instalación
aws --version

# Configurar credenciales
aws configure
```

### Node.js
Scripts `.js` requieren Node.js 18+:

```bash
node --version
```

### PowerShell
Scripts `.ps1` requieren PowerShell 5.1+ (Windows) o PowerShell Core (Linux/Mac):

```bash
pwsh --version
```

## 📝 Notas Importantes

### Permisos AWS Requeridos

Los scripts necesitan los siguientes permisos IAM:

- **Lambda**: `lambda:GetFunction`, `lambda:ListFunctions`
- **DynamoDB**: `dynamodb:Scan`, `dynamodb:DeleteItem`, `dynamodb:DescribeTable`
- **CloudFormation**: `cloudformation:DescribeStacks`, `cloudformation:ListStackResources`
- **AppSync**: `appsync:ListGraphqlApis`, `appsync:GetIntrospectionSchema`

### Región AWS

Por defecto, los scripts usan la región `eu-west-1`. Para cambiar:

```powershell
# En PowerShell
$env:AWS_REGION = "us-east-1"

# En Bash
export AWS_REGION=us-east-1
```

### Backup Antes de Limpiar

Antes de ejecutar `cleanup-test-rooms.ps1`, considera hacer un backup:

```bash
# Exportar datos de una tabla
aws dynamodb scan --table-name trinity-rooms --region eu-west-1 > rooms-backup.json
```

## 🚀 Flujo de Trabajo Recomendado

### Desarrollo Local
```bash
1. npm run build          # Compilar TypeScript
2. npm run deploy         # Desplegar a AWS
3. node scripts/sync-from-aws.js  # Verificar deployment
4. node scripts/generate-mobile-config.js  # Actualizar config móvil
```

### Limpieza Pre-Producción
```powershell
1. .\scripts\cleanup-test-rooms.ps1  # Limpiar datos de prueba
2. Verificar en AWS Console que las tablas están vacías
3. Hacer deployment final
4. Probar con datos reales
```

### Troubleshooting
```bash
1. node scripts/sync-from-aws.js  # Ver estado actual
2. Revisar logs en CloudWatch
3. Verificar variables de entorno
4. Comprobar permisos IAM
```

## 📚 Recursos Adicionales

- [AWS CLI Documentation](https://docs.aws.amazon.com/cli/)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [DynamoDB Best Practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html)

---

**Última actualización**: 2026-02-05  
**Versión**: 2.2.0
