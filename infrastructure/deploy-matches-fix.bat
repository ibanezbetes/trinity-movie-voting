@echo off
echo ========================================
echo Trinity App - Deploy Matches Fix
echo ========================================
echo.

echo Deploying fixes for "Mis Matches" functionality:
echo - Add GSI to TrinityMatches table for user queries
echo - Update Match Lambda with proper getUserMatches implementation  
echo - Update Vote Lambda to create individual user match records
echo.

echo WARNING: This will modify the DynamoDB table structure
echo Existing matches may need to be migrated to work with new GSI
echo.

set /p confirm="Do you want to continue? (y/N): "
if /i not "%confirm%"=="y" if /i not "%confirm%"=="yes" (
    echo Deployment cancelled
    exit /b 0
)

echo.
echo Building Lambda functions...
echo Building Match Lambda...
cd src\handlers\match
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to build Match Lambda
    exit /b 1
)

echo Building Vote Lambda...
cd ..\vote
call npm run build
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to build Vote Lambda
    exit /b 1
)

cd ..\..\..
echo Lambda functions built successfully
echo.

echo Deploying infrastructure changes...
call cdk deploy --require-approval never
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to deploy infrastructure
    exit /b 1
)

echo.
echo ========================================
echo DEPLOYMENT COMPLETE!
echo ========================================
echo.
echo The "Mis Matches" functionality should now work correctly!
echo.
echo What was fixed:
echo - Added GSI to enable efficient user match queries
echo - Fixed getUserMatches() to return actual user matches  
echo - Updated match creation to store individual user records
echo - Enabled proper filtering and sorting of matches
echo.
echo Next steps:
echo 1. Test the mobile app "Mis Matches" screen
echo 2. Create some test matches by voting in rooms
echo 3. Verify matches appear in the "Mis Matches" list
echo 4. Check that matches are sorted by newest first
echo.
echo If you have existing matches, run the migration script:
echo   node scripts\migrate-existing-matches.js
echo.
pause