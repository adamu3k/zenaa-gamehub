# ZENAA MoMo phone setup (Plan B): installs ZenaaMoMo.apk on the MoMo phone from this PC, with SMS already allowed.
#
# Why: Android blocks the SMS permission ("restricted setting") for apps installed from a browser, WhatsApp or a
# file manager, and Google Play Protect may refuse such apps altogether. Apps installed from a PC with Android's own
# tool (adb) are not restricted, and the SMS permission can be granted at install time.
#
# Run: double-click tools\ZENAA-MoMo-phone-setup.cmd (or: powershell -ExecutionPolicy Bypass -File tools\momo-phone-setup.ps1)

$ErrorActionPreference = 'Continue'
$pkg = 'com.zenaa.momo'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolsDir = Join-Path $env:LOCALAPPDATA 'ZenaaTools'
$adb = Join-Path $toolsDir 'platform-tools\adb.exe'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Step($text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ''; Write-Host $text -ForegroundColor Red; Write-Host ''; Read-Host 'Press Enter to close' | Out-Null; exit 1 }
function Adb { & $adb @args 2>&1 | ForEach-Object { "$_" } }

Say 'ZENAA MoMo phone setup' 'White'
Say 'Installs the ZENAA MoMo app on the phone with the MoMo SIM, with SMS permission already allowed.'

# 1. Android's PC tool (adb), from Google
Step '1/5  Android tools'
if (-not (Test-Path $adb)) {
    Say 'Downloading Android platform-tools from Google (about 7 MB)...'
    New-Item -ItemType Directory -Force $toolsDir | Out-Null
    $zip = Join-Path $toolsDir 'platform-tools.zip'
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip
        Expand-Archive -Force $zip $toolsDir
        Remove-Item $zip -ErrorAction SilentlyContinue
    } catch { Fail "Could not download the Android tools: $($_.Exception.Message). Check the internet connection and try again." }
}
if (-not (Test-Path $adb)) { Fail 'The Android tools are missing after the download.' }
Say 'OK' 'Green'

# 2. The app file
Step '2/5  The ZENAA MoMo app'
$apk = Join-Path $here '..\web\public\downloads\ZenaaMoMo.apk'
if (-not (Test-Path $apk)) {
    $apk = Join-Path $toolsDir 'ZenaaMoMo.apk'
    try { Invoke-WebRequest -UseBasicParsing 'http://localhost:8080/downloads/ZenaaMoMo.apk' -OutFile $apk }
    catch { Fail 'Could not find ZenaaMoMo.apk. Run this on the ZENAA server PC while ZENAA is running.' }
}
$apk = (Resolve-Path $apk).Path
Say "OK  ($apk)" 'Green'

# 3. Connect the phone
Step '3/5  Connect the phone'
Say 'On the MoMo phone:'
Say '  a) Settings -> About phone -> tap "Build number" 7 times (Samsung: About phone -> Software information).'
Say '     It says "You are now a developer".'
Say '  b) Settings -> System -> Developer options (Samsung: at the bottom of Settings) -> turn on "USB debugging".'
Say '     If you see "Verify apps over USB", turn it OFF.'
Say '  c) Connect the phone to this PC with a USB cable (a data cable, not charge-only).'
Say '     If the phone asks "Use USB for", choose "File transfer".'
Say '  d) The phone asks "Allow USB debugging?" -> tick "Always allow from this computer" -> Allow.'
Say ''
Say 'No cable? Type W and Enter to connect over Wi-Fi instead (Android 11+, same Wi-Fi as this PC).' 'DarkGray'
$choice = Read-Host 'Press Enter when the phone is connected (or W for Wi-Fi)'
Adb start-server | Out-Null
if ($choice -match '^[wW]') {
    Say 'On the phone: Developer options -> Wireless debugging -> turn on -> "Pair device with pairing code".'
    $pairAt = Read-Host 'Type the IP address & Port shown under the pairing code (e.g. 192.168.1.23:37851)'
    $code = Read-Host 'Type the 6-digit Wi-Fi pairing code'
    Adb pair $pairAt $code | ForEach-Object { Say $_ }
    $connAt = Read-Host 'Now type the IP address & Port shown on the Wireless debugging screen (NOT the pairing one)'
    Adb connect $connAt | ForEach-Object { Say $_ }
}

