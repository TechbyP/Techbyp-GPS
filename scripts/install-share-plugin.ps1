# Quick Fix Script for GPS App
# This installs the missing Share plugin needed for export functionality

Write-Host "🔧 Installing missing dependencies for GPS App..." -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (!(Test-Path "package.json")) {
    Write-Host "❌ Error: package.json not found!" -ForegroundColor Red
    Write-Host "Please run this script from the GPS-App directory" -ForegroundColor Yellow
    exit 1
}

# Install @capacitor/share
Write-Host "📦 Installing @capacitor/share..." -ForegroundColor Yellow
npm install @capacitor/share

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to install @capacitor/share" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Package installed successfully!" -ForegroundColor Green
Write-Host ""

# Sync with Android
Write-Host "🔄 Syncing with Android platform..." -ForegroundColor Yellow
npx cap sync android

if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Warning: Android sync had issues" -ForegroundColor Yellow
    Write-Host "You may need to run 'npx cap sync android' manually" -ForegroundColor Yellow
} else {
    Write-Host "✅ Android platform synced!" -ForegroundColor Green
}

Write-Host ""
Write-Host "✨ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Build the app: npm run build" -ForegroundColor White
Write-Host "2. Copy to Android: npx cap copy android" -ForegroundColor White
Write-Host "3. Open Android Studio: npx cap open android" -ForegroundColor White
Write-Host "4. Build APK from Android Studio" -ForegroundColor White
Write-Host ""
Write-Host "📖 See ISSUES_AND_FIXES.md for detailed information" -ForegroundColor Cyan
