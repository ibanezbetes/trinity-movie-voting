@echo off
echo Checking GSI status for TrinityMatches table...
echo.

:loop
aws dynamodb describe-table --table-name TrinityMatches --query "Table.GlobalSecondaryIndexes[?IndexName=='userId-timestamp-index'].IndexStatus" --output text > temp_status.txt
set /p status=<temp_status.txt
del temp_status.txt

echo GSI Status: %status%

if "%status%"=="ACTIVE" (
    echo.
    echo ✅ GSI is now ACTIVE! The "Mis Matches" functionality is ready to use.
    echo.
    echo Next steps:
    echo 1. Test the mobile app "Mis Matches" screen
    echo 2. Create some test matches by voting in rooms
    echo 3. Verify matches appear in the "Mis Matches" list
    echo.
    goto end
)

if "%status%"=="CREATING" (
    echo ⏳ GSI is still being created... waiting 30 seconds
    timeout /t 30 /nobreak > nul
    goto loop
)

echo ❌ Unexpected GSI status: %status%
echo Please check the AWS console for more details.

:end
pause