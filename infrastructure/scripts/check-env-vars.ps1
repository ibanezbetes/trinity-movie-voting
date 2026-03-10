# Script to check environment variables for all Lambda functions
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Lambda Environment Variables Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$region = "eu-west-1"

# Get all Trinity Lambda functions
$functions = aws lambda list-functions --region $region --query 'Functions[?contains(FunctionName, `TrinityStack`)].FunctionName' --output json | ConvertFrom-Json

if ($functions.Count -eq 0) {
    Write-Host "✗ No Trinity Lambda functions found" -ForegroundColor Red
    exit 1
}

Write-Host "Checking environment variables for $($functions.Count) functions..." -ForegroundColor Yellow
Write-Host ""

# Expected environment variables for each function type
$expectedVars = @{
    "RoomHandler" = @("ROOMS_TABLE", "VOTES_TABLE", "MATCHES_TABLE", "TMDB_LAMBDA_ARN")
    "VoteHandler" = @("VOTES_TABLE", "MATCHES_TABLE", "ROOMS_TABLE", "GRAPHQL_ENDPOINT")
    "MatchHandler" = @("MATCHES_TABLE", "GRAPHQL_ENDPOINT")
    "TmdbHandler" = @("TMDB_READ_TOKEN", "TMDB_API_KEY")
    "UsernameHandler" = @("USERNAMES_TABLE", "ROOMS_TABLE", "VOTES_TABLE", "MATCHES_TABLE", "USER_POOL_ID")
    "RecommendationsHandler" = @("RECOMMENDATIONS_TABLE")
}

$allGood = $true

foreach ($functionName in $functions) {
    # Skip log retention function
    if ($functionName -like "*LogRetention*") {
        continue
    }
    
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
    Write-Host "$functionName" -ForegroundColor Cyan
    Write-Host ""
    
    # Get environment variables
    $envVars = aws lambda get-function-configuration `
        --function-name $functionName `
        --region $region `
        --query 'Environment.Variables' `
        --output json | ConvertFrom-Json
    
    if (-not $envVars) {
        Write-Host "  ⚠ No environment variables configured" -ForegroundColor Yellow
        $allGood = $false
        Write-Host ""
        continue
    }
    
    # Determine function type
    $functionType = $null
    foreach ($key in $expectedVars.Keys) {
        if ($functionName -like "*$key*") {
            $functionType = $key
            break
        }
    }
    
    if ($functionType) {
        # Check expected variables
        $expected = $expectedVars[$functionType]
        $missing = @()
        
        foreach ($varName in $expected) {
            if ($envVars.PSObject.Properties.Name -contains $varName) {
                $value = $envVars.$varName
                $displayValue = if ($value.Length -gt 50) { $value.Substring(0, 47) + "..." } else { $value }
                Write-Host "  ✓ $varName = $displayValue" -ForegroundColor Green
            } else {
                Write-Host "  ✗ $varName = MISSING" -ForegroundColor Red
                $missing += $varName
                $allGood = $false
            }
        }
        
        if ($missing.Count -gt 0) {
            Write-Host ""
            Write-Host "  ⚠ Missing variables: $($missing -join ', ')" -ForegroundColor Yellow
        }
    } else {
        # Unknown function type, just list all variables
        foreach ($prop in $envVars.PSObject.Properties) {
            $value = $prop.Value
            $displayValue = if ($value.Length -gt 50) { $value.Substring(0, 47) + "..." } else { $value }
            Write-Host "  • $($prop.Name) = $displayValue" -ForegroundColor Gray
        }
    }
    
    Write-Host ""
}

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

if ($allGood) {
    Write-Host "✓ All Lambda functions have correct environment variables" -ForegroundColor Green
} else {
    Write-Host "✗ Some Lambda functions are missing required environment variables" -ForegroundColor Red
    Write-Host ""
    Write-Host "To fix, run: npx cdk deploy" -ForegroundColor Yellow
    Write-Host "Or manually update with: aws lambda update-function-configuration" -ForegroundColor Yellow
}

Write-Host ""
