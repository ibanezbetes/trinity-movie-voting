# Trinity Keystore Backup Script
# Crea una copia de seguridad de todos los archivos críticos de firma

$ErrorActionPreference = "Stop"

Write-Host "🔐 Trinity Keystore Backup Script" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# Configuración
$BackupDir = "KEYSTORE_BACKUP"
$Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$BackupDirWithTimestamp = "${BackupDir}_${Timestamp}"

# Archivos críticos a respaldar
$CriticalFiles = @(
    @{
        Source = "mobile/android/app/trinity-release-key.keystore"
        Name = "trinity-release-key.keystore"
        Critical = $true
        Description = "Keystore de producción (CRÍTICO)"
    },
    @{
        Source = "mobile/android/keystore.properties"
        Name = "keystore.properties"
        Critical = $true
        Description = "Credenciales de keystore"
    },
    @{
        Source = "mobile/android/upload_certificate.pem"
        Name = "upload_certificate.pem"
        Critical = $false
        Description = "Certificado de subida"
    },
    @{
        Source = "mobile/android/KEYSTORE_FINGERPRINTS.txt"
        Name = "KEYSTORE_FINGERPRINTS.txt"
        Critical = $false
        Description = "Fingerprints documentados"
    },
    @{
        Source = "mobile/android/app/build.gradle"
        Name = "build.gradle"
        Critical = $true
        Description = "Configuración de build"
    },
    @{
        Source = "KEYSTORE_BACKUP_GUIDE.md"
        Name = "README.md"
        Critical = $true
        Description = "Guía de backup y recuperación"
    }
)

