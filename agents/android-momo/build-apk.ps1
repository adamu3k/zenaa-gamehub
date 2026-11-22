# Builds ZenaaMoMo.apk in Docker and copies it to web\public\downloads (served at /downloads/ZenaaMoMo.apk).
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File agents\android-momo\build-apk.ps1
# (Docker writes progress to stderr, so we check exit codes instead of using ErrorActionPreference=Stop.)
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here '..\..\web\public\downloads'
New-Item -ItemType Directory -Force $out | Out-Null
$env:DOCKER_BUILDKIT = '1'
docker build --progress=plain -f (Join-Path $here 'Dockerfile.build') -t zenaa-momo-builder $here 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) { Write-Host 'APK build failed (see the messages above)'; exit 1 }
$id = (docker create zenaa-momo-builder).Trim()
docker cp "${id}:/out/ZenaaMoMo.apk" (Join-Path $out 'ZenaaMoMo.apk')
if (-not (Test-Path (Join-Path $here 'zenaa-momo.keystore'))) { docker cp "${id}:/out/zenaa-momo.keystore" (Join-Path $here 'zenaa-momo.keystore') }
docker rm $id | Out-Null
Write-Host "Built $((Resolve-Path (Join-Path $out 'ZenaaMoMo.apk')).Path)"
