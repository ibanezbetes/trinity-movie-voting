# Upload Lambda ZIPs to AWS
# Region: eu-west-1
# Date: 2026-02-05

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Uploading Lambda Functions to AWS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Change to lambda-zips directory
Set-Location -Path "lambda-zips"

# Function to upload Lambda
function Upload-Lambda {
    param(
        [string]$FunctionName,
        [string]$ZipFile,
        [string]$Priority = ""
    )
    
    Write-Host "Uploading $ZipFile to $FunctionName... $Priority" -ForegroundColor Yellow
    
    try {
        aws lambda update-function-code `
            --function-name $FunctionName `
            --zip-file "fileb://$ZipFile" `
            --region eu-west-1 `
            --output json | Out-Null
        
        Write-Host "✓ $FunctionName updated successfully" -ForegroundColor Green
        Write-Host ""
    }
    catch {
        Write-Host "✗ Error uploading $FunctionName" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        Write-Host ""
    }
}

# Upload in priority order
Write-Host "1/4: Vote Handler (CRITICAL - Notifications)" -ForegroundColor Magenta
Upload-Lambda -FunctionName "TrinityStack-VoteHandler" -ZipFile "vote-handler.zip" -Priority "⭐ CRITICAL"

Write-Host "2/4: Room Handler (maxParticipants)" -ForegroundColor Magenta
Upload-Lambda -FunctionName "TrinityStack-RoomHandler" -ZipFile "room-handler.zip"

Write-Host "3/4: TMDB Handler (Smart Discovery)" -ForegroundColor Magenta
Upload-Lambda -FunctionName "TrinityStack-TmdbHandler" -ZipFile "tmdb-handler.zip"

Write-Host "4/4: Match Handler (Query Matches)" -ForegroundColor Magenta
Upload-Lambda -FunctionName "TrinityStack-MatchHandler" -ZipFile "match-handler.zip"

# Return to infrastructure directory
Set-Location -Path ".."

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Upload Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Test creating a room with 2 users" -ForegroundColor White
Write-Host "2. Both users vote YES on the same movie" -ForegroundColor White
Write-Host "3. Verify both users receive notification" -ForegroundColor White
Write-Host "4. Check CloudWatch Logs for 'notificado exitosamente'" -ForegroundColor White
Write-Host ""
Write-Host "CloudWatch Logs: https://console.aws.amazon.com/cloudwatch/home?region=eu-west-1#logsV2:log-groups" -ForegroundColor Cyan
Write-Host ""
