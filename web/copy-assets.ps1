# Trinity Web - Copy Assets Script
# Este script copia los assets necesarios desde mobile/assets/ a web/assets/
# Útil para deployment independiente de la carpeta web

Write-Host "🎬 Trinity Web - Copy Assets" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan
Write-Host ""

# Verificar que estamos en la carpeta correcta
if (-not (Test-Path "index.html")) {
    Write-Host "❌ Error: Debes ejecutar este script desde la carpeta web/" -ForegroundColor Red
    exit 1
}

# Verificar que existe la carpeta mobile/assets
if (-not (Test-Path "../mobile/assets")) {
    Write-Host "❌ Error: No se encuentra la carpeta mobile/assets/" -ForegroundColor Red
    exit 1
}

# Crear carpeta assets si no existe
if (-not (Test-Path "assets")) {
    Write-Host "📁 Creando carpeta assets..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path "assets" | Out-Null
}

# Copiar imágenes necesarias
Write-Host "📋 Copiando imágenes..." -ForegroundColor Yellow

$filesToCopy = @(
    "splash-icon.png",
    "favicon.png"
)

foreach ($file in $filesToCopy) {
    $source = "../mobile/assets/$file"
    $destination = "assets/$file"
    
    if (Test-Path $source) {
        Copy-Item -Path $source -Destination $destination -Force
        Write-Host "  ✅ Copiado: $file" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  No encontrado: $file" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "🔄 Actualizando rutas en archivos HTML..." -ForegroundColor Yellow

# Actualizar rutas en archivos HTML
$htmlFiles = Get-ChildItem -Path . -Filter "*.html"

foreach ($htmlFile in $htmlFiles) {
    $content = Get-Content $htmlFile.FullName -Raw
    $updatedContent = $content -replace '\.\./mobile/assets/', './assets/'
    
    if ($content -ne $updatedContent) {
        Set-Content -Path $htmlFile.FullName -Value $updatedContent
        Write-Host "  ✅ Actualizado: $($htmlFile.Name)" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "✅ ¡Assets copiados y rutas actualizadas!" -ForegroundColor Green
Write-Host "📦 Ahora puedes deployar la carpeta web/ de forma independiente" -ForegroundColor Cyan
Write-Host ""
Write-Host "⚠️  NOTA: Si quieres revertir los cambios, ejecuta:" -ForegroundColor Yellow
Write-Host "   git checkout *.html" -ForegroundColor Gray
