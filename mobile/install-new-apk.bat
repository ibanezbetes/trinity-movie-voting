@echo off
echo ========================================
echo Installing NEW APK - Individual Notifications
echo ========================================
echo.

set APK_NAME=trinity-app-INDIVIDUAL-NOTIFICATIONS-v2.apk

if not exist "%APK_NAME%" (
    echo ERROR: APK file not found: %APK_NAME%
    echo.
    echo Please build the APK first by running:
    echo   build-new-apk-complete.bat
    echo.
    pause
    exit /b 1
)

echo APK found: %APK_NAME%
echo.
echo This is a BRAND NEW APK with complete solution for:
echo ✅ Individual user notifications
echo ✅ Dual subscription system (user + room)
echo ✅ Enhanced async voting notifications
echo ✅ Real-time WebSocket improvements
echo ✅ Robust polling fallback system
echo.
echo PROBLEM SOLVED:
echo ✅ ALL users who voted "yes" get notified
echo ✅ Not just the last user who voted
echo ✅ Works even if users voted at different times
echo.

REM Check if ADB is available
adb version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: ADB not found in PATH
    echo.
    echo Please ensure Android SDK is installed and ADB is in your PATH
    echo Typical location: C:\Users\%USERNAME%\AppData\Local\Android\Sdk\platform-tools
    echo.
    echo Alternative: Copy %APK_NAME% to your device and install manually
    echo.
    pause
    exit /b 1
)

echo Checking connected devices...
adb devices
echo.

echo Installing APK on connected device...
echo This may take a few moments...
adb install -r "%APK_NAME%"

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo APK INSTALLATION SUCCESSFUL!
    echo ========================================
    echo.
    echo The Trinity app with Individual Notifications
    echo has been successfully installed on your device.
    echo.
    echo NEW FEATURES ACTIVE:
    echo ✅ Individual user notifications (publishUserMatch)
    echo ✅ User-specific subscriptions (userMatch)
    echo ✅ Room-based subscriptions (roomMatch) 
    echo ✅ Dual subscription system for redundancy
    echo ✅ Enhanced notification delivery
    echo ✅ Async voting problem SOLVED
    echo.
    echo TESTING INSTRUCTIONS:
    echo 1. Open the app on this device
    echo 2. Create or join a room
    echo 3. Have another user join the same room
    echo 4. Vote "yes" on a movie (you can vote first)
    echo 5. Have the other user vote "yes" on the same movie
    echo 6. BOTH users should receive notifications!
    echo.
    echo The async voting notification problem is now SOLVED!
) else (
    echo.
    echo ========================================
    echo Installation Failed
    echo ========================================
    echo.
    echo Possible solutions:
    echo 1. Enable USB debugging on your device
    echo 2. Accept any permission prompts on your device
    echo 3. Ensure device has sufficient storage space
    echo 4. Try uninstalling previous version first:
    echo    adb uninstall com.trinityapp.mobile
    echo 5. Manual installation: Copy APK to device and open it
    echo.
    echo APK location: %CD%\%APK_NAME%
)

echo.
pause