# Installs the ZENAA updater on the server PC: it starts hidden every time you sign in to Windows.
# Run once (as the Windows user that runs Docker Desktop):
#   powershell -ExecutionPolicy Bypass -File infra\updater\install-updater.ps1
# Remove it again:  powershell -ExecutionPolicy Bypass -File infra\updater\install-updater.ps1 -Remove
param([switch]$Remove)
$name = 'ZENAA Updater'
$script = Join-Path $PSScriptRoot 'zenaa-updater.ps1'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*zenaa-updater.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Write-Host 'ZENAA Updater removed.'
  exit 0
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Installs ZENAA updates when you press Update now in ZENAA' -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "Installed and started '$name'. ZENAA -> Backup & updates should show 'Updater on the PC: Running' within a minute."
