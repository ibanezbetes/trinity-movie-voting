# Trinity - Create Production Keystore
# Version: 1.0.0
# Date: 2026-02-08

Write-Host "🔐 Trinity - Generador de Keystore de Producción" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "⚠️  ADVERTENCIA CRÍTICA" -ForegroundColor Red
Write-Host "El keystore es lo MÁS IMPORTANTE de tu app." -ForegroundColor Yellow
Write-Host "Si lo pierdes, NUNCA podrás actualizar tu app." -ForegroundColor Yellow
Write-Host ""
Write-Host "Guárdalo en múltiples lugares:" -ForegroundColor White
Write-Host "  ✅ Google Drive / Dropbox / OneDrive" -ForegroundColor Green
Write-Host "  ✅ USB externo" -ForegroundColor Green
Write-Host "  ✅ Disco duro externo" -ForegroundColor Green
Write-Host "  ✅ Email a ti mismo" -ForegroundColor Green
Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Check if keystore already exists
$keystorePath = "android/app/trinity-release.keystore"
if (Test-Path $keystorePath) {
    Write-Host "⚠️  Ya existe un keystore en: $keystorePath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "¿Deseas crear uno nuevo? Esto SOBRESCRIBIRÁ el existente. (S/N): " -ForegroundColor Red -NoNewline
    $confirm = Read-Host
    
    if ($confirm -ne "S" -and $confirm -ne "s") {
        Write-Host "❌ Operación cancelada" -ForegroundColor Red
        exit 0
    }
    
    Write-Host ""
    Write-Host "⚠️  ÚLTIMA ADVERTENCIA: Esto sobrescribirá tu keystore actual." -ForegroundColor Red
    Write-Host "Si ya publicaste la app con el keystore anterior, NO PODRÁS actualizarla." -ForegroundColor Red
    Write-Host ""
    Write-Host "¿Estás SEGURO? (S/N): " -ForegroundColor Red -NoNewline
    $confirmFinal = Read-Host
    
    if ($confirmFinal -ne "S" -and $confirmFinal -ne "s") {
        Write-Host "❌ Operación cancelada" -ForegroundColor Red
        exit 0
    }
}

Write-Host ""
Write-Host "📝 Información del Keystore" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""

# Collect information
Write-Host "Contraseña del keystore (mínimo 6 caracteres): " -ForegroundColor Yellow -NoNewline
$storePassword = Read-Host -AsSecureString
$storePasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePassword))

if ($storePasswordPlain.Length -lt 6) {
    Write-Host "❌ La contraseña debe tener al menos 6 caracteres" -ForegroundColor Red
    exit 1
}

Write-Host "Confirmar contraseña: " -ForegroundColor Yellow -NoNewline
$storePasswordConfirm = Read-Host -AsSecureString
$storePasswordConfirmPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($storePasswordConfirm))

if ($storePasswordPlain -ne $storePasswordConfirmPlain) {
    Write-Host "❌ Las contraseñas no coinciden" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Nombre y apellidos: " -ForegroundColor Yellow -NoNewline
$name = Read-Host

Write-Host "Unidad organizativa (ej: Trinity Team): " -ForegroundColor Yellow -NoNewline
$orgUnit = Read-Host

Write-Host "Organización (ej: Trinity App): " -ForegroundColor Yellow -NoNewline
$org = Read-Host

Write-Host "Ciudad: " -ForegroundColor Yellow -NoNewline
$city = Read-Host

Write-Host "Estado/Provincia: " -ForegroundColor Yellow -NoNewline
$state = Read-Host

Write-Host "Código de país (ES para España): " -ForegroundColor Yellow -NoNewline
$country = Read-Host

Write-Host ""
Write-Host "🔨 Generando keystore..." -ForegroundColor Cyan
Write-Host ""

# Navigate to android/app
Set-Location android/app

# Generate keystore
$keytoolCmd = "keytool -genkeypair -v -storetype PKCS12 -keystore trinity-release.keystore -alias trinity-key-alias -keyalg RSA -keysize 2048 -validity 10000 -storepass `"$storePasswordPlain`" -keypass `"$storePasswordPlain`" -dname `"CN=$name, OU=$orgUnit, O=$org, L=$city, ST=$state, C=$country`""

Invoke-Expression $keytoolCmd

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error al generar keystore" -ForegroundColor Red
    Set-Location ../..
    exit 1
}

