# ZENAA updater (Windows). Runs in the background on the server PC (installed by install-updater.ps1).
# When someone presses "Update now" in ZENAA (Backup & updates), ZENAA writes updates\request.json.
# This script then: backs up the database, downloads the new version with git, rebuilds and restarts ZENAA,
# and writes its progress to updates\status.json so the page can show it.
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$upd = Join-Path $root 'updates'
$backups = Join-Path $root 'backups'
New-Item -ItemType Directory -Force $upd, $backups | Out-Null
$log = Join-Path $upd 'updater.log'

function Write-Status($state, $message) {
  $o = @{ state = $state; message = $message; at = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText((Join-Path $upd 'status.json'), $o)
  Add-Content $log "$(Get-Date -Format s)  $state  $message"
}

function Run($what, [scriptblock]$cmd) {
  $out = & $cmd 2>&1 | Out-String
  Add-Content $log $out
  if ($LASTEXITCODE -ne 0) { throw "$what failed: $($out.Trim() -split "`n" | Select-Object -Last 3 | Out-String)" }
  return $out
}

Set-Location $root
while ($true) {
  [IO.File]::WriteAllText((Join-Path $upd 'heartbeat'), (Get-Date).ToString('o'))
  $reqFile = Join-Path $upd 'request.json'
  if (Test-Path $reqFile) {
    $req = Get-Content $reqFile -Raw | ConvertFrom-Json
    Remove-Item $reqFile -Force
    try {
      if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is not installed on the server PC — install Git for Windows (git-scm.com), then try again.' }
      if (-not (Test-Path (Join-Path $root '.git'))) { throw "This folder is not a git copy of the project yet. See Help -> 17 (first-time GitHub setup)." }
      Write-Status 'running' 'Backing up the database…'
      $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
      Run 'Backup' { docker compose exec -T db sh -c "pg_dump -U zenaa --format=custom --file=/tmp/before-update.dump zenaa" }
      Run 'Backup copy' { docker compose cp "db:/tmp/before-update.dump" (Join-Path $backups "zenaa-before-update-$ts.dump") }
      $branch = if ($req.branch) { $req.branch } else { 'main' }
      Write-Status 'running' "Downloading the new version ($branch)…"
      Run 'git pull' { git -C $root pull --ff-only origin $branch }
      Write-Status 'running' 'Rebuilding and restarting ZENAA (2–5 minutes)…'
      Run 'docker compose' { docker compose up -d --build }
      $ver = (Get-Content (Join-Path $root 'server\package.json') -Raw | ConvertFrom-Json).version
      Write-Status 'done' "Updated to $ver"
    } catch {
      Write-Status 'failed' $_.Exception.Message
    }
  }
  Start-Sleep -Seconds 15
}
