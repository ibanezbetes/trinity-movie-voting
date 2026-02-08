#!/bin/bash

# Trinity Web - Deployment Script
# Este script facilita el deployment del sitio web a diferentes plataformas

echo "🎬 Trinity Web - Deployment Script"
echo "=================================="
echo ""

# Verificar que estamos en la carpeta correcta
if [ ! -f "index.html" ]; then
    echo "❌ Error: Debes ejecutar este script desde la carpeta web/"
    exit 1
fi

echo "Selecciona la plataforma de deployment:"
echo "1) Netlify"
echo "2) Vercel"
echo "3) AWS S3"
echo "4) GitHub Pages"
echo "5) Cancelar"
echo ""
read -p "Opción (1-5): " option

case $option in
    1)
        echo ""
        echo "📦 Deploying to Netlify..."
        if ! command -v netlify &> /dev/null; then
            echo "⚠️  Netlify CLI no está instalado"
            echo "Instalando: npm install -g netlify-cli"
            npm install -g netlify-cli
        fi
        netlify deploy --prod
        ;;
    2)
        echo ""
        echo "📦 Deploying to Vercel..."
        if ! command -v vercel &> /dev/null; then
            echo "⚠️  Vercel CLI no está instalado"
            echo "Instalando: npm install -g vercel"
            npm install -g vercel
        fi
        vercel --prod
        ;;
    3)
        echo ""
        read -p "Nombre del bucket S3: " bucket_name
        if [ -z "$bucket_name" ]; then
            echo "❌ Error: Debes proporcionar un nombre de bucket"
            exit 1
        fi
        echo "📦 Deploying to AWS S3..."
        aws s3 sync . s3://$bucket_name --delete --exclude ".git/*" --exclude "*.sh" --exclude "README.md"
        echo "✅ Deployment completado"
        echo "🌐 URL: http://$bucket_name.s3-website-$(aws configure get region).amazonaws.com"
        ;;
    4)
        echo ""
        echo "📦 Deploying to GitHub Pages..."
        echo "⚠️  Asegúrate de haber configurado GitHub Pages en tu repositorio"
        echo ""
        read -p "¿Continuar? (y/n): " confirm
        if [ "$confirm" = "y" ]; then
            cd ..
            git subtree push --prefix web origin gh-pages
            echo "✅ Deployment completado"
        else
            echo "❌ Deployment cancelado"
        fi
        ;;
    5)
        echo "❌ Deployment cancelado"
        exit 0
        ;;
    *)
        echo "❌ Opción inválida"
        exit 1
        ;;
esac

echo ""
echo "✅ ¡Deployment completado!"
echo "🎉 Tu sitio web está en línea"
