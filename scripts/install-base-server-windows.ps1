# Installs Alta Capital Base Server as a Windows Scheduled Task (auto-starts on logon & stays alive 24/7).
$ErrorActionPreference = "Stop"

$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$NodeBin = (Get-Command node).Source
$EnvFile = Join-Path $RepoDir ".env"
$EnvExample = Join-Path $RepoDir ".env.example"

if (!(Test-Path $EnvFile) -and (Test-Path $EnvExample)) {
  Copy-Item $EnvExample $EnvFile
  Write-Host "Created $EnvFile from .env.example - edit it to add SUPABASE_ANON_KEY / CLOUD_API_URL."
}

$TaskName = "AltaCapitalBaseServer"
$Action = New-ScheduledTaskAction -Execute $NodeBin -Argument "`"$RepoDir\scripts\start-base-server.mjs`"" -WorkingDirectory $RepoDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 0)

$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "Alta Capital Always-On Base Server + Cloud Sync" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Alta Capital Base Server installed and running on Windows!"
Write-Host "  URL: http://localhost:8181"
Write-Host "  Health: http://localhost:8181/api/health"
Write-Host "  To remove: Unregister-ScheduledTask -TaskName $TaskName -Confirm:`$false"
