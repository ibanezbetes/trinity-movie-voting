@echo off
echo ========================================
echo Trinity App - Restore Backup Script
echo ========================================
echo.

set BACKUP_DIR=trinity_backup_optimistic_ui_working_20260203_144032

echo Checking if backup exists...
if not exist "..\%BACKUP_DIR%" (
    echo ERROR: Backup directory not found: ..\%BACKUP_DIR%
    echo Please ensure the backup exists before running this script.
    pause
    exit /b 1
)

echo.
echo WARNING: This will restore the project to the Optimistic UI working state.
echo Current changes will be lost if not backed up separately.
echo.
set /p confirm="Are you sure you want to restore? (y/N): "
if /i not "%confirm%"=="y" (
    echo Restore cancelled.
    pause
    exit /b 0
)

echo.
echo [1/5] Creating restore directory...
set RESTORE_DIR=trinity_app_restored_%date:~-4,4%%date:~-10,2%%date:~-7,2%_%time:~0,2%%time:~3,2%
set RESTORE_DIR=%RESTORE_DIR: =0%
mkdir "..\%RESTORE_DIR%"

echo.
echo [2/5] Copying backup files...
xcopy "..\%BACKUP_DIR%\*" "..\%RESTORE_DIR%\" /E /H /Y

echo.
echo [3/5] Installing infrastructure dependencies...
cd "..\%RESTORE_DIR%\infrastructure"
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install infrastructure dependencies
    pause
    exit /b 1
)

echo.
echo [4/5] Installing mobile dependencies...
cd "..\mobile"
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install mobile dependencies
    pause
    exit /b 1
)

echo.
echo [5/5] Verifying Android configuration...
if not exist "android\local.properties" (
    echo Creating Android SDK configuration...
    echo sdk.dir=C:\\Users\\%USERNAME%\\AppData\\Local\\Android\\Sdk > android\local.properties
)

echo.
echo ========================================
echo RESTORE COMPLETED SUCCESSFULLY!
echo ========================================
echo Restored to: ..\%RESTORE_DIR%
echo.
echo Next steps:
echo 1. Navigate to the restored directory
echo 2. Test the Optimistic UI functionality
echo 3. Compile APK if needed: mobile\build-apk.bat
echo.
echo The restored project includes:
echo - Working Optimistic UI implementation
echo - Functional APK (trinity-optimistic-ui-v1.0.apk)
echo - Complete documentation
echo - All source code
echo ========================================
pause