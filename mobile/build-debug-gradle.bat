@echo off
echo ========================================
echo Trinity App - Debug APK Build Script
echo ========================================
echo.

REM Set environment variables
set NODE_ENV=development
set REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1

echo [1/5] Setting up environment...
echo NODE_ENV=%NODE_ENV%
echo.

echo [2/5] Cleaning previous builds...
cd android
call gradlew clean
if %ERRORLEVEL% neq 0 (
    echo ERROR: Gradle clean failed
    pause
    exit /b 1
)
echo.

echo [3/5] Installing dependencies...
cd ..
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo.

echo [4/5] Building Debug APK with Gradle...
cd android
call gradlew assembleDebug
if %ERRORLEVEL% neq 0 (
    echo ERROR: Gradle build failed
    pause
    exit /b 1
)
echo.

echo [5/5] Build completed successfully!
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
    echo ✅ SUCCESS: Debug APK built successfully!
    echo.
    echo To install on device:
    echo adb install -r app\build\outputs\apk\debug\app-debug.apk
) else (
    echo ❌ ERROR: APK file not found
)

echo.
pause