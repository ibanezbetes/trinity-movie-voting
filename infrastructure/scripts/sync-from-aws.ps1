# Sync Lambda Functions from AWS
# Downloads current Lambda code from AWS and updates local files

$ErrorActionPreference = "Stop"

Write-Host "🔄 Syncing Lambda Functions from AWS..." -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$region = "eu-west-1"
$functions = @(
    "TrinityStack-VoteHandler",
    "TrinityStack-MatchHandler",
    "TrinityStack-RoomHandler",
    "TrinityStack-TmdbHandler"
)

foreach ($function in $functions) {
    Write-Host "📥 Downloading $function..." -ForegroundColor Yellow
    
    try {
        # Get function code location
        $response = aws lambda get-function --function-name $function --region $region --query 'Code.Location' --output text
        
        if ($response) {
            $handlerName = $function -replace "TrinityStack-", "" | ForEach-Object { $_.ToLower() }
            $zipPath = "lambda-zips/$handlerName-from-aws.zip"
            
            # Download ZIP
            Invoke-WebRequest -Uri $response -OutFile $zipPath
            
            Write-Host "  ✅ Downloaded to $zipPath" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "  ❌ Error downloading $function : $_" -ForegroundColor Red
    }
}

Write-Host "`n✅ Sync completed!" -ForegroundColor Green
Write-Host "📦 ZIPs downloaded to lambda-zips/*-from-aws.zip" -ForegroundColor Cyan
