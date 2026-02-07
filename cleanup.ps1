# Trinity Project Cleanup Script
# Version: 1.0.0
# Last Updated: 2026-02-07
# Description: Limpia archivos temporales del proyecto Trinity

Write-Host "🧹 Iniciando limpieza del proyecto Trinity..." -ForegroundColor Cyan
Write-Host ""

$filesDeleted = 0
$foldersDeleted = 0

# 1. Eliminar documentación temporal en root
Write-Host "📄 Limpiando documentación temporal en root..." -ForegroundColor Yellow
$tempDocs = Get-ChildItem -Path "." -File | Where-Object {
    $_.Name -match '(_FIX|_SUMMARY|_BUILD|_IMPLEMENTATION|_TEMP|_WIP|_DRAFT|_ERROR|_SOLUTION|_CELEBRATION|_INSTALACION|_SUCCESS|_DEPLOYMENT|_STATUS|_CAPACITY|_LIMIT|_INFO|_READY|_VERIFICATION|_TROUBLESHOOTING|_CHANGELOG|_FEATURES|_INSTRUCTIONS|_DOCUMENTATION|_REFERENCE|_USAGE|_APK|_CLIENTS|_NOTES|_IMPROVEMENT|_SYNC|_COMPLETED|_STEPS)\.md$' -and
    $_.Name -notmatch '^(README|LICENSE|PROJECT_STATUS)' -and
    $_.FullName -notmatch 'docs\\'
}
foreach ($file in $tempDocs) {
    Remove-Item $file.FullName -Force
    Write-Host "  ✓ Eliminado: $($file.Name)" -ForegroundColor Gray
    $filesDeleted++
}

# 2. Eliminar APKs temporales
Write-Host "📱 Limpiando APKs temporales..." -ForegroundColor Yellow
$apks = Get-ChildItem -Path "." -Filter "*.apk" -File
foreach ($apk in $apks) {
    Remove-Item $apk.FullName -Force
    Write-Host "  ✓ Eliminado: $($apk.Name)" -ForegroundColor Gray
    $filesDeleted++
}

# 3. Eliminar scripts temporales en root
Write-Host "📜 Limpiando scripts temporales en root..." -ForegroundColor Yellow
$tempScripts = Get-ChildItem -Path "." -File | Where-Object {
    ($_.Name -match '^(build|deploy|install|test|create|get|update|check|verify|upload|download|sync)-.*\.(bat|js|ps1|sh)$') -and
    $_.Name -ne 'cleanup.ps1'
}
foreach ($script in $tempScripts) {
    Remove-Item $script.FullName -Force
    Write-Host "  ✓ Eliminado: $($script.Name)" -ForegroundColor Gray
    $filesDeleted++
}

# 4. Limpiar infrastructure
Write-Host "🏗️ Limpiando infrastructure..." -ForegroundColor Yellow

# Documentación temporal en infrastructure
if (Test-Path "infrastructure") {
    $infraDocs = Get-ChildItem -Path "infrastructure" -File | Where-Object {
        $_.Name -match '(_FIX|_SUMMARY|_BUILD|_IMPLEMENTATION|_TEMP|_WIP|_DRAFT|_ERROR|_SOLUTION|_CELEBRATION|_INSTALACION|_SUCCESS|_DEPLOYMENT|_STATUS|_NOW|_SYNC|_COMPLETED)\.md$' -and
        $_.Name -notmatch '^README'
    }
    foreach ($file in $infraDocs) {
        Remove-Item $file.FullName -Force
        Write-Host "  ✓ Eliminado: infrastructure/$($file.Name)" -ForegroundColor Gray
        $filesDeleted++
    }

    # Scripts temporales en infrastructure
    $infraScripts = Get-ChildItem -Path "infrastructure" -File | Where-Object {
        ($_.Name -match '^(check|deploy|find|force|upload|download|verify)-.*\.(bat|js|ps1|sh)$') -and
        $_.Name -ne 'create-zips.ps1'
    }
    foreach ($script in $infraScripts) {
        Remove-Item $script.FullName -Force
        Write-Host "  ✓ Eliminado: infrastructure/$($script.Name)" -ForegroundColor Gray
        $filesDeleted++
    }

    # Reportes temporales
    $infraReports = Get-ChildItem -Path "infrastructure" -Filter "*-report.json" -File
    foreach ($report in $infraReports) {
        Remove-Item $report.FullName -Force
        Write-Host "  ✓ Eliminado: infrastructure/$($report.Name)" -ForegroundColor Gray
        $filesDeleted++
    }
}

# 5. Limpiar mobile
Write-Host "📱 Limpiando mobile..." -ForegroundColor Yellow

