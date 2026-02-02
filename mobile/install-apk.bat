@echo off
echo Installing Trinity APK with Enhanced Match System...
echo.

set APK_PATH=android\app\build\outputs\apk\debug\app-debug.apk

if not exist "%APK_PATH%" (
    echo ❌ APK not found at %APK_PATH%
    echo Please run build-apk-optimized.bat first to build the APK
    pause
    exit /b 1
)

echo 📱 APK found: %APK_PATH%
echo Size: ~129 MB
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
    echo - Differentiated notifications (in-room vs out-of-room)
    echo - Match saved to all participants' profiles
    echo.
    echo 📱 You can now launch Trinity on your device!
) else (
    echo.
    echo ❌ Installation failed!
    echo Make sure:
    echo - Android device is connected
    echo - USB debugging is enabled
    echo - ADB is installed and in PATH
)

echo.
pause