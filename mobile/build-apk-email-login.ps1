# Trinity APK Build Script - Email Login Version
# Version: 2.2.5
# Date: 2026-02-08
# Description: Build APK with email-only login (username display only)

Write-Host "🚀 Building Trinity APK - Email Login Version" -ForegroundColor Cyan
Write-Host "Version: 2.2.5" -ForegroundColor Yellow
Write-Host "Feature: Email-only login with username display" -ForegroundColor Yellow
Write-Host ""

# Get timestamp for filename
$timestamp = Get-Date -Format "yyyyMMdd-HHmm"
$version = "2.2.5"
$apkName = "trinity-email-login-v$version-$timestamp.apk"

Write-Host "📦 APK will be named: $apkName" -ForegroundColor Green
Write-Host ""

# Navigate to mobile directory
Set-Location -Path $PSScriptRoot

# Clean previous builds
Write-Host "🧹 Cleaning previous builds..." -ForegroundColor Yellow
if (Test-Path "android/app/build") {
    Remove-Item -Path "android/app/build" -Recurse -Force
    Write-Host "✅ Cleaned android/app/build" -ForegroundColor Green
}

# Install dependencies
Write-Host ""
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to install dependencies" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Dependencies installed" -ForegroundColor Green

# Build APK
Write-Host ""
Write-Host "🔨 Building APK..." -ForegroundColor Yellow
Write-Host "This may take several minutes..." -ForegroundColor Gray

Set-Location android
./gradlew assembleRelease

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed" -ForegroundColor Red
    Set-Location ..
    exit 1
}

Set-Location ..

# Find the APK
$apkPath = "android/app/build/outputs/apk/release/app-release.apk"

if (Test-Path $apkPath) {
    # Copy to root with versioned name
    Copy-Item -Path $apkPath -Destination "../$apkName" -Force
    
    Write-Host ""
    Write-Host "✅ Build successful!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📱 APK Location:" -ForegroundColor Cyan
    Write-Host "   $apkName" -ForegroundColor White
    Write-Host ""
    Write-Host "📊 APK Size:" -ForegroundColor Cyan
    $size = (Get-Item "../$apkName").Length / 1MB
    Write-Host "   $([math]::Round($size, 2)) MB" -ForegroundColor White
    Write-Host ""
    Write-Host "🎯 Features in this build:" -ForegroundColor Cyan
    Write-Host "   ✅ Email-only login (simplified)" -ForegroundColor White
    Write-Host "   ✅ Username display in Dashboard" -ForegroundColor White
    Write-Host "   ✅ Username stored in preferred_username" -ForegroundColor White
    Write-Host "   ✅ No username blocking issues" -ForegroundColor White
    Write-Host "   ✅ GDPR-compliant account deletion" -ForegroundColor White
    Write-Host ""
    Write-Host "📝 Installation:" -ForegroundColor Cyan
    Write-Host "   adb install $apkName" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "❌ APK not found at expected location" -ForegroundColor Red
    exit 1
}
