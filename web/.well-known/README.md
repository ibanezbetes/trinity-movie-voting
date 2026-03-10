# Android App Links - assetlinks.json

Este archivo es necesario para que los deep links de Android funcionen sin mostrar el diálogo de selección de app.

## 📁 Archivo Actual

- `assetlinks.json` - Verificación de dominio para Android App Links

## 🔑 Fingerprints Incluidos

### 1. Debug (Desarrollo Local)
```
FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C
```
- **Uso**: Desarrollo local con `npx expo run:android`
- **Keystore**: `mobile/android/app/debug.keystore`

### 2. Release (Build Local)
```
33:79:58:38:1D:54:97:04:6C:81:8A:5D:EB:46:42:99:76:57:45:DD:26:A4:44:DD:F7:4B:1A:96:8B:49:5C:12
```
- **Uso**: Build de release local
- **Keystore**: `mobile/android/app/trinity-release.keystore`

### 3. Google Play (Producción) - ✅ AGREGADO

```
F9:75:E8:C1:B7:6A:BE:A3:D3:29:65:98:CC:E3:20:DA:6D:4A:97:3E:B9:9B:2E:72:57:93:F1:54:7A:CE:EC:61
```
- **Uso**: Producción - Apps descargadas desde Google Play Store
- **Keystore**: Gestionado por Google (App Signing by Google Play)

## 🚀 Cómo Agregar Fingerprint de Google Play

### Paso 1: Subir App a Play Store

1. Sube tu primera versión (Internal Testing, Closed Testing, o Production)
2. Google generará automáticamente el App Signing Key

### Paso 2: Obtener Fingerprint

1. Ve a: https://play.google.com/console
2. Selecciona tu app "Trinity"
3. Navega a: **Release → Setup → App signing**
4. En la sección "App signing key certificate", copia el **SHA-256 certificate fingerprint**

### Paso 3: Actualizar assetlinks.json

Agrega el nuevo fingerprint al array:

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
        "[FINGERPRINT DE GOOGLE PLAY AQUÍ]"
      ]
    }
  }
]
```

### Paso 4: Re-deployar

Sube el archivo actualizado a tu servidor para que sea accesible en:
```
https://trinity-app.es/.well-known/assetlinks.json
```

### Paso 5: Verificar

```powershell
# Verificar que el archivo sea accesible
Invoke-WebRequest -Uri "https://trinity-app.es/.well-known/assetlinks.json" -UseBasicParsing

# Verificar con herramienta de Google
# https://developers.google.com/digital-asset-links/tools/generator
```

## 📋 Checklist

### Desarrollo (Ahora)
- [x] Fingerprint Debug agregado
- [x] Fingerprint Release agregado
- [x] Archivo deployado en servidor
- [x] Verificado accesible (Status 200)
- [x] Content-Type: application/json

### Producción (Después de publicar en Play Store)
- [x] App subida a Play Store
- [x] Fingerprint de Google Play obtenido
- [x] Fingerprint agregado a assetlinks.json
- [ ] Archivo re-deployado
- [ ] Verificado con herramienta de Google
- [ ] Probado descargando desde Play Store

## 🔍 Verificación

### Verificar Accesibilidad
```powershell
Invoke-WebRequest -Uri "https://trinity-app.es/.well-known/assetlinks.json" -UseBasicParsing
```

**Debe retornar**:
- Status Code: 200
- Content-Type: application/json

### Verificar con Google
1. Ve a: https://developers.google.com/digital-asset-links/tools/generator
2. Ingresa:
   - Site domain: `trinity-app.es`
   - App package name: `com.trinityapp.mobile`
   - App package fingerprint: [Uno de los fingerprints]
3. Click "Test Statement"
4. Debe mostrar: ✅ "Statement verified"

## 📚 Documentación

- `docs/GOOGLE_PLAY_FINGERPRINT_GUIDE.md` - Guía completa para obtener fingerprint de Play Store
- `docs/DEEP_LINKING_GUIDE.md` - Guía de implementación de deep linking
- `DEPLOYMENT_ASSETLINKS.md` - Guía de deployment

## ⚠️ Importante

- **NO elimines** los fingerprints Debug y Release, son necesarios para desarrollo
- **Puedes tener múltiples fingerprints** en el mismo archivo
- **Cada fingerprint** permite que la app funcione en diferentes entornos
- **Re-deploya** el archivo cada vez que agregues un nuevo fingerprint

---

**Última actualización**: 2026-03-10
**Fingerprints actuales**: 3 (Debug, Release, Google Play)
**Estado**: ✅ Listo para producción - Falta re-deployar
