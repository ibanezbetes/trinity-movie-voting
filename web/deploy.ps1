# Trinity Web - Deployment Script
# Este script sube los archivos necesarios al servidor vía FTP

# Configuración (EDITA ESTOS VALORES)
$FTP_HOST = "ftp.trinity-app.es"
$FTP_USER = "tu_usuario_ftp"
$FTP_PASS = "tu_password_ftp"
$REMOTE_PATH = "/public_html"

Write-Host "🚀 Trinity Web Deployment" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan
Write-Host ""

# Verificar que los archivos existen
$files = @(
    ".htaccess",
    "room.html",
    ".well-known/apple-app-site-association",
    ".well-known/assetlinks.json"
)

Write-Host "📋 Verificando archivos..." -ForegroundColor Yellow
foreach ($file in $files) {
    if (Test-Path $file) {
        Write-Host "  ✓ $file" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $file (NO ENCONTRADO)" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "⚠️  IMPORTANTE: Antes de continuar, verifica que:" -ForegroundColor Yellow
Write-Host "  1. Has reemplazado TEAM_ID en apple-app-site-association" -ForegroundColor Yellow
Write-Host "  2. Has configurado FTP_HOST, FTP_USER y FTP_PASS arriba" -ForegroundColor Yellow
Write-Host ""

$confirm = Read-Host "¿Continuar con el deployment? (s/n)"
if ($confirm -ne "s") {
    Write-Host "❌ Deployment cancelado" -ForegroundColor Red
    exit 0
}

Write-Host ""
Write-Host "📤 Subiendo archivos al servidor..." -ForegroundColor Cyan

# Nota: Este script requiere WinSCP o similar para FTP
# Alternativa: Usar un cliente FTP GUI como FileZilla

Write-Host ""
Write-Host "💡 Para subir los archivos, usa uno de estos métodos:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. FileZilla (GUI):" -ForegroundColor White
Write-Host "   - Conecta a: $FTP_HOST" -ForegroundColor Gray
Write-Host "   - Usuario: $FTP_USER" -ForegroundColor Gray
Write-Host "   - Sube los archivos a: $REMOTE_PATH" -ForegroundColor Gray
Write-Host ""
Write-Host "2. WinSCP (GUI):" -ForegroundColor White
Write-Host "   - Protocolo: FTP" -ForegroundColor Gray
Write-Host "   - Host: $FTP_HOST" -ForegroundColor Gray
Write-Host "   - Usuario: $FTP_USER" -ForegroundColor Gray
Write-Host ""
Write-Host "3. cPanel File Manager:" -ForegroundColor White
Write-Host "   - Accede a tu cPanel" -ForegroundColor Gray
Write-Host "   - Ve a 'Administrador de archivos'" -ForegroundColor Gray
Write-Host "   - Navega a public_html/" -ForegroundColor Gray
Write-Host "   - Sube los archivos" -ForegroundColor Gray
Write-Host ""

Write-Host "✅ Archivos listos para subir" -ForegroundColor Green
