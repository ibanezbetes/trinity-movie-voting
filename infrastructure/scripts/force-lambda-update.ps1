# Script to force Lambda function update
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Forcing Lambda Function Update" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$functionName = "TrinityStack-RoomHandlerCF7B6EB0-3l8zXFEAAKwE"

Write-Host "Publishing new version to force refresh..." -ForegroundColor Yellow

# Publish a new version to force Lambda to reload code
# This is safer than modifying environment variables
aws lambda publish-version `
    --function-name $functionName `
    --region eu-west-1 `
    --no-cli-pager `
    --query 'Version' `
    --output text

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✓ New version published" -ForegroundColor Green
    Write-Host ""
    Write-Host "Waiting 5 seconds for Lambda to update..." -ForegroundColor Yellow
    Start-Sleep -Seconds 5
    
    Write-Host ""
    Write-Host "✓ Lambda function should be updated now" -ForegroundColor Green
    Write-Host ""
    Write-Host "Try creating a room again to test" -ForegroundColor Cyan
} else {
    Write-Host ""
    Write-Host "✗ Failed to publish version" -ForegroundColor Red
}
