# Script to verify Lambda deployment and force update if needed
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Trinity Lambda Deployment Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$region = "eu-west-1"

# Get all Trinity Lambda functions
Write-Host "Fetching Lambda functions..." -ForegroundColor Yellow
$functions = aws lambda list-functions --region $region --query 'Functions[?contains(FunctionName, `TrinityStack`)].FunctionName' --output json | ConvertFrom-Json

if ($functions.Count -eq 0) {
    Write-Host "✗ No Trinity Lambda functions found" -ForegroundColor Red
    exit 1
}

Write-Host "Found $($functions.Count) Lambda functions:" -ForegroundColor Green
$functions | ForEach-Object { Write-Host "  - $_" -ForegroundColor Gray }
Write-Host ""

# Check each function's status
Write-Host "Checking function status..." -ForegroundColor Yellow
Write-Host ""

$allSuccessful = $true

foreach ($functionName in $functions) {
    $status = aws lambda get-function --function-name $functionName --region $region --query 'Configuration.[LastUpdateStatus,CodeSize,LastModified]' --output json | ConvertFrom-Json
    
    $updateStatus = $status[0]
    $codeSize = $status[1]
    $lastModified = $status[2]
    
    Write-Host "$functionName" -ForegroundColor Cyan
    Write-Host "  Status: $updateStatus" -ForegroundColor $(if ($updateStatus -eq "Successful") { "Green" } else { "Red" })
    Write-Host "  Code Size: $([math]::Round($codeSize / 1024, 2)) KB"
    Write-Host "  Last Modified: $lastModified"
    Write-Host ""
    
    if ($updateStatus -ne "Successful") {
        $allSuccessful = $false
    }
}

if ($allSuccessful) {
    Write-Host "✓ All Lambda functions are up to date" -ForegroundColor Green
} else {
    Write-Host "✗ Some Lambda functions need attention" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Key Functions for Room Creation:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Find Room and TMDB handlers
$roomHandler = $functions | Where-Object { $_ -like "*RoomHandler*" }
$tmdbHandler = $functions | Where-Object { $_ -like "*TmdbHandler*" }

if ($roomHandler) {
    Write-Host "Room Handler: $roomHandler" -ForegroundColor Green
} else {
    Write-Host "Room Handler: NOT FOUND" -ForegroundColor Red
}

if ($tmdbHandler) {
    Write-Host "TMDB Handler: $tmdbHandler" -ForegroundColor Green
} else {
    Write-Host "TMDB Handler: NOT FOUND" -ForegroundColor Red
}

Write-Host ""
Write-Host "To update a specific function:" -ForegroundColor Yellow
Write-Host "  aws lambda update-function-code --function-name [NAME] --region $region --zip-file fileb://lambda-zips/[handler].zip" -ForegroundColor Gray
Write-Host ""
