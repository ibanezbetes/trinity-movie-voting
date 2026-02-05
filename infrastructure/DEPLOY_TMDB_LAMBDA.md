# 🚀 Deploy TMDB Lambda - Quick Guide

## ✅ Archivos Listos para Deployment

El ZIP actualizado está en:
```
infrastructure/lambda-zips/tmdb-handler.zip (851.42 KB)
```

## 📋 Pasos de Deployment

### Opción 1: AWS Console (Recomendado)

1. **Ir a AWS Lambda Console**
   ```
   https://console.aws.amazon.com/lambda/
   ```

2. **Buscar la función TMDB**
   - Nombre probable: `TmdbHandler` o `trinity-TmdbHandler`
   - Región: `eu-west-1` (verificar en tu configuración)

3. **Subir el ZIP**
   - Click en la función
   - Tab "Code" → "Upload from" → ".zip file"
   - Seleccionar: `infrastructure/lambda-zips/tmdb-handler.zip`
   - Click "Save"

4. **Verificar Variables de Entorno**
   - Tab "Configuration" → "Environment variables"
   - Verificar que existan:
     ```
     TMDB_READ_TOKEN = tu_token_aquí
     TMDB_BASE_URL = https://api.themoviedb.org/3
     ```

5. **Probar**
   - Crear una sala nueva en la app móvil
   - Verificar que las películas son diferentes
   - Crear otra sala → películas diferentes de nuevo

### Opción 2: AWS CLI

```bash
# Desde la carpeta infrastructure/

# 1. Obtener el nombre exacto de la función
aws lambda list-functions --query "Functions[?contains(FunctionName, 'Tmdb')].FunctionName" --output text

# 2. Subir el ZIP (reemplazar FUNCTION_NAME con el nombre real)
aws lambda update-function-code \
  --function-name FUNCTION_NAME \
  --zip-file fileb://lambda-zips/tmdb-handler.zip \
  --region eu-west-1

# 3. Verificar que se actualizó
aws lambda get-function --function-name FUNCTION_NAME --region eu-west-1
```

### Opción 3: CDK Deploy (Completo)

```bash
# Desde la carpeta infrastructure/

# 1. Compilar TypeScript
npm run build

# 2. Deploy completo del stack
cdk deploy

# Nota: Esto desplegará TODAS las Lambdas, no solo TMDB
```

## 🧪 Verificación Post-Deployment

### 1. Verificar en CloudWatch Logs

```bash
# Ver logs recientes de la Lambda
aws logs tail /aws/lambda/FUNCTION_NAME --follow --region eu-west-1
```

Buscar en los logs:
```
✅ Smart Random Discovery complete: 50 candidates (target: 50)
   Phases executed: X, Unique IDs: 50
```

### 2. Test Manual en la App

1. Abrir la app móvil Trinity
2. Crear una sala nueva:
   - Tipo: Película
   - Géneros: Acción + Aventura
3. Verificar que aparecen películas variadas (no siempre "Zootrópolis 2")
4. Crear otra sala con los mismos géneros
5. Verificar que las películas son DIFERENTES

### 3. Test con Logs Detallados

Crear sala y revisar CloudWatch Logs para ver:
```
PHASE 1: Strict search with ALL genres (AND logic)
  → Fetching page 37 with AND logic
  → Phase 1 found 18 candidates (total: 18)
PHASE 2: Fallback search with ANY genre (OR logic) - need 32 more
  → Fetching page 12 with OR logic
  → Phase 2 added 20 results (total: 38)
PHASE 3 (Attempt 1): Additional fetch - need 12 more
  → Fetching page 45
  → Phase 3 added 12 new candidates (total: 50)
```

## ⚠️ Troubleshooting

### Error: "TMDB token not configured"

**Solución**: Verificar variables de entorno en AWS Lambda Console
```bash
# Verificar con CLI
aws lambda get-function-configuration \
  --function-name FUNCTION_NAME \
  --region eu-west-1 \
  --query 'Environment.Variables'
```

### Error: "Module not found: axios"

**Solución**: El ZIP debe incluir `node_modules`. Regenerar:
```bash
cd infrastructure
.\create-zips.ps1
```

### Películas siguen siendo las mismas

**Posibles causas**:
1. El ZIP no se subió correctamente
2. La app móvil tiene cache
3. La Lambda antigua sigue activa

**Solución**:
```bash
# Verificar versión de la Lambda
aws lambda get-function --function-name FUNCTION_NAME --region eu-west-1 --query 'Configuration.LastModified'

# Forzar actualización
aws lambda update-function-configuration \
  --function-name FUNCTION_NAME \
  --region eu-west-1 \
  --description "Smart Random Discovery v2.0"
```

## 📊 Métricas Esperadas

Después del deployment, deberías ver:

- **Invocaciones**: Aumentan con cada creación de sala
- **Duración**: ~2-5 segundos (3 fases de búsqueda)
- **Errores**: 0% (si todo está configurado correctamente)
- **Logs**: Mensajes detallados de cada fase

## 🎯 Resultado Final

✅ Cada sala tendrá 50 películas únicas  
✅ Páginas aleatorias 1-50 de TMDB  
✅ Orden aleatorio (shuffle)  
✅ Lógica AND + OR para máxima cobertura  
✅ Variedad garantizada entre salas  

---

**Documentación completa**: `docs/SMART_RANDOM_DISCOVERY_ENHANCED.md`
