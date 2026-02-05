# Trinity Project Cleanup Script
# Ejecutar mensualmente para mantener el proyecto limpio
# Uso: .\cleanup.ps1

Write-Host "🧹 Iniciando limpieza del proyecto Trinity..." -ForegroundColor Cyan
Write-Host ""

$filesRemoved = 0

# Eliminar documentación temporal
Write-Host "📄 Eliminando documentación temporal..." -ForegroundColor Yellow
$tempDocs = Get-ChildItem -Recurse -File | Where-Object {
    $_.Name -match '(_FIX|_SUMMARY|_BUILD|_IMPLEMENTATION|_TEMP|_WIP|_DRAFT|_ERROR|_SOLUTION|_DIAGNOSIS|_OPTIONS|_CELEBRATION|_INSTALACION|_TROUBLESHOOTING|_DEPLOYMENT|_CHANGELOG|_FEATURES|_INSTRUCTIONS|_DOCUMENTATION|_REFERENCE|_USAGE|_CLIENTS|_NOTES)\.md$' -and
    $_.FullName -notmatch 'node_modules' -and
    $_.FullName -notmatch '\\docs\\' -and
    $_.FullName -notmatch '\\\.git\\' -and
    $_.Name -notmatch '^(README|LICENSE|CHANGELOG|CLEANUP_SUMMARY)\.md$'
}
foreach ($file in $tempDocs) {
    Write-Host "  Eliminando: $($file.Name)" -ForegroundColor Gray
    Remove-Item $file.FullName -Force
    $filesRemoved++
}

# Eliminar scripts temporales
Write-Host "📜 Eliminando scripts temporales..." -ForegroundColor Yellow
$tempScripts = Get-ChildItem -Recurse -File | Where-Object {
    ($_.Name -match '^(build|deploy|install|test|create|get|update|verify|check)-.*\.(bat|js)$') -and
    $_.FullName -notmatch 'node_modules' -and
    $_.FullName -notmatch '\\scripts\\' -and
    $_.FullName -notmatch '\\\.git\\'
}
foreach ($file in $tempScripts) {
    Write-Host "  Eliminando: $($file.Name)" -ForegroundColor Gray
    Remove-Item $file.FullName -Force
    $filesRemoved++
}

# Eliminar archivos de test JSON
Write-Host "🧪 Eliminando archivos de test..." -ForegroundColor Yellow
$testFiles = Get-ChildItem -Recurse -File | Where-Object {
    $_.Name -match '(test-|_test|-response|-payload)\.json$' -and
    $_.FullName -notmatch 'node_modules' -and
    $_.FullName -notmatch '\\\.git\\'
}
foreach ($file in $testFiles) {
    Write-Host "  Eliminando: $($file.Name)" -ForegroundColor Gray
    Remove-Item $file.FullName -Force
    $filesRemoved++
}

# Eliminar APKs temporales
Write-Host "📱 Eliminando APKs temporales..." -ForegroundColor Yellow
if (Test-Path "mobile") {
    $apks = Get-ChildItem -Path "mobile" -Filter "*.apk" -File -Recurse | Where-Object {
        $_.FullName -notmatch 'node_modules'
    }
    foreach ($file in $apks) {
        Write-Host "  Eliminando: $($file.Name)" -ForegroundColor Gray
        Remove-Item $file.FullName -Force
        $filesRemoved++
    }
}

# Eliminar AABs temporales
Write-Host "📦 Eliminando AABs temporales..." -ForegroundColor Yellow
if (Test-Path "mobile") {
    $aabs = Get-ChildItem -Path "mobile" -Filter "*.aab" -File -Recurse | Where-Object {
        $_.FullName -notmatch 'node_modules'
    }
    foreach ($file in $aabs) {
        Write-Host "  Eliminando: $($file.Name)" -ForegroundColor Gray
        Remove-Item $file.FullName -Force
        $filesRemoved++
    }
}

# Eliminar ZIPs temporales (excepto lambda-zips)
Write-Host "🗜️ Eliminando ZIPs temporales..." -ForegroundColor Yellow
$tempZips = Get-ChildItem -Recurse -File -Filter "*.zip" | Where-Object {
    $_.FullName -notmatch 'lambda-zips' -and
    $_.FullName -notmatch 'node_modules' -and
    $_.FullName -notmatch '\\\.git\\'
}
foreach ($file in $tempZips) {
    Write-Host "  Eliminando: $($file.Name)" -ForegroundColor Gray
    Remove-Item $file.FullName -Force
    $filesRemoved++
}

# Eliminar carpetas duplicadas
Write-Host "📁 Eliminando carpetas duplicadas..." -ForegroundColor Yellow
$duplicateFolders = @(
    "docu_trinity",
    "docs_backup",
    "lambda-fixes",
    "temp",
    "tmp"
)
foreach ($folder in $duplicateFolders) {
    if (Test-Path $folder) {
        Write-Host "  Eliminando carpeta: $folder" -ForegroundColor Gray
        Remove-Item $folder -Recurse -Force
        $filesRemoved++
    }
}

# Limpiar carpetas de build de Android
Write-Host "🏗️ Limpiando carpetas de build de Android..." -ForegroundColor Yellow
$buildPaths = @(
    "mobile\android\app\build",
    "mobile\android\app\.cxx",
    "mobile\android\build"
)
foreach ($path in $buildPaths) {
    if (Test-Path $path) {
        Write-Host "  Limpiando: $path" -ForegroundColor Gray
        Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Limpiar cdk.out (se regenera automáticamente)
Write-Host "☁️ Limpiando cdk.out..." -ForegroundColor Yellow
if (Test-Path "infrastructure\cdk.out") {
    Write-Host "  Limpiando: infrastructure\cdk.out" -ForegroundColor Gray
    Remove-Item "infrastructure\cdk.out" -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "✅ Limpieza completada!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Resumen:" -ForegroundColor Cyan
Write-Host "  ✓ Archivos eliminados: $filesRemoved" -ForegroundColor White
Write-Host "  ✓ Documentación temporal eliminada" -ForegroundColor White
Write-Host "  ✓ Scripts temporales eliminados" -ForegroundColor White
Write-Host "  ✓ Archivos de test eliminados" -ForegroundColor White
Write-Host "  ✓ APKs/AABs temporales eliminados" -ForegroundColor White
Write-Host "  ✓ ZIPs temporales eliminados" -ForegroundColor White
Write-Host "  ✓ Carpetas de build limpiadas" -ForegroundColor White
Write-Host ""
Write-Host "💡 Tip: Ejecuta este script mensualmente para mantener el proyecto limpio" -ForegroundColor Yellow
Write-Host ""
