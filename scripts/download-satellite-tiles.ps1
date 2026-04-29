# Download Satellite Tiles for Offline Use
# Downloads ESRI World Imagery satellite tiles for Germany

Write-Host "🛰️  ESRI Satellite Tile Downloader" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is installed
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js version: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js is not installed or not in PATH" -ForegroundColor Red
    Write-Host "   Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "⚠️  WARNING: This will download satellite imagery tiles!" -ForegroundColor Yellow
Write-Host "   - Default zoom levels 0-10: ~200-500MB" -ForegroundColor Yellow
Write-Host "   - Higher zoom levels will require MUCH more space" -ForegroundColor Yellow
Write-Host "   - Please check ESRI Terms of Service before proceeding" -ForegroundColor Yellow
Write-Host ""

$confirmation = Read-Host "Do you want to continue? (yes/no)"
if ($confirmation -ne "yes" -and $confirmation -ne "y") {
    Write-Host "❌ Download cancelled" -ForegroundColor Red
    exit 0
}

Write-Host ""
Write-Host "Starting download..." -ForegroundColor Green
Write-Host ""

# Run the download script
node "$PSScriptRoot\download-satellite-tiles.js"

$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    Write-Host ""
    Write-Host "✅ Satellite tiles downloaded successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Rebuild your app: npm run build" -ForegroundColor White
    Write-Host "2. Sync to Android: npx cap sync" -ForegroundColor White
    Write-Host "3. Build APK: .\build-apk.ps1" -ForegroundColor White
    Write-Host ""
    Write-Host "The satellite tiles will be bundled in your APK and available offline." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Download failed with exit code: $exitCode" -ForegroundColor Red
    Write-Host "   Check the error messages above for details" -ForegroundColor Yellow
    exit $exitCode
}
