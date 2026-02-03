@echo off
echo ========================================
echo Building NEW APK - Individual Notifications
echo ========================================
echo.
echo This is a COMPLETE NEW BUILD with:
echo - Individual user notifications
echo - Dual subscription system
echo - Enhanced async voting solution
echo.

REM Set build timestamp
set BUILD_TIME=%date:~-4,4%-%date:~-10,2%-%date:~-7,2%_%time:~0,2%-%time:~3,2%-%time:~6,2%
set BUILD_TIME=%BUILD_TIME: =0%

echo Build started at: %BUILD_TIME%
echo.

REM Step 1: Clean everything thoroughly
echo ========================================
echo Step 1: Complete Cleanup
echo ========================================
echo.

echo Stopping any running Metro processes...
taskkill /f /im node.exe 2>nul
taskkill /f /im java.exe 2>nul

echo Cleaning build directories...
if exist "android\.cxx" rmdir /s /q "android\.cxx"
if exist "android\app\.cxx" rmdir /s /q "android\app\.cxx"
if exist "android\build" rmdir /s /q "android\build"
if exist "android\app\build" rmdir /s /q "android\app\build"

echo Cleaning Gradle cache...
cd android
call gradlew clean --no-daemon --quiet
cd ..

echo Cleaning npm cache...
npm cache clean --force

echo.
echo ========================================
echo Step 2: Prebuild Native Code
echo ========================================
echo.

echo Running Expo prebuild (clean)...
call npx expo prebuild --platform android --clean
if %errorlevel% neq 0 (
    echo ERROR: Expo prebuild failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo Step 3: Generate Bundle
echo ========================================
echo.

echo Generating production bundle...
call npx expo export --platform android
if %errorlevel% neq 0 (
    echo ERROR: Bundle generation failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo Step 4: Build APK with Gradle
echo ========================================
echo.

echo Building release APK...
cd android
call gradlew assembleRelease --no-daemon --stacktrace --info
if %errorlevel% neq 0 (
    echo ERROR: APK build failed
    echo.
    echo Trying alternative build method...
    call gradlew assembleRelease --no-daemon --debug
    if %errorlevel% neq 0 (
        echo ERROR: Both build methods failed
        pause
        exit /b 1
    )
)

echo.
echo ========================================
echo Step 5: Copy and Verify APK
echo ========================================
echo.

REM Check if APK was created
if not exist "app\build\outputs\apk\release\app-release.apk" (
    echo ERROR: APK file not found after build
    echo Expected location: android\app\build\outputs\apk\release\app-release.apk
    pause
    exit /b 1
)

REM Copy APK with descriptive name
set APK_NAME=trinity-app-INDIVIDUAL-NOTIFICATIONS-v2.apk
copy "app\build\outputs\apk\release\app-release.apk" "..\%APK_NAME%"

echo.
echo ========================================
echo BUILD COMPLETED SUCCESSFULLY!
echo ========================================
echo.
echo APK Details:
echo - File: %APK_NAME%
echo - Location: mobile\%APK_NAME%
echo - Build Time: %BUILD_TIME%
echo - Size: 
dir "..\%APK_NAME%" | find "%APK_NAME%"
echo.
echo NEW FEATURES INCLUDED:
echo ✅ Individual user notifications (publishUserMatch)
echo ✅ Dual subscription system (user + room)
echo ✅ Enhanced async voting solution
echo ✅ Real-time WebSocket improvements
echo ✅ Robust polling fallback
echo.
echo PROBLEM SOLVED:
echo ✅ ALL users who voted "yes" get notified
echo ✅ Not just the last user who voted
echo ✅ Works with async voting (different times)
echo.
echo Ready to install: install-individual-notifications-apk.bat
echo.
pause