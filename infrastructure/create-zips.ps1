Write-Host "Creating Lambda ZIP files for manual deployment..." -ForegroundColor Green

# Create output directory
if (!(Test-Path "lambda-zips")) {
    New-Item -ItemType Directory -Path "lambda-zips"
}

# Clean previous zips
Remove-Item "lambda-zips\*.zip" -ErrorAction SilentlyContinue

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "Creating TMDB Handler ZIP (PRIORITY)..." -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# TMDB Handler (most important - has axios dependency)
$tmdbPath = "src\handlers\tmdb"
if (Test-Path "$tmdbPath\index.js") {
    $files = @("$tmdbPath\index.js", "$tmdbPath\package.json")
    
    # Include node_modules if it exists
    if (Test-Path "$tmdbPath\node_modules") {
        Write-Host "- Including node_modules with axios dependency" -ForegroundColor Green
        Compress-Archive -Path "$tmdbPath\index.js", "$tmdbPath\package.json", "$tmdbPath\node_modules" -DestinationPath "lambda-zips\tmdb-handler.zip" -Force
    } else {
        Write-Host "- WARNING: node_modules not found, creating ZIP without dependencies" -ForegroundColor Red
        Compress-Archive -Path "$tmdbPath\index.js", "$tmdbPath\package.json" -DestinationPath "lambda-zips\tmdb-handler.zip" -Force
    }
    Write-Host "✓ tmdb-handler.zip created" -ForegroundColor Green
} else {
    Write-Host "ERROR: $tmdbPath\index.js not found!" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "Creating Room Handler ZIP..." -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Room Handler
$roomPath = "src\handlers\room"
if (Test-Path "$roomPath\index.js") {
    Compress-Archive -Path "$roomPath\index.js", "$roomPath\package.json" -DestinationPath "lambda-zips\room-handler.zip" -Force
    Write-Host "✓ room-handler.zip created" -ForegroundColor Green
} else {
    Write-Host "ERROR: $roomPath\index.js not found!" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "Creating Vote Handler ZIP..." -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Vote Handler
$votePath = "src\handlers\vote"
if (Test-Path "$votePath\index.js") {
    if (Test-Path "$votePath\node_modules") {
        Compress-Archive -Path "$votePath\index.js", "$votePath\package.json", "$votePath\node_modules" -DestinationPath "lambda-zips\vote-handler.zip" -Force
    } else {
        Compress-Archive -Path "$votePath\index.js", "$votePath\package.json" -DestinationPath "lambda-zips\vote-handler.zip" -Force
    }
    Write-Host "✓ vote-handler.zip created" -ForegroundColor Green
} else {
    Write-Host "ERROR: $votePath\index.js not found!" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "Creating Match Handler ZIP..." -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Match Handler
$matchPath = "src\handlers\match"
if (Test-Path "$matchPath\index.js") {
    Compress-Archive -Path "$matchPath\index.js", "$matchPath\package.json" -DestinationPath "lambda-zips\match-handler.zip" -Force
    Write-Host "✓ match-handler.zip created" -ForegroundColor Green
} else {
    Write-Host "ERROR: $matchPath\index.js not found!" -ForegroundColor Red
}

Write-Host "`n========================================" -ForegroundColor Green
Write-Host "SUCCESS! Lambda ZIP files created!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

# List created files
Write-Host "`nCreated ZIP files:" -ForegroundColor Cyan
Get-ChildItem "lambda-zips\*.zip" | ForEach-Object {
    $size = [math]::Round($_.Length / 1KB, 2)
    Write-Host "  $($_.Name) ($size KB)" -ForegroundColor White
}

Write-Host "`nUPLOAD INSTRUCTIONS:" -ForegroundColor Yellow
Write-Host "====================" -ForegroundColor Yellow
Write-Host "1. Go to AWS Lambda Console" -ForegroundColor White
Write-Host "2. Upload these ZIP files to your functions:" -ForegroundColor White
Write-Host "   - tmdb-handler.zip   --> TmdbHandler Lambda (UPLOAD THIS FIRST!)" -ForegroundColor Cyan
Write-Host "   - room-handler.zip   --> RoomHandler Lambda" -ForegroundColor White  
Write-Host "   - vote-handler.zip   --> VoteHandler Lambda" -ForegroundColor White
Write-Host "   - match-handler.zip  --> MatchHandler Lambda" -ForegroundColor White

Write-Host "`nCRITICAL: Upload tmdb-handler.zip FIRST as it contains" -ForegroundColor Red
Write-Host "the axios dependency that fixes the randomization!" -ForegroundColor Red

Write-Host "`nAfter uploading, test creating a room to see different movies!" -ForegroundColor Green

Write-Host "`nPress any key to continue..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")