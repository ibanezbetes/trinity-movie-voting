# 🔗 Deep Linking Testing Guide - Estilo Playtomic

## 📋 Resumen

Trinity ya tiene implementado deep linking completo estilo Playtomic. Este documento explica cómo funciona y cómo probarlo.

## 🎯 Comportamiento Esperado

### Escenario 1: Usuario CON app instalada
```
Usuario recibe: https://trinity-app.es/room/ABC123
Click en enlace → App se abre automáticamente → Auto-join a sala ABC123
```

### Escenario 2: Usuario SIN app instalada
```
Usuario recibe: https://trinity-app.es/room/ABC123
Click en enlace → Página web con botón "Abrir Trinity" → Redirige a Play Store
```

### Escenario 3: Usuario abre en navegador
```
Usuario escribe: https://trinity-app.es/room/ABC123
Navegador muestra: Página web con código ABC123 y botón para abrir app
```

## ✅ Checklist de Implementación

### 1. Configuración Web ✅

- [x] **room.html**: Página de redirección con JavaScript
- [x] **.htaccess**: Rewrite rules para Apache
- [x] **cloudfront-function.js**: Rewrite para CloudFront/CDN
- [x] **.well-known/assetlinks.json**: Verificación de dominio Android

### 2. Configuración Mobile ✅

- [x] **app.json**: Intent filters para Android App Links
- [x] **App.tsx**: Detección de deep links con Linking API
- [x] **AppNavigator.tsx**: Navegación con código pendiente
- [x] **JoinRoomScreen.tsx**: Auto-join con código inicial

### 3. Configuración Backend ✅

- [x] **Room Handler**: Soporte para códigos de 6 caracteres
- [x] **GraphQL**: Mutation joinRoom funcional

## 🧪 Cómo Probar

### Paso 1: Verificar assetlinks.json

```bash
# Debe estar accesible públicamente
curl https://trinity-app.es/.well-known/assetlinks.json

# Debe devolver JSON con tus fingerprints
```

**Contenido esperado**:
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

### Paso 2: Verificar room.html

```bash
# Debe estar accesible
curl https://trinity-app.es/room.html

# O visitar en navegador
# https://trinity-app.es/room/TEST12
```

### Paso 3: Probar en Android

#### A. Con ADB (Desarrollo)

```bash
# Simular click en enlace
adb shell am start -a android.intent.action.VIEW -d "https://trinity-app.es/room/ABC123"

# Verificar logs
adb logcat | grep -i trinity
```

#### B. Con WhatsApp (Real)

1. Crear sala en la app → Obtener código (ej: ABC123)
2. Compartir enlace por WhatsApp: `https://trinity-app.es/room/ABC123`
3. Abrir WhatsApp en otro dispositivo
4. Click en el enlace
5. **Resultado esperado**: App se abre y auto-join a la sala

#### C. Con Navegador (Fallback)

1. Abrir Chrome en Android
2. Escribir: `https://trinity-app.es/room/ABC123`
3. **Resultado esperado**: Página web con botón "Abrir Trinity"
4. Click en botón → App se abre

### Paso 4: Verificar Android App Links

```bash
# Verificar que el dominio esté verificado
adb shell pm get-app-links com.trinityapp.mobile

# Debe mostrar:
# com.trinityapp.mobile:
#   ID: ...
#   Signatures: ...
#   Domain verification state:
#     trinity-app.es: verified
```

## 🔧 Troubleshooting

### Problema 1: App no se abre automáticamente

**Causa**: Android App Links no verificado

**Solución**:
1. Verificar que assetlinks.json esté en `https://trinity-app.es/.well-known/assetlinks.json`
2. Verificar que los fingerprints sean correctos
3. Reinstalar la app (Android cachea la verificación)
4. Esperar 24-48h para que Google verifique el dominio

**Verificar fingerprints**:
```bash
# Debug keystore
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android

# Release keystore
keytool -list -v -keystore path/to/release.keystore -alias your-alias

# Google Play (desde Play Console)
# App Integrity → App Signing → SHA-256 certificate fingerprint
```

### Problema 2: Página web no carga

**Causa**: Rewrite rules no configuradas

**Solución Apache (.htaccess)**:
```apache
RewriteEngine On
RewriteRule ^room/([A-Z0-9]{6})$ /room.html [L,QSA]
```

**Solución CloudFront (Function)**:
```javascript
function handler(event) {
    var request = event.request;
    var uri = request.uri;
    
    if (uri.match(/^\/room\/[A-Z0-9]{6}$/i)) {
        request.uri = '/room.html';
    }
    
    return request;
}
```

**Solución Netlify (netlify.toml)**:
```toml
[[redirects]]
  from = "/room/:code"
  to = "/room.html"
  status = 200
```

### Problema 3: Auto-join no funciona

**Causa**: Código no se pasa correctamente

**Verificar logs en App.tsx**:
```typescript
// Debe aparecer en logs
logger.auth('Room deep link detected', { roomCode, url: event.url });
logger.auth('Room code stored for pending join', { roomCode });
```

**Verificar logs en JoinRoomScreen**:
```typescript
// Debe aparecer en logs
logger.userAction('Initial room code received from deep link', { roomCode: initialRoomCode });
```

## 📱 Flujo Técnico Completo

