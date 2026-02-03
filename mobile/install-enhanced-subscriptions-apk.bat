@echo off
echo ========================================
echo Installing Trinity App - Enhanced Subscriptions v2
echo ========================================

echo.
echo 🚀 Enhanced Features in this build:
echo   ✓ Real-time WebSocket subscriptions with retry logic
echo   ✓ Enhanced polling fallback with exponential backoff  
echo   ✓ Improved error handling and connection management
echo   ✓ Better match detection and notification system
echo.

cd /d "%~dp0"

echo 📱 Checking for connected Android devices...
adb devices

echo.
echo 📦 Installing APK: trinity-app-ENHANCED-SUBSCRIPTIONS-v2.apk
echo.

adb install -r "trinity-app-ENHANCED-SUBSCRIPTIONS-v2.apk"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ✅ INSTALLATION SUCCESSFUL!
    echo.
    echo 🎯 The app is now installed with enhanced real-time subscriptions
    echo 💡 Test the improved match notifications by voting in rooms
    echo 🔔 You should receive instant notifications when matches occur
    echo.
    echo 📱 Launch the app from your device to test the enhanced features
    echo.
) else (
    echo.
    echo ❌ INSTALLATION FAILED!
    echo.
    echo 💡 Make sure:
    echo   - Your device is connected via USB
    echo   - USB debugging is enabled
    echo   - You have authorized this computer for debugging
    echo.
    echo 🔄 Try running 'adb devices' to check connection
    echo.
)

pause