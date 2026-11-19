# Alta Capital — One-Click Free Local AI Models Installer for Windows (Ollama GPU/CPU)
# Uses your local PC's GPU/CPU compute to add unlimited free AI models directly to Alta Capital's AI pool.
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-local-ai-windows.ps1

$ErrorActionPreference = "Stop"

Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  Alta Capital — Local Machine Free AI Models Setup (Ollama)" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan

# 1. Detect total RAM (GB)
$ramBytes = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
$ramGB = [math]::Round($ramBytes / 1GB, 1)
Write-Host "Detected System RAM: $ramGB GB" -ForegroundColor Gray

# 2. Configure CORS & LAN access so browser + Base Server + phone can share local PC compute
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "User")
$env:OLLAMA_ORIGINS = "*"
$env:OLLAMA_HOST = "0.0.0.0:11434"
Write-Host "Configured OLLAMA_ORIGINS=* and OLLAMA_HOST=0.0.0.0:11434" -ForegroundColor Green

# 3. Install Ollama if not present
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCmd) {
  Write-Host "Installing Ollama (free open-source local LLM runtime)..." -ForegroundColor Yellow
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
  } else {
    $installer = Join-Path $env:TEMP "OllamaSetup.exe"
    Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $installer
    Start-Process -FilePath $installer -ArgumentList "/VERYSILENT" -Wait
  }
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
  if (-not $ollamaCmd) {
    $fallbackBin = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path $fallbackBin) { $ollamaExe = $fallbackBin } else { throw "Ollama installed — please reopen PowerShell and re-run this script." }
  } else {
    $ollamaExe = $ollamaCmd.Source
  }
} else {
  $ollamaExe = $ollamaCmd.Source
  Write-Host "Ollama already installed: $ollamaExe" -ForegroundColor Green
}

# 4. Ensure Ollama service is running with CORS enabled
$running = $false
try {
  Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 2 | Out-Null
  $running = $true
} catch {
  Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

# 5. Select free open-source models based on local machine RAM
$models = @("qwen2.5:3b", "llama3.2:3b")
if ($ramGB -ge 12) {
  $models += "qwen2.5:7b"
  $models += "deepseek-r1:7b"
}
if ($ramGB -ge 24) {
  $models += "qwen2.5-coder:7b"
}

Write-Host ""
Write-Host "Downloading free open-source models suited for $ramGB GB RAM:" -ForegroundColor Cyan
foreach ($m in $models) {
  Write-Host "  -> Pulling $m ..." -ForegroundColor Yellow
  & $ollamaExe pull $m
}

# 6. Verify OpenAI-compatible endpoint
Write-Host ""
Write-Host "Testing local AI endpoint (http://127.0.0.1:11434/v1)..." -ForegroundColor Cyan
$tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
$names = ($tags.models | ForEach-Object { $_.name }) -join ", "
Write-Host "Installed local models ready: $names" -ForegroundColor Green

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "  DONE! Your PC's GPU/CPU is now powering Alta Capital AI!" -ForegroundColor Green
Write-Host "  1. Open Alta Capital (or start Base Server: npm run base-server)" -ForegroundColor White
Write-Host "  2. All installed models auto-register into the AI Pool." -ForegroundColor White
Write-Host "  3. Restart Ollama if it was already open before running this script." -ForegroundColor Gray
Write-Host "==============================================================" -ForegroundColor Green
