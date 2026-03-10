# Script to check TMDB Handler logs
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Checking TMDB Handler Logs" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$functionName = "TrinityStack-TMDBHandler"

Write-Host "Fetching recent logs from CloudWatch..." -ForegroundColor Yellow
Write-Host ""

# Get the log group name
$logGroups = aws logs describe-log-groups --region eu-west-1 --query "logGroups[?contains(logGroupName, 'TMDBHandler')].logGroupName" --output text 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error getting log groups" -ForegroundColor Red
    Write-Host $logGroups
    exit 1
}

$logGroupName = $logGroups.Trim()

if ([string]::IsNullOrEmpty($logGroupName)) {
    Write-Host "No TMDB Handler log group found" -ForegroundColor Red
    exit 1
}

Write-Host "Log Group: $logGroupName" -ForegroundColor Cyan
Write-Host ""

# Get recent logs (last 10 minutes)
$startTime = [DateTimeOffset]::UtcNow.AddMinutes(-10).ToUnixTimeMilliseconds()

Write-Host "Recent logs:" -ForegroundColor Yellow
Write-Host ""

aws logs tail $logGroupName --region eu-west-1 --since 10m --format short

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
