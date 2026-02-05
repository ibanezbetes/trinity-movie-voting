# 🚨 TMDB Lambda Error - Diagnóstico y Solución

## ❌ Error Actual
```
Failed to fetch movie candidates: Error: TMDB Lambda error: undefined
```

## 🔍 Posibles Causas

### 1. Variable de Entorno TMDB_API_KEY No Configurada
**Más Probable** - La función Lambda no tiene acceso a la API key de TMDB.

### 2. Función Lambda No Actualizada
La función sigue usando el código anterior sin Smart Random Discovery.

### 3. Permisos o Configuración Incorrecta
Problemas de IAM o configuración de la función.

## 🛠️ Solución Paso a Paso

### PASO 1: Verificar Variables de Entorno (CRÍTICO)

1. **Ir a AWS Lambda Console**
   - https://console.aws.amazon.com/lambda/
   - Región: eu-west-1

2. **Buscar función TmdbHandler**
   - Nombre: `TrinityStack-TmdbHandlerE269C7B6-*`

3. **Verificar Variables de Entorno**
   - Ir a pestaña "Configuration" → "Environment variables"
   - **Debe existir:** `TMDB_API_KEY` con tu API key de TMDB
   - **Si no existe:** Añadir la variable

#### ¿Cómo obtener TMDB API Key?
1. Ir a https://www.themoviedb.org/
2. Crear cuenta / Login
3. Ir a Settings → API
4. Copiar "API Read Access Token" (Bearer token)

### PASO 2: Actualizar Función con Mejor Manejo de Errores

1. **Subir nuevo ZIP**
   - Usar: `tmdb-handler-fixed-v2.zip` (versión mejorada)
   - Pestaña "Code" → "Upload from" → ".zip file"

2. **Verificar configuración**
   - Handler: `index.handler`
   - Runtime: Node.js 18.x
   - Timeout: 30 segundos

### PASO 3: Test Manual de la Función

1. **Crear test event**
   - Pestaña "Test"
   - Event name: `test-movie-discovery`
   - Event JSON:
```json
{
  "mediaType": "MOVIE",
  "genreIds": [28, 12]
}
```

2. **Ejecutar test**
   - Clic "Test"
   - **Resultado esperado:** 200 status con ~50 candidatos

### PASO 4: Verificar Logs Detallados

1. **Ir a CloudWatch Logs**
   - Log group: `/aws/lambda/TrinityStack-TmdbHandlerE269C7B6-*`

2. **Buscar mensajes de error**
   - "TMDB token not configured"
   - "Available env vars"
   - "Token configured: NO"

## 🔧 Configuración Correcta de Variables de Entorno

### En AWS Lambda Console:

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `TMDB_API_KEY` | `eyJhbGciOiJIUzI1NiJ9...` | Bearer token de TMDB |
| `TMDB_BASE_URL` | `https://api.themoviedb.org/3` | (Opcional) |

### ⚠️ IMPORTANTE: Formato del Token
- **Correcto:** `eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiI...` (Bearer token completo)
- **Incorrecto:** Solo el API key corto

## 📊 Verificación de Éxito

### ✅ Logs Correctos en CloudWatch:
```
TMDBClient initializing...
Base URL: https://api.themoviedb.org/3
Token configured: YES
Token length: 200+
Starting Smart Random Discovery for MOVIE with genres: 28,12
STEP A: Priority search with ALL genres (AND logic)
```

### ✅ Respuesta Correcta del Test:
```json
{
  "statusCode": 200,
  "body": {
    "candidates": [...], // Array con ~50 elementos
    "totalResults": 50,
    "page": 1
  }
}
```

## 🚨 Troubleshooting Específico

### Error: "TMDB token not configured"
**Solución:** Añadir variable `TMDB_API_KEY` en Lambda

### Error: "401 Unauthorized"
**Solución:** Verificar que el token TMDB sea válido y completo

### Error: "Timeout"
**Solución:** Aumentar timeout de Lambda a 30 segundos

### Error: "Cannot find module 'axios'"
**Solución:** Subir el ZIP correcto con dependencias

## 🔄 Script de Verificación Rápida

```bash
# Verificar función existe
aws lambda get-function --function-name TrinityStack-TmdbHandlerE269C7B6-XXXXXXXXXX --region eu-west-1

# Verificar variables de entorno
aws lambda get-function-configuration --function-name TrinityStack-TmdbHandlerE269C7B6-XXXXXXXXXX --region eu-west-1 --query 'Environment.Variables'

# Test manual
aws lambda invoke --function-name TrinityStack-TmdbHandlerE269C7B6-XXXXXXXXXX --region eu-west-1 --payload '{"mediaType":"MOVIE","genreIds":[28,12]}' response.json
```

## 📝 Checklist de Solución

- [ ] Variable `TMDB_API_KEY` configurada en Lambda
- [ ] Token TMDB válido (Bearer token completo)
- [ ] Función actualizada con `tmdb-handler-fixed-v2.zip`
- [ ] Test manual ejecutado exitosamente
- [ ] Logs muestran "Token configured: YES"
- [ ] Respuesta contiene ~50 candidatos

## ⚡ Solución Rápida (2 minutos)

1. **AWS Lambda Console** → Buscar `TmdbHandler`
2. **Configuration** → **Environment variables** → **Edit**
3. **Add environment variable:**
   - Key: `TMDB_API_KEY`
   - Value: `[TU_BEARER_TOKEN_DE_TMDB]`
4. **Save**
5. **Probar crear sala** en la app

---

## 🎯 Resultado Esperado

Después de configurar `TMDB_API_KEY`, la creación de salas debería funcionar correctamente con ~50 candidatos variados por sala.

**¡El error "undefined" se resolverá inmediatamente!**