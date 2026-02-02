@echo off
echo ========================================
echo Trinity App - Production APK Build
echo (Forces bundle inclusion)
echo ========================================
echo.

REM Set environment variables for production
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
cd ..
echo.

echo [4/6] Creating assets directory...
if not exist "android\app\src\main\assets" (
    mkdir "android\app\src\main\assets"
)
echo.

echo [5/6] Building APK with forced bundle generation...
cd android
call gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a --no-daemon -PbundleInDebug=true
if %ERRORLEVEL% neq 0 (
    echo ERROR: Gradle build failed
    pause
    exit /b 1
)
echo.

echo [6/6] Build completed successfully!
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
    echo ✅ SUCCESS: Production APK built successfully!
    echo.
    echo This APK should work standalone without Metro bundler
    echo.
    echo Creating installable copy...
    copy "app\build\outputs\apk\debug\app-debug.apk" "..\trinity-app-production.apk" >nul
    if exist "..\trinity-app-production.apk" (
        echo ✅ Created: trinity-app-production.apk
        echo Location: %cd%\..\trinity-app-production.apk
    )
) else (
    echo ❌ ERROR: APK file not found
)

echo.
pause