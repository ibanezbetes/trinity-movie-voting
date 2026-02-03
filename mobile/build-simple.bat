@echo off
echo Building Trinity APK with updated changes...
echo.

echo Current directory: %CD%
echo.

echo Step 1: Creating assets directory...
if not exist "android\app\src\main\assets" mkdir "android\app\src\main\assets"

echo Step 2: Building with Gradle (skipping bundle for now)...
cd android
call gradlew assembleRelease --no-daemon --offline
if %errorlevel% neq 0 (
    echo Trying online build...
    call gradlew assembleRelease --no-daemon
)

if %errorlevel% neq 0 (
    echo Build failed! Trying debug build...
    call gradlew assembleDebug --no-daemon
)

echo.
echo Build completed. Checking for APK files...
dir app\build\outputs\apk\release\ 2>nul
dir app\build\outputs\apk\debug\ 2>nul

echo.
pause