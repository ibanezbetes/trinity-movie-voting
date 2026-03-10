# Script to verify Lambda deployment versions
# Checks if the latest code is deployed by comparing LastModified dates

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Verifying Lambda Deployment Status" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Lambda function names (adjust if your stack name is different)
$lambdaFunctions = @(
    "TrinityStack-TMDBHandler",
    "TrinityStack-RoomHandler",
    "TrinityStack-VoteHandler",
    "TrinityStack-MatchHandler"
)

$allGood = $true

foreach ($functionName in $lambdaFunctions) {
    Write-Host "Checking: $functionName" -ForegroundColor Yellow
    
    try {
        # Get Lambda function configuration
        $config = aws lambda get-function-configuration --function-name $functionName 2>&1
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  ✗ ERROR: Could not find function" -ForegroundColor Red
            Write-Host "    Make sure the function name is correct" -ForegroundColor Gray
            $allGood = $false
            continue
        }
        
        $configJson = $config | ConvertFrom-Json
        
        # Extract key information
        $lastModified = $configJson.LastModified
        $codeSize = [math]::Round($configJson.CodeSize / 1KB, 2)
        $runtime = $configJson.Runtime
        $timeout = $configJson.Timeout
        
        Write-Host "  ✓ Function found" -ForegroundColor Green
        Write-Host "    Last Modified: $lastModified" -ForegroundColor Gray
        Write-Host "    Code Size: $codeSize KB" -ForegroundColor Gray
        Write-Host "    Runtime: $runtime" -ForegroundColor Gray
        Write-Host "    Timeout: $timeout seconds" -ForegroundColor Gray
        
        # Check if modified recently (within last hour)
        $lastModifiedDate = [DateTime]::Parse($lastModified)
        $now = [DateTime]::UtcNow
        $timeDiff = $now - $lastModifiedDate
        
        if ($timeDiff.TotalMinutes -lt 60) {
            Write-Host "    ⚡ Recently updated ($([math]::Round($timeDiff.TotalMinutes, 0)) minutes ago)" -ForegroundColor Green
        } else {
            Write-Host "    ⚠ Last update: $([math]::Round($timeDiff.TotalHours, 1)) hours ago" -ForegroundColor Yellow
        }
        
    } catch {
        Write-Host "  ✗ ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $allGood = $false
    }
    
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan

if ($allGood) {
    Write-Host "✓ All Lambda functions are accessible" -ForegroundColor Green
} else {
    Write-Host "✗ Some issues were found" -ForegroundColor Red
}

Write-Host ""
Write-Host "To check environment variables:" -ForegroundColor Cyan
Write-Host "  aws lambda get-function-configuration --function-name TrinityStack-TMDBHandler --query Environment" -ForegroundColor Gray
Write-Host ""
Write-Host "To view recent logs:" -ForegroundColor Cyan
Write-Host "  aws logs tail /aws/lambda/TrinityStack-TMDBHandler --follow" -ForegroundColor Gray
Write-Host ""
