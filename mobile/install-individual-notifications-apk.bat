@echo off
echo ========================================
echo Installing Individual Notifications APK
echo ========================================
echo.

set APK_NAME=trinity-app-INDIVIDUAL-NOTIFICATIONS.apk

if not exist "%APK_NAME%" (
    echo ERROR: APK file not found: %APK_NAME%
    echo.
    echo Please build the APK first by running:
    echo   build-individual-notifications-apk.bat
    echo.
    pause
    exit /b 1
)

echo APK found: %APK_NAME%
echo.
echo This APK includes the solution for async voting notifications:
echo - Individual user notifications
echo - Dual subscription system (user + room based)
echo - Enhanced notification delivery to ALL users
echo - Real-time WebSocket improvements
echo.

REM Check if ADB is available
adb version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: ADB not found in PATH
    echo.
    echo Please ensure Android SDK is installed and ADB is in your PATH
    echo Typical location: C:\Users\%USERNAME%\AppData\Local\Android\Sdk\platform-tools
    echo.
    pause
    exit /b 1
)

echo Checking connected devices...
adb devices

echo.
echo Installing APK on connected device...
adb install -r "%APK_NAME%"

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo APK Installation Successful!
    echo ========================================
    echo.
    echo The Trinity app with Individual Notifications
    echo has been installed on your device.
    echo.
    echo PROBLEM SOLVED:
    echo - ALL users who voted "yes" get notified
    echo - Not just the last user who voted
    echo - Works even if users voted at different times
    echo.
    echo Features included:
    echo - Individual user notifications (publishUserMatch)
    echo - Dual subscription system (user + room based)
    echo - Enhanced notification delivery
    echo - Real-time WebSocket improvements
    echo - Robust polling fallback system
    echo.
    echo You can now test the async voting solution!
) else (
    echo.
    echo ========================================
    echo Installation Failed
    echo ========================================
    echo.
    echo Please check:
    echo - Device is connected and USB debugging is enabled
    echo - Device has sufficient storage space
    echo - Previous version is uninstalled (if needed)
    echo.
    echo You can also install manually by copying the APK
    echo to your device and opening it.
)

echo.
pause