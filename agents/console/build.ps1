# Builds zenaa-ps4.elf and zenaa-ps5.elf in Docker and copies them to server\console (shipped inside the ZENAA image).
# Run:  powershell -ExecutionPolicy Bypass -File agents\console\build.ps1
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here '..\..\server\console'
New-Item -ItemType Directory -Force $out | Out-Null
docker build --progress=plain -f (Join-Path $here 'Dockerfile.build') -t zenaa-console-builder $here 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) { Write-Host 'Console payload build failed (see the messages above)'; exit 1 }
$id = (docker create zenaa-console-builder).Trim()
foreach ($f in 'zenaa-ps4.elf', 'zenaa-ps5.elf') { docker cp "${id}:/out/$f" (Join-Path $out $f) }
docker rm $id | Out-Null
Write-Host "Built payloads in $((Resolve-Path $out).Path)"
