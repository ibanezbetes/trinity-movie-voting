@echo off
echo ========================================
echo Trinity App - Gradle APK Build Script
echo ========================================
echo.

REM Set environment variables
set NODE_ENV=production
set REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1

echo [1/6] Setting up environment...
echo NODE_ENV=%NODE_ENV%
echo.

echo [2/6] Cleaning previous builds...
cd android
call gradlew clean
if %ERRORLEVEL% neq 0 (
    echo ERROR: Gradle clean failed
    pause
    exit /b 1
)
echo.

echo [3/6] Installing dependencies...
cd ..
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo.

echo [4/6] Generating Metro bundle...
call npx expo export:embed --platform android --dev false --clear
if %ERRORLEVEL% neq 0 (
    echo ERROR: Metro bundle generation failed
    pause
    exit /b 1
)
echo.

echo [5/6] Building APK with Gradle...
cd android
call gradlew assembleRelease
if %ERRORLEVEL% neq 0 (
    echo ERROR: Gradle build failed
    pause
    exit /b 1
)
echo.

echo [6/6] Build completed successfully!
echo.
echo APK Location:
echo %cd%\app\build\outputs\apk\release\app-release.apk
echo.

REM Check if APK exists and show size
if exist "app\build\outputs\apk\release\app-release.apk" (
    for %%I in ("app\build\outputs\apk\release\app-release.apk") do (
        echo APK Size: %%~zI bytes
        set /a "size_mb=%%~zI / 1024 / 1024"
        echo APK Size: !size_mb! MB
    )
    echo.
    echo ✅ SUCCESS: APK built successfully!
    echo.
    echo To install on device:
    echo adb install -r app\build\outputs\apk\release\app-release.apk
) else (
    echo ❌ ERROR: APK file not found
)

echo.
pause