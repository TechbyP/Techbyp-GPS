# Generates local TLS certificates with mkcert for frontend (Vite) and backend (FastAPI)
# Works for desktop browsers and Android devices (after installing the mkcert root CA)

$ErrorActionPreference = 'Stop'

Write-Host "🔐 Generating local TLS certificates with mkcert" -ForegroundColor Cyan

# Ensure mkcert exists
if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    Write-Host "mkcert is not installed." -ForegroundColor Yellow
    Write-Host "Install via Chocolatey (admin prompt):  choco install mkcert" -ForegroundColor Yellow
    Write-Host "Then rerun this script." -ForegroundColor Yellow
    exit 1
}

# Collect hostnames/IPs to include
$certDir = Join-Path $PSScriptRoot "certs"
if (-not (Test-Path $certDir)) { New-Item -ItemType Directory -Path $certDir | Out-Null }

# Get LAN IPv4 addresses (exclude loopback/APIPA)
$lanIps = (Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.IPAddress -notmatch '^169\.254\.' }).IPAddress
if (-not $lanIps) { $lanIps = @() }

# Build SAN list
$names = @('localhost', '127.0.0.1', '::1') + $lanIps

Write-Host "Including hostnames/IPs:" ($names -join ', ')

# Install root CA (creates if missing)
Write-Host "➡️  Ensuring mkcert root CA is installed..." -ForegroundColor Cyan
mkcert -install

# Generate cert/key for both frontend and backend
$certPath = Join-Path $certDir "cert.pem"
$keyPath  = Join-Path $certDir "key.pem"

Write-Host "➡️  Generating certs at $certDir" -ForegroundColor Cyan
mkcert -cert-file $certPath -key-file $keyPath @names

Write-Host "✅ Done"
Write-Host "Frontend (Vite) will auto-use certs if they exist." -ForegroundColor Green
Write-Host "Backend: run with  USE_SSL=1  to enable HTTPS (uses the same certs)." -ForegroundColor Green
Write-Host "Android: transfer mkcert root CA to the device and install as user CA." -ForegroundColor Green

Write-Host "Root CA locations (for import):" -ForegroundColor Cyan
Write-Host "Windows: $env:LOCALAPPDATA\mkcert\rootCA.pem" -ForegroundColor Yellow
Write-Host "Then copy to phone and install (Settings > Security > Encryption & credentials > Install a certificate)." -ForegroundColor Yellow
