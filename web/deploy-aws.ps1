# Trinity Web - AWS S3 Deployment Script
# Sube el sitio web a S3 y invalida el cache de CloudFront

param(
    [string]$BucketName = "trinity-app-web",
    [string]$DistributionId = "",
    [switch]$SkipInvalidation
)

Write-Host "🚀 Trinity Web - AWS Deployment" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Verificar que AWS CLI está instalado
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Error: AWS CLI no está instalado" -ForegroundColor Red
    Write-Host "Instala AWS CLI desde: https://aws.amazon.com/cli/" -ForegroundColor Yellow
    exit 1
}

# Verificar credenciales de AWS
Write-Host "🔐 Verificando credenciales de AWS..." -ForegroundColor Yellow
$awsIdentity = aws sts get-caller-identity 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error: No se pudo verificar las credenciales de AWS" -ForegroundColor Red
    Write-Host "Ejecuta: aws configure" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Credenciales verificadas" -ForegroundColor Green
Write-Host ""

# Verificar que el bucket existe
Write-Host "🪣 Verificando bucket S3: $BucketName..." -ForegroundColor Yellow
$bucketExists = aws s3 ls "s3://$BucketName" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error: El bucket '$BucketName' no existe o no tienes acceso" -ForegroundColor Red
    Write-Host "Crea el bucket con: aws s3 mb s3://$BucketName" -ForegroundColor Yellow
    exit 1
}
Write-Host "✅ Bucket encontrado" -ForegroundColor Green
Write-Host ""

# Subir archivos a S3
Write-Host "📤 Subiendo archivos a S3..." -ForegroundColor Yellow
Write-Host ""

# Sync con delete (elimina archivos que ya no existen)
aws s3 sync . "s3://$BucketName" `
    --delete `
    --exclude ".git/*" `
    --exclude "*.ps1" `
    --exclude "*.sh" `
    --exclude "*.md" `
    --exclude "node_modules/*" `
    --cache-control "public, max-age=31536000" `
    --exclude "*.html" `
    --exclude "*.json"

# Subir HTML con cache corto
aws s3 sync . "s3://$BucketName" `
    --exclude "*" `
    --include "*.html" `
    --cache-control "public, max-age=3600"

# Subir JSON con cache corto
aws s3 sync . "s3://$BucketName" `
    --exclude "*" `
    --include "*.json" `
    --cache-control "public, max-age=3600"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error al subir archivos a S3" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ Archivos subidos correctamente" -ForegroundColor Green
Write-Host ""

# Invalidar cache de CloudFront
if (-not $SkipInvalidation) {
    if ([string]::IsNullOrEmpty($DistributionId)) {
        Write-Host "⚠️  Distribution ID no proporcionado" -ForegroundColor Yellow
        Write-Host "Para invalidar el cache de CloudFront, ejecuta:" -ForegroundColor Yellow
        Write-Host "  .\deploy-aws.ps1 -DistributionId YOUR_DISTRIBUTION_ID" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "O manualmente:" -ForegroundColor Yellow
        Write-Host "  aws cloudfront create-invalidation --distribution-id YOUR_ID --paths '/*'" -ForegroundColor Cyan
    } else {
        Write-Host "🔄 Invalidando cache de CloudFront..." -ForegroundColor Yellow
        $invalidation = aws cloudfront create-invalidation `
            --distribution-id $DistributionId `
            --paths "/*" 2>&1
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ Error al invalidar cache de CloudFront" -ForegroundColor Red
            Write-Host $invalidation -ForegroundColor Red
        } else {
            Write-Host "✅ Cache invalidado correctamente" -ForegroundColor Green
            Write-Host "Los cambios estarán disponibles en unos minutos" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "🎉 Deployment completado!" -ForegroundColor Green
Write-Host ""
Write-Host "🌐 Sitio web: https://trinity-app.es" -ForegroundColor Cyan
Write-Host ""

# Mostrar información útil
Write-Host "📋 Comandos útiles:" -ForegroundColor Yellow
Write-Host "  Ver archivos en S3:" -ForegroundColor Gray
Write-Host "    aws s3 ls s3://$BucketName --recursive" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Invalidar cache manualmente:" -ForegroundColor Gray
Write-Host "    aws cloudfront create-invalidation --distribution-id YOUR_ID --paths '/*'" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Ver distribuciones de CloudFront:" -ForegroundColor Gray
Write-Host "    aws cloudfront list-distributions --query 'DistributionList.Items[*].[Id,DomainName,Comment]' --output table" -ForegroundColor Cyan
Write-Host ""