$state = ''
for ($i = 0; $i -lt 90; $i++) {
    $lines = Adb devices | Where-Object { $_ -match "`t" }
    if ($lines | Where-Object { $_ -match "`tdevice$" }) { $state = 'device'; break }
    if ($lines | Where-Object { $_ -match "`tunauthorized$" }) {
        if ($state -ne 'unauthorized') { Say 'Waiting... look at the phone and tap Allow on "Allow USB debugging?".' 'Yellow' }
        $state = 'unauthorized'
    } elseif ($i -eq 5) { Say 'Waiting for the phone... (check USB debugging is on and the cable carries data)' 'Yellow' }
    Start-Sleep -Seconds 2
}
if ($state -ne 'device') { Fail 'The phone was not found. Check steps a) to d), try another cable or USB port, then run this again.' }
if (@(Adb devices | Where-Object { $_ -match "`tdevice$" }).Count -gt 1) { Fail 'More than one phone is connected. Unplug the others and run this again.' }
$model = (Adb shell getprop ro.product.model) -join ''
$android = (Adb shell getprop ro.build.version.release) -join ''
Say "OK  (connected: $model, Android $android)" 'Green'

# 4. Install with SMS allowed
Step '4/5  Install ZENAA MoMo with SMS allowed'
Say 'Watch the phone: if Google Play Protect asks, choose "Install anyway" (under "More details").' 'Yellow'
$out = Adb install -r -g $apk
$out | ForEach-Object { Say $_ 'DarkGray' }
if (($out -join ' ') -match 'INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match') {
    Say 'An older copy with a different signature is installed. Removing it first (you will pair again)...' 'Yellow'
    Adb uninstall $pkg | Out-Null
    $out = Adb install -r -g $apk
    $out | ForEach-Object { Say $_ 'DarkGray' }
}
if (-not (($out -join ' ') -match 'Success')) {
    $why = ($out -join ' ')
    if ($why -match 'VERIFICATION|USER_RESTRICTED|rejected|blocked') {
        Fail ('The phone refused the install. On the phone: Developer options -> turn OFF "Verify apps over USB"' + "`n" +
              '(Xiaomi/Redmi/POCO: turn ON "Install via USB" - needs a Mi account), and answer "Install anyway" if Play Protect asks. Then run this again.')
    }
    Fail "The install failed: $why"
}
Adb shell pm grant $pkg android.permission.RECEIVE_SMS | Out-Null
Adb shell appops set $pkg ACCESS_RESTRICTED_SETTINGS allow | Out-Null
Adb shell dumpsys deviceidle whitelist "+$pkg" | Out-Null   # don't put the app to sleep
$granted = (Adb shell dumpsys package $pkg) -join "`n"
if ($granted -match 'android.permission.RECEIVE_SMS: granted=true') { Say 'OK  (SMS permission: allowed)' 'Green' }
else { Say 'Installed, but Android did not confirm the SMS permission. Open the app: if it still shows "Allow SMS", follow the steps it shows.' 'Yellow' }

# 5. Open the app
Step '5/5  Open the app and pair'
Adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 | Out-Null
Say 'The app is open on the phone. Now:'
Say '  1) In ZENAA on this PC: Settings -> MoMo top-ups -> "Pair the MoMo phone".'
Say '  2) On the phone: type the server address (e.g. http://192.168.1.10:8080) and the 6-digit code -> Pair.'
Say '  3) Test: send GHS 1 by MoMo to the venue number from another phone. It shows under "Recent" in the app.'
Say ''
Say 'Done. You can unplug the phone. You may turn USB debugging off again (Developer options).' 'Green'
Say 'If Play Protect later says the app is harmful and turns it off: on the MoMo phone only, Play Store -> your picture ->'
Say 'Play Protect -> settings (gear) -> turn off "Scan apps with Play Protect", then open ZENAA MoMo again.'
Write-Host ''
Read-Host 'Press Enter to close' | Out-Null