# Return to mobile folder
Set-Location ../..

Write-Host ""
Write-Host "✅ Keystore generado exitosamente" -ForegroundColor Green
Write-Host ""

# Create keystore.properties
Write-Host "📝 Creando keystore.properties..." -ForegroundColor Cyan

$keystorePropsContent = @"
# Keystore Configuration for Release Builds
# IMPORTANT: DO NOT commit this file to Git!

storePassword=$storePasswordPlain
keyPassword=$storePasswordPlain
keyAlias=trinity-key-alias
storeFile=trinity-release.keystore
"@

$keystorePropsContent | Out-File -FilePath "android/keystore.properties" -Encoding UTF8

Write-Host "✅ keystore.properties creado" -ForegroundColor Green
Write-Host ""

# Save credentials to a text file
Write-Host "💾 Guardando credenciales..." -ForegroundColor Cyan

$credentialsContent = @"
TRINITY APP - KEYSTORE CREDENTIALS
===================================

⚠️  GUARDA ESTE ARCHIVO EN UN LUGAR SEGURO
⚠️  SI PIERDES ESTA INFORMACIÓN, NO PODRÁS ACTUALIZAR TU APP

Keystore File: trinity-release.keystore
Store Password: $storePasswordPlain
Key Alias: trinity-key-alias
Key Password: $storePasswordPlain

Información del Certificado:
----------------------------
Nombre: $name
Unidad Organizativa: $orgUnit
Organización: $org
Ciudad: $city
Estado/Provincia: $state
País: $country

Fecha de Creación: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Validez: 10,000 días (~27 años)

UBICACIONES DONDE DEBES GUARDAR ESTE ARCHIVO:
----------------------------------------------
✅ Google Drive / Dropbox / OneDrive
✅ USB externo
✅ Disco duro externo
✅ Email a ti mismo
✅ Gestor de contraseñas (LastPass, 1Password, Bitwarden)

ARCHIVOS QUE DEBES RESPALDAR:
------------------------------
✅ android/app/trinity-release.keystore
✅ android/keystore.properties
✅ Este archivo (trinity-keystore-credentials.txt)

---
Trinity App
trinity.app.spain@gmail.com
https://trinity-app.es
"@

$credentialsContent | Out-File -FilePath "trinity-keystore-credentials.txt" -Encoding UTF8

Write-Host "✅ Credenciales guardadas en: trinity-keystore-credentials.txt" -ForegroundColor Green
Write-Host ""

Write-Host "=================================================" -ForegroundColor Green
Write-Host "✅ ¡KEYSTORE CREADO EXITOSAMENTE!" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
Write-Host ""
Write-Host "📁 Archivos generados:" -ForegroundColor Cyan
Write-Host "  • android/app/trinity-release.keystore" -ForegroundColor White
Write-Host "  • android/keystore.properties" -ForegroundColor White
Write-Host "  • trinity-keystore-credentials.txt" -ForegroundColor White
Write-Host ""
Write-Host "🔐 Credenciales:" -ForegroundColor Cyan
Write-Host "  Store Password: $storePasswordPlain" -ForegroundColor White
Write-Host "  Key Alias: trinity-key-alias" -ForegroundColor White
Write-Host "  Key Password: $storePasswordPlain" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  IMPORTANTE - GUARDA ESTOS ARCHIVOS:" -ForegroundColor Red
Write-Host "  1. Copia trinity-keystore-credentials.txt a Google Drive" -ForegroundColor Yellow
Write-Host "  2. Copia android/app/trinity-release.keystore a Google Drive" -ForegroundColor Yellow
Write-Host "  3. Envía trinity-keystore-credentials.txt a tu email" -ForegroundColor Yellow
Write-Host "  4. Guarda en USB/disco externo" -ForegroundColor Yellow
Write-Host ""
Write-Host "📤 Próximos pasos:" -ForegroundColor Cyan
Write-Host "  1. Ejecuta: ./generate-aab.ps1" -ForegroundColor White
Write-Host "  2. Sube el AAB a Google Play Console" -ForegroundColor White
Write-Host ""
Write-Host "📖 Guía completa: docs/GOOGLE_PLAY_STORE_GUIDE.md" -ForegroundColor Cyan
Write-Host ""
Write-Host "🎬 Stop Scroll Infinity - Ponte de acuerdo en un chin ✨" -ForegroundColor Magenta
Write-Host ""
