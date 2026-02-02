@echo off
echo ========================================
echo TRINITY APP - BUILD UPDATED APK
echo ========================================
echo.

echo 1. Sincronizando configuracion con AWS...
cd infrastructure
node scripts/sync-from-aws.js
if %ERRORLEVEL% neq 0 (
    echo ERROR: Fallo la sincronizacion con AWS
    pause
    exit /b 1
)

echo.
echo 2. Cambiando al directorio mobile...
cd ..\mobile

echo.
echo 3. Construyendo APK con EAS Build...
echo Usando perfil: production-apk
echo Formato: APK (no AAB)
echo.

npx eas build --platform android --profile production-apk --non-interactive

if %ERRORLEVEL% neq 0 (
    echo ERROR: Fallo la construccion del APK
    pause
    exit /b 1
)

echo.
echo ========================================
echo APK CONSTRUIDO EXITOSAMENTE
echo ========================================
echo.
echo El APK se ha generado con:
echo - Backend sincronizado con AWS
echo - Configuracion actualizada
echo - Notificaciones corregidas
echo.
echo Descarga el APK desde el enlace mostrado arriba
echo.
pause