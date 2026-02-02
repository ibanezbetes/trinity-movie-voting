@echo off
echo Building Trinity APK (Optimized for Windows)...
echo.

echo Setting environment variables...
set NODE_ENV=production
set ANDROID_HOME=C:\Users\daniz\AppData\Local\Android\Sdk
set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr

echo.
echo Cleaning Metro cache...
npx react-native start --reset-cache --port 8081 > nul 2>&1 &
timeout /t 3 > nul
taskkill /f /im node.exe > nul 2>&1

echo.
echo Pre-building JavaScript bundle...
npx react-native bundle --platform android --dev false --entry-file index.ts --bundle-output android/app/src/main/assets/index.android.bundle --assets-dest android/app/src/main/res/

echo.
echo Building APK with Gradle...
cd android

echo Cleaning previous builds...
call gradlew clean --no-daemon --parallel

echo Building release APK...
call gradlew assembleRelease --no-daemon --parallel --build-cache

if %errorlevel% neq 0 (
    echo.
    echo Release build failed, trying debug build...
    call gradlew assembleDebug --no-daemon --parallel --build-cache
    
    if %errorlevel% neq 0 (
        echo.
        echo ❌ Both builds failed!
        pause
        exit /b %errorlevel%
    ) else (
        echo.
        echo ✅ DEBUG APK built successfully!
        echo Location: android\app\build\outputs\apk\debug\app-debug.apk
    )
) else (
    echo.
    echo ✅ RELEASE APK built successfully!
    echo Location: android\app\build\outputs\apk\release\app-release.apk
)

echo.
echo APK Information:
if exist "app\build\outputs\apk\release\app-release.apk" (
    dir app\build\outputs\apk\release\app-release.apk
) else (
    dir app\build\outputs\apk\debug\app-debug.apk
)

echo.
echo 📱 APK ready for installation!
pause