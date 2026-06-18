# Copy APK to public folder for download
$apkSource = "android\app\build\outputs\apk\debug\app-debug.apk"
$apkDest = "public\TECHBYP-GPS Pro.apk"
$downloadUrl = "http://localhost:5173/TECHBYP-GPS%20Pro.apk"

if (Test-Path $apkSource) {
    Write-Host "📦 Copying APK to public folder..." -ForegroundColor Cyan
    Copy-Item $apkSource $apkDest -Force
    
    $size = (Get-Item $apkDest).Length / 1MB
    Write-Host "✅ APK copied successfully! Size: $([math]::Round($size, 2)) MB" -ForegroundColor Green
    Write-Host "📍 Location: $apkDest" -ForegroundColor Gray
    Write-Host "`n💡 The APK is now available at: $downloadUrl" -ForegroundColor Cyan
} else {
    Write-Host "❌ APK not found at: $apkSource" -ForegroundColor Red
    Write-Host "💡 Build the APK first in Android Studio" -ForegroundColor Yellow
    Write-Host "   Build -> Build Bundles / APKs -> Build APKs" -ForegroundColor Gray
}
