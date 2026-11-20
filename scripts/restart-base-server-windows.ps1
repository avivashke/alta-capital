# Alta Capital - Clean Base Server Restart on Windows (Pure ASCII for PowerShell 5.1)
# Stops any existing node server.mjs listening on port 8181 and starts a fresh instance.

$ErrorActionPreference = "SilentlyContinue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "Stopping existing Alta Capital Base Server on port 8181 (if running)..." -ForegroundColor Yellow

$conns = Get-NetTCPConnection -LocalPort 8181 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  if ($c.OwningProcess -gt 0) {
    Write-Host "  Stopping PID $($c.OwningProcess)..." -ForegroundColor Gray
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

$task = Get-ScheduledTask -TaskName "AltaCapitalBaseServer" -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName "AltaCapitalBaseServer" -ErrorAction SilentlyContinue
  try {
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
    Set-ScheduledTask -TaskName "AltaCapitalBaseServer" -Principal $principal -ErrorAction SilentlyContinue | Out-Null
  } catch {}
  Start-Sleep -Seconds 1
}

Start-Sleep -Seconds 1
Start-Process -FilePath "node" -ArgumentList "scripts/start-base-server.mjs" -WorkingDirectory $root -WindowStyle Minimized
Start-Sleep -Seconds 2
Write-Host "Started Alta Capital Base Server in your interactive desktop session (Chrome popups enabled)." -ForegroundColor Green

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:8181/api/health" -TimeoutSec 5
  Write-Host "Base Server LIVE at http://localhost:$($health.port) (uptime $($health.uptimeSec)s)" -ForegroundColor Cyan
} catch {
  Write-Host "Base Server is starting up... open http://localhost:8181 in a few seconds." -ForegroundColor Yellow
}
