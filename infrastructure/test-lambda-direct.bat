@echo off
echo ========================================
echo Trinity TMDB Lambda - Direct Test
echo ========================================

echo.
echo [1/3] Buscando función TmdbHandler...
aws lambda list-functions --region eu-west-1 --query "Functions[?contains(FunctionName, 'TmdbHandler')].{Name:FunctionName,Runtime:Runtime}" --output table

echo.
echo [2/3] Verificando variables de entorno...
for /f "tokens=*" %%i in ('aws lambda list-functions --region eu-west-1 --query "Functions[?contains(FunctionName, 'TmdbHandler')].FunctionName" --output text') do set FUNCTION_NAME=%%i

if "%FUNCTION_NAME%"=="" (
    echo ERROR: No se encontró la función TmdbHandler
    pause
    exit /b 1
)

echo Función encontrada: %FUNCTION_NAME%
echo.
echo Variables de entorno:
aws lambda get-function-configuration --function-name "%FUNCTION_NAME%" --region eu-west-1 --query "Environment.Variables" --output table

echo.
echo [3/3] Ejecutando test directo...
aws lambda invoke --function-name "%FUNCTION_NAME%" --region eu-west-1 --payload file://test-tmdb-function.json response-tmdb.json

echo.
echo Respuesta de la función:
type response-tmdb.json

echo.
echo ========================================
echo Verificar logs en CloudWatch:
echo https://console.aws.amazon.com/cloudwatch/home?region=eu-west-1#logsV2:log-groups/log-group/%%252Faws%%252Flambda%%252F%FUNCTION_NAME%
echo ========================================

pause