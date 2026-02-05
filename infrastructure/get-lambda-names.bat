@echo off
echo ========================================
echo Trinity Lambda Functions - Name Finder
echo ========================================

echo.
echo Buscando funciones Lambda de Trinity en eu-west-1...
echo.

aws lambda list-functions --region eu-west-1 --query "Functions[?starts_with(FunctionName, 'TrinityStack')].{Name:FunctionName,Runtime:Runtime,Handler:Handler}" --output table

echo.
echo ========================================
echo Instrucciones:
echo ========================================
echo 1. Busca la funcion que contenga "TmdbHandler" 
echo 2. Busca la funcion que contenga "RoomHandler"
echo 3. Usa esos nombres exactos en la consola AWS
echo ========================================

pause