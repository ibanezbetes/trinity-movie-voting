@echo off
echo Building Trinity DEBUG APK...
echo.

echo Setting environment variables...
set NODE_ENV=development

echo Cleaning previous builds...
cd android
call gradlew clean --no-daemon
if %errorlevel% neq 0 (
    echo Clean failed!
    pause
    exit /b %errorlevel%
)

echo Building DEBUG APK...
call gradlew assembleDebug --no-daemon
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b %errorlevel%
)

echo.
echo ✅ DEBUG APK built successfully!
echo Location: android\app\build\outputs\apk\debug\app-debug.apk
echo.

echo APK Information:
dir app\build\outputs\apk\debug\app-debug.apk

echo.
echo 📱 You can now install this DEBUG APK on your Android device.
echo 🔧 This APK includes debugging features and connects to Metro bundler.
echo.
echo To install: adb install app\build\outputs\apk\debug\app-debug.apk
pause