if (Test-Path "mobile") {
    # Documentación temporal en mobile
    $mobileDocs = Get-ChildItem -Path "mobile" -File | Where-Object {
        $_.Name -match '(_FIX|_SUMMARY|_BUILD|_IMPLEMENTATION|_TEMP|_WIP|_DRAFT|_ERROR|_SOLUTION|_CELEBRATION|_INSTALACION|_SUCCESS|_DEPLOYMENT|_STATUS|_GUIDE|_INSTRUCTIONS)\.md$' -and
        $_.Name -notmatch '^README'
    }
    foreach ($file in $mobileDocs) {
        Remove-Item $file.FullName -Force
        Write-Host "  ✓ Eliminado: mobile/$($file.Name)" -ForegroundColor Gray
        $filesDeleted++
    }

    # Scripts temporales en mobile
    $mobileScripts = Get-ChildItem -Path "mobile" -File | Where-Object {
        $_.Name -match '^(build|install|deploy)-.*\.(bat|sh|ps1)$'
    }
    foreach ($script in $mobileScripts) {
        Remove-Item $script.FullName -Force
        Write-Host "  ✓ Eliminado: mobile/$($script.Name)" -ForegroundColor Gray
        $filesDeleted++
    }

    # APKs en mobile
    $mobileApks = Get-ChildItem -Path "mobile" -Filter "*.apk" -File -ErrorAction SilentlyContinue
    foreach ($apk in $mobileApks) {
        Remove-Item $apk.FullName -Force
        Write-Host "  ✓ Eliminado: mobile/$($apk.Name)" -ForegroundColor Gray
        $filesDeleted++
    }
}

# 6. Limpiar archivos de test y respuestas
Write-Host "🧪 Limpiando archivos de test..." -ForegroundColor Yellow
$testFiles = Get-ChildItem -Recurse -File | Where-Object {
    ($_.Name -match '(test-|_test|-response|-payload)\.json$') -and
    $_.FullName -notmatch 'node_modules'
}
foreach ($file in $testFiles) {
    Remove-Item $file.FullName -Force
    Write-Host "  ✓ Eliminado: $($file.FullName.Replace($PWD.Path + '\', ''))" -ForegroundColor Gray
    $filesDeleted++
}

# 7. Limpiar ZIPs temporales (excepto lambda-zips)
Write-Host "📦 Limpiando ZIPs temporales..." -ForegroundColor Yellow
$tempZips = Get-ChildItem -Recurse -File -Filter "*.zip" | Where-Object {
    $_.FullName -notmatch 'lambda-zips' -and
    $_.FullName -notmatch 'node_modules'
}
foreach ($zip in $tempZips) {
    Remove-Item $zip.FullName -Force
    Write-Host "  ✓ Eliminado: $($zip.FullName.Replace($PWD.Path + '\', ''))" -ForegroundColor Gray
    $filesDeleted++
}

# 8. Limpiar carpetas de build
Write-Host "🏗️ Limpiando carpetas de build..." -ForegroundColor Yellow

# Android build
if (Test-Path "mobile/android/app/build") {
    Remove-Item "mobile/android/app/build" -Recurse -Force
    Write-Host "  ✓ Eliminado: mobile/android/app/build/" -ForegroundColor Gray
    $foldersDeleted++
}

# Android .cxx
if (Test-Path "mobile/android/app/.cxx") {
    Remove-Item "mobile/android/app/.cxx" -Recurse -Force
    Write-Host "  ✓ Eliminado: mobile/android/app/.cxx/" -ForegroundColor Gray
    $foldersDeleted++
}

# Android build root
if (Test-Path "mobile/android/build") {
    Remove-Item "mobile/android/build" -Recurse -Force
    Write-Host "  ✓ Eliminado: mobile/android/build/" -ForegroundColor Gray
    $foldersDeleted++
}

# CDK cache
if (Test-Path "infrastructure/cdk.out/.cache") {
    Remove-Item "infrastructure/cdk.out/.cache" -Recurse -Force
    Write-Host "  ✓ Eliminado: infrastructure/cdk.out/.cache/" -ForegroundColor Gray
    $foldersDeleted++
}

# 9. Limpiar carpetas temporales
Write-Host "📁 Limpiando carpetas temporales..." -ForegroundColor Yellow

$tempFolders = @(
    "lambda-fixes",
    "docu_trinity",
    "docs_backup",
    "temp-lambda-downloads"
)

foreach ($folder in $tempFolders) {
    if (Test-Path $folder) {
        Remove-Item $folder -Recurse -Force
        Write-Host "  ✓ Eliminado: $folder/" -ForegroundColor Gray
        $foldersDeleted++
    }
}

# 10. Resumen
Write-Host ""
Write-Host "✅ Limpieza completada!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Resumen:" -ForegroundColor Cyan
Write-Host "  • Archivos eliminados: $filesDeleted" -ForegroundColor White
Write-Host "  • Carpetas eliminadas: $foldersDeleted" -ForegroundColor White
Write-Host ""
Write-Host "💡 Recomendaciones:" -ForegroundColor Yellow
Write-Host "  • Ejecuta 'git status' para ver los cambios" -ForegroundColor White
Write-Host "  • Revisa que no se hayan eliminado archivos importantes" -ForegroundColor White
Write-Host "  • Ejecuta este script regularmente para mantener el proyecto limpio" -ForegroundColor White
Write-Host ""
