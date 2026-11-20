# Alta Capital - Harness Intel Arc GPU for Local AI Models (Ollama Vulkan Backend)
# Pure ASCII for full Windows PowerShell 5.1 compatibility.
# Enables OLLAMA_VULKAN=1 + Flash Attention + Q8_0 KV Cache, restarts Ollama cleanly,
# runs a live warm-up benchmark on qwen2.5:3b, and verifies GPU offload via `ollama ps`.

$ErrorActionPreference = "Stop"

Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  Alta Capital - Intel Arc GPU Accelerator Setup (Ollama)" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan

# 1. Detect GPUs on this Windows machine
Write-Host "[1/4] Detecting installed GPUs..." -ForegroundColor Yellow
$gpus = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue
$hasIntelArc = $false
foreach ($g in $gpus) {
  $vramGB = if ($g.AdapterRAM -gt 0) { [math]::Round($g.AdapterRAM / 1GB, 1) } else { "Shared/Dynamic" }
  Write-Host "  GPU: $($g.Name) | Driver: $($g.DriverVersion) | Status: $($g.Status) | RAM: $vramGB" -ForegroundColor White
  if ($g.Name -match "Intel.*Arc") {
    $hasIntelArc = $true
  }
}

if ($hasIntelArc) {
  Write-Host "  Intel Arc GPU detected! Configuring Vulkan GPU acceleration..." -ForegroundColor Green
} else {
  Write-Host "  Configuring Vulkan GPU acceleration for detected GPU(s)..." -ForegroundColor Yellow
}

# 2. Persist GPU acceleration environment variables for Ollama
Write-Host "[2/4] Setting Ollama GPU environment variables (User scope)..." -ForegroundColor Yellow
$envMap = @{
  "OLLAMA_VULKAN"          = "1"
  "OLLAMA_FLASH_ATTENTION" = "1"
  "OLLAMA_KV_CACHE_TYPE"   = "q8_0"
  "OLLAMA_KEEP_ALIVE"      = "15m"
  "OLLAMA_NUM_PARALLEL"    = "2"
  "OLLAMA_ORIGINS"         = "*"
  "OLLAMA_HOST"            = "0.0.0.0:11434"
}

foreach ($k in $envMap.Keys) {
  $v = $envMap[$k]
  [Environment]::SetEnvironmentVariable($k, $v, "User")
  Set-Item -Path "Env:$k" -Value $v
  Write-Host "  $k=$v" -ForegroundColor Gray
}

# Refresh PATH so ollama is always found
$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machinePath;$userPath"

$ollamaExe = "ollama"
$ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollamaCmd) {
  $fallback = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
  if (Test-Path $fallback) { $ollamaExe = $fallback } else { throw "Ollama not found. Run npm run setup:local-ai:win first." }
}

# 3. Restart Ollama cleanly so it boots WITH OLLAMA_VULKAN=1
Write-Host "[3/4] Restarting Ollama with Intel Arc Vulkan backend active..." -ForegroundColor Yellow
Get-Process -Name "ollama*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
Start-Sleep -Seconds 3

# Verify API up
$tags = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 8
$modelNames = @($tags.models | ForEach-Object { $_.name })
if ($modelNames.Count -eq 0) {
  throw "No Ollama models installed. Run npm run setup:local-ai:win first."
}
Write-Host "  Ollama serving models: $($modelNames -join ', ')" -ForegroundColor Green

# 4. Warm up a model and inspect GPU offload percentage via /api/ps + ollama ps
$testModel = if ($modelNames -contains "qwen2.5:3b") { "qwen2.5:3b" } else { $modelNames[0] }
Write-Host "[4/4] Running GPU acceleration test on $testModel ..." -ForegroundColor Yellow

$body = @{
  model = $testModel
  prompt = "Reply with OK in one word."
  stream = $false
  options = @{ num_predict = 12 }
} | ConvertTo-Json -Depth 4

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$gen = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/generate" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 60
$sw.Stop()

$tps = if ($gen.eval_duration -gt 0) { [math]::Round($gen.eval_count / ($gen.eval_duration / 1e9), 1) } else { 0 }
Write-Host "  Response: $($gen.response.Trim()) | Speed: $tps tokens/sec | Time: $([math]::Round($sw.Elapsed.TotalSeconds, 1))s" -ForegroundColor Cyan

Write-Host ""
Write-Host "Live GPU Offload Check (ollama ps):" -ForegroundColor Yellow
& $ollamaExe ps

try {
  $psJson = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/ps" -TimeoutSec 5
  foreach ($rm in $psJson.models) {
    $total = [double]$rm.size
    $vram = [double]$rm.size_vram
    $gpuPct = if ($total -gt 0) { [math]::Round(($vram / $total) * 100, 0) } else { 0 }
    if ($gpuPct -gt 0) {
      Write-Host "  SUCCESS! $($rm.name) is running ${gpuPct}% on Intel Arc GPU ($([math]::Round($vram / 1GB, 2)) GB VRAM)!" -ForegroundColor Green
    } else {
      Write-Host "  NOTICE: $($rm.name) reported 0% VRAM offload." -ForegroundColor Yellow
      Write-Host "  If your Intel Arc driver is older, update Intel Arc Graphics Driver (Vulkan 1.3+) from intel.com and re-run this script." -ForegroundColor Yellow
      Write-Host "  Alternative: Install LM Studio (supports Intel Arc Vulkan/SYCL natively) on port 1234 - Alta Capital auto-detects it too!" -ForegroundColor Yellow
    }
  }
} catch {
  Write-Host "  Could not query /api/ps: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "==============================================================" -ForegroundColor Cyan
