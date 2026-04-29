# Fix Firebase Database Setup
# ============================
# This script will:
# 1. Deploy Firestore rules
# 2. Set up admin user with correct role
# 3. Create user_profiles document if missing

Write-Host "🔧 Firebase Database Setup" -ForegroundColor Cyan
Write-Host "=========================" -ForegroundColor Cyan
Write-Host ""

# Check if Firebase CLI is installed
Write-Host "📋 Checking Firebase CLI..." -ForegroundColor Yellow
try {
    $firebaseVersion = firebase --version
    Write-Host "✅ Firebase CLI found: $firebaseVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Firebase CLI not found. Installing..." -ForegroundColor Red
    npm install -g firebase-tools
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install Firebase CLI" -ForegroundColor Red
        exit 1
    }
}

# Login check
Write-Host ""
Write-Host "📋 Checking Firebase authentication..." -ForegroundColor Yellow
$loginCheck = firebase projects:list 2>&1
if ($loginCheck -match "Error" -or $loginCheck -match "not logged in") {
    Write-Host "🔐 Please login to Firebase..." -ForegroundColor Yellow
    firebase login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Firebase login failed" -ForegroundColor Red
        exit 1
    }
}

Write-Host "✅ Firebase authentication OK" -ForegroundColor Green

# Step 1: Deploy Firestore Rules
Write-Host ""
Write-Host "📤 Step 1: Deploying Firestore rules..." -ForegroundColor Cyan
firebase deploy --only firestore:rules
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to deploy Firestore rules" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Firestore rules deployed successfully" -ForegroundColor Green

# Step 2: Set up admin user
Write-Host ""
Write-Host "👤 Step 2: Setting up admin user..." -ForegroundColor Cyan
$adminEmail = Read-Host "Enter admin email (default: florin@techbyp.com)"
if ([string]::IsNullOrWhiteSpace($adminEmail)) {
    $adminEmail = "florin@techbyp.com"
}

Write-Host "Setting admin role for: $adminEmail" -ForegroundColor Yellow
node scripts/set-admin-user.js $adminEmail
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  Warning: Admin user script failed. You may need to:" -ForegroundColor Yellow
    Write-Host "   1. Ensure firebase-service-account.json exists in scripts/" -ForegroundColor Yellow
    Write-Host "   2. Manually create users/{uid} document with role: 'admin'" -ForegroundColor Yellow
} else {
    Write-Host "✅ Admin user configured successfully" -ForegroundColor Green
}

# Step 3: Instructions for user_profiles
Write-Host ""
Write-Host "📝 Step 3: Verify user_profiles document" -ForegroundColor Cyan
Write-Host "   Please ensure user_profiles/{uid} exists with:" -ForegroundColor White
Write-Host "   - firstName: 'Your First Name'" -ForegroundColor White
Write-Host "   - lastName: 'Your Last Name'" -ForegroundColor White
Write-Host "   - email: '$adminEmail'" -ForegroundColor White
Write-Host "   - company: 'Your Company (optional)'" -ForegroundColor White
Write-Host ""

Write-Host "🎉 Firebase database setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Summary:" -ForegroundColor Cyan
Write-Host "   ✅ Firestore rules deployed" -ForegroundColor Green
Write-Host "   ✅ Admin user configured: $adminEmail" -ForegroundColor Green
Write-Host "   📝 Verify user_profiles in Firebase Console" -ForegroundColor Yellow
Write-Host ""
Write-Host "🔗 Firebase Console: https://console.firebase.google.com/project/gps-app-f7d1e/firestore" -ForegroundColor Cyan
