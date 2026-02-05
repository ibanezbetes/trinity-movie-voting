# Solución Manual para Problemas de Expo

## Problema
Error: `JSBigFileString::fromPath - Could not open file`

## Causa
Archivos corruptos o bloqueados en node_modules, especialmente en `react-native-screens`.

## Solución Paso a Paso

### Opción 1: Reiniciar y Limpiar (Recomendado)

1. **Cerrar TODO**:
   - Cierra VS Code
   - Cierra todas las terminales
   - Cierra Android Studio si está abierto
   - Cierra cualquier emulador de Android

2. **Reiniciar el PC** (esto libera todos los archivos bloqueados)

3. **Después del reinicio**, abre PowerShell como Administrador y ejecuta:

```powershell
cd C:\Users\daniz\Documents\GitHub\trinity_app\mobile

# Eliminar node_modules
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue

# Eliminar package-lock.json
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue

# Eliminar cache de Expo
Remove-Item -Recurse -Force .expo -ErrorAction SilentlyContinue

# Limpiar cache de npm
npm cache clean --force

# Reinstalar
npm install

# Iniciar Expo
npx expo start --clear
```

### Opción 2: Sin Reiniciar (Más Complejo)

1. **Abrir Task Manager** (Ctrl + Shift + Esc)

2. **Buscar y terminar estos procesos**:
   - node.exe
   - expo.exe
   - adb.exe
   - java.exe (relacionado con Android)

3. **Abrir PowerShell como Administrador** y ejecutar:

```powershell
cd C:\Users\daniz\Documents\GitHub\trinity_app\mobile

# Forzar cierre de procesos
taskkill /F /IM node.exe /T 2>$null
taskkill /F /IM adb.exe /T 2>$null

# Esperar 5 segundos
Start-Sleep -Seconds 5

# Eliminar node_modules con método alternativo
if (Test-Path node_modules) {
    # Renombrar primero (a veces funciona mejor)
    Rename-Item node_modules node_modules_old -ErrorAction SilentlyContinue
    
    # Eliminar en segundo plano
    Start-Job -ScriptBlock {
        Remove-Item -Recurse -Force "C:\Users\daniz\Documents\GitHub\trinity_app\mobile\node_modules_old"
    }
}

# Continuar con la instalación mientras se elimina en background
npm cache clean --force
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .expo -ErrorAction SilentlyContinue

# Esperar a que termine el job de eliminación
Get-Job | Wait-Job
Get-Job | Remove-Job

# Reinstalar
npm install

# Iniciar
npx expo start --clear
```

### Opción 3: Usar Yarn en lugar de npm

A veces Yarn maneja mejor los archivos bloqueados en Windows:

```powershell
# Instalar Yarn si no lo tienes
npm install -g yarn

cd C:\Users\daniz\Documents\GitHub\trinity_app\mobile

# Limpiar
yarn cache clean
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force yarn.lock -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue

# Reinstalar con Yarn
yarn install

# Iniciar
npx expo start --clear
```

### Opción 4: Eliminar Manualmente la Carpeta Problemática

Si todo lo demás falla:

1. Abre el Explorador de Windows
2. Navega a: `C:\Users\daniz\Documents\GitHub\trinity_app\mobile\node_modules`
3. Busca la carpeta `react-native-screens`
4. Intenta eliminarla manualmente
5. Si no puedes, usa **Unlocker** o **LockHunter** (herramientas gratuitas para Windows)
6. Después de eliminarla, ejecuta: `npm install`

## Verificación

Después de cualquier opción, verifica que funciona:

```powershell
npx expo start --clear
```

Deberías ver:

```
Starting Metro Bundler
› Metro waiting on exp://192.168.x.x:8081
› Scan the QR code above with Expo Go (Android) or the Camera app (iOS)
```

## Si Aún No Funciona

Considera crear el proyecto desde cero en una nueva carpeta:

```powershell
# En una carpeta temporal
npx create-expo-app trinity-test
cd trinity-test

# Copiar tu código fuente
# Copiar package.json (dependencies)
# npm install
# npx expo start
```

## Prevención Futura

Para evitar este problema:

1. Siempre cierra Expo con Ctrl+C antes de cerrar la terminal
2. No elimines archivos mientras Expo está corriendo
3. Usa `npx expo start --clear` regularmente para limpiar cache
4. Considera usar WSL2 (Windows Subsystem for Linux) para desarrollo React Native

## Contacto

Si ninguna opción funciona, considera:
- Actualizar Node.js a la última versión LTS
- Actualizar npm: `npm install -g npm@latest`
- Verificar antivirus (a veces bloquea archivos)
- Ejecutar PowerShell como Administrador
