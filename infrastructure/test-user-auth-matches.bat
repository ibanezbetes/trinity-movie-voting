@echo off
echo ========================================
echo User Authentication Match Verification
echo ========================================
echo.
echo This script tests match queries using Cognito user authentication
echo (same method as mobile app)
echo.

REM Check if credentials are provided
if "%COGNITO_USERNAME%"=="" (
    echo ERROR: COGNITO_USERNAME environment variable not set
    echo.
    echo Please set your credentials:
    echo   set COGNITO_USERNAME=your-email@example.com
    echo   set COGNITO_PASSWORD=your-password
    echo.
    echo Then run this script again.
    echo.
    pause
    exit /b 1
)

if "%COGNITO_PASSWORD%"=="" (
    echo ERROR: COGNITO_PASSWORD environment variable not set
    echo.
    echo Please set your credentials:
    echo   set COGNITO_USERNAME=your-email@example.com
    echo   set COGNITO_PASSWORD=your-password
    echo.
    echo Then run this script again.
    echo.
    pause
    exit /b 1
)

echo Using credentials for: %COGNITO_USERNAME%
echo.

REM Install dependencies if needed
if not exist node_modules (
    echo Installing dependencies...
    npm install aws-amplify
    echo.
)

echo Running user authentication test...
echo.
node check-matches-with-user-auth.js

echo.
echo ========================================
echo Test completed
echo ========================================
pause