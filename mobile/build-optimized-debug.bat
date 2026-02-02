@echo off
echo ========================================
echo Trinity App - Optimized Debug APK Build
echo (Release-like performance, Debug signing)
echo ========================================
echo.

REM Set environment variables for production-like build
set NODE_ENV=production
set REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1

echo [1/6] Setting up environment...
echo NODE_ENV=%NODE_ENV%
echo.

echo [2/6] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo.

echo [3/6] Cleaning previous builds...
cd android
call gradlew clean --no-daemon
if %ERRORLEVEL% neq 0 (
    echo ERROR: Gradle clean failed
    pause
    exit /b 1
)
echo.

echo [4/6] Building Optimized Debug APK...
echo (This APK has production optimizations but debug signing)
call gradlew assembleDebug --no-daemon -Pproduction=true
if %ERRORLEVEL% neq 0 (
    echo ERROR: Gradle build failed
    pause
    exit /b 1
)
echo.

echo [5/6] Build completed successfully!
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
    echo ✅ SUCCESS: Optimized Debug APK built successfully!
    echo.
    echo This APK has:
    echo - Production-level JavaScript optimization
    echo - Hermes engine enabled
    echo - All Trinity features included
    echo - Debug signing (can install on any device)
    echo.
    echo To install on device:
    echo adb install -r app\build\outputs\apk\debug\app-debug.apk
    echo.
    echo Or copy APK to device and install manually
) else (
    echo ❌ ERROR: APK file not found
)

echo.
echo [6/6] Creating installable APK copy...
if exist "app\build\outputs\apk\debug\app-debug.apk" (
    copy "app\build\outputs\apk\debug\app-debug.apk" "..\trinity-app-optimized.apk" >nul
    if exist "..\trinity-app-optimized.apk" (
        echo ✅ Created: trinity-app-optimized.apk (ready for device installation)
        echo Location: %cd%\..\trinity-app-optimized.apk
    )
)

echo.
pause