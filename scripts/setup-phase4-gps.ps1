# Phase 4 GPS Enhancements - Quick Setup Script
# Run this script to install required packages and deploy configurations

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Phase 4: GPS & Hardware Enhancements" -ForegroundColor Cyan
Write-Host "Setup Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if npm is available
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: npm not found. Please install Node.js first." -ForegroundColor Red
    exit 1
}

# Install required Capacitor plugins
Write-Host "Step 1: Installing Capacitor plugins..." -ForegroundColor Yellow
Write-Host "  - @capacitor/haptics (vibration feedback)" -ForegroundColor Gray
Write-Host "  - @capacitor/device (battery info)" -ForegroundColor Gray

npm install @capacitor/haptics @capacitor/device

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install Capacitor plugins" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Capacitor plugins installed" -ForegroundColor Green
Write-Host ""

# Sync Capacitor
Write-Host "Step 2: Syncing Capacitor..." -ForegroundColor Yellow
npx cap sync

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to sync Capacitor" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Capacitor synced" -ForegroundColor Green
Write-Host ""

# Check Firebase CLI
Write-Host "Step 3: Checking Firebase CLI..." -ForegroundColor Yellow
if (Get-Command firebase -ErrorAction SilentlyContinue) {
    Write-Host "✓ Firebase CLI found" -ForegroundColor Green
    
    Write-Host ""
    Write-Host "Step 4: Deploying Firestore indexes..." -ForegroundColor Yellow
    
    # Deploy indexes
    firebase deploy --only firestore:indexes
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Firestore indexes deployed" -ForegroundColor Green
    } else {
        Write-Host "⚠ Firestore indexes deployment failed (you may need to do this manually)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "Step 5: Deploying Firestore rules..." -ForegroundColor Yellow
    
    # Deploy rules
    firebase deploy --only firestore:rules
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Firestore rules deployed" -ForegroundColor Green
    } else {
        Write-Host "⚠ Firestore rules deployment failed (you may need to do this manually)" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠ Firebase CLI not found - skipping Firestore deployment" -ForegroundColor Yellow
    Write-Host "  Install with: npm install -g firebase-tools" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Import tablet-optimizations.css in your index.css:" -ForegroundColor White
Write-Host "   @import './styles/tablet-optimizations.css';" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Validate GPS device flow in tablet app" -ForegroundColor White
Write-Host "   See: docs/ANDROID_TABLET_GPS_VALIDATION.md" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Review native GPS backend capabilities" -ForegroundColor White
Write-Host "   See: docs/NATIVE_GPS_BACKEND.md" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Build and test on Android tablet:" -ForegroundColor White
Write-Host "   .\build-apk.ps1" -ForegroundColor Gray
Write-Host ""

Write-Host "Documentation:" -ForegroundColor Yellow
Write-Host "  Documentation index: docs/README.md" -ForegroundColor Gray
Write-Host "  Validation runbook: docs/ANDROID_TABLET_GPS_VALIDATION.md" -ForegroundColor Gray
Write-Host ""

# Check if Firestore rules need update
Write-Host "IMPORTANT: Update Firestore Rules" -ForegroundColor Yellow
Write-Host "Add this to your firestore.rules inside the users/{uid} match:" -ForegroundColor White
Write-Host ""
Write-Host "  match /gps_devices/{deviceId} {" -ForegroundColor Gray
Write-Host "    allow read, write: if request.auth != null && request.auth.uid == uid;" -ForegroundColor Gray
Write-Host "  }" -ForegroundColor Gray
Write-Host ""

Write-Host "Press any key to exit..." -ForegroundColor Cyan
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
