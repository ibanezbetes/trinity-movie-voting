@echo off
echo ========================================
echo Mobile App Match Detection Verification
echo ========================================
echo.
echo This script simulates exactly what the mobile app does
echo to detect matches, helping debug notification issues.
echo.

REM Check if credentials are provided
if "%COGNITO_USERNAME%"=="" (
    echo ERROR: COGNITO_USERNAME environment variable not set
    echo.
    echo Please set your credentials first:
    echo   set COGNITO_USERNAME=your-email@example.com
    echo   set COGNITO_PASSWORD=your-password
    echo.
    echo Example:
    echo   set COGNITO_USERNAME=user@example.com
    echo   set COGNITO_PASSWORD=mypassword
    echo   %~nx0
    echo.
    pause
    exit /b 1
)

if "%COGNITO_PASSWORD%"=="" (
    echo ERROR: COGNITO_PASSWORD environment variable not set
    echo.
    echo Please set your credentials first:
    echo   set COGNITO_USERNAME=your-email@example.com
    echo   set COGNITO_PASSWORD=your-password
    echo.
    pause
    exit /b 1
)

echo Testing with user: %COGNITO_USERNAME%
echo.

REM Install dependencies if needed
if not exist node_modules (
    echo Installing dependencies...
    npm install aws-amplify
    echo.
)

echo Running mobile app simulation...
echo.
node verify-mobile-match-detection.js

echo.
echo ========================================
echo Verification completed
echo ========================================
echo.
echo If matches were found above, your mobile app should:
echo - Show notifications in voting rooms
echo - Display matches in My Matches screen
echo - Receive real-time updates via subscriptions
echo.
echo If no matches found, check backend Lambda logs
echo and DynamoDB tables for match creation issues.
echo.
pause