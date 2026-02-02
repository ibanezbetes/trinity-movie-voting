@echo off
echo ========================================
echo Trinity App - Fixed APK Build
echo (With embedded JS bundle)
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

echo [3/4] Building APK with embedded bundle (no clean)...
echo This will include the JavaScript bundle in the APK
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
    echo ✅ SUCCESS: Fixed APK built successfully!
    echo.
    echo This APK should work standalone (no Metro needed)
    echo.
    echo Creating installable copy...
    copy "app\build\outputs\apk\debug\app-debug.apk" "..\trinity-app-fixed.apk" >nul
    if exist "..\trinity-app-fixed.apk" (
        echo ✅ Created: trinity-app-fixed.apk
        echo Location: %cd%\..\trinity-app-fixed.apk
        echo.
        echo Try installing this APK on your device!
    )
) else (
    echo ❌ ERROR: APK file not found
)

echo.
pause