# Trinity Web - Deployment Script (PowerShell)
# Este script facilita el deployment del sitio web a diferentes plataformas

Write-Host "🎬 Trinity Web - Deployment Script" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Verificar que estamos en la carpeta correcta
if (-not (Test-Path "index.html")) {
    Write-Host "❌ Error: Debes ejecutar este script desde la carpeta web/" -ForegroundColor Red
    exit 1
}

Write-Host "Selecciona la plataforma de deployment:" -ForegroundColor Yellow
Write-Host "1) Netlify"
Write-Host "2) Vercel"
Write-Host "3) AWS S3"
Write-Host "4) GitHub Pages"
Write-Host "5) Cancelar"
Write-Host ""
$option = Read-Host "Opción (1-5)"

switch ($option) {
    "1" {
        Write-Host ""
        Write-Host "📦 Deploying to Netlify..." -ForegroundColor Green
        
        # Verificar si Netlify CLI está instalado
        $netlifyInstalled = Get-Command netlify -ErrorAction SilentlyContinue
        if (-not $netlifyInstalled) {
            Write-Host "⚠️  Netlify CLI no está instalado" -ForegroundColor Yellow
            Write-Host "Instalando: npm install -g netlify-cli"
            npm install -g netlify-cli
        }
        
        netlify deploy --prod
    }
    "2" {
        Write-Host ""
        Write-Host "📦 Deploying to Vercel..." -ForegroundColor Green
        
        # Verificar si Vercel CLI está instalado
        $vercelInstalled = Get-Command vercel -ErrorAction SilentlyContinue
        if (-not $vercelInstalled) {
            Write-Host "⚠️  Vercel CLI no está instalado" -ForegroundColor Yellow
            Write-Host "Instalando: npm install -g vercel"
            npm install -g vercel
        }
        
        vercel --prod
    }
    "3" {
        Write-Host ""
        $bucketName = Read-Host "Nombre del bucket S3"
        
        if ([string]::IsNullOrWhiteSpace($bucketName)) {
            Write-Host "❌ Error: Debes proporcionar un nombre de bucket" -ForegroundColor Red
            exit 1
        }
        
        Write-Host "📦 Deploying to AWS S3..." -ForegroundColor Green
        
        # Sync files to S3
        aws s3 sync . "s3://$bucketName" --delete --exclude ".git/*" --exclude "*.ps1" --exclude "*.sh" --exclude "README.md"
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Deployment completado" -ForegroundColor Green
            
            # Get AWS region
            $region = aws configure get region
            Write-Host "🌐 URL: http://$bucketName.s3-website-$region.amazonaws.com" -ForegroundColor Cyan
        } else {
            Write-Host "❌ Error durante el deployment" -ForegroundColor Red
            exit 1
        }
    }
    "4" {
        Write-Host ""
        Write-Host "📦 Deploying to GitHub Pages..." -ForegroundColor Green
        Write-Host "⚠️  Asegúrate de haber configurado GitHub Pages en tu repositorio" -ForegroundColor Yellow
        Write-Host ""
        
        $confirm = Read-Host "¿Continuar? (y/n)"
        
        if ($confirm -eq "y") {
            Set-Location ..
            git subtree push --prefix web origin gh-pages
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "✅ Deployment completado" -ForegroundColor Green
            } else {
                Write-Host "❌ Error durante el deployment" -ForegroundColor Red
                exit 1
            }
        } else {
            Write-Host "❌ Deployment cancelado" -ForegroundColor Red
            exit 0
        }
    }
    "5" {
        Write-Host "❌ Deployment cancelado" -ForegroundColor Red
        exit 0
    }
    default {
        Write-Host "❌ Opción inválida" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "✅ ¡Deployment completado!" -ForegroundColor Green
Write-Host "🎉 Tu sitio web está en línea" -ForegroundColor Cyan
