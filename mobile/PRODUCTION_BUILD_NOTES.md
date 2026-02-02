# Trinity App - Production Build Notes

## Cambios Realizados para Compilación de Producción

### 1. Configuración de Variables de Entorno

**Archivo modificado:** `mobile/app.json`
- Agregadas variables de entorno en la sección `extra` para que estén disponibles en builds de producción
- Configuradas las URLs de AWS y credenciales para producción

**Archivo modificado:** `mobile/src/config/aws-config.ts`
- Implementada lógica para leer configuración desde Expo constants en producción
- Fallback a variables de entorno y valores hardcoded como respaldo

### 2. Configuración de Build Android

**Archivo modificado:** `mobile/android/app/build.gradle`
- Cambiado de Expo CLI a React Native CLI para bundling
- Configurado entry point correcto (`../../index.ts`)
- Limitado a arquitectura arm64-v8a para evitar problemas de rutas largas en Windows
- Deshabilitado lint para acelerar compilación

**Archivo modificado:** `mobile/android/gradle.properties`
- Configurado para compilar solo arm64-v8a
- Esto resuelve problemas de rutas de archivos demasiado largas en Windows

### 3. Configuración de Metro

**Archivo creado:** `mobile/metro.config.js`
- Configuración básica de Metro para React Native
- Compatible con la estructura del proyecto

### 4. Dependencias Agregadas

```bash
npm install --save-dev @react-native-community/cli
npm install --save-dev @react-native/metro-config
npm install expo-constants
```

### 5. Script de Build

**Archivo creado:** `mobile/build-apk.bat`
- Script automatizado para compilar APK de producción
- Incluye limpieza, compilación y verificación

## Cómo Compilar APK de Producción

### Opción 1: Usar el script automatizado
```bash
cd mobile
build-apk.bat
```

### Opción 2: Compilación manual
```bash
cd mobile/android
set NODE_ENV=production
gradlew clean
gradlew assembleRelease
```

## Ubicación de la APK

La APK compilada se encuentra en:
```
mobile/android/app/build/outputs/apk/release/app-release.apk
```

## Configuración de Producción

La aplicación ahora usa las siguientes configuraciones para producción:

- **AWS Region:** eu-west-1
- **User Pool ID:** eu-west-1_RPkdnO7Ju
- **User Pool Client ID:** 61nf41i2bff1c4oc4qo9g36m1k
- **GraphQL Endpoint:** https://nvokqs473bbfdizeq4n5oosjpy.appsync-api.eu-west-1.amazonaws.com/graphql
- **Auth Type:** AMAZON_COGNITO_USER_POOLS

## Notas Importantes

1. **Arquitectura:** La APK está compilada solo para arm64-v8a, que es compatible con la mayoría de dispositivos Android modernos.

2. **Tamaño:** La APK tiene aproximadamente 26.5 MB.

3. **Firma:** Actualmente usa la keystore de debug. Para producción real, necesitarás generar una keystore de release.

4. **Variables de Entorno:** Las configuraciones están embebidas en la APK, no necesita conexión a localhost.

## Solución de Problemas

Si encuentras el error "Unable to load script" o referencias a localhost:
1. Verifica que las variables de entorno estén correctamente configuradas en `app.json`
2. Asegúrate de que `expo-constants` esté instalado
3. Recompila la APK completamente con `gradlew clean` seguido de `gradlew assembleRelease`