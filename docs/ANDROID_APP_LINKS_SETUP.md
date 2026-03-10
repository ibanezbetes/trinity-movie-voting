# Android App Links - Guía Completa de Configuración

**Versión**: 1.0.8 (versionCode 14)  
**Fecha**: 2026-03-10  
**Estado**: ✅ Configuración completa - Listo para deployment

## 📋 Resumen

Android App Links permite que los enlaces `https://trinity-app.es/room/{CODE}` abran la app directamente sin pasar por el navegador, proporcionando una experiencia de usuario fluida y nativa.

## ✅ Configuración Actual

### 1. Archivo assetlinks.json

**Ubicación**: `web/.well-known/assetlinks.json`  
**URL Pública**: `https://trinity-app.es/.well-known/assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.trinityapp.mobile",
      "sha256_cert_fingerprints": [
        "FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C",
        "33:79:58:38:1D:54:97:04:6C:81:8A:5D:EB:46:42:99:76:57:45:DD:26:A4:44:DD:F7:4B:1A:96:8B:49:5C:12",
        "F9:75:E8:C1:B7:6A:BE:A3:D3:29:65:98:CC:E3:20:DA:6D:4A:97:3E:B9:9B:2E:72:57:93:F1:54:7A:CE:EC:61"
      ]
    }
  }
]
```

**Fingerprints incluidos**:
- Debug keystore (desarrollo local)
- Release keystore (builds manuales)
- Google Play Store (builds de producción)

### 2. Configuración en app.json

**Archivo**: `mobile/app.json`

```json
{
  "android": {
    "intentFilters": [
      {
        "action": "VIEW",
        "autoVerify": true,
        "data": [
          {
            "scheme": "https",
            "host": "trinity-app.es",
            "pathPattern": "/room/.*"
          }
        ],
        "category": ["BROWSABLE", "DEFAULT"]
      }
    ]
  }
}
```

**Parámetros clave**:
- `autoVerify: true` - Android verifica automáticamente el dominio
- `pathPattern: "/room/.*"` - Coincide con cualquier código de sala
- `scheme: "https"` - Solo enlaces HTTPS (más seguros)

### 3. Manejo de Deep Links en App.tsx

**Archivo**: `mobile/App.tsx`

```typescript
// Detecta enlaces de sala: https://trinity-app.es/room/{CODE}
const roomLinkMatch = event.url.match(/(?:trinity-app\.es|myapp:)\/room\/([A-Z0-9]{6})/i);

if (roomLinkMatch) {
  const roomCode = roomLinkMatch[1].toUpperCase();
  
  // Guarda el código para unirse después de autenticación
  await AsyncStorage.setItem('@trinity_pending_room_code', roomCode);
}
```

### 4. Navegación Automática en AppNavigator.tsx

**Archivo**: `mobile/src/navigation/AppNavigator.tsx`

```typescript
React.useEffect(() => {
  if (pendingRoomCode && navigationRef.current) {
    // Navega a JoinRoom con el código pendiente
    setTimeout(() => {
      navigationRef.current?.navigate('JoinRoom', { 
        initialRoomCode: pendingRoomCode 
      });
    }, 500);
  }
}, [pendingRoomCode]);
```

### 5. Auto-Join en JoinRoomScreen.tsx

**Archivo**: `mobile/src/screens/JoinRoomScreen.tsx`

```typescript
// Si hay código inicial, auto-join
useEffect(() => {
  if (initialRoomCode) {
    setRoomCode(initialRoomCode);
    handleJoinRoom(initialRoomCode);
  }
}, [initialRoomCode]);
```

## 🚀 Proceso de Deployment

### Paso 1: Build de la App

```bash
cd mobile

# Incrementar versionCode en build.gradle si es necesario
# Actualmente: versionCode 14

# Build para Play Store
npx eas build --platform android --profile production
```

### Paso 2: Subir a Google Play Store

