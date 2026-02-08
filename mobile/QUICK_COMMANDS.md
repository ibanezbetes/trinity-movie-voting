# ⚡ Trinity - Comandos Rápidos

Referencia rápida de comandos para desarrollo y publicación.

---

## 🔐 Keystore de Producción

### Crear Keystore (Primera vez)
```powershell
cd mobile
./create-keystore.ps1
```

### Verificar Keystore
```powershell
cd mobile/android/app
keytool -list -v -keystore trinity-release.keystore
```

---

## 📦 Generar AAB para Play Store

### Método 1: Script Automático (Recomendado)
```powershell
cd mobile
./generate-aab.ps1
```

### Método 2: Gradle Manual
```powershell
cd mobile/android
./gradlew clean
./gradlew bundleRelease
```

**Output**: `mobile/android/app/build/outputs/bundle/release/app-release.aab`

---

## 🏗️ Builds de Desarrollo

### Iniciar Servidor de Desarrollo
```bash
cd mobile
npx expo start
```

### Ejecutar en Android
```bash
cd mobile
npx expo run:android
```

### Ejecutar en iOS
```bash
cd mobile
npx expo run:ios
```

---

## 🧪 Testing

### Generar APK para Testing
```bash
cd mobile
npx eas build --profile production-apk --platform android
```

### Instalar APK en Dispositivo
```bash
adb install mobile/trinity-v1.0.0-release.apk
```

---

## 🔄 Actualizar Versión

### 1. Actualizar app.json
```json
{
  "expo": {
    "version": "1.0.1"
  }
}
```

### 2. Actualizar build.gradle
```gradle
defaultConfig {
    versionCode 2        // Incrementar
    versionName "1.0.1"  // Incrementar
}
```

### 3. Generar Nuevo AAB
```powershell
cd mobile
./generate-aab.ps1
```

---

## 🧹 Limpieza

### Limpiar Cache de Expo
```bash
cd mobile
npx expo start -c
```

### Limpiar Build de Android
```powershell
cd mobile/android
./gradlew clean
```

### Limpiar Todo
```bash
cd mobile
rm -rf node_modules
rm -rf android/app/build
rm -rf android/build
npm install
```

---

## 📊 Verificación

### Ver Logs de Android
```bash
npx react-native log-android
```

### Ver Logs de iOS
```bash
npx react-native log-ios
```

### Verificar Tamaño del AAB
```powershell
cd mobile/android/app/build/outputs/bundle/release
ls -lh app-release.aab
```

---

## 🚀 Deployment

### Deploy Infrastructure
```bash
cd infrastructure
npm run build
./create-zips.ps1
cdk deploy
```

### Sync Config to Mobile
```bash
cd infrastructure/scripts
node generate-mobile-config.js
```

---

## 🔍 Debug

### Abrir React DevTools
```bash
npx react-devtools
```

### Abrir Android Studio
```bash
cd mobile/android
studio .
```

### Ver Variables de Entorno
```bash
cd mobile
cat .env
```

---

## 📱 Play Store

### Abrir Play Console
```
https://play.google.com/console
```

### URL de la App
```
https://play.google.com/store/apps/details?id=com.trinityapp.mobile
```

---

## 🆘 Troubleshooting

### Error: "Keystore not found"
```powershell
cd mobile
./create-keystore.ps1
```

### Error: "Version code already used"
Incrementar `versionCode` en `build.gradle`

### Error: "Metro bundler issues"
```bash
cd mobile
npx expo start -c
```

### Error: "Gradle build failed"
```powershell
cd mobile/android
./gradlew clean
cd ..
npx expo prebuild --clean
```

---

## 📚 Documentación

- [README Principal](../README.md)
- [Mobile README](README.md)
- [Guía de Play Store](../docs/GOOGLE_PLAY_STORE_GUIDE.md)
- [Checklist de Publicación](PLAY_STORE_CHECKLIST.md)

---

**Trinity Team**  
trinity.app.spain@gmail.com  
https://trinity-app.es
