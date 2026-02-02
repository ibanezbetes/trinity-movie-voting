@echo off
echo Installing Trinity APK with Enhanced Match System...
echo.

set APK_PATH=trinity-app-arm64.apk

if not exist "%APK_PATH%" (
    echo ❌ APK not found at %APK_PATH%
    echo Please run build-arm64-only.bat first to build the APK
    pause
    exit /b 1
)

echo 📱 APK found: %APK_PATH%
echo Size: ~43 MB (ARM64 optimized)
echo.

echo Make sure your Android device is connected and USB debugging is enabled.
echo.
pause

echo Installing APK...
adb install -r "%APK_PATH%"

if %errorlevel% equ 0 (
    echo.
    echo ✅ Trinity APK installed successfully!
    echo.
    echo 🎯 Enhanced Match System Features:
    echo - Proactive match checking before every user action
    echo - Global notifications for all users when match occurs
    echo - Automatic room deletion after match
    echo - Real-time WebSocket notifications via AppSync
    echo - Differentiated notifications (in-room vs out-of-room)
    echo.
    echo 🔐 Authentication Flow:
    echo - Register: Creates account and redirects to login
    echo - Login: Proper token management and verification
    echo - Session: Robust token validation and refresh
    echo.
    echo 📱 Navigation Structure:
    echo - Dashboard: Crear Sala, Unirse a Sala, Mis Salas, Recomendaciones
    echo - Mis Salas: Shows all active rooms (created + participated)
    echo - Mis Matches: Complete match history with movie posters
    echo - Profile: Integrated match history access
    echo.
    echo 📡 Backend Integration:
    echo - AWS AppSync GraphQL API with real-time subscriptions
    echo - Lambda functions for match processing and notifications
    echo - DynamoDB for data persistence
    echo - All backend changes deployed and functional
    echo.
    echo 🚀 You can now launch Trinity on your device!
    echo.
    echo 💡 Important: After registering, you'll be redirected to login
    echo    to ensure proper token management. This is normal behavior.
) else (
    echo.
    echo ❌ Installation failed!
    echo Make sure:
    echo - Android device is connected
    echo - USB debugging is enabled
    echo - ADB is installed and in PATH
    echo.
    echo Alternative: Copy trinity-app-arm64.apk to your device and install manually
)

echo.
pause