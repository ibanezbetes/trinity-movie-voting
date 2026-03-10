# Complete Lambda Deployment Script
# This script builds, packages, and deploys all Lambda functions

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Trinity Lambda Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$region = "eu-west-1"
$rootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# Step 1: Build TypeScript
Write-Host "Step 1: Building TypeScript..." -ForegroundColor Yellow
Set-Location $rootDir
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ Build failed" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Build successful" -ForegroundColor Green
Write-Host ""

# Step 2: Create ZIP files
Write-Host "Step 2: Creating Lambda ZIP files..." -ForegroundColor Yellow
& "$rootDir\create-zips.ps1"

if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ ZIP creation failed" -ForegroundColor Red
    exit 1
}

Write-Host "✓ ZIPs created" -ForegroundColor Green
Write-Host ""

# Step 3: Get Lambda function names
Write-Host "Step 3: Fetching Lambda function names..." -ForegroundColor Yellow
$functions = aws lambda list-functions --region $region --query 'Functions[?contains(FunctionName, `TrinityStack`)].FunctionName' --output json | ConvertFrom-Json

if ($functions.Count -eq 0) {
    Write-Host "✗ No Trinity Lambda functions found" -ForegroundColor Red
    Write-Host "  Make sure you've deployed the CDK stack first: npx cdk deploy" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ Found $($functions.Count) Lambda functions" -ForegroundColor Green
Write-Host ""

# Step 4: Update Lambda functions
Write-Host "Step 4: Updating Lambda functions..." -ForegroundColor Yellow
Write-Host ""

$roomHandler = $functions | Where-Object { $_ -like "*RoomHandler*" }
$tmdbHandler = $functions | Where-Object { $_ -like "*TmdbHandler*" }
$voteHandler = $functions | Where-Object { $_ -like "*VoteHandler*" }
$matchHandler = $functions | Where-Object { $_ -like "*MatchHandler*" }
$usernameHandler = $functions | Where-Object { $_ -like "*UsernameHandler*" }

$updates = @(
    @{ Name = $roomHandler; Zip = "room-handler.zip"; Label = "Room Handler" },
    @{ Name = $tmdbHandler; Zip = "tmdb-handler.zip"; Label = "TMDB Handler" },
    @{ Name = $voteHandler; Zip = "vote-handler.zip"; Label = "Vote Handler" },
    @{ Name = $matchHandler; Zip = "match-handler.zip"; Label = "Match Handler" },
    @{ Name = $usernameHandler; Zip = "username-handler.zip"; Label = "Username Handler" }
)

$successCount = 0
$failCount = 0

foreach ($update in $updates) {
    if (-not $update.Name) {
        Write-Host "⚠ $($update.Label): Function not found, skipping" -ForegroundColor Yellow
        continue
    }
    
    Write-Host "Updating $($update.Label)..." -ForegroundColor Cyan
    
    $zipPath = Join-Path $rootDir "lambda-zips" $update.Zip
    
    if (-not (Test-Path $zipPath)) {
        Write-Host "  ✗ ZIP file not found: $zipPath" -ForegroundColor Red
        $failCount++
        continue
    }
    
    aws lambda update-function-code `
        --function-name $update.Name `
        --region $region `
        --zip-file "fileb://$zipPath" `
        --no-cli-pager `
        --output json | Out-Null
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Updated successfully" -ForegroundColor Green
        $successCount++
    } else {
        Write-Host "  ✗ Update failed" -ForegroundColor Red
        $failCount++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deployment Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Successful: $successCount" -ForegroundColor Green
Write-Host "Failed: $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })
Write-Host ""

# Step 5: Wait and verify
if ($successCount -gt 0) {
    Write-Host "Waiting 10 seconds for Lambda functions to update..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    
    Write-Host ""
    Write-Host "Verifying deployment status..." -ForegroundColor Yellow
    Write-Host ""
    
    $allSuccessful = $true
    
    foreach ($update in $updates) {
        if (-not $update.Name) { continue }
        
        $status = aws lambda get-function `
            --function-name $update.Name `
            --region $region `
            --query 'Configuration.LastUpdateStatus' `
            --output text
        
        $statusColor = if ($status -eq "Successful") { "Green" } else { "Red" }
        Write-Host "$($update.Label): $status" -ForegroundColor $statusColor
        
        if ($status -ne "Successful") {
            $allSuccessful = $false
        }
    }
    
    Write-Host ""
    
    if ($allSuccessful) {
        Write-Host "✓ All Lambda functions deployed successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "You can now test the app with the updated filters." -ForegroundColor Cyan
    } else {
        Write-Host "⚠ Some functions may still be updating. Check AWS Console for details." -ForegroundColor Yellow
    }
}

Write-Host ""
