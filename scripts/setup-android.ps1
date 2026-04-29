# Android Build Setup Script
# Run this script to set up the project for Android APK building

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "GPS Tracker - Android APK Setup" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Step 1: Install Capacitor and dependencies
Write-Host "[1/6] Installing Capacitor and plugins..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor Gray
npm install --legacy-peer-deps @capacitor/core @capacitor/cli @capacitor/android @capacitor/geolocation @capacitor/filesystem @capacitor/preferences @capacitor/splash-screen @capacitor-community/sqlite

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Installation failed. Check the errors above." -ForegroundColor Red
    Write-Host "Try running: npm install --force" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Packages installed successfully" -ForegroundColor Green

# Step 2: Build the web app
Write-Host "`n[2/6] Building web app..." -ForegroundColor Yellow
Write-Host "Building without compression for Android compatibility..." -ForegroundColor Gray
$env:CAPACITOR_PLATFORM = "android"
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Build failed. Check the errors above." -ForegroundColor Red
    exit 1
}

Write-Host "✅ Build successful" -ForegroundColor Green

# Step 3: Add Android platform
Write-Host "`n[3/6] Adding Android platform..." -ForegroundColor Yellow
if (Test-Path "android") {
    Write-Host "Android platform already exists, skipping..." -ForegroundColor Gray
} else {
    npx cap add android
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`n❌ Failed to add Android platform" -ForegroundColor Red
        exit 1
    }
}

Write-Host "✅ Android platform ready" -ForegroundColor Green

# Step 4: Sync Capacitor
Write-Host "`n[4/6] Syncing Capacitor..." -ForegroundColor Yellow
npx cap sync android

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Sync failed" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Sync complete" -ForegroundColor Green

# Step 5: Update AndroidManifest for permissions
Write-Host "`n[5/6] Configuring Android permissions..." -ForegroundColor Yellow
$manifestPath = "android/app/src/main/AndroidManifest.xml"
if (Test-Path $manifestPath) {
    Write-Host "✅ AndroidManifest.xml found" -ForegroundColor Green
} else {
    Write-Host "⚠️ AndroidManifest.xml not found, you may need to add permissions manually" -ForegroundColor Yellow
}

# Step 6: Instructions
Write-Host "`n[6/6] Setup Complete!" -ForegroundColor Green
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "1. Open Android Studio (if not installed, download from:" -ForegroundColor White
Write-Host "   https://developer.android.com/studio)" -ForegroundColor Gray
Write-Host "`n2. Run this command:" -ForegroundColor White
Write-Host "   npx cap open android" -ForegroundColor Yellow
Write-Host "`n3. In Android Studio:" -ForegroundColor White
Write-Host "   ⏳ Wait for Gradle sync to complete (5-10 minutes first time)" -ForegroundColor Gray
Write-Host "   📦 Build -> Build Bundles / APKs -> Build APKs" -ForegroundColor Gray
Write-Host "   📱 APK location: android/app/build/outputs/apk/debug/app-debug.apk" -ForegroundColor Gray
Write-Host "`n   💡 If Android Studio asks for SDK:" -ForegroundColor Cyan
Write-Host "      File -> Settings -> Appearance & Behavior -> System Settings -> Android SDK" -ForegroundColor Gray
Write-Host "      Let Android Studio download SDK automatically (recommended)" -ForegroundColor Gray
Write-Host "`n   📤 After building APK, run: .\copy-apk.ps1" -ForegroundColor Yellow
Write-Host "      This copies the APK to public folder for tablet download" -ForegroundColor Gray
Write-Host "`n4. Testing on tablet:" -ForegroundColor White
Write-Host "   - Enable Developer Options on tablet" -ForegroundColor Gray
Write-Host "   - Enable USB Debugging" -ForegroundColor Gray
Write-Host "   - Connect via USB and run: npx cap run android" -ForegroundColor Yellow
Write-Host "`n========================================`n" -ForegroundColor Cyan

$response = Read-Host "Open Android Studio now? (y/n)"
if ($response -eq 'y' -or $response -eq 'Y') {
    Write-Host "Opening Android Studio..." -ForegroundColor Yellow
    npx cap open android
}
