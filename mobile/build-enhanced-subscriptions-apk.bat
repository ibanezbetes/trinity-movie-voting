@echo off
echo ========================================
echo Building Trinity App with Enhanced Subscriptions
echo ========================================

echo.
echo 🔧 Enhanced Features:
echo - Real-time WebSocket subscriptions
echo - Improved connection handling with retry logic
echo - Enhanced polling fallback mechanism
echo - Better error handling and exponential backoff
echo.

cd /d "%~dp0"

echo 📱 Cleaning previous builds...
if exist "android\app\build" rmdir /s /q "android\app\build"
if exist "dist" rmdir /s /q "dist"

echo 📦 Installing dependencies...
call npm install

echo 🏗️ Building optimized bundle...
call npx expo export --platform android --dev false --clear

echo 📋 Copying assets to Android...
if not exist "android\app\src\main\assets" mkdir "android\app\src\main\assets"
copy "dist\index.js" "android\app\src\main\assets\index.android.bundle"

echo 🔨 Building APK with enhanced subscriptions...
cd android
call gradlew assembleRelease --no-daemon --max-workers=4

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ BUILD SUCCESSFUL!
    echo.
    echo 📱 APK Location: android\app\build\outputs\apk\release\app-release.apk
    echo.
    echo 🚀 Enhanced Features Included:
    echo   ✓ Real-time WebSocket subscriptions with retry logic
    echo   ✓ Enhanced polling fallback with exponential backoff  
    echo   ✓ Improved error handling and connection management
    echo   ✓ Better match detection and notification system
    echo.
    
    echo 📋 Copying APK with descriptive name...
    copy "app\build\outputs\apk\release\app-release.apk" "..\trinity-app-ENHANCED-SUBSCRIPTIONS.apk"
    
    echo.
    echo 🎯 Ready to test enhanced real-time notifications!
    echo 💡 The app now uses WebSocket connections for better real-time performance
    echo.
) else (
    echo.
    echo ❌ BUILD FAILED!
    echo Check the error messages above for details.
    echo.
)

cd ..
pause