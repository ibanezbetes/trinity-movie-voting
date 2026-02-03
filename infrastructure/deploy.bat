@echo off
echo Deploying Trinity Infrastructure...
echo.

echo Checking AWS credentials...
aws sts get-caller-identity >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ AWS credentials not configured!
    echo Please run: aws configure
    pause
    exit /b 1
)

echo ✅ AWS credentials verified
echo.

echo Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ❌ Failed to install dependencies!
    pause
    exit /b %errorlevel%
)

echo Building TypeScript...
call npm run build
if %errorlevel% neq 0 (
    echo ❌ TypeScript build failed!
    pause
    exit /b %errorlevel%
)

echo Deploying CDK stack...
call cdk deploy --require-approval never
if %errorlevel% neq 0 (
    echo ❌ CDK deployment failed!
    pause
    exit /b %errorlevel%
)

echo.
echo ✅ Deployment completed successfully!
echo.

echo Generating mobile configuration...
node scripts/generate-mobile-config.js
if %errorlevel% neq 0 (
    echo ⚠️ Warning: Failed to generate mobile config
    echo You may need to run this manually later
)

echo.
echo 🎉 Trinity infrastructure deployed and configured!
echo You can now run the mobile app with: cd ../mobile && npm start
pause