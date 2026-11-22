# Builds ZenaaTV.apk in Docker and copies it to web\public\downloads (served at /downloads/ZenaaTV.apk).
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File agents\android-tv\build-apk.ps1
# (Docker writes progress to stderr, so we check exit codes instead of using ErrorActionPreference=Stop.)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here '..\..\web\public\downloads'
New-Item -ItemType Directory -Force $out | Out-Null
$env:DOCKER_BUILDKIT = '1'
docker build --progress=plain -f (Join-Path $here 'Dockerfile.build') -t zenaa-tv-builder $here 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) { Write-Host 'APK build failed (see the messages above)'; exit 1 }
$id = (docker create zenaa-tv-builder).Trim()
docker cp "${id}:/out/ZenaaTV.apk" (Join-Path $out 'ZenaaTV.apk')
if (-not (Test-Path (Join-Path $here 'zenaa-tv.keystore'))) { docker cp "${id}:/out/zenaa-tv.keystore" (Join-Path $here 'zenaa-tv.keystore') }
docker rm $id | Out-Null
Write-Host "Built $((Resolve-Path (Join-Path $out 'ZenaaTV.apk')).Path)"
