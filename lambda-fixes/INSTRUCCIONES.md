# 🔧 INSTRUCCIONES ACTUALIZADAS PARA LAMBDA FUNCTIONS

## 📁 Archivos Corregidos

- `room-handler.zip` - Para Room Handler Lambda (contiene index.js + package.json)
- `match-handler.zip` - Para Match Handler Lambda (contiene match-index.js renombrado como index.js + package.json)

## 🚀 PASOS CORREGIDOS

### 1. Room Handler Lambda

1. Ve a AWS Console → Lambda Functions
2. Busca la función: `TrinityStack-RoomHandlerCF7B6EB0-*`
3. En la pestaña "Code", haz clic en "Upload from" → ".zip file"
4. Sube el archivo `room-handler.zip`
5. **IMPORTANTE**: En "Runtime settings", el Handler debe ser: `index.handler`
6. Haz clic en "Deploy"

### 2. Match Handler Lambda

1. Ve a AWS Console → Lambda Functions  
2. Busca la función: `TrinityStack-MatchHandler04464E10-*`
3. En la pestaña "Code", haz clic en "Upload from" → ".zip file"
4. Sube el archivo `match-handler.zip`
5. **IMPORTANTE**: En "Runtime settings", el Handler debe ser: `index.handler`
6. Haz clic en "Deploy"

## ✅ VERIFICACIÓN RÁPIDA

Después de subir los archivos:

1. **Probar Room Creation**: Intenta crear una sala en la app
2. **Verificar Logs**: Deberías ver en CloudWatch:
   ```
   Field name: createRoom
   Processing createRoom mutation
   Room created successfully: [roomId] with code: [code]
   ```
3. **Confirmar Funcionamiento**: La creación de salas debería funcionar sin errores

## 🔧 PROBLEMA SOLUCIONADO

- ❌ **Error anterior**: `"Cannot find module 'index'"`
- ✅ **Solución**: Creados archivos `index.js` específicos para cada Lambda
- ✅ **Handler correcto**: `index.handler` (no nombres personalizados)

## 📋 Si Aún Hay Problemas

Si después de subir los ZIP files sigues viendo errores:

1. **Verifica el Handler**: Debe ser exactamente `index.handler`
2. **Verifica el Runtime**: Debe ser `Node.js 18.x` o superior
3. **Verifica Variables de Entorno**:
   - `ROOMS_TABLE` = trinity-rooms
   - `VOTES_TABLE` = trinity-votes  
   - `MATCHES_TABLE` = trinity-matches
   - `TMDB_LAMBDA_ARN` = ARN de la función TMDB

## 🎯 RESULTADO ESPERADO

Después de la actualización correcta:
- ✅ La creación de salas funcionará
- ✅ No más errores "Cannot find module"
- ✅ Los logs mostrarán "Processing createRoom mutation"
- ✅ La app podrá crear salas con códigos únicos