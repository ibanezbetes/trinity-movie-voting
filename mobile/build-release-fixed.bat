@echo off
echo ========================================
echo Trinity App - Fixed Release APK Build
echo ========================================
echo.

REM Set environment variables for release
set NODE_ENV=production
set REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1

echo [1/8] Setting up environment...
echo NODE_ENV=%NODE_ENV%
echo.

echo [2/8] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo.

echo [3/8] Cleaning previous builds...
cd android
call gradlew clean --no-daemon
if %ERRORLEVEL% neq 0 (
    echo ERROR: Gradle clean failed
    pause
    exit /b 1
)
cd ..
echo.

echo [4/8] Creating assets directory...
if not exist "android\app\src\main\assets" (
    mkdir "android\app\src\main\assets"
)
echo.

echo [5/8] Generating bundle with fixed Metro config...
call npx @react-native-community/cli bundle ^
    --platform android ^
    --dev false ^
    --entry-file index.ts ^
    --bundle-output android/app/src/main/assets/index.android.bundle ^
    --assets-dest android/app/src/main/res/ ^
    --reset-cache

if %ERRORLEVEL% neq 0 (
    echo ERROR: Bundle generation failed, trying alternative method...
    echo Removing problematic bundle and letting Gradle handle it...
    if exist "android\app\src\main\assets\index.android.bundle" (
        del "android\app\src\main\assets\index.android.bundle"
    )
)
echo.

echo [6/8] Building Release APK with Gradle...
cd android
call gradlew assembleRelease --no-daemon --max-workers=1 -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g"
if %ERRORLEVEL% neq 0 (
    echo ERROR: Gradle build failed
    pause
    exit /b 1
)
echo.

echo [7/8] Build completed successfully!
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
    echo This APK has:
    echo - Full production optimizations
    echo - Minified JavaScript
    echo - Optimized resources
    echo - All Trinity features included
    echo.
    echo To install on device:
    echo adb install -r app\build\outputs\apk\release\app-release.apk
) else (
    echo ❌ ERROR: APK file not found
)

echo.
echo [8/8] Creating installable APK copy...
if exist "app\build\outputs\apk\release\app-release.apk" (
    copy "app\build\outputs\apk\release\app-release.apk" "..\trinity-app-release.apk" >nul
    if exist "..\trinity-app-release.apk" (
        echo ✅ Created: trinity-app-release.apk (ready for device installation)
        echo Location: %cd%\..\trinity-app-release.apk
        echo.
        echo You can now:
        echo 1. Copy trinity-app-release.apk to your device
        echo 2. Install it directly on your Android device
        echo 3. Or use: adb install -r trinity-app-release.apk
    )
)

echo.
pause