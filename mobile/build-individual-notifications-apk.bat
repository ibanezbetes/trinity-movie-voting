@echo off
echo ========================================
echo Building APK with Individual Notifications
echo ========================================
echo.
echo This build includes the solution for async voting:
echo - Individual user notifications
echo - Dual subscription system (user + room)
echo - Enhanced notification delivery
echo.

REM Set build timestamp
set BUILD_TIME=%date:~-4,4%-%date:~-10,2%-%date:~-7,2%_%time:~0,2%-%time:~3,2%-%time:~6,2%
set BUILD_TIME=%BUILD_TIME: =0%

echo Build started at: %BUILD_TIME%
echo.

REM Clean previous builds thoroughly
echo Cleaning previous builds...
echo Removing .cxx directories...
rmdir /s /q "android\app\.cxx" 2>nul
rmdir /s /q "android\.cxx" 2>nul
echo Removing build directories...
rmdir /s /q "android\build" 2>nul
rmdir /s /q "android\app\build" 2>nul

echo Cleaning node_modules cache...
npm cache clean --force 2>nul

echo Running Gradle clean...
cd android
call gradlew clean --no-daemon
if %errorlevel% neq 0 (
    echo WARNING: Gradle clean had issues, continuing anyway...
)

echo.
echo Prebuild with Expo to generate native code...
cd ..
call npx expo prebuild --platform android --clean
if %errorlevel% neq 0 (
    echo ERROR: Expo prebuild failed
    pause
    exit /b 1
)

echo.
echo Generating Android bundle...
call npx expo export --platform android
if %errorlevel% neq 0 (
    echo ERROR: Expo export failed
    pause
    exit /b 1
)

echo.
echo Building APK with Gradle (no daemon for stability)...
cd android
call gradlew assembleRelease --no-daemon --stacktrace
if %errorlevel% neq 0 (
    echo ERROR: Gradle build failed
    echo Check the error messages above for details
    pause
    exit /b 1
)

echo.
echo ========================================
echo APK Build Completed Successfully!
echo ========================================

REM Copy APK with descriptive name
set APK_NAME=trinity-app-INDIVIDUAL-NOTIFICATIONS.apk
copy "app\build\outputs\apk\release\app-release.apk" "..\%APK_NAME%"

echo.
echo APK Location: mobile\%APK_NAME%
echo Build Time: %BUILD_TIME%
echo.
echo Features included in this build:
echo - Individual user notifications (solves async voting)
echo - Dual subscription system (user + room based)
echo - Enhanced notification delivery to ALL users
echo - Real-time WebSocket improvements
echo - Robust polling fallback system
echo.
echo PROBLEM SOLVED:
echo - ALL users who voted "yes" get notified
echo - Not just the last user who voted
echo - Works even if users voted at different times
echo.
echo Ready to install on your device!
echo.
pause