@echo off
echo ========================================
echo Deploying Individual User Notifications
echo ========================================
echo.
echo This deployment adds individual user notifications
echo to solve the async voting notification problem.
echo.

REM Set deployment timestamp
set DEPLOY_TIME=%date:~-4,4%-%date:~-10,2%-%date:~-7,2%_%time:~0,2%-%time:~3,2%-%time:~6,2%
set DEPLOY_TIME=%DEPLOY_TIME: =0%

echo Deployment started at: %DEPLOY_TIME%
echo.

echo Building TypeScript handlers...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: TypeScript build failed
    pause
    exit /b 1
)

echo.
echo Deploying infrastructure with CDK...
call npx cdk deploy --require-approval never
if %errorlevel% neq 0 (
    echo ERROR: CDK deployment failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo Deployment Completed Successfully!
echo ========================================
echo.
echo New features deployed:
echo - Individual user notifications (publishUserMatch)
echo - User-specific subscriptions (userMatch)
echo - Enhanced vote handler with per-user notifications
echo - Dual subscription system in mobile app
echo.
echo This solves the async voting notification problem:
echo - ALL users who voted "yes" get notified
echo - Not just the last user who voted
echo - Works even if users voted at different times
echo.
echo Deployment Time: %DEPLOY_TIME%
echo.
pause