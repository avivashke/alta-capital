# One command: stop the host copy of the Base Server, start the container (+ optional phone tunnel).
param([switch]$Tunnel)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path .env.docker)) {
  $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 20 | ForEach-Object { [char]$_ })
  "ALTA_BASIC_AUTH=alta:$pw" | Set-Content .env.docker -Encoding ascii
  Write-Host "Created .env.docker. Login for the phone -> user: alta  password: $pw" -ForegroundColor Yellow
}
if (-not (docker info 2>$null)) { throw 'Docker Desktop is not running. Start it and run this again.' }
$t = Get-ScheduledTask -TaskName AltaCapitalBaseServer -ErrorAction SilentlyContinue
if ($t) { Stop-ScheduledTask -TaskName AltaCapitalBaseServer; Write-Host 'Stopped the host Base Server (the container uses the same ./data folder).' }
Get-NetTCPConnection -LocalPort 8181 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
$composeArgs = @('compose', '--env-file', '.env.docker')
if ($Tunnel) { $composeArgs += @('--profile', 'tunnel') }
$composeArgs += @('up', '-d', '--build')
& docker @composeArgs
if ($Tunnel) {
  Start-Sleep 12
  docker compose logs tunnel 2>&1 | Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -Last 1 | ForEach-Object { Write-Host "Phone address: $($_.Matches[0].Value)" -ForegroundColor Green }
}