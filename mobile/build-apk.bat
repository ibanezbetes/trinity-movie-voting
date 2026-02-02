@echo off
echo Building Trinity APK for production...
echo.

echo Setting environment variables...
set NODE_ENV=production

echo Cleaning previous builds...
cd android
call gradlew clean
if %errorlevel% neq 0 (
    echo Clean failed!
    pause
    exit /b %errorlevel%
)

echo Building APK...
call gradlew assembleRelease
if %errorlevel% neq 0 (
    echo Build failed!
    pause
    exit /b %errorlevel%
)

echo.
echo ✅ APK built successfully!
echo Location: android\app\build\outputs\apk\release\app-release.apk
echo.

echo APK Information:
dir app\build\outputs\apk\release\app-release.apk

echo.
echo You can now install this APK on your Android device.
pause