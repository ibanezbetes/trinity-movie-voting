# Infrastructure Scripts

Scripts de utilidad para la gestión de la infraestructura Trinity.

## 📜 Scripts Disponibles

### generate-mobile-config.js
Genera automáticamente la configuración AWS para la aplicación móvil basándose en los outputs del stack de CloudFormation.

**Uso:**
```bash
node scripts/generate-mobile-config.js
```

**Qué hace:**
- Lee los outputs del stack `TrinityStack`
- Genera el archivo `mobile/src/config/aws-config.ts`
- Configura automáticamente:
  - Cognito User Pool ID y Client ID
  - AppSync GraphQL endpoint
  - Región AWS

**Cuándo usar:**
- Después de cada deployment
- Cuando cambien los recursos AWS
- Al configurar un nuevo entorno

### update-mobile-config.js
Actualiza la configuración móvil existente con los valores actuales de AWS.

**Uso:**
```bash
node scripts/update-mobile-config.js
```

**Qué hace:**
- Similar a `generate-mobile-config.js` pero preserva configuraciones personalizadas
- Actualiza solo los valores que han cambiado
- Mantiene comentarios y formato del archivo

**Cuándo usar:**
- Para actualizaciones incrementales
- Cuando solo algunos valores han cambiado
- En entornos de desarrollo

## 🚀 Ejecución Automática

Estos scripts se ejecutan automáticamente:

### Durante Deployment
```bash
# El script deploy.bat ejecuta automáticamente:
npm run deploy
npm run generate-config
```

### Manualmente
```bash
# Generar configuración
npm run generate-config

# Actualizar configuración
npm run update-config
```

## 🔧 Configuración

### Variables de Entorno Requeridas

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_PROFILE=default

# Stack Configuration
STACK_NAME=TrinityStack  # Por defecto
```

### Archivos Generados

```
mobile/src/config/aws-config.ts
```

Ejemplo del archivo generado:
```typescript
export const awsConfig = {
  Auth: {
    region: 'us-east-1',
    userPoolId: 'us-east-1_xxxxxxxxx',
    userPoolWebClientId: 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
  },
  API: {
    GraphQL: {
      endpoint: 'https://xxxxxxxxxxxxxxxxxxxxxxxxxx.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
      defaultAuthMode: 'userPool',
    },
  },
};
```

## 🐛 Troubleshooting

### Error: Stack not found
```bash
# Verificar que el stack existe
aws cloudformation describe-stacks --stack-name TrinityStack

# Verificar región correcta
aws configure get region
```

### Error: Access denied
```bash
# Verificar credenciales AWS
aws sts get-caller-identity

# Verificar permisos CloudFormation
aws iam get-user
```

### Error: File not found
```bash
# Verificar estructura de directorios
ls -la mobile/src/config/

# Crear directorio si no existe
mkdir -p mobile/src/config/
```

## 📚 Dependencias

### Node.js Packages
- `@aws-sdk/client-cloudformation` - Para leer outputs del stack
- `fs` - Para escribir archivos de configuración
- `path` - Para manejo de rutas

### AWS CLI
Los scripts requieren AWS CLI configurado:
```bash
aws configure
```

### Permisos IAM Requeridos
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:DescribeStacks"
      ],
      "Resource": "arn:aws:cloudformation:*:*:stack/TrinityStack/*"
    }
  ]
}
```

---

Para más información, consultar la [documentación principal](../README.md).