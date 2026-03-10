# Script para buscar el keystore original de Trinity App
# SHA-1 esperado: 4E:91:C3:BC:9D:1B:10:1F:A4:8D:57:2A:E2:9D:C2:3C:6C:38:56:16

$expectedSHA1 = "4E:91:C3:BC:9D:1B:10:1F:A4:8D:57:2A:E2:9D:C2:3C:6C:38:56:16"
$keytoolPath = "C:\Program Files\Eclipse Adoptium\jdk-21.0.7.6-hotspot\bin\keytool.exe"

Write-Host "Buscando keystores en el sistema..." -ForegroundColor Yellow
Write-Host "SHA-1 esperado: $expectedSHA1" -ForegroundColor Cyan
Write-Host ""

# Buscar en ubicaciones comunes
$searchPaths = @(
    "$env:USERPROFILE\Downloads",
    "$env:USERPROFILE\Documents",
    "$env:USERPROFILE\Desktop",
    "$env:USERPROFILE\OneDrive",
    "C:\Users"
)

foreach ($path in $searchPaths) {
    if (Test-Path $path) {
        Write-Host "Buscando en: $path" -ForegroundColor Gray
        
        $keystores = Get-ChildItem -Path $path -Recurse -Filter "*.keystore" -ErrorAction SilentlyContinue
        
        foreach ($keystore in $keystores) {
            Write-Host "  Encontrado: $($keystore.FullName)" -ForegroundColor Green
            
            # Intentar leer el keystore (puede requerir contraseña)
            try {
                $output = & $keytoolPath -list -v -keystore $keystore.FullName -storepass android 2>&1
                
                if ($output -match "SHA1:\s*([A-F0-9:]+)") {
                    $sha1 = $matches[1].Trim()
                    Write-Host "    SHA-1: $sha1" -ForegroundColor White
                    
                    if ($sha1 -eq $expectedSHA1) {
                        Write-Host "    ¡ENCONTRADO! Este es el keystore correcto" -ForegroundColor Green -BackgroundColor Black
                        Write-Host "    Copia este archivo a: mobile/android/app/" -ForegroundColor Yellow
                    }
                }
            } catch {
                Write-Host "    No se pudo leer (puede requerir contraseña diferente)" -ForegroundColor Red
            }
        }
    }
}

Write-Host ""
Write-Host "Búsqueda completada." -ForegroundColor Yellow
Write-Host ""
Write-Host "Si no encontraste el keystore, verifica:" -ForegroundColor Cyan
Write-Host "  - Backups en la nube (Google Drive, Dropbox, OneDrive)" -ForegroundColor White
Write-Host "  - Discos duros externos" -ForegroundColor White
Write-Host "  - Gestores de contraseñas" -ForegroundColor White
Write-Host "  - Carpetas de proyectos anteriores" -ForegroundColor White
