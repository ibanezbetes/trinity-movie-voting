# Script para solucionar problemas de Expo en Windows
# Ejecutar desde mobile/

Write-Host "🔧 Solucionando problemas de Expo..." -ForegroundColor Cyan
Write-Host ""

# 1. Detener procesos de Node y Expo
Write-Host "1️⃣ Deteniendo procesos de Node y Expo..." -ForegroundColor Yellow
Get-Process | Where-Object {$_.ProcessName -like "*node*" -or $_.ProcessName -like "*expo*"} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 2. Limpiar cache de npm
Write-Host "2️⃣ Limpiando cache de npm..." -ForegroundColor Yellow
npm cache clean --force

# 3. Eliminar node_modules (forzado)
Write-Host "3️⃣ Eliminando node_modules..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    # Intentar eliminación normal
    Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue
    
    # Si falla, usar robocopy para limpiar (método Windows)
    if (Test-Path "node_modules") {
        Write-Host "   Usando método alternativo..." -ForegroundColor Gray
        $emptyDir = New-Item -ItemType Directory -Path "empty_temp" -Force
        robocopy $emptyDir.FullName "node_modules" /MIR /R:0 /W:0 | Out-Null
        Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force "empty_temp" -ErrorAction SilentlyContinue
    }
}

# 4. Eliminar package-lock.json
Write-Host "4️⃣ Eliminando package-lock.json..." -ForegroundColor Yellow
if (Test-Path "package-lock.json") {
    Remove-Item -Force "package-lock.json"
}

# 5. Eliminar cache de Expo
Write-Host "5️⃣ Eliminando cache de Expo..." -ForegroundColor Yellow
if (Test-Path ".expo") {
    Remove-Item -Recurse -Force ".expo" -ErrorAction SilentlyContinue
}

# 6. Limpiar cache de Metro
Write-Host "6️⃣ Limpiando cache de Metro..." -ForegroundColor Yellow
$metroCache = "$env:LOCALAPPDATA\Temp\metro-*"
Remove-Item -Recurse -Force $metroCache -ErrorAction SilentlyContinue

# 7. Reinstalar dependencias
Write-Host "7️⃣ Reinstalando dependencias..." -ForegroundColor Yellow
npm install

Write-Host ""
Write-Host "✅ Limpieza completada!" -ForegroundColor Green
Write-Host ""
Write-Host "🚀 Ahora puedes ejecutar:" -ForegroundColor Cyan
Write-Host "   npx expo start" -ForegroundColor White
Write-Host ""
