# GPS Tracker - Windows Firewall Setup
# This script configures Windows Firewall to allow network access to the backend

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "GPS Tracker - Network Access Setup" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "[ERROR] This script requires Administrator privileges!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[OK] Running with Administrator privileges" -ForegroundColor Green
Write-Host ""

# Function to add firewall rule
function Add-FirewallRule {
    param (
        [string]$Name,
        [int]$Port,
        [string]$Protocol = "TCP"
    )
    
    Write-Host "Configuring firewall rule: $Name" -ForegroundColor Yellow
    
    # Remove existing rule if it exists
    $existingRule = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
    if ($existingRule) {
        Write-Host "  Removing existing rule..." -ForegroundColor Gray
        Remove-NetFirewallRule -DisplayName $Name
    }
    
    # Add new rule
    try {
        New-NetFirewallRule `
            -DisplayName $Name `
            -Direction Inbound `
            -Protocol $Protocol `
            -LocalPort $Port `
            -Action Allow `
            -Profile Any `
            -ErrorAction Stop | Out-Null
        Write-Host "  [OK] Rule added successfully" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  [ERROR] Failed to add rule: $_" -ForegroundColor Red
        return $false
    }
}

Write-Host "Adding firewall rules for GPS Tracker..." -ForegroundColor Cyan
Write-Host ""

# Backend API (port 8000)
$backend = Add-FirewallRule -Name "GPS Tracker - Backend API" -Port 8000 -Protocol TCP

# Frontend Dev Server (port 5173)
$frontend = Add-FirewallRule -Name "GPS Tracker - Frontend Dev" -Port 5173 -Protocol TCP

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Network Access Configuration Summary" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

if ($backend -and $frontend) {
    Write-Host "[SUCCESS] All firewall rules configured successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your GPS Tracker is now accessible from other devices on your network!" -ForegroundColor Green
    Write-Host ""
    Write-Host "To access from mobile/tablet:" -ForegroundColor Yellow
    Write-Host ""
    
    # Get local IP addresses
    $ipAddresses = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
        $_.InterfaceAlias -notlike "*Loopback*" -and 
        $_.IPAddress -notlike "169.254.*" 
    }
    
    if ($ipAddresses) {
        Write-Host "   Use one of these URLs:" -ForegroundColor Cyan
        foreach ($ip in $ipAddresses) {
            Write-Host "   >> http://$($ip.IPAddress):5173" -ForegroundColor White
        }
    } else {
        Write-Host "   >> http://YOUR_PC_IP:5173" -ForegroundColor White
        Write-Host "   (Replace YOUR_PC_IP with your computer's IP address)" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "[IMPORTANT] Notes:" -ForegroundColor Yellow
    Write-Host "   - Make sure both backend and frontend are running" -ForegroundColor Gray
    Write-Host "   - Backend: python backend/main.py" -ForegroundColor Gray
    Write-Host "   - Frontend: npm run dev" -ForegroundColor Gray
    Write-Host "   - All devices must be on the same WiFi network" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "Warning: Some firewall rules failed to configure" -ForegroundColor Yellow
    if ($backend) {
        Write-Host "    Backend API (port 8000): OK" -ForegroundColor Green
    } else {
        Write-Host "    Backend API (port 8000): FAILED" -ForegroundColor Red
    }
    if ($frontend) {
        Write-Host "    Frontend Dev (port 5173): OK" -ForegroundColor Green
    } else {
        Write-Host "    Frontend Dev (port 5173): FAILED" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "Please check Windows Firewall settings manually or try running the script again." -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to exit"
