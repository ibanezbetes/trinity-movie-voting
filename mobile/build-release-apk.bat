@echo off
echo ========================================
echo Trinity App - Release APK Build Script
echo ========================================
echo.

REM Set environment variables for release
set NODE_ENV=production
set REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1

echo [1/7] Setting up environment...
echo NODE_ENV=%NODE_ENV%
echo.

echo [2/7] Cleaning build directories...
cd android
if exist "app\build" (
    echo Removing previous build...
    rmdir /s /q "app\build" 2>nul
)
if exist "app\.cxx" (
    echo Removing CMake cache...
    rmdir /s /q "app\.cxx" 2>nul
)
echo Clean completed
echo.

echo [3/7] Installing dependencies...
cd ..
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo.

echo [4/7] Creating assets directory...
if not exist "android\app\src\main\assets" (
    mkdir "android\app\src\main\assets"
)
echo Assets directory ready
echo.

echo [5/7] Generating release bundle...
call npx react-native bundle ^
    --platform android ^
    --dev false ^
    --entry-file index.ts ^
    --bundle-output android/app/src/main/assets/index.android.bundle ^
    --assets-dest android/app/src/main/res/

if %ERRORLEVEL% neq 0 (
    echo ERROR: Bundle generation failed
    pause
    exit /b 1
)
echo Bundle generated successfully
echo.

echo [6/7] Building Release APK with Gradle...
cd android
call gradlew assembleRelease --no-daemon --max-workers=1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Gradle build failed
    pause
    exit /b 1
)
echo.

echo [7/7] Build completed successfully!
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
    echo ✅ SUCCESS: Release APK built successfully!
    echo.
    echo To install on device:
    echo adb install -r app\build\outputs\apk\release\app-release.apk
) else (
    echo ❌ ERROR: APK file not found
)

echo.
pause