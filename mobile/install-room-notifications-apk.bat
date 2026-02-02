@echo off
echo ========================================
echo Installing Trinity App - Room Notifications
echo ========================================
echo.
echo Nueva APK con notificaciones basadas en salas
echo Fecha: %date% %time%
echo.

echo [1/2] Verificando dispositivo conectado...
adb devices
echo.

echo [2/2] Instalando APK actualizada...
adb install -r trinity-app-room-notifications.apk

if %errorlevel% equ 0 (
    echo.
    echo ✅ APK instalada exitosamente!
    echo.
    echo 🎯 NUEVAS CARACTERÍSTICAS:
    echo - Notificaciones simultáneas para todos los usuarios en la sala
    echo - Suscripciones automáticas basadas en roomId
    echo - Manejo mejorado de errores y reconexión
    echo - Limpieza automática al salir de salas
    echo.
    echo 🧪 PROTOCOLO DE PRUEBA:
    echo 1. Dispositivo A: Crear sala
    echo 2. Dispositivo B: Unirse a la sala
    echo 3. Ambos: Votar "Like" en la misma película
    echo 4. Verificar: Ambos reciben notificación simultáneamente
    echo.
) else (
    echo.
    echo ❌ Error instalando APK
    echo Verifica que el dispositivo esté conectado y el USB debugging habilitado
)

echo.
pause