1. Ir a [Google Play Console](https://play.google.com/console)
2. Seleccionar Trinity App
3. Ir a "Producción" → "Crear nueva versión"
4. Subir el AAB generado (versionCode 14)
5. Completar notas de versión
6. Enviar para revisión

### Paso 3: Deploy del Website

```bash
cd web

# Verificar que assetlinks.json existe
ls -la .well-known/assetlinks.json

# Deploy a AWS S3
aws s3 sync . s3://trinity-app-web --delete --exclude ".git/*"

# Invalidar caché de CloudFront
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/.well-known/assetlinks.json"
```

### Paso 4: Verificación Post-Deployment

```bash
# Verificar que assetlinks.json es accesible
curl https://trinity-app.es/.well-known/assetlinks.json

# Debe retornar HTTP 200 con el JSON correcto
```

## 🔍 Verificación de App Links

### Método 1: Script Automático (Recomendado)

```powershell
cd mobile
./verify-app-links.ps1
```

El script:
- ✅ Verifica que ADB está instalado
- ✅ Verifica que hay un dispositivo conectado
- ✅ Muestra el estado actual de App Links
- ✅ Permite forzar re-verificación
- ✅ Verifica que assetlinks.json es accesible
- ✅ Permite probar deep links

### Método 2: Comandos ADB Manuales

```bash
# Ver estado actual
adb shell pm get-app-links com.trinityapp.mobile

# Debe mostrar:
# trinity-app.es: verified

# Si muestra "none" o "legacy_failure", forzar verificación:
adb shell pm set-app-links --package com.trinityapp.mobile 0 all
adb shell pm verify-app-links --re-verify com.trinityapp.mobile

# Esperar 5-10 segundos y verificar de nuevo
adb shell pm get-app-links com.trinityapp.mobile
```

### Método 3: Configuración Manual

Si los comandos ADB no funcionan:

1. Abrir "Ajustes" en el teléfono
2. Ir a "Apps" → "Trinity"
3. Ir a "Abrir por defecto"
4. Activar "Abrir enlaces admitidos"
5. Verificar que `trinity-app.es` está en la lista

## 🧪 Testing

### Test 1: Verificar assetlinks.json

```bash
curl -I https://trinity-app.es/.well-known/assetlinks.json

# Debe retornar:
# HTTP/2 200
# content-type: application/json
```

### Test 2: Probar Deep Link con ADB

```bash
# Probar con código de sala real
adb shell am start -W -a android.intent.action.VIEW \
  -d "https://trinity-app.es/room/ABC123" \
  com.trinityapp.mobile

# La app debe:
# 1. Abrirse automáticamente
# 2. Navegar a JoinRoomScreen
# 3. Auto-unirse a la sala ABC123
```

### Test 3: Probar Compartir Sala

1. Abrir Trinity en el teléfono
2. Crear una sala
3. Hacer clic en el botón de compartir (header)
4. Seleccionar "Compartir enlace"
5. Compartir por WhatsApp/Telegram/etc.
6. En otro dispositivo, hacer clic en el enlace
7. Verificar que:
   - La app se abre directamente (sin navegador)
   - Se une automáticamente a la sala

### Test 4: Probar con Usuario No Autenticado

1. Cerrar sesión en Trinity
2. Hacer clic en un enlace de sala
3. Verificar que:
   - La app se abre
   - Muestra pantalla de login
   - Después de login, se une automáticamente a la sala

## 🐛 Troubleshooting

### Problema 1: El enlace abre el navegador en lugar de la app

**Causa**: Android no ha verificado el dominio

**Solución**:
```bash
# Forzar verificación
cd mobile
./verify-app-links.ps1

# Elegir "S" cuando pregunte si quiere forzar verificación
```

### Problema 2: "trinity-app.es: none" en get-app-links

**Causa**: La verificación falló

**Posibles razones**:
- assetlinks.json no es accesible (verificar con curl)
- Fingerprint incorrecto en assetlinks.json
- App no tiene autoVerify: true

**Solución**:
1. Verificar que assetlinks.json es accesible
2. Verificar que contiene el fingerprint correcto
3. Reinstalar la app desde Play Store
4. Esperar 5-10 minutos para que Android verifique

### Problema 3: La app se abre pero no navega a la sala

**Causa**: Problema en el flujo de navegación

**Solución**:
1. Verificar logs en Logcat:
```bash
adb logcat | grep -i "trinity\|deep\|link"
```

2. Verificar que `pendingRoomCode` se está pasando correctamente
3. Verificar que `JoinRoomScreen` recibe `initialRoomCode`

### Problema 4: "legacy_failure" en get-app-links

**Causa**: Android intentó verificar pero falló

**Solución**:
1. Verificar que assetlinks.json tiene el fingerprint correcto:
```bash
# Obtener fingerprint de la app instalada
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android | grep SHA256
```

2. Comparar con el fingerprint en assetlinks.json
3. Si no coinciden, actualizar assetlinks.json y re-deployar

## 📊 Verificación de Estado

### Checklist Pre-Deployment

- [ ] `assetlinks.json` existe en `web/.well-known/`
- [ ] Contiene los 3 fingerprints (Debug, Release, Play Store)
- [ ] `app.json` tiene `autoVerify: true`
- [ ] `pathPattern` es `/room/.*`
- [ ] `App.tsx` detecta enlaces de sala
- [ ] `AppNavigator.tsx` navega con `pendingRoomCode`
- [ ] `JoinRoomScreen.tsx` auto-join con `initialRoomCode`
- [ ] versionCode incrementado en `build.gradle`

### Checklist Post-Deployment

- [ ] assetlinks.json es accesible en `https://trinity-app.es/.well-known/assetlinks.json`
- [ ] Retorna HTTP 200
- [ ] Content-Type es `application/json`
- [ ] App instalada desde Play Store
- [ ] `adb shell pm get-app-links` muestra "verified"
- [ ] Test con ADB funciona correctamente
- [ ] Test compartiendo sala funciona correctamente

## 🔐 Seguridad

### Fingerprints

Los fingerprints SHA-256 son críticos para la seguridad:

- **Debug**: Solo para desarrollo local
- **Release**: Para builds manuales de testing
- **Play Store**: Para builds de producción

**NUNCA** compartir keystores o fingerprints públicamente.

### HTTPS Only

Android App Links solo funciona con HTTPS, no HTTP. Esto asegura:
- Comunicación encriptada
- Verificación de dominio
- Protección contra ataques MITM

## 📚 Referencias

- [Android App Links Documentation](https://developer.android.com/training/app-links)
- [Verify Android App Links](https://developer.android.com/training/app-links/verify-android-applinks)
- [Digital Asset Links](https://developers.google.com/digital-asset-links/v1/getting-started)

## 🎯 Próximos Pasos

1. **Subir versionCode 14 a Play Store**
   - Build ya generado con `npx eas build`
   - Subir AAB a Google Play Console
   - Esperar aprobación (1-3 días)

2. **Verificar assetlinks.json en producción**
   - Confirmar que es accesible
   - Verificar que CloudFront no está cacheando incorrectamente

3. **Testing Post-Release**
   - Instalar desde Play Store
   - Verificar App Links con script
   - Probar compartir sala end-to-end

4. **Monitoreo**
   - Verificar logs de CloudWatch
   - Monitorear errores de deep linking
   - Recopilar feedback de usuarios

---

**Última actualización**: 2026-03-10  
**Versión de la app**: 1.0.8 (versionCode 14)  
**Estado**: ✅ Listo para deployment
