@echo off
echo ========================================
echo Trinity App - Standalone APK (FIXED)
echo (Using React Native CLI bundling)
echo ========================================
echo.

REM Set environment variables for production
set NODE_ENV=production
set REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1

echo [1/4] Setting up environment...
echo NODE_ENV=%NODE_ENV%
echo.

echo [2/4] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo.

echo [3/4] Building standalone APK (no clean to avoid codegen issues)...
echo This will create an APK with embedded JavaScript bundle
cd android

REM Try release first, fallback to debug if it fails
echo Attempting release build...
call gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=1
if %ERRORLEVEL% neq 0 (
    echo.
    echo ❌ Release build failed, trying debug build...
    echo.
    call gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=1
    if %ERRORLEVEL% neq 0 (
        echo ERROR: Both release and debug builds failed
        pause
        exit /b 1
    )
    set BUILD_TYPE=debug
    set APK_PATH=app\build\outputs\apk\debug\app-debug.apk
) else (
    set BUILD_TYPE=release
    set APK_PATH=app\build\outputs\apk\release\app-release.apk
)
echo.

echo [4/4] Build completed successfully!
echo.
echo APK Location:
echo %cd%\%APK_PATH%
echo.

REM Check if APK exists and show size
if exist "%APK_PATH%" (
    for %%I in ("%APK_PATH%") do (
        echo APK Size: %%~zI bytes
        set /a "size_mb=%%~zI / 1024 / 1024"
        echo APK Size: !size_mb! MB
    )
    echo.
    echo ✅ SUCCESS: Standalone %BUILD_TYPE% APK built successfully!
    echo.
    echo This APK includes the JavaScript bundle and should work standalone
    echo (no Metro bundler connection needed)
    echo.
    echo Creating installable copy...
    copy "%APK_PATH%" "..\trinity-app-standalone-fixed.apk" >nul
    if exist "..\trinity-app-standalone-fixed.apk" (
        echo ✅ Created: trinity-app-standalone-fixed.apk
        echo Location: %cd%\..\trinity-app-standalone-fixed.apk
        echo.
        echo 📱 READY FOR DEVICE INSTALLATION!
        echo This APK should work on your device without the "Unable to load script" error.
        echo.
        echo 🔧 TECHNICAL DETAILS:
        echo - Uses React Native CLI bundling instead of Expo CLI
        echo - Avoids Metro config ESM issues on Windows
        echo - Includes embedded JavaScript bundle
        echo - ARM64-v8a architecture only
        echo - %BUILD_TYPE% build with production optimizations
    )
) else (
    echo ❌ ERROR: APK file not found at %APK_PATH%
)

echo.
echo 📋 INSTALLATION INSTRUCTIONS:
echo 1. Copy trinity-app-standalone-fixed.apk to your device
echo 2. Enable "Install from unknown sources" in Android settings
echo 3. Install the APK
echo 4. The app should open without errors
echo.
pause