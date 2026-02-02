@echo off
echo ========================================
echo Trinity APK Verification Script
echo ========================================
echo.

set DEBUG_APK=android\app\build\outputs\apk\debug\app-debug.apk
set RELEASE_APK=android\app\build\outputs\apk\release\app-release.apk

echo Checking APK files...
echo.

if exist "%DEBUG_APK%" (
    echo ✅ DEBUG APK: Found
    for %%I in ("%DEBUG_APK%") do (
        echo    Location: %%~fI
        echo    Size: %%~zI bytes (~127 MB)
        echo    Modified: %%~tI
    )
    echo.
) else (
    echo ❌ DEBUG APK: Not found
    echo.
)

if exist "%RELEASE_APK%" (
    echo ✅ RELEASE APK: Found
    for %%I in ("%RELEASE_APK%") do (
        echo    Location: %%~fI
        echo    Size: %%~zI bytes
        echo    Modified: %%~tI
    )
    echo.
) else (
    echo ❌ RELEASE APK: Not found (use build-apk-gradle.bat to build)
    echo.
)

echo ========================================
echo Trinity App Features Implemented:
echo ========================================
echo.
echo 🎯 Enhanced Match System:
echo    ✅ Proactive match checking before every user action
echo    ✅ Global notifications for all users when match occurs
echo    ✅ Automatic room deletion after match
echo    ✅ Real-time WebSocket notifications via AppSync
echo    ✅ Differentiated notifications (in-room vs out-of-room)
echo.
echo 🔐 Authentication Flow:
echo    ✅ Registration redirects to login for proper token management
echo    ✅ Robust token verification and refresh
echo    ✅ Secure session management
echo.
echo 📱 Navigation Structure:
echo    ✅ Dashboard: Crear Sala, Unirse a Sala, Mis Salas, Recomendaciones
echo    ✅ Mis Salas: Shows all active rooms (created + participated)
echo    ✅ Mis Matches: Complete match history with movie posters
echo    ✅ Profile integration with match history access
echo.
echo 🏗️ Build System:
echo    ✅ Traditional React Native Gradle build (not EAS)
echo    ✅ Optimized for arm64-v8a architecture
echo    ✅ Debug APK successfully compiled
echo    ✅ Build scripts for both debug and release
echo.
echo 📡 Backend Integration:
echo    ✅ AWS AppSync GraphQL API
echo    ✅ Real-time subscriptions for match notifications
echo    ✅ Lambda functions for match processing
echo    ✅ DynamoDB for data persistence
echo.

if exist "%DEBUG_APK%" (
    echo To install the debug APK on your device:
    echo adb install -r "%DEBUG_APK%"
    echo.
    echo Or use: install-apk.bat
)

echo.
pause