# Crear directorio de backup
Write-Host "📁 Creando directorio de backup..." -ForegroundColor Yellow
if (Test-Path $BackupDir) {
    Write-Host "   ⚠️  Directorio $BackupDir ya existe" -ForegroundColor Yellow
    $response = Read-Host "   ¿Sobrescribir? (s/n)"
    if ($response -ne "s") {
        Write-Host "   ❌ Backup cancelado" -ForegroundColor Red
        exit 1
    }
    Remove-Item -Recurse -Force $BackupDir
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
Write-Host "   ✅ Directorio creado: $BackupDir" -ForegroundColor Green
Write-Host ""

# Copiar archivos
Write-Host "📋 Copiando archivos críticos..." -ForegroundColor Yellow
Write-Host ""

$SuccessCount = 0
$FailCount = 0
$CriticalMissing = @()

foreach ($file in $CriticalFiles) {
    $sourcePath = $file.Source
    $destPath = Join-Path $BackupDir $file.Name
    $description = $file.Description
    $isCritical = $file.Critical
    
    Write-Host "   Copiando: $description" -ForegroundColor White
    Write-Host "   Origen:   $sourcePath" -ForegroundColor Gray
    
    if (Test-Path $sourcePath) {
        try {
            Copy-Item $sourcePath $destPath -Force
            Write-Host "   ✅ Copiado exitosamente" -ForegroundColor Green
            $SuccessCount++
        } catch {
            Write-Host "   ❌ Error al copiar: $($_.Exception.Message)" -ForegroundColor Red
            $FailCount++
            if ($isCritical) {
                $CriticalMissing += $description
            }
        }
    } else {
        Write-Host "   ⚠️  Archivo no encontrado" -ForegroundColor Yellow
        $FailCount++
        if ($isCritical) {
            $CriticalMissing += $description
        }
    }
    Write-Host ""
}

# Crear archivo de información del backup
$BackupInfo = @"
Trinity Keystore Backup
=======================

Fecha de backup: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Archivos copiados: $SuccessCount
Archivos faltantes: $FailCount

Archivos incluidos:
-------------------
"@

foreach ($file in $CriticalFiles) {
    $status = if (Test-Path (Join-Path $BackupDir $file.Name)) { "✅" } else { "❌" }
    $BackupInfo += "`n$status $($file.Name) - $($file.Description)"
}

$BackupInfo += @"


Información de la Keystore:
---------------------------
Alias: trinity-key-alias
Store Password: TrinityApp2024!
Key Password: TrinityApp2024!

SHA1: 5E:91:A9:4E:3C:5A:2F:0D:0D:BF:CD:E0:8D:47:43:F7:43:8F:AE:24
SHA256: 56:CF:A1:1B:79:1B:36:A5:4D:F5:17:18:FA:E8:D9:A2:FE:F9:8E:5E:2A:C7:75:8C:6E:9D:2A:F2:B8:1E:6A:97

Google Play SHA256: F9:75:E8:C1:B7:6A:BE:A3:D3:29:65:98:CC:E3:20:DA:6D:4A:97:3E:B9:9B:2E:72:57:93:F1:54:7A:CE:EC:61

⚠️ IMPORTANTE:
- Guarda este backup en múltiples ubicaciones
- Nunca subas la keystore sin encriptar a la nube
- Verifica los backups mensualmente
- La keystore es IRREMPLAZABLE

Próximas acciones:
-----------------
1. Copiar carpeta $BackupDir a USB externo
2. Copiar carpeta $BackupDir a otro disco duro
3. Crear ZIP encriptado y subir a nube
4. Actualizar fecha en KEYSTORE_BACKUP_GUIDE.md
"@

$BackupInfo | Out-File -FilePath (Join-Path $BackupDir "BACKUP_INFO.txt") -Encoding UTF8

# Resumen
Write-Host "=================================" -ForegroundColor Cyan
Write-Host "📊 Resumen del Backup" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "✅ Archivos copiados: $SuccessCount" -ForegroundColor Green
Write-Host "❌ Archivos faltantes: $FailCount" -ForegroundColor $(if ($FailCount -gt 0) { "Red" } else { "Green" })
Write-Host ""
Write-Host "📁 Ubicación del backup: $BackupDir" -ForegroundColor White
Write-Host ""

if ($CriticalMissing.Count -gt 0) {
    Write-Host "⚠️  ADVERTENCIA: Archivos críticos faltantes:" -ForegroundColor Red
    foreach ($missing in $CriticalMissing) {
        Write-Host "   - $missing" -ForegroundColor Red
    }
    Write-Host ""
}

# Verificar keystore
Write-Host "🔍 Verificando keystore..." -ForegroundColor Yellow
$keystorePath = Join-Path $BackupDir "trinity-release-key.keystore"
if (Test-Path $keystorePath) {
    $keystoreSize = (Get-Item $keystorePath).Length
    Write-Host "   ✅ Keystore encontrada" -ForegroundColor Green
    Write-Host "   Tamaño: $keystoreSize bytes" -ForegroundColor Gray
    
    # Intentar verificar fingerprints (requiere keytool)
    try {
        $keytoolOutput = keytool -list -v -keystore $keystorePath -alias trinity-key-alias -storepass "TrinityApp2024!" 2>&1
        if ($keytoolOutput -match "SHA256: (.+)") {
            $sha256 = $Matches[1].Trim()
            Write-Host "   SHA256: $sha256" -ForegroundColor Cyan
        }
    } catch {
        Write-Host "   ⚠️  No se pudo verificar fingerprint (keytool no disponible)" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ❌ Keystore NO encontrada en el backup" -ForegroundColor Red
}
Write-Host ""

# Instrucciones finales
Write-Host "=================================" -ForegroundColor Cyan
Write-Host "📋 Próximos Pasos" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Copiar carpeta '$BackupDir' a USB externo" -ForegroundColor White
Write-Host "2. Copiar carpeta '$BackupDir' a otro disco duro" -ForegroundColor White
Write-Host "3. Crear ZIP encriptado:" -ForegroundColor White
Write-Host "   7z a -p -mhe=on trinity-keystore-backup.7z $BackupDir/" -ForegroundColor Gray
Write-Host "4. Subir ZIP encriptado a Google Drive/Dropbox" -ForegroundColor White
Write-Host "5. Actualizar fecha en KEYSTORE_BACKUP_GUIDE.md" -ForegroundColor White
Write-Host ""
Write-Host "⚠️  RECORDATORIO: La keystore es IRREMPLAZABLE" -ForegroundColor Red
Write-Host "   Sin ella, pierdes acceso permanente a Google Play Store" -ForegroundColor Red
Write-Host ""
Write-Host "✅ Backup completado exitosamente" -ForegroundColor Green
