# ZENAA - upload the latest changes to GitHub (after the first-time setup).
# Saves every changed file as a new version and pushes it. Servers then get it with Backup & updates -> Update now.
# Run with: tools\ZENAA-publish-update.cmd
param(
  [string]$Message = '',
  [switch]$Yes
)
# Git writes normal progress to stderr; Windows PowerShell 5.1 would treat that as an error, so rely on exit codes.
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Fail($t) { Say ""; Say "STOPPED: $t" 'Red'; Say ""; exit 1 }

Say ""
Say "=== ZENAA GAMEHUB - publish an update to GitHub ===" 'Cyan'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail "Git is not installed (https://git-scm.com/download/win)." }
if (-not (Test-Path (Join-Path $root '.git'))) { Fail "This folder is not on GitHub yet. Run tools\ZENAA-GitHub-setup.cmd first." }
$remote = (& git remote get-url origin) 2>$null
if (-not $remote) { Fail "No GitHub address set. Run tools\ZENAA-GitHub-setup.cmd first." }

$ver = (Get-Content (Join-Path $root 'server\package.json') -Raw | ConvertFrom-Json).version
& git add -A
$staged = & git diff --cached --name-only
foreach ($f in $staged) {
  if ($f -match '(^|/)\.env$|\.keystore$|\.dump$|(^|/)backups/') { & git reset -q; Fail "Refusing to upload a secret file: $f (check .gitignore)" }
}
if (-not $staged) {
  Say "No changes since the last upload."
} else {
  Say "Version in server\package.json: v$ver" 'Yellow'
  Say "Changed files: $(@($staged).Count)"
  $staged | Select-Object -First 15 | ForEach-Object { Say "  $_" }
  if (@($staged).Count -gt 15) { Say "  ..." }
  $lastVer = (& git log -1 --format=%s) 2>$null
  if ($lastVer -match "v$([regex]::Escape($ver))\b") { Say "Note: servers only see 'update available' when the version number goes up (server\package.json)." 'Yellow' }
  if (-not $Message) {
    $Message = (Read-Host "Short note for this update (Enter = 'ZENAA GAMEHUB v$ver')").Trim()
    if (-not $Message) { $Message = "ZENAA GAMEHUB v$ver" }
  }
  & git commit -q -m $Message
  if ($LASTEXITCODE -ne 0) { Fail "Could not save the changes." }
}

$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
Say "Uploading to $remote ($branch)..."
& git push -u origin $branch 2>&1 | ForEach-Object { Say "  $_" }
if ($LASTEXITCODE -ne 0) {
  Say "Upload failed. If GitHub has changes this PC doesn't have, run:  git pull --rebase origin $branch   then try again." 'Red'
  exit 1
}
# Tag the version once, so GitHub lists it under Tags/Releases.
& git rev-parse -q --verify "refs/tags/v$ver" *> $null
if ($LASTEXITCODE -ne 0) {
  & git tag "v$ver" 2>$null
  & git push -q origin "v$ver" 2>$null
}
Say ""
Say "Published. On each ZENAA server: Backup & updates -> Check now -> Update now." 'Green'
Say ""
