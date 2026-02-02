# Trinity App - Comandos de Referencia Rápida

## 🚀 Compilación APK - Comandos Esenciales

### Compilación Exitosa (Método Probado)
```bash
# 1. Navegar al directorio
cd mobile

# 2. Configurar gradle.properties (una sola vez)
echo "reactNativeArchitectures=arm64-v8a" >> android/gradle.properties

# 3. Instalar dependencias
npm install

# 4. Compilar APK ARM64
cd android
set NODE_ENV=production
gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a --no-daemon

# 5. APK resultante en:
# android/app/build/outputs/apk/debug/app-debug.apk
```

### Script Automatizado
```bash
cd mobile
.\build-arm64-only.bat
```

## 🔧 Solución de Problemas

### Error: Paths Largos (Windows)
```bash
# Síntoma: "Filename longer than 260 characters"
# Solución: Forzar solo ARM64
gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
```

### Error: Metro Bundler Serialization
```bash
# Síntoma: "Serializer did not return expected format"
# Solución: Usar debug build con NODE_ENV=production
set NODE_ENV=production
gradlew assembleDebug
```

### Error: Codegen Directories Missing
```bash
# Síntoma: "add_subdirectory given source which is not an existing directory"
# Solución: Regenerar proyecto
npx expo prebuild --clean --platform android
```

### Limpieza Completa (Último Recurso)
```bash
cd mobile
rm -rf android/app/.cxx
rm -rf android/app/build
rm -rf android/build
npx expo prebuild --clean --platform android
```

## 📱 Instalación en Dispositivo

### Método 1: ADB (Recomendado)
```bash
# Verificar dispositivo conectado
adb devices

# Instalar APK
adb install -r trinity-app-arm64.apk
```

### Método 2: Script Automatizado
```bash
cd mobile
.\install-apk.bat
```

### Método 3: Manual
1. Copiar `trinity-app-arm64.apk` al dispositivo
2. Abrir desde explorador de archivos
3. Permitir instalación de fuentes desconocidas
4. Instalar

## 🔍 Verificación

### Verificar APK Compilada
```bash
# Verificar existencia
dir mobile/android/app/build/outputs/apk/debug/app-debug.apk

# Verificar tamaño (debe ser ~40-50MB)
dir mobile/trinity-app-arm64.apk
```

### Verificar Configuración
```bash
# Verificar gradle.properties
type mobile/android/gradle.properties | findstr "reactNativeArchitectures"
# Debe mostrar: reactNativeArchitectures=arm64-v8a
```

## ⚡ Comandos de Una Línea

### Build Rápido
```bash
cd mobile/android && set NODE_ENV=production && gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a --no-daemon
```

### Instalar Rápido
```bash
adb install -r mobile/trinity-app-arm64.apk
```

### Limpiar y Rebuild
```bash
cd mobile && rm -rf android/app/.cxx android/app/build && npx expo prebuild --clean --platform android
```

## 📋 Configuraciones Críticas

### gradle.properties (Esencial)
```properties
reactNativeArchitectures=arm64-v8a
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m
org.gradle.parallel=true
```

### metro.config.js (Fix Serialization)
```javascript
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.serializer = { ...config.serializer, customSerializer: undefined };
module.exports = config;
```

## 🎯 Parámetros Importantes

### Gradle Parameters
- `-PreactNativeArchitectures=arm64-v8a` - Fuerza solo ARM64
- `--no-daemon` - Evita conflictos de memoria
- `--max-workers=1` - Reduce uso de memoria

### Environment Variables
- `NODE_ENV=production` - Optimizaciones de JavaScript
- `REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1` - Evita problemas de red

## 🚨 Troubleshooting Rápido

| Error | Comando de Solución |
|-------|-------------------|
| Path length | `gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a` |
| Metro serialization | `set NODE_ENV=production && gradlew assembleDebug` |
| Codegen missing | `npx expo prebuild --clean --platform android` |
| Build corrupto | `rm -rf android/app/.cxx android/app/build` |
| Gradle daemon | `gradlew --stop && gradlew assembleDebug --no-daemon` |

## 📁 Archivos Importantes

### Scripts Creados
- `build-arm64-only.bat` - Build principal
- `install-apk.bat` - Instalación automática
- `verify-apk.bat` - Verificación de build

### Documentación
- `APK_BUILD_TROUBLESHOOTING_GUIDE.md` - Guía completa
- `TECHNICAL_SOLUTION_SUMMARY.md` - Resumen técnico
- `INSTALL_INSTRUCTIONS.md` - Instrucciones de usuario

### APK Final
- `trinity-app-arm64.apk` - APK lista para instalar (43MB)

## 💡 Tips Rápidos

1. **Siempre usar ARM64 únicamente** en Windows
2. **NODE_ENV=production** para optimizaciones
3. **Debug APK funciona igual que release** para este proyecto
4. **Limpiar builds** si hay errores extraños
5. **Verificar tamaño APK** (~40-50MB es correcto)

Esta referencia rápida debe permitir reproducir la compilación exitosa en minutos.