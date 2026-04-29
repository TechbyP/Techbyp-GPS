# GPS Tracker - Network Access Setup
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "GPS Tracker - Network Access Setup" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")

if (-not $isAdmin) {
    Write-Host "[ERROR] This script requires Administrator privileges!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please right-click PowerShell and select Run as Administrator" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[OK] Running with Administrator privileges" -ForegroundColor Green
Write-Host ""

function New-FirewallRule {
    param(
        [string]$Name,
        [int]$Port,
        [string]$Description
    )
    
    try {
        $existingRule = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
        if ($existingRule) {
            Write-Host "Removing existing rule: $Name" -ForegroundColor Yellow
            Remove-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
        }
        
        Write-Host "Creating firewall rule: $Name (Port $Port)" -ForegroundColor Cyan
        New-NetFirewallRule -DisplayName $Name -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Description $Description -ErrorAction Stop
        
        Write-Host "Successfully created: $Name" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host "Failed to create: $Name - $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

Write-Host "Configuring firewall rules for GPS Tracker..." -ForegroundColor Cyan
Write-Host ""

$backend = New-FirewallRule -Name "GPS Tracker - Backend API" -Port 8000 -Description "Allow access to GPS Tracker Backend API on port 8000"
$frontend = New-FirewallRule -Name "GPS Tracker - Frontend Dev" -Port 5173 -Description "Allow access to GPS Tracker Frontend Development Server on port 5173"

Write-Host ""
Write-Host "Network Access Configuration Summary" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

if ($backend -and $frontend) {
    Write-Host "[SUCCESS] All firewall rules configured successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your GPS Tracker is now accessible from other devices!" -ForegroundColor Green
    Write-Host ""
    Write-Host "To access from mobile/tablet:" -ForegroundColor Yellow
    Write-Host ""
    
    $ipAddresses = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
        $_.InterfaceAlias -notlike "*Loopback*" -and 
        $_.IPAddress -notlike "169.254.*" 
    }
    
    if ($ipAddresses) {
        Write-Host "   Use one of these URLs:" -ForegroundColor Cyan
        foreach ($ip in $ipAddresses) {
            Write-Host "   http://$($ip.IPAddress):5173" -ForegroundColor White
        }
    } else {
        Write-Host "   http://YOUR_PC_IP:5173" -ForegroundColor White
        Write-Host "   (Replace YOUR_PC_IP with your IP address)" -ForegroundColor Gray
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
    Write-Host "Please check Windows Firewall settings manually." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Setup complete! Press Enter to continue..." -ForegroundColor Cyan
Read-Host
