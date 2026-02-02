@echo off
echo ========================================
echo Deploying Room-Based Match Notifications
echo ========================================
echo.

echo [1/3] Installing CDK dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to install CDK dependencies
    exit /b 1
)

echo [2/3] Building CDK stack...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to build CDK stack
    exit /b 1
)

echo [3/3] Deploying to AWS...
call cdk deploy --require-approval never
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to deploy CDK stack
    exit /b 1
)

echo.
echo ========================================
echo ✅ Room-Based Notifications Deployed!
echo ========================================
echo.
echo New Features:
echo - roomMatch subscription with roomId filtering
echo - publishRoomMatch mutation for broadcasting
echo - Room membership validation (basic)
echo - Enhanced match detection with room broadcasting
echo.
echo Next Steps:
echo 1. Test the mobile app to verify notifications work
echo 2. Check CloudWatch logs for room match events
echo 3. Implement Task 2 for persistent room membership
echo.
pause