# GPS Tracker - Development Startup Script
# Starts frontend server only (Serverless Mode)

Write-Host "🚀 Starting GPS Tracker App (Serverless)..." -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is installed
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js is not installed. Please install Node.js first." -ForegroundColor Red
    exit 1
}

# Install frontend dependencies if node_modules doesn't exist
if (-not (Test-Path "node_modules")) {
    Write-Host "📦 Installing frontend dependencies..." -ForegroundColor Yellow
    npm install
}

Write-Host ""
Write-Host "✅ Dependencies checked!" -ForegroundColor Green
Write-Host ""

# Start frontend server
Write-Host "🌐 Starting frontend server..." -ForegroundColor Cyan
npm run dev
Write-Host "🎨 Starting frontend server on port 5173 (HTTPS)..." -ForegroundColor Cyan
Write-Host ""
Write-Host "📍 Frontend: https://localhost:5173" -ForegroundColor Green
Write-Host "🔌 Backend:  https://localhost:8000" -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  Note: Both frontend and backend use HTTPS with self-signed certificates" -ForegroundColor Yellow
Write-Host "    You may need to accept certificate warnings in your browser" -ForegroundColor Yellow
Write-Host ""
npm run dev
