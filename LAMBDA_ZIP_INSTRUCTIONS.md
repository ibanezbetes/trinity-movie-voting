# INSTRUCCIONES PARA SUBIR EL ZIP DE LA LAMBDA

## 🚨 ARCHIVO LISTO PARA SUBIR

**Archivo:** `vote-handler-ROOM-PERSISTENCE-FIX.zip`

## 📋 PASOS PARA ACTUALIZAR LA LAMBDA

### 1. Subir el ZIP manualmente:
```bash
aws lambda update-function-code --function-name trinity-vote-handler --zip-file fileb://vote-handler-ROOM-PERSISTENCE-FIX.zip
```

### 2. Verificar que se actualizó:
```bash
aws lambda get-function --function-name trinity-vote-handler --query "Configuration.LastModified"
```

## ✅ CONTENIDO DEL ZIP VERIFICADO

El ZIP contiene el código con el **FIX DE PERSISTENCIA DE SALAS**:

```javascript
// DISABLED: Do not delete room after match - let it remain active
// This prevents "Room not found" errors for users who vote after match is created
// await this.deleteRoom(roomId);

console.log(`Match created but room ${roomId} kept active to prevent "Room not found" errors`);
```

## 🎯 RESULTADO ESPERADO

Después de subir este ZIP:

1. **Las salas NO se eliminarán** después de crear matches
2. **Los usuarios podrán seguir votando** sin errores "Room not found"
3. **Múltiples matches posibles** en la misma sala
4. **Experiencia de usuario fluida** sin interrupciones

## 🔍 VERIFICACIÓN EN CLOUDWATCH

Después de la actualización, los logs deberían mostrar:

```
MATCH DETECTED! All X users voted positively for movie XXXXX
🔔 INICIANDO BROADCAST REAL para sala: [roomId]
🚀 NUEVA IMPLEMENTACION v2: Usando llamada HTTP directa a AppSync
✅ BROADCAST EXITOSO: AppSync ha recibido la orden de notificar.
Match created but room [roomId] kept active to prevent "Room not found" errors
```

**IMPORTANTE:** Ya NO debe aparecer `Room [roomId] deleted after match creation`

---
**Fecha:** 3 de Febrero, 2026 - 02:35:00 UTC  
**Archivo:** `vote-handler-ROOM-PERSISTENCE-FIX.zip`  
**Función:** `trinity-vote-handler`  
**Fix:** Persistencia de salas después de matches  
**Estado:** LISTO PARA SUBIR MANUALMENTE