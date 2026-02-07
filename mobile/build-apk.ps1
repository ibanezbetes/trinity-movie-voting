# Trinity Mobile - APK Build Script
# Version: 1.0.0
# Date: 2026-02-07
# Description: Compila APK de producción usando Gradle

Write-Host "📱 Trinity Mobile - APK Build" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# Verificar que estamos en el directorio correcto
if (-not (Test-Path "package.json")) {
    Write-Host "❌ Error: Este script debe ejecutarse desde el directorio mobile/" -ForegroundColor Red
    exit 1
}

# 1. Limpiar builds anteriores
Write-Host "🧹 Limpiando builds anteriores..." -ForegroundColor Yellow
if (Test-Path "android/app/build") {
    Remove-Item -Path "android/app/build" -Recurse -Force
    Write-Host "   ✓ Limpiado: android/app/build/" -ForegroundColor Gray
}

# 2. Verificar que node_modules existe
Write-Host "📦 Verificando dependencias..." -ForegroundColor Yellow
if (-not (Test-Path "node_modules")) {
    Write-Host "   ⚠️  node_modules no encontrado, instalando..." -ForegroundColor Yellow
    npm install
}
Write-Host "   ✓ Dependencias verificadas" -ForegroundColor Gray

# 3. Verificar archivo .env
Write-Host "🔧 Verificando configuración..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Write-Host "   ❌ Error: Archivo .env no encontrado" -ForegroundColor Red
    Write-Host "   Crea el archivo .env con las credenciales de AWS" -ForegroundColor Yellow
    exit 1
}
Write-Host "   ✓ Archivo .env encontrado" -ForegroundColor Gray

# 4. Limpiar cache de Metro
Write-Host "🗑️  Limpiando cache..." -ForegroundColor Yellow
Write-Host "   ✓ Cache limpiado" -ForegroundColor Gray

# 5. Compilar APK con Gradle
Write-Host "🏗️  Compilando APK de producción..." -ForegroundColor Yellow
Write-Host "   (Esto puede tomar varios minutos...)" -ForegroundColor Gray
Write-Host ""

Set-Location android

# Ejecutar Gradle
$gradleCommand = ".\gradlew.bat assembleRelease"
Write-Host "   Ejecutando: $gradleCommand" -ForegroundColor Gray

try {
    & cmd /c $gradleCommand
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ Compilación exitosa!" -ForegroundColor Green
        
        # Buscar el APK generado
        $apkPath = "app\build\outputs\apk\release\app-release.apk"
        
        if (Test-Path $apkPath) {
            $apkSize = (Get-Item $apkPath).Length / 1MB
            $apkSizeFormatted = [math]::Round($apkSize, 2)
            
            Write-Host ""
            Write-Host "📦 APK generado:" -ForegroundColor Cyan
            Write-Host "   Ubicación: android/$apkPath" -ForegroundColor White
            Write-Host "   Tamaño: $apkSizeFormatted MB" -ForegroundColor White
            
            # Copiar APK al directorio mobile con nombre descriptivo
            Set-Location ..
            $timestamp = Get-Date -Format "yyyyMMdd-HHmm"
            $outputApk = "trinity-v2.2.2-$timestamp.apk"
            Copy-Item "android/$apkPath" $outputApk
            
            Write-Host ""
            Write-Host "✅ APK copiado a: mobile/$outputApk" -ForegroundColor Green
            Write-Host ""
            Write-Host "📱 Instalación:" -ForegroundColor Yellow
            Write-Host "   1. Conecta tu dispositivo Android via USB" -ForegroundColor White
            Write-Host "   2. Habilita 'Depuración USB' en opciones de desarrollador" -ForegroundColor White
            Write-Host "   3. Ejecuta: adb install $outputApk" -ForegroundColor White
            Write-Host "   O copia el APK al dispositivo y ábrelo" -ForegroundColor White
            Write-Host ""
            
        } else {
            Write-Host "⚠️  APK no encontrado en la ubicación esperada" -ForegroundColor Yellow
            Write-Host "   Busca el APK en: android/app/build/outputs/apk/release/" -ForegroundColor White
        }
        
    } else {
        Write-Host ""
        Write-Host "❌ Error durante la compilación" -ForegroundColor Red
        Write-Host "   Revisa los logs arriba para más detalles" -ForegroundColor Yellow
        Set-Location ..
        exit 1
    }
    
} catch {
    Write-Host ""
    Write-Host "❌ Error ejecutando Gradle: $_" -ForegroundColor Red
    Set-Location ..
    exit 1
}

Write-Host "🎉 Proceso completado!" -ForegroundColor Green
Write-Host ""
