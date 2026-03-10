# Script to deploy schema updates to AWS AppSync
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deploying Schema Updates to AWS AppSync" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "This will update:" -ForegroundColor Yellow
Write-Host "  - GraphQL Schema (yearRange, platformIds)" -ForegroundColor Gray
Write-Host "  - Lambda functions (if needed)" -ForegroundColor Gray
Write-Host ""

# Check if in infrastructure directory
if (-not (Test-Path "cdk.json")) {
    Write-Host "ERROR: Must run from infrastructure directory" -ForegroundColor Red
    exit 1
}

Write-Host "Starting CDK deployment..." -ForegroundColor Green
Write-Host ""

# Deploy the stack
npx cdk deploy --require-approval never

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "✓ Deployment successful!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Schema updated with:" -ForegroundColor Cyan
    Write-Host "  ✓ yearRange field in CreateRoomInput" -ForegroundColor Green
    Write-Host "  ✓ platformIds field in CreateRoomInput" -ForegroundColor Green
    Write-Host ""
    Write-Host "You can now create rooms with year and platform filters!" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "✗ Deployment failed" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Check the error messages above" -ForegroundColor Yellow
}
