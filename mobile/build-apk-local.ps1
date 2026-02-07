# Build APK locally using Expo
# This script builds a production APK without using EAS

Write-Host "🚀 Building Trinity APK locally..." -ForegroundColor Cyan
Write-Host ""

# Step 1: Clean previous builds
Write-Host "📦 Step 1: Cleaning previous builds..." -ForegroundColor Yellow
if (Test-Path "android/app/build") {
    Remove-Item -Path "android/app/build" -Recurse -Force
    Write-Host "✓ Cleaned android/app/build" -ForegroundColor Green
}
if (Test-Path "android/app/.cxx") {
    Remove-Item -Path "android/app/.cxx" -Recurse -Force
    Write-Host "✓ Cleaned android/app/.cxx" -ForegroundColor Green
}
if (Test-Path "android/build") {
    Remove-Item -Path "android/build" -Recurse -Force
    Write-Host "✓ Cleaned android/build" -ForegroundColor Green
}

# Step 2: Export for Android
Write-Host ""
Write-Host "📱 Step 2: Exporting Android bundle..." -ForegroundColor Yellow
$env:NODE_ENV = "production"
npx expo export --platform android

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Export failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Export completed" -ForegroundColor Green

# Step 3: Build APK with Gradle
Write-Host ""
Write-Host "🔨 Step 3: Building APK with Gradle..." -ForegroundColor Yellow
Set-Location android
.\gradlew assembleRelease --no-daemon

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    Set-Location ..
    exit 1
}

Set-Location ..

# Step 4: Find and copy APK
Write-Host ""
Write-Host "📦 Step 4: Locating APK..." -ForegroundColor Yellow

$apkPath = "android\app\build\outputs\apk\release\app-release.apk"

if (Test-Path $apkPath) {
    $version = "2.2.2"
    $timestamp = Get-Date -Format "yyyyMMdd-HHmm"
    $newApkName = "trinity-v$version-$timestamp.apk"
    
    Copy-Item $apkPath $newApkName
    
    $apkSize = (Get-Item $newApkName).Length / 1MB
    $apkSizeMB = [math]::Round($apkSize, 2)
    
    Write-Host ""
    Write-Host "✅ SUCCESS! APK built successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📱 APK Details:" -ForegroundColor Cyan
    Write-Host "  File: $newApkName" -ForegroundColor White
    Write-Host "  Size: $apkSizeMB MB" -ForegroundColor White
    Write-Host "  Location: $(Get-Location)\$newApkName" -ForegroundColor White
    Write-Host ""
    Write-Host "📲 Installation Instructions:" -ForegroundColor Cyan
    Write-Host "  1. Transfer APK to your Android device" -ForegroundColor White
    Write-Host "  2. Enable 'Install from Unknown Sources' in Settings" -ForegroundColor White
    Write-Host "  3. Open the APK file and install" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "❌ APK not found at expected location!" -ForegroundColor Red
    Write-Host "Expected: $apkPath" -ForegroundColor Yellow
    exit 1
}
