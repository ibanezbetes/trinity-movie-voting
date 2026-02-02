@echo off
echo ========================================
echo Trinity App - Standalone APK Build
echo (Includes JS bundle - no Metro needed)
echo ========================================
echo.

REM Set environment variables for production
set NODE_ENV=production
set REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1

echo [1/7] Setting up environment...
echo NODE_ENV=%NODE_ENV%
echo.

echo [2/7] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo.

echo [3/7] Creating assets directory...
if not exist "android\app\src\main\assets" (
    mkdir "android\app\src\main\assets"
)
echo Assets directory ready
echo.

echo [4/7] Generating JavaScript bundle with Expo...
call npx expo export --platform android --output-dir dist --clear
if %ERRORLEVEL% neq 0 (
    echo Trying alternative bundle method...
    call npx expo export:embed --platform android --entry-file index.ts
    if %ERRORLEVEL% neq 0 (
        echo ERROR: Bundle generation failed with both methods
        pause
        exit /b 1
    )
) else (
    echo Copying bundle from export...
    if exist "dist\_expo\static\js\android" (
        copy "dist\_expo\static\js\android\*.js" "android\app\src\main\assets\index.android.bundle"
    )
)
echo Bundle generated successfully
echo.

echo [5/7] Verifying bundle exists...
if exist "android\app\src\main\assets\index.android.bundle" (
    for %%I in ("android\app\src\main\assets\index.android.bundle") do (
        echo Bundle size: %%~zI bytes
    )
    echo ✅ Bundle verified
) else (
    echo ❌ ERROR: Bundle not found
    pause
    exit /b 1
)
echo.

echo [6/7] Building APK with embedded bundle...
cd android
call gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a --no-daemon
if %ERRORLEVEL% neq 0 (
    echo ERROR: Gradle build failed
    pause
    exit /b 1
)
echo.

echo [7/7] Build completed successfully!
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
    echo ✅ SUCCESS: Standalone APK built successfully!
    echo.
    echo This APK:
    echo - Contains embedded JavaScript bundle
    echo - Does NOT need Metro bundler
    echo - Works offline on any device
    echo - Includes all Trinity features
    echo.
    echo Creating installable copy...
    copy "app\build\outputs\apk\debug\app-debug.apk" "..\trinity-app-standalone.apk" >nul
    if exist "..\trinity-app-standalone.apk" (
        echo ✅ Created: trinity-app-standalone.apk
        echo Location: %cd%\..\trinity-app-standalone.apk
        echo.
        echo This APK is ready for device installation!
    )
) else (
    echo ❌ ERROR: APK file not found
)

echo.
pause