### 1. Usuario hace click en enlace

```
WhatsApp/SMS: https://trinity-app.es/room/ABC123
```

### 2. Android verifica App Links

```
Android System:
  ¿Está verificado trinity-app.es para com.trinityapp.mobile?
  → Sí (assetlinks.json válido)
  → Abrir app directamente
```

### 3. App recibe deep link

```typescript
// App.tsx - Linking.addEventListener
const roomLinkMatch = event.url.match(/(?:trinity-app\.es|myapp:)\/room\/([A-Z0-9]{6})/i);
if (roomLinkMatch) {
  const roomCode = roomLinkMatch[1].toUpperCase(); // "ABC123"
  await AsyncStorage.setItem('@trinity_pending_room_code', roomCode);
}
```

### 4. AppNavigator navega a JoinRoom

```typescript
// AppNavigator.tsx
React.useEffect(() => {
  if (pendingRoomCode && navigationRef.current) {
    navigationRef.current?.navigate('JoinRoom', { 
      initialRoomCode: pendingRoomCode 
    });
  }
}, [pendingRoomCode]);
```

### 5. JoinRoomScreen auto-join

```typescript
// JoinRoomScreen.tsx
React.useEffect(() => {
  const initialRoomCode = route.params?.initialRoomCode;
  if (initialRoomCode) {
    setRoomCode(initialRoomCode);
    setTimeout(() => {
      handleJoinRoom(initialRoomCode);
    }, 500);
  }
}, [route.params?.initialRoomCode]);
```

### 6. Usuario entra a la sala

```
VotingRoomScreen con roomId y roomCode
```

## 🌐 Configuración de Servidor Web

### Apache (.htaccess)

Ya configurado en `web/.htaccess`:
```apache
RewriteEngine On
RewriteRule ^room/([A-Z0-9]{6})$ /room.html [L,QSA]
```

### Nginx

Si usas Nginx, agregar a configuración:
```nginx
location ~ ^/room/([A-Z0-9]{6})$ {
    rewrite ^/room/([A-Z0-9]{6})$ /room.html last;
}
```

### CloudFront

Ya configurado en `web/cloudfront-function.js`:
```javascript
function handler(event) {
    var request = event.request;
    var uri = request.uri;
    
    if (uri.match(/^\/room\/[A-Z0-9]{6}$/i)) {
        request.uri = '/room.html';
    }
    
    return request;
}
```

### Netlify

Crear `web/netlify.toml`:
```toml
[[redirects]]
  from = "/room/:code"
  to = "/room.html"
  status = 200

[[headers]]
  for = "/.well-known/assetlinks.json"
  [headers.values]
    Content-Type = "application/json"
    Access-Control-Allow-Origin = "*"
```

### Vercel

Crear `web/vercel.json`:
```json
{
  "rewrites": [
    {
      "source": "/room/:code",
      "destination": "/room.html"
    }
  ],
  "headers": [
    {
      "source": "/.well-known/assetlinks.json",
      "headers": [
        {
          "key": "Content-Type",
          "value": "application/json"
        }
      ]
    }
  ]
}
```

## 🎯 Checklist Final

Antes de lanzar a producción:

- [ ] assetlinks.json accesible en `https://trinity-app.es/.well-known/assetlinks.json`
- [ ] Fingerprints correctos (Debug, Release, Google Play)
- [ ] room.html accesible en `https://trinity-app.es/room.html`
- [ ] Rewrite rules funcionando (`/room/ABC123` → `/room.html`)
- [ ] App instalada en dispositivo de prueba
- [ ] Probar con enlace real en WhatsApp
- [ ] Probar con enlace en navegador
- [ ] Verificar auto-join funciona
- [ ] Verificar fallback a Play Store si app no instalada

## 📊 Métricas de Éxito

- ✅ 90%+ de usuarios con app instalada → Auto-join directo
- ✅ 10%- de usuarios sin app → Redirigidos a Play Store
- ✅ 0 errores de navegación o deep linking
- ✅ Tiempo de auto-join < 2 segundos

## 🚀 Deployment

### 1. Subir archivos web

```bash
cd web

# Netlify
netlify deploy --prod

# Vercel
vercel --prod

# AWS S3 + CloudFront
aws s3 sync . s3://trinity-app-web --delete
aws cloudfront create-invalidation --distribution-id YOUR_ID --paths "/*"
```

### 2. Verificar assetlinks.json

```bash
curl https://trinity-app.es/.well-known/assetlinks.json
```

### 3. Build y deploy app

```bash
cd mobile

# Build production
eas build --platform android --profile production

# Submit to Play Store
eas submit --platform android
```

### 4. Esperar verificación de Google

- Google verifica Android App Links automáticamente
- Puede tomar 24-48 horas
- Verificar en Play Console → App Integrity → App Links

## 📚 Referencias

- [Android App Links](https://developer.android.com/training/app-links)
- [React Navigation Deep Linking](https://reactnavigation.org/docs/deep-linking/)
- [Expo Linking](https://docs.expo.dev/guides/linking/)
- [assetlinks.json Generator](https://developers.google.com/digital-asset-links/tools/generator)

---

**Última actualización**: 2026-03-10  
**Versión**: 1.0.8  
**Estado**: ✅ Implementado y listo para testing
