# Trinity - Generate Android App Bundle (.aab) for Google Play Store
# Version: 1.0.0
# Date: 2026-02-08

Write-Host "🎬 Trinity - Generador de Android App Bundle (.aab)" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Check if keystore.properties exists
$keystorePropsPath = "android/keystore.properties"
if (-Not (Test-Path $keystorePropsPath)) {
    Write-Host "⚠️  ADVERTENCIA: No se encontró keystore.properties" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Necesitas crear tu keystore de producción primero." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Pasos:" -ForegroundColor White
    Write-Host "1. Genera el keystore:" -ForegroundColor White
    Write-Host "   cd android/app" -ForegroundColor Gray
    Write-Host "   keytool -genkeypair -v -storetype PKCS12 -keystore trinity-release.keystore -alias trinity-key-alias -keyalg RSA -keysize 2048 -validity 10000" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. Copia el archivo de ejemplo:" -ForegroundColor White
    Write-Host "   cd android" -ForegroundColor Gray
    Write-Host "   copy keystore.properties.example keystore.properties" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. Edita keystore.properties con tus contraseñas" -ForegroundColor White
    Write-Host ""
    Write-Host "4. Vuelve a ejecutar este script" -ForegroundColor White
    Write-Host ""
    Write-Host "📖 Consulta docs/GOOGLE_PLAY_STORE_GUIDE.md para más detalles" -ForegroundColor Cyan
    exit 1
}

Write-Host "✅ keystore.properties encontrado" -ForegroundColor Green
Write-Host ""

# Check if keystore file exists
$keystoreProps = Get-Content $keystorePropsPath | ConvertFrom-StringData
$keystoreFile = "android/app/" + $keystoreProps.storeFile

if (-Not (Test-Path $keystoreFile)) {
    Write-Host "❌ ERROR: No se encontró el archivo keystore: $keystoreFile" -ForegroundColor Red
    Write-Host ""
    Write-Host "Verifica que el archivo exista o genera uno nuevo." -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Keystore encontrado: $keystoreFile" -ForegroundColor Green
Write-Host ""

# Get current version
$appJsonPath = "app.json"
$appJson = Get-Content $appJsonPath | ConvertFrom-Json
$version = $appJson.expo.version

Write-Host "📦 Versión actual: $version" -ForegroundColor Cyan
Write-Host ""

# Confirm before building
Write-Host "¿Deseas generar el AAB para esta versión? (S/N): " -ForegroundColor Yellow -NoNewline
$confirm = Read-Host

if ($confirm -ne "S" -and $confirm -ne "s") {
    Write-Host "❌ Operación cancelada" -ForegroundColor Red
    exit 0
}

Write-Host ""
Write-Host "🔨 Iniciando build..." -ForegroundColor Cyan
Write-Host ""

# Navigate to android folder
Set-Location android

# Clean previous builds
Write-Host "🧹 Limpiando builds anteriores..." -ForegroundColor Yellow
./gradlew clean

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error al limpiar builds" -ForegroundColor Red
    Set-Location ..
    exit 1
}

Write-Host "✅ Limpieza completada" -ForegroundColor Green
Write-Host ""

# Generate AAB
Write-Host "📦 Generando Android App Bundle (.aab)..." -ForegroundColor Yellow
Write-Host "⏳ Esto puede tomar varios minutos..." -ForegroundColor Gray
Write-Host ""

./gradlew bundleRelease

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error al generar AAB" -ForegroundColor Red
    Set-Location ..
    exit 1
}

# Return to mobile folder
Set-Location ..

# Check if AAB was generated
$aabPath = "android/app/build/outputs/bundle/release/app-release.aab"
if (-Not (Test-Path $aabPath)) {
    Write-Host "❌ ERROR: No se generó el archivo AAB" -ForegroundColor Red
    exit 1
}

# Get file size
$aabSize = (Get-Item $aabPath).Length / 1MB
$aabSizeFormatted = "{0:N2}" -f $aabSize

Write-Host ""
Write-Host "=================================================" -ForegroundColor Green
Write-Host "✅ ¡AAB GENERADO EXITOSAMENTE!" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
Write-Host ""
Write-Host "📦 Archivo: $aabPath" -ForegroundColor Cyan
Write-Host "📊 Tamaño: $aabSizeFormatted MB" -ForegroundColor Cyan
Write-Host "🎯 Versión: $version" -ForegroundColor Cyan
Write-Host ""
Write-Host "📤 Próximos pasos:" -ForegroundColor Yellow
Write-Host "1. Ve a Google Play Console: https://play.google.com/console" -ForegroundColor White
Write-Host "2. Selecciona tu app (o crea una nueva)" -ForegroundColor White
Write-Host "3. Ve a Producción > Crear nueva versión" -ForegroundColor White
Write-Host "4. Sube el archivo: $aabPath" -ForegroundColor White
Write-Host "5. Completa la información y envía a revisión" -ForegroundColor White
Write-Host ""
Write-Host "📖 Guía completa: docs/GOOGLE_PLAY_STORE_GUIDE.md" -ForegroundColor Cyan
Write-Host ""
Write-Host "🎬 Stop Scroll Infinity - Ponte de acuerdo en un chin ✨" -ForegroundColor Magenta
Write-Host ""
