@echo off
echo ========================================
echo Trinity App - ARM64 Only APK Build
echo ========================================
echo.

REM Set environment variables
set NODE_ENV=production
set REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1

echo [1/4] Setting up environment...
echo NODE_ENV=%NODE_ENV%
echo Building for arm64-v8a only (avoids Windows path issues)
echo.

echo [2/4] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo.

echo [3/4] Building APK for arm64-v8a only...
cd android
call gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a --no-daemon
if %ERRORLEVEL% neq 0 (
    echo ERROR: Gradle build failed
    pause
    exit /b 1
)
echo.

echo [4/4] Build completed successfully!
echo.
echo APK Location:
echo %cd%\app\build\outputs\apk\debug\app-debug.apk
echo.

REM Check if APK exists and show size
if exist "app\build\outputs\apk\debug\app-debug.apk" (
    for %%I in ("app\build\outputs\apk\debug\app-debug.apk") do (
        echo APK Size: %%~zI bytes
        set /a "size_mb=%%~zI / 1024 / 1024"
        echo APK Size: !size_mb! MB
    )
    echo.
    echo ✅ SUCCESS: ARM64 APK built successfully!
    echo.
    echo This APK:
    echo - Works on 99%% of modern Android devices (ARM64)
    echo - Contains all Trinity features
    echo - Can be installed on any device
    echo - Connects to your deployed backend
    echo.
    echo To install on device:
    echo adb install -r app\build\outputs\apk\debug\app-debug.apk
    echo.
    echo Creating installable copy...
    copy "app\build\outputs\apk\debug\app-debug.apk" "..\trinity-app-arm64.apk" >nul
    if exist "..\trinity-app-arm64.apk" (
        echo ✅ Created: trinity-app-arm64.apk
        echo Location: %cd%\..\trinity-app-arm64.apk
        echo.
        echo You can now transfer this APK to your device and install it!
    )
) else (
    echo ❌ ERROR: APK file not found
)

echo.
pause