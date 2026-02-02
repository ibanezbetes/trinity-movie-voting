@echo off
echo Building Trinity APK using EAS Build (local)...
echo.

echo Installing EAS CLI if not present...
call npm install -g @expo/eas-cli

echo.
echo Building APK locally...
call eas build --platform android --local --profile preview

echo.
echo Build completed! Check the output above for the APK location.
pause