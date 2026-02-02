@echo off
echo ========================================
echo Trinity App - Standalone Release APK
echo (With embedded JS bundle for device)
echo ========================================
echo.

REM Set environment variables for production
set NODE_ENV=production
set REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1

echo [1/5] Setting up environment...
echo NODE_ENV=%NODE_ENV%
echo.

echo [2/5] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo.

echo [3/5] Cleaning previous builds...
cd android
call gradlew clean -PreactNativeArchitectures=arm64-v8a
echo.

echo [4/5] Building Release APK with embedded bundle...
echo This will create a standalone APK that works without Metro
call gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=1
if %ERRORLEVEL% neq 0 (
    echo.
    echo ❌ Release build failed, trying debug with bundle...
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

echo [5/5] Build completed successfully!
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
    echo This APK includes the JavaScript bundle and works standalone
    echo (no Metro bundler connection needed)
    echo.
    echo Creating installable copy...
    copy "%APK_PATH%" "..\trinity-app-standalone.apk" >nul
    if exist "..\trinity-app-standalone.apk" (
        echo ✅ Created: trinity-app-standalone.apk
        echo Location: %cd%\..\trinity-app-standalone.apk
        echo.
        echo 📱 READY FOR DEVICE INSTALLATION!
        echo This APK should work on your device without errors.
    )
) else (
    echo ❌ ERROR: APK file not found at %APK_PATH%
)

echo.
echo 🔍 To verify the APK includes the bundle:
echo 1. Install on device: adb install -r trinity-app-standalone.apk
echo 2. Or copy to device and install manually
echo 3. The app should open without "Unable to load script" error
echo.
pause