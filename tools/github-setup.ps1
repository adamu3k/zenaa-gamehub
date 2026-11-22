# ZENAA - put this folder on GitHub (first time).
# 1. Checks Git is installed.  2. Asks for your empty GitHub repository address.
# 3. Makes sure secrets (.env, signing keys, backups) are NOT uploaded.  4. Uploads everything (Git asks you to sign in to GitHub once).
# Run with: tools\ZENAA-GitHub-setup.cmd   (or: powershell -ExecutionPolicy Bypass -File tools\github-setup.ps1)
param(
  [string]$RepoUrl = '',
  [string]$Name = '',
  [string]$Email = '',
  [switch]$NoPush
)
# Git writes normal progress to stderr; Windows PowerShell 5.1 would treat that as an error, so rely on exit codes.
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Fail($t) { Say "" ; Say "STOPPED: $t" 'Red'; Say ""; exit 1 }
function Git-Run { $out = & git @args 2>&1; if ($LASTEXITCODE -ne 0) { Fail ("git " + ($args -join " ") + ": " + (($out | Out-String).Trim())) }; return $out }

Say ""
Say "=== ZENAA GAMEHUB - put the project on GitHub ===" 'Cyan'
Say ""

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Fail "Git is not installed. Install 'Git for Windows' from https://git-scm.com/download/win (keep the default options), then run this again."
}

# --- 1. Repository address ---
if (-not $RepoUrl) {
  Say "Before you continue, create an EMPTY repository on GitHub:" 'Yellow'
  Say "  1. Sign in at https://github.com  ->  + (top right)  ->  New repository"
  Say "  2. Name: zenaa-gamehub     Visibility: Private (recommended)"
  Say "  3. Do NOT tick 'Add a README', .gitignore or licence  ->  Create repository"
  Say "  4. Copy the HTTPS address it shows, e.g. https://github.com/yourname/zenaa-gamehub.git"
  Say ""
  $RepoUrl = (Read-Host "Paste the repository address").Trim()
}
if ($RepoUrl -match '^https://github\.com/([\w.-]+)/([\w.-]+?)(\.git)?/?$') {
  $owner = $Matches[1]; $repo = $Matches[2]
  $RepoUrl = "https://github.com/$owner/$repo.git"
} elseif ($RepoUrl -match '^[\w.-]+/[\w.-]+$') {
  $owner, $repo = $RepoUrl.Split('/'); $RepoUrl = "https://github.com/$owner/$repo.git"
} elseif (-not ($RepoUrl -match '^(https?://|git@|file://|[A-Za-z]:\\|/)')) {
  Fail "That doesn't look like a GitHub address. It should look like https://github.com/yourname/zenaa-gamehub"
} else { $owner = ''; $repo = '' }

# --- 2. Who you are (shown on each saved version) ---
$curName = (& git config user.name) 2>$null
$curEmail = (& git config user.email) 2>$null
if (-not $Name) { $Name = $curName }
if (-not $Name) { $Name = (Read-Host "Your name for the update history (e.g. Zenaa Admin)").Trim() }
if (-not $Name) { $Name = 'ZENAA admin' }
if (-not $Email) { $Email = $curEmail }
if (-not $Email) {
  $private = if ($owner) { "$owner@users.noreply.github.com" } else { 'zenaa@localhost' }
  $e = (Read-Host "Email for the update history (press Enter to keep your email private: $private)").Trim()
  $Email = if ($e) { $e } else { $private }
}

# --- 3. Local repository ---
if (-not (Test-Path (Join-Path $root '.git'))) {
  Say "Creating the local history..."
  Git-Run init | Out-Null
  Git-Run checkout -B main | Out-Null
}
Git-Run config user.name "$Name" | Out-Null
Git-Run config user.email "$Email" | Out-Null
Git-Run config core.autocrlf false | Out-Null

# Never upload secrets.
$mustIgnore = @('.env', 'backups/x.dump', 'agents/android-tv/zenaa-tv.keystore', 'agents/android-momo/zenaa-momo.keystore', 'server/node_modules/x', 'updates/x')
foreach ($p in $mustIgnore) {
  & git check-ignore -q --no-index $p 2>$null
  if ($LASTEXITCODE -ne 0) { Fail "$p is not in .gitignore - it must never be uploaded. Restore the .gitignore file from the ZENAA download." }
}

Say "Saving the current version..."
Git-Run add -A | Out-Null
$staged = & git diff --cached --name-only
foreach ($f in $staged) {
  if ($f -match '(^|/)\.env$|\.keystore$|\.dump$|(^|/)backups/') { Fail "Refusing to upload a secret file: $f" }
}
$ver = (Get-Content (Join-Path $root 'server\package.json') -Raw | ConvertFrom-Json).version
if ($staged) {
  Git-Run commit -q -m "ZENAA GAMEHUB v$ver" | Out-Null
  Say "  Saved v$ver ($(@($staged).Count) files)." 'Green'
} else {
  Say "  Nothing new to save."
}

# --- 4. Link and upload ---
$remotes = & git remote
if ($remotes -contains 'origin') { Git-Run remote set-url origin $RepoUrl | Out-Null } else { Git-Run remote add origin $RepoUrl | Out-Null }
if ($NoPush) { Say "Linked to $RepoUrl (not uploaded: -NoPush)."; exit 0 }

Say ""
Say "Uploading to GitHub. If a window asks you to sign in, choose 'Sign in with your browser'." 'Yellow'
& git push -u origin main 2>&1 | ForEach-Object { Say "  $_" }
if ($LASTEXITCODE -ne 0) {
  Say ""
  Say "The upload did not finish. Common reasons:" 'Red'
  Say "  - The GitHub repository is not empty (it has a README): create a new EMPTY one, or delete the README there."
  Say "  - Sign-in was cancelled: run this again."
  Say "  - The address is wrong: run this again and paste the address from the repository page."
  exit 1
}

Say ""
Say "Done! Your project is on GitHub: $($RepoUrl -replace '\.git$','')" 'Green'
Say ""
Say "Next (once):" 'Cyan'
if ($owner) { Say "  1. ZENAA -> Settings -> Updates -> GitHub repository:  $owner/$repo   branch: main  -> Save settings" }
else { Say "  1. ZENAA -> Settings -> Updates -> GitHub repository: owner/name  branch: main -> Save settings" }
Say "  2. Install the updater on the server PC (starts with Windows):"
Say "       powershell -ExecutionPolicy Bypass -File infra\updater\install-updater.ps1"
Say "  3. Later, to upload new changes: double-click tools\ZENAA-publish-update.cmd"
Say ""
