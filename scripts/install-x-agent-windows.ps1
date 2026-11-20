# Alta Capital - Local X (Twitter) Browser Fundamental Research Agent Setup (Windows)
# Pure ASCII for full Windows PowerShell 5.1 compatibility.
# Installs playwright-core locally (reuses existing Edge/Chrome with zero browser download when found).

$ErrorActionPreference = "Stop"

Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "  Alta Capital - X Browser Fundamental Agent Setup (Roni)" -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required (>=20). Install from https://nodejs.org and re-run."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required. Reopen PowerShell after installing Node.js."
}

Write-Host "[1/3] Installing playwright-core into local node_modules (--no-save)..." -ForegroundColor Yellow
npm install --no-save playwright-core

$profileDir = Join-Path $root "data\x-browser-profile"
if (-not (Test-Path $profileDir)) {
  New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
}

Write-Host "[2/3] Checking installed browsers (Chrome / Microsoft Edge)..." -ForegroundColor Yellow
$browserPaths = @(
  "$env:PROGRAMFILES\Google\Chrome\Application\chrome.exe",
  "${env:PROGRAMFILES(X86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:PROGRAMFILES(X86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:PROGRAMFILES\Microsoft\Edge\Application\msedge.exe"
)

$foundBrowser = $null
foreach ($bp in $browserPaths) {
  if ($bp -and (Test-Path $bp)) {
    $foundBrowser = $bp
    break
  }
}

if ($foundBrowser) {
  Write-Host "  Found system browser: $foundBrowser" -ForegroundColor Green
  Write-Host "  Skipping extra Chromium download (reusing your installed browser)." -ForegroundColor Green
} else {
  Write-Host "  No Chrome/Edge found at default paths. Installing Playwright Chromium..." -ForegroundColor Yellow
  npx playwright-core install chromium
}

Write-Host "[3/3] Verifying X Browser Agent status..." -ForegroundColor Yellow
node scripts/x-browser-agent.mjs --status

Write-Host ""
Write-Host "==============================================================" -ForegroundColor Green
Write-Host "  Roni (X Browser Fundamental Agent) is READY!" -ForegroundColor Green
Write-Host "  Step 1: Open http://localhost:8181/#/fundamentals" -ForegroundColor White
Write-Host "  Step 2: Click 'Open Browser to Login to X' (or run: npm run x-agent:login)" -ForegroundColor White
Write-Host "  Step 3: Sign in once with the X account you created for Roni." -ForegroundColor White
Write-Host "  Step 4: Click 'Run X Fundamental Scan' anytime!" -ForegroundColor White
Write-Host "==============================================================" -ForegroundColor Green
